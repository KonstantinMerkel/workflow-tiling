import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { WorkspaceLayout, WorkspaceManager } from './workspace.js';
import { createDefaultEscalator } from './layout.js';
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
    constructor(settings) {
        

        this._windowWrappers = new Map(); // window -> WindowWrapper
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
        this._restoringWindows = new Set(); // transient: windows mid-restore from evacuation

        this.settings = settings;
        this.escalator = createDefaultEscalator();
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


    clearRestoringWindows() {
        this._restoringWindows.clear();
    }

    addRestoringWindow(window) {
        this._restoringWindows.add(window);
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
        if (window.unmanaged) return;

        let wrapper = this._ensureWrapper(window);
        if (!wrapper) return;

        wrapper.bindSignals();
        wrapper.bindSizeChanged();

        try {
            const context = this._resolveTilingContext(window, wrapper);
            if (!context) return;

            const { workspace, monitorIndex, monitorId, isRestoring } = context;

            if (this.monitorManager.checkEvacuation(window, wrapper, monitorId, workspace)) {
                this._updateWrapperCache(wrapper, workspace, monitorIndex, monitorId);
                return;
            }

            this._handleWorkspaceChange(window, wrapper, workspace, monitorId);
            this._updateWrapperCache(wrapper, workspace, monitorIndex, monitorId);
            this._applyTrackingState(window, monitorId, workspace, isRestoring);
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
        if (isRestoring) {
            monitorIndex = wrapper.monitorIndex;
            let currentMon = window.get_monitor ? window.get_monitor() : -1;
            if (!window.minimized && currentMon === wrapper.monitorIndex) {
                this._restoringWindows.delete(window);
            }
        }

        const monitorId = this.monitorManager.getMonitorId(monitorIndex);
        return { workspace, monitorIndex, monitorId, isRestoring };
    }

    _handleWorkspaceChange(window, wrapper, newWorkspace, newMonitorId) {
        const oldWorkspace = wrapper.workspace;
        const oldMonitorId = wrapper.monitorId;

        if (oldWorkspace && (oldWorkspace !== newWorkspace || oldMonitorId !== newMonitorId)) {
            try {
                const oldGrid = this.workspaceManager.getLayout(oldWorkspace);
                oldGrid.untrackWindow(window, oldMonitorId);
                this._scheduleRetile(oldWorkspace, oldMonitorId, wrapper.monitorIndex);
            } catch (e) {}
        }
    }

    _updateWrapperCache(wrapper, workspace, monitorIndex, monitorId) {
        wrapper.workspace = workspace;
        wrapper.monitorIndex = monitorIndex;
        wrapper.monitorId = monitorId;
    }

    _applyTrackingState(window, monitorId, workspace, isRestoring) {
        const layout = this.workspaceManager.getLayout(workspace);
        const isEvacuated = this.monitorManager.isEvacuated(window);
        
        if ((window.minimized || isEvacuated) && !isRestoring) {
            layout.untrackWindow(window, monitorId);
        } else {
            layout.trackWindow(window, monitorId);
        }
    }

    /**
     * Removes a window from the system and cleans up all associated resources.
     */
    untile(window) {
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
        if (this.dragManager && this.dragManager._activeDrag) return;

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
        if (!workspace) {
            workspace = global.workspace_manager.get_active_workspace();
        }
        if (!workspace) return;

        Logger.info('Performing single-pass hydration sweep');
        
        const windows = workspace.list_windows();
        const restoringExtra = [...this._restoringWindows].filter(w => !windows.includes(w));
        const allWindows = [...windows, ...restoringExtra];

        allWindows.forEach(window => {
            if (window && !window.unmanaged) {
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
    }
}
