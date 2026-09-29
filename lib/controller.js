import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { WorkspaceLayout, WorkspaceManager } from './workspace.js';

import { WindowWrapper } from './window.js';
import { Logger } from './utils/logger.js';
import { MonitorManager, MonitorRef } from './monitor.js';
import { DragManager } from './drag.js';
import { isTilable } from './utils/helper.js';
import { getEnteringEdge } from './utils/geometry.js';

/**
 * TilingController: The central orchestration Singelton.
 * Manages WorkspaceLayouts and implements an event-driven One-Shot Signal Intercept.
 */
export class TilingController {
    static activeInstance = null;

    /**
     * @param {SettingsManager} settings User Preference Interface
     */
    constructor(settings) {
        if (TilingController.activeInstance) {
            // fail early, fail loud
            throw new Error("WorkflowTiling: Stale TilingController instance still active!");
        }
        TilingController.activeInstance = this;

        this._windowWrappers = new Map(); // window -> WindowWrapper
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId

        this.settings = settings;
        this.escalator = null;
        this.monitorManager = new MonitorManager(this);
        this.workspaceManager = new WorkspaceManager(this);
        this.dragManager = new DragManager(this);
        this._authorizedOverrides = new Set();

        /** 
         * When true, layout re-evaluations are deferred. 
         * Used to prevent layout thrashing during multi-monitor setup/teardown.
         */
        this._batchMode = false;
    }

    /** @param {Boolean} mode */
    setBatchMode(mode) {
        this._batchMode = mode;
    }

    /**
     * Update the escalator in use
     * @param {LayoutEscalator} escalator 
     */
    setEscalator(escalator) {
        this.escalator = escalator;
        this.workspaceManager.clearLayouts();
    }

    /**
     * @param {Meta.window} window
     * @returns {boolean} if the window in question is currently maximised/fullscreen
     */
    isOverrideActive(window) {
        return this._authorizedOverrides.has(window);
    }

    updateWindowWrapperMonitor(window, monitor, workspace = undefined) {
        const wrapper = this._windowWrappers.get(window);
        if (wrapper) {
            wrapper.monitorId = monitor.id;
            wrapper.monitorIndex = monitor.index;
            if (workspace !== undefined) wrapper.workspace = workspace;
        }
    }

    /**
     * Register a window and initiate one-Shot Signal sequence.
     * @param {Meta.window} The new window
     */
    tilingRequest(window) {
        if (!isTilable(window)) return Logger.debug(`tilingRequest: Rejected untilable window "${window?.get_title?.() ?? 'unknown'}" type=${window?.get_window_type?.() ?? '?'} transient=${!!window?.get_transient_for?.()}`);
        if (this.dragManager && this.dragManager.isWindowInDragPreview(window)) return Logger.debug(`tilingRequest: Ignored for window in active drag preview.`);

        Logger.debug(`tilingRequest: Initiating for window ID ${window?.get_id?.() ?? 'unknown'} ("${window?.get_title?.() ?? 'unknown'}")`);

        const isNewWindow = !this._windowWrappers.has(window);
        const wrapper = this._ensureWrapper(window);
        if (wrapper.isInTransit()) return Logger.debug(`tilingRequest: Ignored window still in transit`)

        const context = this._resolveTilingContext(window, wrapper);
        if (!context) return Logger.debug(`tilingRequest: Aborted. No context resolved.`);

        const { workspace, monitor, isRestoring, preferredSlot } = context;
        Logger.debug(`tilingRequest: Context resolved -> Workspace: ${workspace.index ? workspace.index() : 'unknown'}, MonitorIndex: ${monitor.index}, MonitorID: ${monitor.id}, Restoring: ${isRestoring}`);

        // new window spawing in undoes maximisation/fullscreen
        if (isNewWindow && !isRestoring) {
            this._clearOverridesOnMonitor(monitor.index);
        }

        // handle window Evacuation
        if (this.monitorManager.isEvacuation(window, wrapper, monitor.id)) {
            this.monitorManager.handleEvacuation(window, wrapper);
            this.updateWindowWrapperMonitor(window, monitor, workspace);
            return Logger.debug(`tilingRequest: Window evacuated. Updating cache and returning.`);
        }

        const layout = this.workspaceManager.getLayout(workspace);
        const isMonitorChange = wrapper.workspace && wrapper.workspace === workspace && wrapper.monitorId && wrapper.monitorId !== monitor.id;

        if (isMonitorChange) {
            const sourceMonitor = new MonitorRef(wrapper.monitorId, wrapper.monitorIndex);
            this._handleMonitorTransitionChange(window, wrapper, layout, sourceMonitor, monitor, workspace);
        } else {
            this._handleNormalTilingRequest(window, wrapper, workspace, monitor, isRestoring, preferredSlot);
        }
    }

    _handleMonitorTransitionChange(window, wrapper, layout, sourceMonitor, targetMonitor, workspace) {
        const slot = layout.getWindowSlot(sourceMonitor.id, window);
        const sourceSlot = slot !== undefined ? slot : 0;

        const sourceRect = sourceMonitor.getGeometry();
        const targetRect = targetMonitor.getGeometry();

        const enteringEdge = getEnteringEdge(sourceRect, targetRect);

        const result = layout.handleMonitorTransition(window, sourceMonitor.id, targetMonitor.id, enteringEdge, sourceSlot);
        
        if (result && result.aborted) {
            // Restore window to previous monitor physically
            if (window.move_to_monitor) window.move_to_monitor(sourceMonitor.index);
            this._scheduleRetile(workspace, sourceMonitor);
            return;
        }

        this.updateWindowWrapperMonitor(window, targetMonitor);
        wrapper.beginMonitorTransit();
        
        if (result && result.swappedWindow) {
            this.updateWindowWrapperMonitor(result.swappedWindow, sourceMonitor);
            const swappedWrapper = this._windowWrappers.get(result.swappedWindow);
            if (swappedWrapper) swappedWrapper.beginMonitorTransit();
            if (result.swappedWindow.move_to_monitor) result.swappedWindow.move_to_monitor(sourceMonitor.index);
        }

        Logger.debug(`tilingRequest: Monitor transition handled. Scheduling retile.`);
        this._scheduleRetile(workspace, sourceMonitor);
        this._scheduleRetile(workspace, targetMonitor);
    }

    _handleNormalTilingRequest(window, wrapper, workspace, monitor, isRestoring, preferredSlot) {
        const oldSlot = this._handleWorkspaceChange(window, wrapper, workspace, monitor.id);
        const finalPreferredSlot = isRestoring ? preferredSlot : (oldSlot !== undefined ? oldSlot : undefined);
        this.updateWindowWrapperMonitor(window, monitor, workspace);
        this._applyTrackingState(window, monitor.id, workspace, isRestoring, finalPreferredSlot);
        
        Logger.debug(`tilingRequest: State applied. Scheduling retile.`);
        this._scheduleRetile(workspace, monitor);
    }

    _ensureWrapper(window) {
        let wrapper = this._windowWrappers.get(window);
        if (!wrapper) {
            wrapper = new WindowWrapper(window, this);
            this._windowWrappers.set(window, wrapper);
            wrapper.bindSignals();
            wrapper.bindSizeChanged();
        }
        return wrapper;
    }

    _resolveTilingContext(window, wrapper) {
        let workspace = wrapper ? wrapper.effectiveWorkspace : (window.get_workspace ? window.get_workspace() : null);
        let monitorIndex = wrapper ? wrapper.effectiveMonitorIndex : (window.get_monitor ? window.get_monitor() : -1);

        if (!workspace) workspace = global.workspace_manager.get_active_workspace();
        if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();

        if (!workspace) return null;
        
        // Guard against transient GNOME states during monitor unplug
        if (monitorIndex >= this.monitorManager.getMonitorCount()) {
            return null;
        }

        const isRestoring = this.monitorManager._restoringWindows.has(window);
        const preferredSlot = isRestoring ? this.monitorManager._restoringWindows.get(window) : undefined;
        if (isRestoring) {
            monitorIndex = wrapper.monitorIndex;
            let currentMon = wrapper ? wrapper.effectiveMonitorIndex : (window.get_monitor ? window.get_monitor() : -1);
            if (!window.minimized && currentMon === wrapper.monitorIndex) {
                this.monitorManager._restoringWindows.delete(window);
            }
        }

        const monitor = this.monitorManager.createRef(monitorIndex);
        return { workspace, monitor, isRestoring, preferredSlot };
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
                this._scheduleRetile(oldWorkspace, new MonitorRef(oldMonitorId, wrapper.monitorIndex));
            } catch (e) {}
        }
        return oldSlot;
    }



    _applyTrackingState(window, monitorId, workspace, isRestoring, preferredSlot) {
        const layout = this.workspaceManager.getLayout(workspace);
        const isEvacuated = this.monitorManager.isEvacuated(window);
        
        if (isEvacuated && !window.minimized) {
            this.monitorManager.clearEvacuation(window);
        }

        if (window.minimized && !isRestoring) {
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

        if (this.dragManager && this.dragManager._activeDrag && this.dragManager._activeDrag.window === window) {
            this.dragManager.forceCleanup();
        }

        wrapper.destroy();
        const { workspace, monitorIndex, monitorId } = wrapper;
        this._windowWrappers.delete(window);
        this._authorizedOverrides.delete(window);

        try {
            if (workspace) {
                const layout = this.workspaceManager.getLayout(workspace);
                layout.untrackWindow(window, monitorId);
                this._scheduleRetile(workspace, new MonitorRef(monitorId, monitorIndex));
            }
        } catch (e) {
            Logger.error('Error in untile', e);
        }
    }

    _scheduleRetile(workspace, monitor) {
        if (this._batchMode) return;
        if (this.dragManager && this.dragManager._activeDrag) {
            this.dragManager._deferredRetiles = this.dragManager._deferredRetiles || [];
            const exists = this.dragManager._deferredRetiles.some(r => r.workspace === workspace && r.monitor.id === monitor.id);
            if (!exists) {
                this.dragManager._deferredRetiles.push({workspace, monitor});
            }
            return;
        }

        const key = `${workspace.index ? workspace.index() : workspace}-${monitor.id}`;
        
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
                if (this.monitorManager.getMonitorId(monitor.index) !== monitor.id) {
                    this._retileTimeouts.delete(key);
                    return false;
                }

                const monitorRect = monitor.getWorkArea(workspace);
                const layout = this.workspaceManager.getLayout(workspace);
                const gaps = this.settings ? this.settings.getGaps() : { inner: 6, outer: 4 };
                const operations = layout.getRetileOperations(monitor.id, monitorRect, gaps);
                
                operations.forEach(op => {
                    const wrap = this._windowWrappers.get(op.window);
                    if (wrap) wrap.applyGeometry(op.rect);
                });
            } catch (e) {
                Logger.error(`Debounced retile failed for monitor ${monitor.id}`, e);
            }
            this._retileTimeouts.delete(key);
            return false;
        });

        this._retileTimeouts.set(key, timeoutId);
    }

    retileAll() {
        this._windowWrappers.forEach((wrapper) => {
            if (wrapper.workspace && wrapper.monitorIndex >= 0) {
                this._scheduleRetile(wrapper.workspace, new MonitorRef(wrapper.monitorId, wrapper.monitorIndex));
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
            if (!isTilable(w)) {
                Logger.debug(`Hydrate: Skipping untilable window ID ${w.get_id ? w.get_id() : 'unknown'}`);
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
        const restoringExtra = [...this.monitorManager._restoringWindows.keys()].filter(w => !windows.includes(w));
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
        const wrapper = this._windowWrappers.get(window);
        const workspace = wrapper ? wrapper.effectiveWorkspace : window.get_workspace();
        if (!workspace) return;

        const monitorIndex = wrapper ? wrapper.effectiveMonitorIndex : window.get_monitor();
        const monitorId = this.monitorManager.getMonitorId(monitorIndex);
        const layout = this.workspaceManager.getLayout(workspace);

        if (layout.moveWindowDirection(monitorId, window, direction)) {
            this._scheduleRetile(workspace, new MonitorRef(monitorId, monitorIndex));
        }
    }

    focusWindowDirection(window, direction) {
        if (!window) return;
        const wrapper = this._windowWrappers.get(window);
        const workspace = wrapper ? wrapper.effectiveWorkspace : window.get_workspace();
        if (!workspace) return;

        const monitorIndex = wrapper ? wrapper.effectiveMonitorIndex : window.get_monitor();
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
        this.workspaceManager.closeMonitorWindows(monitorIndex, includeMinimized);
    }

    closeWorkspaceWindows(workspace) {
        this.workspaceManager.closeWorkspaceWindows(workspace);
    }

    switchMonitors(activeMonitorIndex) {
        this.workspaceManager.switchMonitors(activeMonitorIndex);
    }

    portMonitorToWorkspace(monitorIndex, direction) {
        this.workspaceManager.portMonitorToWorkspace(monitorIndex, direction);
    }

    unminimizeWorkspace(workspace) {
        this.workspaceManager.unminimizeWorkspace(workspace);
    }

    toggleOverrideActiveWindow(type) {
        const targetWindow = global.display.get_focus_window();
        if (!isTilable(targetWindow)) return;

        const isActive = (targetWindow.maximized_horizontally && targetWindow.maximized_vertically) || (targetWindow.is_fullscreen && targetWindow.is_fullscreen());

        if (isActive) {
            this._authorizedOverrides.delete(targetWindow);
            if (targetWindow.is_fullscreen && targetWindow.is_fullscreen()) targetWindow.unmake_fullscreen();
            if (targetWindow.maximized_horizontally && targetWindow.maximized_vertically) targetWindow.unmaximize();
        } else {
            this._authorizedOverrides.add(targetWindow);
            if (type === 'maximize') targetWindow.maximize();
            if (type === 'fullscreen') targetWindow.make_fullscreen();
        }
    }

    _clearOverridesOnMonitor(monitorIndex) {
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        this._windowWrappers.forEach((wrapper, window) => {
            if (wrapper.monitorIndex === monitorIndex && wrapper.workspace === activeWorkspace && isTilable(window)) {
                this._authorizedOverrides.delete(window);
                if (window.maximized_horizontally && window.maximized_vertically) {
                    window.unmaximize();
                }
                if (window.is_fullscreen && window.is_fullscreen()) {
                    window.unmake_fullscreen();
                }
            }
        });
    }

    clear() {
        if (this.dragManager) this.dragManager.forceCleanup();
        this._retileTimeouts.forEach(id => global.compositor.get_laters().remove(id));
        this._retileTimeouts.clear();
        this._windowWrappers.forEach((wrapper, win) => {
            wrapper.destroy();
        });
        this.workspaceManager.clearLayouts();
        this._windowWrappers.clear();
        this._authorizedOverrides.clear();
        this.monitorManager.clear();

        if (TilingController.activeInstance === this) {
            TilingController.activeInstance = null;
        }
    }
}
