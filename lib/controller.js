import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { WorkspaceLayout, WorkspaceManager } from './workspace.js';

import { WindowWrapper } from './window.js';
import { Logger } from './logger.js';
import { MonitorManager } from './monitor.js';
import { DragManager } from './drag.js';
import { TILABLE_WINDOW_TYPES } from './signals.js';

/**
 * TilingController: The central orchestration layer.
 * Manages WorkspaceLayouts and implements an event-driven One-Shot Signal Intercept.
 */
export class TilingController {
    static activeInstance = null;

    constructor(settings) {
        if (TilingController.activeInstance) {
            throw new Error("WorkflowTiling: Stale TilingController instance still active!");
        }
        TilingController.activeInstance = this;

        this._windowWrappers = new Map(); // window -> WindowWrapper
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
        this._restoringWindows = new Map(); // transient: windows mid-restore from evacuation

        this.settings = settings;
        this.escalator = null;
        this.monitorManager = new MonitorManager(this);
        this.workspaceManager = new WorkspaceManager(this);
        this.dragManager = new DragManager(this);

        /** 
         * When true, layout re-evaluations are deferred. 
         * Used to prevent layout thrashing during multi-monitor setup/teardown.
         */
        this._batchMode = false;
    }

    setBatchMode(mode) {
        this._batchMode = mode;
    }

    setEscalator(escalator) {
        this.escalator = escalator;
        this.workspaceManager.clearLayouts();
    }


    clearRestoringWindows() {
        this._restoringWindows.clear();
    }

    addRestoringWindow(window, slot) {
        this._restoringWindows.set(window, slot);
    }

    updateWindowWrapperMonitor(window, monitorId, monitorIndex) {
        const wrapper = this._windowWrappers.get(window);
        if (wrapper) {
            wrapper.monitorId = monitorId;
            wrapper.monitorIndex = monitorIndex;
        }
    }

    /**
     * Registers a window and initiates the One-Shot Signal sequence.
     */
    tilingRequest(window) {
        if (window.unmanaged) {
            Logger.debug(`tilingRequest: Rejected unmanaged window`);
            return;
        }

        Logger.debug(`tilingRequest: Initiating for window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}")`);

        let wrapper = this._ensureWrapper(window);
        if (!wrapper) {
            Logger.debug(`tilingRequest: Aborted. Wrapper creation rejected window.`);
            return;
        }

        wrapper.bindSignals();
        wrapper.bindSizeChanged();

        try {
            const context = this._resolveTilingContext(window, wrapper);
            if (!context) {
                Logger.debug(`tilingRequest: Aborted. No context resolved.`);
                return;
            }

            const { workspace, monitorIndex, monitorId, isRestoring, preferredSlot } = context;
            Logger.debug(`tilingRequest: Context resolved -> Workspace: ${workspace.index ? workspace.index() : 'unknown'}, MonitorIndex: ${monitorIndex}, MonitorID: ${monitorId}, Restoring: ${isRestoring}`);

            if (this.monitorManager.checkEvacuation(window, wrapper, monitorId, workspace)) {
                Logger.debug(`tilingRequest: Window evacuated. Updating cache and returning.`);
                this._updateWrapperCache(wrapper, workspace, monitorIndex, monitorId);
                return;
            }

            const oldSlot = this._handleWorkspaceChange(window, wrapper, workspace, monitorId);
            const finalPreferredSlot = isRestoring ? preferredSlot : (oldSlot !== undefined ? oldSlot : undefined);
            this._updateWrapperCache(wrapper, workspace, monitorIndex, monitorId);
            this._applyTrackingState(window, monitorId, workspace, isRestoring, finalPreferredSlot);
            
            Logger.debug(`tilingRequest: State applied. Scheduling retile.`);
            this._scheduleRetile(workspace, monitorId, monitorIndex);
        } catch (e) {
            Logger.warn(`Tiling attempt failed for "${wrapper ? wrapper.title : 'unknown'}"`, e);
        }
    }

    _ensureWrapper(window) {
        const type = window.get_window_type ? window.get_window_type() : Meta.WindowType.NORMAL;
        const skipTaskbar = window.is_skip_taskbar ? window.is_skip_taskbar() : false;
        const shouldTile = TILABLE_WINDOW_TYPES.includes(type) && !skipTaskbar;

        let wrapper = this._windowWrappers.get(window);
        if (!shouldTile) {
            if (wrapper) this.untile(window);
            return null;
        }

        if (!wrapper) {
            wrapper = new WindowWrapper(window, this);
            this._windowWrappers.set(window, wrapper);
        }
        return wrapper;
    }

    _resolveTilingContext(window, wrapper) {
        let workspace = window.get_workspace ? window.get_workspace() : null;
        let monitorIndex = window.get_monitor ? window.get_monitor() : -1;

        if (!workspace) workspace = global.workspace_manager.get_active_workspace();
        if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();

        if (!workspace) return null;

        const isRestoring = this._restoringWindows.has(window);
        const preferredSlot = isRestoring ? this._restoringWindows.get(window) : undefined;
        if (isRestoring) {
            monitorIndex = wrapper.monitorIndex;
            let currentMon = window.get_monitor ? window.get_monitor() : -1;
            if (!window.minimized && currentMon === wrapper.monitorIndex) {
                this._restoringWindows.delete(window);
            }
        }

        const monitorId = this.monitorManager.getMonitorId(monitorIndex);
        return { workspace, monitorIndex, monitorId, isRestoring, preferredSlot };
    }

    _handleWorkspaceChange(window, wrapper, newWorkspace, newMonitorId) {
        const oldWorkspace = wrapper.workspace;
        const oldMonitorId = wrapper.monitorId;
        let oldSlot = undefined;

        if (oldWorkspace && (oldWorkspace !== newWorkspace || oldMonitorId !== newMonitorId)) {
            try {
                const oldGrid = this.workspaceManager.getLayout(oldWorkspace);
                oldSlot = oldGrid._getTracker(oldMonitorId).getSlot(window);
                oldGrid.untrackWindow(window, oldMonitorId);
                this._scheduleRetile(oldWorkspace, oldMonitorId, wrapper.monitorIndex);
            } catch (e) {}
        }
        return oldSlot;
    }

    _updateWrapperCache(wrapper, workspace, monitorIndex, monitorId) {
        wrapper.workspace = workspace;
        wrapper.monitorIndex = monitorIndex;
        wrapper.monitorId = monitorId;
    }

    _applyTrackingState(window, monitorId, workspace, isRestoring, preferredSlot) {
        const layout = this.workspaceManager.getLayout(workspace);
        const isEvacuated = this.monitorManager.isEvacuated(window);
        
        if ((window.minimized || isEvacuated) && !isRestoring) {
            layout.untrackWindow(window, monitorId);
        } else {
            layout.trackWindow(window, monitorId, preferredSlot);
        }
    }

    /**
     * Removes a window from the system and cleans up all associated resources.
     */
    untile(window) {
        Logger.debug(`untile: Removing window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}")`);
        const wrapper = this._windowWrappers.get(window);
        if (!wrapper) return;

        wrapper.destroy();
        const { workspace, monitorIndex, monitorId } = wrapper;
        this._windowWrappers.delete(window);

        try {
            if (workspace) {
                const layout = this.workspaceManager.getLayout(workspace);
                layout.untrackWindow(window, monitorId);
                this._scheduleRetile(workspace, monitorId, monitorIndex);
            }
        } catch (e) {
            Logger.error('Error in untile', e);
        }
    }

    _scheduleRetile(workspace, monitorId, monitorIndex) {
        if (this._batchMode) return;
        if (this.dragManager && this.dragManager._activeDrag) {
            this.dragManager._deferredRetiles = this.dragManager._deferredRetiles || [];
            const exists = this.dragManager._deferredRetiles.some(r => r.workspace === workspace && r.monitorId === monitorId);
            if (!exists) {
                this.dragManager._deferredRetiles.push({workspace, monitorId, monitorIndex});
            }
            return;
        }

        const key = `${workspace}-${monitorId}`;
        
        if (this._retileTimeouts.has(key)) {
            global.compositor.get_laters().remove(this._retileTimeouts.get(key));
        }

        const timeoutId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            try {
                if (!workspace || !workspace.get_work_area_for_monitor) {
                    this._retileTimeouts.delete(key);
                    return false;
                }

                // Verify monitor ID matches index.
                if (this.monitorManager.getMonitorId(monitorIndex) !== monitorId) {
                    this._retileTimeouts.delete(key);
                    return false;
                }

                const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);
                const layout = this.workspaceManager.getLayout(workspace);
                const gaps = this.settings ? this.settings.getGaps() : { inner: 6, outer: 4 };
                const operations = layout.getRetileOperations(monitorId, monitorRect, gaps);
                
                operations.forEach(op => {
                    const wrap = this._windowWrappers.get(op.window);
                    if (wrap) wrap.applyGeometry(op.rect);
                });
            } catch (e) {
                Logger.error(`Debounced retile failed for monitor ${monitorId}`, e);
            }
            this._retileTimeouts.delete(key);
            return false;
        });

        this._retileTimeouts.set(key, timeoutId);
    }

    retileAll() {
        this._windowWrappers.forEach((wrapper) => {
            if (wrapper.workspace && wrapper.monitorIndex >= 0) {
                this._scheduleRetile(wrapper.workspace, wrapper.monitorId, wrapper.monitorIndex);
            }
        });
    }

    /**
     * Triggers a full evaluation of all current windows and forces a complete retile.
     * This is useful during initialization or when the monitor layout drastically changes.
     */
    hydrate(workspace = null) {
        Logger.info(`Performing single-pass hydration sweep for workspace ${workspace && workspace.index ? workspace.index() : 'ALL'}`);
        
        let windows = [];
        if (workspace) {
            windows = workspace.list_windows();
        } else {
            windows = global.display.list_all_windows();
        }

        Logger.debug(`Hydrate: Found ${windows.length} total windows from shell.`);

        // Filter and sort active windows by ID to preserve historical insertion order slots
        const activeWindows = windows.filter(w => {
            if (!w) {
                Logger.debug(`Hydrate: Skipping null window object`);
                return false;
            }
            if (w.unmanaged) {
                Logger.debug(`Hydrate: Skipping unmanaged window ID ${w.get_id ? w.get_id() : 'unknown'}`);
                return false;
            }
            return true;
        });
        
        Logger.debug(`Hydrate: Filtered down to ${activeWindows.length} managed active windows.`);

        activeWindows.sort((a, b) => {
            const idA = a.get_id ? a.get_id() : 0;
            const idB = b.get_id ? b.get_id() : 0;
            return idA - idB;
        });
        const restoringExtra = [...this._restoringWindows.keys()].filter(w => !windows.includes(w));
        Logger.debug(`Hydrate: Adding ${restoringExtra.length} restoring windows not present in list.`);
        const allWindows = [...activeWindows, ...restoringExtra];
        Logger.debug(`Hydrate: Final list sorted by ID. Sequence: ${allWindows.map(w => w.get_id ? w.get_id() : 'unknown').join(', ')}`);

        allWindows.forEach(window => {
            if (window) {
                Logger.debug(`Hydrate: Issuing tiling request for window ID ${window.get_id ? window.get_id() : 'unknown'}`);
                this.tilingRequest(window);
            }
        });
    }

    /**
     * Swaps the given window with the closest adjacent window in the specified direction.
     * Triggers a retile if a valid candidate is found.
     */
    moveWindowDirection(window, direction) {
        if (!window) return;
        const workspace = window.get_workspace();
        if (!workspace) return;

        const monitorIndex = window.get_monitor();
        const monitorId = this.monitorManager.getMonitorId(monitorIndex);
        const layout = this.workspaceManager.getLayout(workspace);

        if (layout.moveWindowDirection(monitorId, window, direction)) {
            this._scheduleRetile(workspace, monitorId, monitorIndex);
        }
    }

    focusWindowDirection(window, direction) {
        if (!window) return;
        const workspace = window.get_workspace();
        if (!workspace) return;

        const monitorIndex = window.get_monitor();
        const monitorId = this.monitorManager.getMonitorId(monitorIndex);
        const layout = this.workspaceManager.getLayout(workspace);

        layout.focusWindowDirection(monitorId, window, direction);
    }

    handleMonitorsChanged() {
        this.monitorManager.handleMonitorsChanged();
    }

    startDragTracking(window) {
        this.dragManager.startDragTracking(window);
    }

    endDragTracking(window) {
        this.dragManager.endDragTracking(window);
    }

    closeMonitorWindows(monitorIndex, includeMinimized) {
        this.monitorManager.closeMonitorWindows(monitorIndex, includeMinimized);
    }

    closeWorkspaceWindows(workspace) {
        this.workspaceManager.closeWorkspaceWindows(workspace);
    }

    switchMonitors(activeMonitorIndex) {
        this.monitorManager.switchMonitors(activeMonitorIndex);
    }

    portMonitorToWorkspace(monitorIndex, direction) {
        this.monitorManager.portMonitorToWorkspace(monitorIndex, direction);
    }

    unminimizeWorkspace(workspace) {
        this.workspaceManager.unminimizeWorkspace(workspace);
    }



    clear() {
        this._retileTimeouts.forEach(id => global.compositor.get_laters().remove(id));
        this._retileTimeouts.clear();
        this._windowWrappers.forEach((wrapper, win) => {
            wrapper.destroy();
        });
        this.workspaceManager.clearLayouts();
        this._windowWrappers.clear();
        this._restoringWindows.clear();
        this.monitorManager.clear();

        if (TilingController.activeInstance === this) {
            TilingController.activeInstance = null;
        }
    }
}
