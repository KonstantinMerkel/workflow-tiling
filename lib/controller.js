import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { WorkspaceGrid } from './workspace.js';
import { createDefaultEscalator } from './layout.js';
import { WindowWrapper } from './window.js';
import { Logger } from './logger.js';

/**
 * TilingController: The central orchestration layer.
 * Manages WorkspaceGrids and implements an event-driven One-Shot Signal Intercept.
 */
export class TilingController {
    constructor() {
        this.escalator = createDefaultEscalator();
        this.workspaceGrids = new Map();
        this._windowWrappers = new Map(); // window -> WindowWrapper
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
        this._batchMode = false;
        this._lastMonitorCount = 0;
        this._evacuatedWindows = new Map(); // window -> { monitorId, workspace }
        this._restoringWindows = new Set(); // transient: windows mid-restore from evacuation
        this._monitorsChangedPending = false;
        this._knownMonitorIds = new Set();
    }

    initializeMonitorState() {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            this._lastMonitorCount = logicalMonitors.length;
            this._knownMonitorIds.clear();
            for (let i = 0; i < logicalMonitors.length; i++) {
                this._knownMonitorIds.add(this._getMonitorId(i));
            }
            Logger.info(`Initialized monitor state. Count: ${this._lastMonitorCount}`);
        } catch (e) {
            Logger.error('Failed to initialize monitor state', e);
        }
    }
    _getMonitorId(monitorIndex) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            const logicalMonitor = logicalMonitors[monitorIndex];
            if (logicalMonitor) {
                const physicalMonitors = logicalMonitor.get_monitors();
                const monitor = physicalMonitors && physicalMonitors.length > 0 ? physicalMonitors[0] : null;
                if (monitor) {
                    if (monitor.get_stable_id) return monitor.get_stable_id() || monitor.get_connector();
                    if (monitor.get_connector) return monitor.get_connector();
                }
            }
        } catch (e) {
            Logger.warn(`Could not get monitor ID for index ${monitorIndex}`, e);
        }
        return `idx-${monitorIndex}`;
    }

    _monitorExists(monitorId) {
        return this._getMonitorIndex(monitorId) >= 0;
    }

    _getMonitorIndex(monitorId) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            for (let i = 0; i < logicalMonitors.length; i++) {
                const physicalMonitors = logicalMonitors[i].get_monitors();
                if (physicalMonitors) {
                    for (let m of physicalMonitors) {
                        const id = m.get_stable_id ? (m.get_stable_id() || m.get_connector()) : m.get_connector();
                        if (id === monitorId) return i;
                    }
                }
            }
        } catch (e) {}
        return -1;
    }


    /**
     * Registers a window and initiates the One-Shot Signal sequence.
     */
    tilingRequest(window) {
        if (!window || window.unmanaged) return;

        let wrapper = this._windowWrappers.get(window);
        if (!wrapper) {
            wrapper = new WindowWrapper(window, this);
            this._windowWrappers.set(window, wrapper);
        }

        wrapper.bindSignals();
        wrapper.bindOneShotSizeChanged();

        // Core Tiling Logic
        try {
            let workspace = window.get_workspace ? window.get_workspace() : null;
            let monitorIndex = window.get_monitor ? window.get_monitor() : -1;

            if (!workspace) workspace = global.workspace_manager.get_active_workspace();
            if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();

            if (!workspace) return;

            const isRestoring = this._restoringWindows.has(window);

            // Enforce target monitor during async unminimize/restore.
            if (isRestoring) {
                monitorIndex = wrapper.monitorIndex;
                
                // Release window when unminimized on target monitor.
                let currentMon = window.get_monitor ? window.get_monitor() : -1;
                if (!window.minimized && currentMon === wrapper.monitorIndex) {
                    this._restoringWindows.delete(window);
                }
            }

            const monitorId = this._getMonitorId(monitorIndex);
            const oldWorkspace = wrapper.workspace;
            const oldMonitorId = wrapper.monitorId;

            // Handle movement between workspaces/monitors
            if (oldWorkspace && (oldWorkspace !== workspace || oldMonitorId !== monitorId)) {
                // EVACUATION DETECTION
                // Guard: skip if already evacuated.
                if (oldMonitorId && oldMonitorId !== monitorId && !this._monitorExists(oldMonitorId)
                    && !this._evacuatedWindows.has(window)) {
                    Logger.info(`Evacuation detected for "${wrapper.title}" (Monitor ${oldMonitorId} removed)`);
                    this._batchMode = true; // Choke retiles
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (window && !window.unmanaged && !window.minimized) {
                            window.minimize();
                        }
                        return GLib.SOURCE_REMOVE;
                    });

                    // Track by window reference with original monitor info.
                    this._evacuatedWindows.set(window, { monitorId: oldMonitorId, workspace: oldWorkspace });
                    
                    try {
                        const oldGrid = this.getWorkspaceGrid(oldWorkspace);
                        oldGrid.untrackWindow(window, oldMonitorId);
                    } catch (e) {}
                    
                    // Suppress immediate tiling on target monitor.
                    wrapper.workspace = workspace;
                    wrapper.monitorIndex = monitorIndex;
                    wrapper.monitorId = monitorId;
                    return;
                }

                try {
                    const oldGrid = this.getWorkspaceGrid(oldWorkspace);
                    oldGrid.untrackWindow(window, oldMonitorId);
                    this._scheduleRetile(oldWorkspace, oldMonitorId, wrapper.monitorIndex);
                } catch (e) {}
            }

            // Update cache with current location
            wrapper.workspace = workspace;
            wrapper.monitorIndex = monitorIndex;
            wrapper.monitorId = monitorId;

            const grid = this.getWorkspaceGrid(workspace);

            const isEvacuated = this._evacuatedWindows.has(window);
            if ((window.minimized || isEvacuated) && !isRestoring) {
                grid.untrackWindow(window, monitorId);
            } else {
                grid.trackWindow(window, monitorId);
            }

            this._scheduleRetile(workspace, monitorId, monitorIndex);
        } catch (e) {
            Logger.warn(`Tiling attempt failed for "${wrapper.title}"`, e);
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
                const grid = this.getWorkspaceGrid(workspace);
                grid.untrackWindow(window, monitorId);
                this._scheduleRetile(workspace, monitorId, monitorIndex);
            }
        } catch (e) {
            Logger.error('Error in untile', e);
        }
    }

    _scheduleRetile(workspace, monitorId, monitorIndex) {
        if (this._batchMode) return;

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
                if (this._getMonitorId(monitorIndex) !== monitorId) {
                    this._retileTimeouts.delete(key);
                    return false;
                }

                const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);
                const grid = this.getWorkspaceGrid(workspace);
                const operations = grid.getRetileOperations(monitorId, monitorRect);
                
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
        this._windowMetaCache.forEach((meta) => {
            if (meta.workspace && meta.monitorIndex >= 0) {
                this._scheduleRetile(meta.workspace, meta.monitorId, meta.monitorIndex);
            }
        });
    }

    handleMonitorsChanged() {
        // Debounce monitors-changed signal.
        if (this._monitorsChangedPending) return;
        this._monitorsChangedPending = true;

        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            const currentMonitorCount = logicalMonitors.length;

            Logger.info(`Topology Change. Count: ${this._lastMonitorCount}->${currentMonitorCount}`);

            // Wait for GNOME work-area resizing to finish.
            global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._monitorsChangedPending = false;
                try {
                    this._batchMode = false;
                    this.workspaceGrids.clear();
                    if (currentMonitorCount < this._lastMonitorCount) {
                        this._restoringWindows.clear(); 
                    } 

                    // Build set of currently available monitor IDs
                    const currentMonitorIds = new Set();
                    for (let i = 0; i < currentMonitorCount; i++) {
                        currentMonitorIds.add(this._getMonitorId(i));
                    }

                    // Restore evacuated windows.
                    if (currentMonitorCount > this._lastMonitorCount && this._evacuatedWindows.size > 0) {
                        // Identify target monitor from diff of known IDs.
                        const newMonitorIds = [...currentMonitorIds].filter(id => !this._knownMonitorIds.has(id));
                        const targetMonitorId = newMonitorIds.length > 0 ? newMonitorIds[0] : this._getMonitorId(currentMonitorCount - 1);
                        const targetIndex = this._getMonitorIndex(targetMonitorId);

                        const restoredCount = this._evacuatedWindows.size;
                        Logger.info(`Restoring ${restoredCount} window(s) to new monitor ${targetMonitorId} (index ${targetIndex})`);

                        for (const [win, info] of this._evacuatedWindows) {
                            if (win && !win.unmanaged) {
                                // Unminimize to trigger GNOME behavior.
                                win.unminimize();

                                // Update meta cache to target monitor.
                                const wrapper = this._windowWrappers.get(win);
                                if (wrapper) {
                                    wrapper.monitorId = targetMonitorId;
                                    wrapper.monitorIndex = targetIndex;
                                }

                                // Mark for minimized-check bypass.
                                this._restoringWindows.add(win);
                            }
                        }
                        this._evacuatedWindows.clear();
                    }

                    this.hydrate();

                    this._lastMonitorCount = currentMonitorCount;
                    this._knownMonitorIds = new Set(currentMonitorIds);

                } catch (e) {
                    Logger.error('Hydration failed', e);
                    this._batchMode = false;
                    this._monitorsChangedPending = false;
                }
                return false;
            });

        } catch (e) {
            Logger.error('Monitor change processing failed', e);
            this._batchMode = false;
            this._monitorsChangedPending = false;
        }
    }

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

    getWorkspaceGrid(workspace) {
        if (!this.workspaceGrids.has(workspace)) {
            this.workspaceGrids.set(workspace, new WorkspaceGrid(workspace, this.escalator));
        }
        return this.workspaceGrids.get(workspace);
    }

    clear() {
        this._retileTimeouts.forEach(id => global.compositor.get_laters().remove(id));
        this._retileTimeouts.clear();
        this._windowWrappers.forEach((wrapper, win) => {
            wrapper.destroy();
        });
        this.workspaceGrids.clear();
        this._windowWrappers.clear();
        this._evacuatedWindows.clear();
        this._restoringWindows.clear();
        this._monitorsChangedPending = false;
    }
}
