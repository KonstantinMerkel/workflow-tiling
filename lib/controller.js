import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { WorkspaceGrid } from './workspace.js';
import { createDefaultEscalator } from './layout.js';

/**
 * TilingController: The central orchestration layer.
 * Manages WorkspaceGrids and implements an event-driven One-Shot Signal Intercept.
 */
export class TilingController {
    constructor() {
        this.escalator = createDefaultEscalator();
        this.workspaceGrids = new Map();
        this._windowMetaCache = new Map(); // window -> { workspace, monitorIndex, monitorId, ... }
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
            const monitors = manager.get_monitors();
            this._lastMonitorCount = monitors.length;
            this._knownMonitorIds.clear();
            for (let i = 0; i < monitors.length; i++) {
                this._knownMonitorIds.add(this._getMonitorId(i));
            }
            console.log(`WorkflowTiling: Initialized monitor state. Count: ${this._lastMonitorCount}`);
        } catch (e) {
            console.error(`WorkflowTiling: Failed to initialize monitor state: ${e.message}`);
        }
    }
    _getMonitorId(monitorIndex) {
        try {
            const manager = global.backend.get_monitor_manager();
            const monitors = manager.get_monitors();
            const monitor = monitors[monitorIndex];
            if (monitor) {
                if (monitor.get_stable_id) return monitor.get_stable_id() || monitor.get_connector();
                if (monitor.get_connector) return monitor.get_connector();
            }
        } catch (e) {
            console.warn(`WorkflowTiling: Could not get monitor ID for index ${monitorIndex}: ${e.message}`);
        }
        return `idx-${monitorIndex}`;
    }

    _monitorExists(monitorId) {
        try {
            const manager = global.backend.get_monitor_manager();
            const monitors = manager.get_monitors();
            return monitors.some(m => {
                const id = m.get_stable_id ? (m.get_stable_id() || m.get_connector()) : m.get_connector();
                return id === monitorId;
            });
        } catch (e) {
            return false;
        }
    }

    _getMonitorIndex(monitorId) {
        try {
            const manager = global.backend.get_monitor_manager();
            const monitors = manager.get_monitors();
            for (let i = 0; i < monitors.length; i++) {
                const m = monitors[i];
                const id = m.get_stable_id ? (m.get_stable_id() || m.get_connector()) : m.get_connector();
                if (id === monitorId) return i;
            }
        } catch (e) {}
        return -1;
    }


    /**
     * Registers a new window and initiates the One-Shot Signal sequence.
     */
    tilingRequest(window) {
        if (!window || window.unmanaged) return;

        const title = (window.get_title && window.get_title()) || 'New Window';

        // 0. Lifecycle & State Signals
        let meta = this._windowMetaCache.get(window) || {
            unmanagedId: 0,
            workspaceId: 0,
            minimizedId: 0,
            signalId: 0,
            timeoutId: 0
        };

        if (meta.unmanagedId === 0) {
            meta.unmanagedId = window.connect('unmanaged', () => this.untile(window));
        }
        if (meta.workspaceId === 0) {
            meta.workspaceId = window.connect('workspace-changed', () => this.tilingRequest(window));
        }
        if (meta.minimizedId === 0) {
            meta.minimizedId = window.connect('notify::minimized', () => this.tilingRequest(window));
        }

        // 1. One-Shot Signal Hook for Verification Snap
        if (meta.signalId === 0) {
            meta.signalId = window.connect('size-changed', () => {
                this._disconnectSignal(window, 'signalId');
                this.tilingRequest(window);
            });
        }

        // 2. Strict Timeout Registry: Memory Leak Fallback
        if (meta.timeoutId === 0) {
            meta.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._disconnectSignal(window, 'signalId');
                const currentMeta = this._windowMetaCache.get(window);
                if (currentMeta) {
                    currentMeta.timeoutId = 0;
                    this._windowMetaCache.set(window, currentMeta);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        // Store intermediate state
        this._windowMetaCache.set(window, meta);

        // 3. Core Tiling Logic
        try {
            let workspace = window.get_workspace ? window.get_workspace() : null;
            let monitorIndex = window.get_monitor ? window.get_monitor() : -1;

            if (!workspace) workspace = global.workspace_manager.get_active_workspace();
            if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();

            if (!workspace) return;

            const isRestoring = this._restoringWindows.has(window);

            // During an async unminimize/restore, GNOME might report the wrong monitor or workspace.
            // Force it to stay on its intended target.
            if (isRestoring) {
                monitorIndex = meta.monitorIndex;
                
                // If the GNOME animation is finished and it is finally unminimized, we can release it
                if (!window.minimized) {
                    this._restoringWindows.delete(window);
                }
            }

            const monitorId = this._getMonitorId(monitorIndex);
            const oldWorkspace = meta.workspace;
            const oldMonitorId = meta.monitorId;

            // Handle movement between workspaces/monitors
            if (oldWorkspace && (oldWorkspace !== workspace || oldMonitorId !== monitorId)) {
                // EVACUATION DETECTION
                // Guard: skip if already evacuated (prevents duplicate signal re-evacuation)
                if (oldMonitorId && oldMonitorId !== monitorId && !this._monitorExists(oldMonitorId)
                    && !this._evacuatedWindows.has(window)) {
                    console.log(`WorkflowTiling: Evacuation detected for "${title}" (Monitor ${oldMonitorId} removed)`);
                    this._batchMode = true; // Choke retiles
                    window.minimize();

                    // Track by window reference with original monitor info for restoration
                    this._evacuatedWindows.set(window, { monitorId: oldMonitorId, workspace: oldWorkspace });
                    
                    try {
                        const oldGrid = this.getWorkspaceGrid(oldWorkspace);
                        oldGrid.untrackWindow(window, oldMonitorId);
                    } catch (e) {}
                    
                    // Update cache and return to suppress immediate tiling on the new monitor
                    meta.workspace = workspace;
                    meta.monitorIndex = monitorIndex;
                    meta.monitorId = monitorId;
                    this._windowMetaCache.set(window, meta);
                    return;
                }

                try {
                    const oldGrid = this.getWorkspaceGrid(oldWorkspace);
                    oldGrid.untrackWindow(window, oldMonitorId);
                    this._scheduleRetile(oldWorkspace, oldMonitorId, meta.monitorIndex);
                } catch (e) {}
            }

            // Update cache with current location
            meta.workspace = workspace;
            meta.monitorIndex = monitorIndex;
            meta.monitorId = monitorId;
            this._windowMetaCache.set(window, meta);

            const grid = this.getWorkspaceGrid(workspace);

            if (window.minimized && !isRestoring) {
                grid.untrackWindow(window, monitorId);
            } else {
                grid.trackWindow(window, monitorId);
            }

            this._scheduleRetile(workspace, monitorId, monitorIndex);
        } catch (e) {
            console.error(`WorkflowTiling: Tiling attempt failed for "${title}": ${e.message}`);
        }
    }

    /**
     * Removes a window from the system and cleans up all associated resources.
     */
    untile(window) {
        const cached = this._windowMetaCache.get(window);
        if (!cached) return;

        // Pre-emptive cleanup of all timers and initialization signals
        if (cached.timeoutId > 0) GLib.source_remove(cached.timeoutId);
        this._disconnectSignal(window, 'signalId');
        this._disconnectSignal(window, 'unmanagedId');
        this._disconnectSignal(window, 'workspaceId');
        this._disconnectSignal(window, 'minimizedId');

        const { workspace, monitorIndex, monitorId } = cached;
        this._windowMetaCache.delete(window);

        try {
            if (workspace) {
                const grid = this.getWorkspaceGrid(workspace);
                grid.untrackWindow(window, monitorId);
                this._scheduleRetile(workspace, monitorId, monitorIndex);
            }
        } catch (e) {
            console.error(`WorkflowTiling: Error in untile: ${e.message}`);
        }
    }

    _disconnectSignal(window, key) {
        try {
            const meta = this._windowMetaCache.get(window);
            if (meta && meta[key] > 0) {
                if (window && window.handler_is_connected(meta[key])) {
                    window.disconnect(meta[key]);
                }
                meta[key] = 0;
                this._windowMetaCache.set(window, meta);
            }
        } catch (e) {}
    }

    _scheduleRetile(workspace, monitorId, monitorIndex) {
        if (this._batchMode) return;

        const key = `${workspace}-${monitorId}`;
        
        if (this._retileTimeouts.has(key)) {
            GLib.source_remove(this._retileTimeouts.get(key));
        }

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            try {
                if (!workspace || !workspace.get_work_area_for_monitor) {
                    this._retileTimeouts.delete(key);
                    return GLib.SOURCE_REMOVE;
                }

                // Safety: Ensure the monitor at this index still matches our ID
                if (this._getMonitorId(monitorIndex) !== monitorId) {
                    this._retileTimeouts.delete(key);
                    return GLib.SOURCE_REMOVE;
                }

                const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);
                const grid = this.getWorkspaceGrid(workspace);
                const operations = grid.getRetileOperations(monitorId, monitorRect);
                
                operations.forEach(op => this._applyGeometry(op.window, op.rect));
            } catch (e) {
                console.error(`WorkflowTiling: Debounced retile failed for monitor ${monitorId}: ${e.message}`);
            }
            this._retileTimeouts.delete(key);
            return GLib.SOURCE_REMOVE;
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

    _handleMonitorsChanged() {
        // Debounce: monitors-changed fires multiple times per hotplug event
        if (this._monitorsChangedPending) return;
        this._monitorsChangedPending = true;

        try {
            const manager = global.backend.get_monitor_manager();
            const monitors = manager.get_monitors();
            const currentMonitorCount = monitors.length;

            console.log(`WorkflowTiling: Topology Change. Count: ${this._lastMonitorCount}->${currentMonitorCount}`);

            // Single-Pass Finalization: Use idle_add to ensure GNOME has fully finished its physical work-area resizing and panel updates.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._monitorsChangedPending = false;
                try {
                    this._batchMode = false;
                    this.workspaceGrids.clear(); 

                    // Build set of currently available monitor IDs
                    const currentMonitorIds = new Set();
                    for (let i = 0; i < monitors.length; i++) {
                        currentMonitorIds.add(this._getMonitorId(i));
                    }

                    // Restore evacuated windows if monitor count increased (replug scenario)
                    if (currentMonitorCount > this._lastMonitorCount && this._evacuatedWindows.size > 0) {
                        // Find the newly appeared monitor by checking which ID wasn't known before
                        const newMonitorIds = [...currentMonitorIds].filter(id => !this._knownMonitorIds.has(id));
                        const targetMonitorId = newMonitorIds.length > 0 ? newMonitorIds[0] : this._getMonitorId(currentMonitorCount - 1);
                        const targetIndex = this._getMonitorIndex(targetMonitorId);

                        const restoredCount = this._evacuatedWindows.size;
                        console.log(`WorkflowTiling: Restoring ${restoredCount} window(s) to new monitor ${targetMonitorId} (index ${targetIndex})`);

                        for (const [win, info] of this._evacuatedWindows) {
                            if (win && !win.unmanaged) {
                                // Unminimize to trigger native GNOME behavior
                                // The geometry engine (_applyGeometry) will physically snap the window to the correct monitor
                                win.unminimize();

                                // Update meta cache to restored monitor so hydration tiles correctly
                                const cachedMeta = this._windowMetaCache.get(win);
                                if (cachedMeta) {
                                    cachedMeta.monitorId = targetMonitorId;
                                    cachedMeta.monitorIndex = targetIndex;
                                    this._windowMetaCache.set(win, cachedMeta);
                                }

                                // Mark for minimized-check bypass (unminimize is async in GNOME)
                                this._restoringWindows.add(win);
                            }
                        }
                        this._evacuatedWindows.clear();
                    }

                    this.hydrate();

                    this._lastMonitorCount = currentMonitorCount;
                    this._knownMonitorIds = new Set(currentMonitorIds);

                } catch (e) {
                    console.error(`WorkflowTiling: Hydration failed: ${e.message}`);
                    this._batchMode = false;
                    this._monitorsChangedPending = false;
                }
                return GLib.SOURCE_REMOVE;
            });

        } catch (e) {
            console.error(`WorkflowTiling: Monitor change processing failed: ${e.message}`);
            this._batchMode = false;
            this._monitorsChangedPending = false;
        }
    }

    getWorkspaceGrid(workspace) {
        if (!this.workspaceGrids.has(workspace)) {
            this.workspaceGrids.set(workspace, new WorkspaceGrid(workspace, this.escalator));
        }
        return this.workspaceGrids.get(workspace);
    }

    /**
     * Executes the actual Mutter move/resize call.
     */
    _applyGeometry(window, rect) {
        try {
            if (!window || window.unmanaged || !window.move_resize_frame) return;
            if (!this._windowMetaCache.has(window)) return;

            const title = (window.get_title && window.get_title()) || 'Unknown';

            if (window.maximized_horizontally || window.maximized_vertically) {
                window.unmaximize();
                // Sequential unmaximize delay
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    if (!window || window.unmanaged || !this._windowMetaCache.has(window)) return GLib.SOURCE_REMOVE;
                    this._doResize(window, rect, title);
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._doResize(window, rect, title);
            }
        } catch (e) {
            console.warn(`WorkflowTiling: Skipping resize: ${e.message}`);
        }
    }

    _doResize(window, rect, title) {
        try {
            window.move_resize_frame(
                true, 
                Math.round(rect.x), 
                Math.round(rect.y), 
                Math.round(rect.width), 
                Math.round(rect.height)
            );
        } catch (e) {
            console.error(`WorkflowTiling: Resize failed for "${title}": ${e.message}`);
        }
    }

    clear() {
        this._retileTimeouts.forEach(id => GLib.source_remove(id));
        this._retileTimeouts.clear();
        this._windowMetaCache.forEach((meta, win) => {
            if (meta.timeoutId > 0) GLib.source_remove(meta.timeoutId);
            this._disconnectSignal(win, 'signalId');
            this._disconnectSignal(win, 'unmanagedId');
            this._disconnectSignal(win, 'workspaceId');
            this._disconnectSignal(win, 'minimizedId');
        });
        this.workspaceGrids.clear();
        this._windowMetaCache.clear();
        this._evacuatedWindows.clear();
        this._restoringWindows.clear();
        this._monitorsChangedPending = false;
    }
}
