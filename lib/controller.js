import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { WorkspaceGrid } from './workspace.js';
import { createDefaultEscalator } from './layout.js';
import { WindowWrapper } from './window.js';
import { Logger } from './logger.js';
import { MonitorManager } from './monitor.js';

/**
 * TilingController: The central orchestration layer.
 * Manages WorkspaceGrids and implements an event-driven One-Shot Signal Intercept.
 */
export class TilingController {
    constructor(settings) {
        this.settings = settings;
        this.escalator = createDefaultEscalator();
        this.workspaceGrids = new Map();
        this._windowWrappers = new Map(); // window -> WindowWrapper
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
        this._batchMode = false;
        this._restoringWindows = new Set(); // transient: windows mid-restore from evacuation
        this.monitorManager = new MonitorManager(this);
    }

    setBatchMode(mode) {
        this._batchMode = mode;
    }

    clearWorkspaceGrids() {
        this.workspaceGrids.clear();
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
        if (!window || window.unmanaged) return;

        const type = window.get_window_type ? window.get_window_type() : Meta.WindowType.NORMAL;
        const skipTaskbar = window.is_skip_taskbar ? window.is_skip_taskbar() : false;
        const validTypes = [
            Meta.WindowType.NORMAL,
            Meta.WindowType.TERMINAL,
            Meta.WindowType.UTILITY
        ];
        const shouldTile = validTypes.includes(type) && !skipTaskbar;

        let wrapper = this._windowWrappers.get(window);
        if (!shouldTile) {
            if (wrapper) this.untile(window);
            return;
        }

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

            const monitorId = this.monitorManager.getMonitorId(monitorIndex);
            const oldWorkspace = wrapper.workspace;
            const oldMonitorId = wrapper.monitorId;

            // Handle movement between workspaces/monitors
            if (oldWorkspace && (oldWorkspace !== workspace || oldMonitorId !== monitorId)) {
                // EVACUATION DETECTION
                // Guard: skip if already evacuated.
                if (oldMonitorId && oldMonitorId !== monitorId && !this.monitorManager.monitorExists(oldMonitorId)
                    && !this.monitorManager.isEvacuated(window)) {
                    Logger.info(`Evacuation detected for "${wrapper.title}" (Monitor ${oldMonitorId} removed)`);
                    this._batchMode = true; // Choke retiles
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (window && !window.unmanaged && !window.minimized) {
                            window.minimize();
                        }
                        return GLib.SOURCE_REMOVE;
                    });

                    // Track by window reference with original monitor info.
                    this.monitorManager.recordEvacuation(window, oldMonitorId, oldWorkspace);
                    
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

            const isEvacuated = this.monitorManager.isEvacuated(window);
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
                if (this.monitorManager.getMonitorId(monitorIndex) !== monitorId) {
                    this._retileTimeouts.delete(key);
                    return false;
                }

                const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);
                const grid = this.getWorkspaceGrid(workspace);
                const gaps = this.settings ? this.settings.getGaps() : { inner: 6, outer: 4 };
                const operations = grid.getRetileOperations(monitorId, monitorRect, gaps);
                
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
        this._restoringWindows.clear();
        this.monitorManager.clear();
    }
}
