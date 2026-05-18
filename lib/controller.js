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
        this._windowMetaCache = new Map(); // window -> { workspace, monitorIndex, timeoutId, signalId }
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
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

            const oldWorkspace = meta.workspace;
            const oldMonitor = meta.monitorIndex;

            // Handle movement between workspaces/monitors
            if (oldWorkspace && (oldWorkspace !== workspace || oldMonitor !== monitorIndex)) {
                try {
                    const oldGrid = this.getWorkspaceGrid(oldWorkspace);
                    oldGrid.untrackWindow(window, oldMonitor);
                    this._scheduleRetile(oldWorkspace, oldMonitor);
                } catch (e) {}
            }

            // Update cache with current location
            meta.workspace = workspace;
            meta.monitorIndex = monitorIndex;
            this._windowMetaCache.set(window, meta);

            const grid = this.getWorkspaceGrid(workspace);

            if (window.minimized) {
                grid.untrackWindow(window, monitorIndex);
            } else {
                grid.trackWindow(window, monitorIndex);
            }

            this._scheduleRetile(workspace, monitorIndex);
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

        const { workspace, monitorIndex } = cached;
        this._windowMetaCache.delete(window);

        try {
            if (workspace) {
                const grid = this.getWorkspaceGrid(workspace);
                grid.untrackWindow(window, monitorIndex);
                this._scheduleRetile(workspace, monitorIndex);
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

    _scheduleRetile(workspace, monitorIndex) {
        const key = `${workspace}-${monitorIndex}`;
        
        if (this._retileTimeouts.has(key)) {
            GLib.source_remove(this._retileTimeouts.get(key));
        }

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            try {
                if (!workspace || !workspace.get_work_area_for_monitor) {
                    this._retileTimeouts.delete(key);
                    return GLib.SOURCE_REMOVE;
                }

                const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);
                const grid = this.getWorkspaceGrid(workspace);
                const operations = grid.getRetileOperations(monitorIndex, monitorRect);
                
                operations.forEach(op => this._applyGeometry(op.window, op.rect));
            } catch (e) {
                console.error(`WorkflowTiling: Debounced retile failed: ${e.message}`);
            }
            this._retileTimeouts.delete(key);
            return GLib.SOURCE_REMOVE;
        });

        this._retileTimeouts.set(key, timeoutId);
    }

    retileAll() {
        this._windowMetaCache.forEach((meta) => {
            if (meta.workspace && meta.monitorIndex >= 0) {
                this._scheduleRetile(meta.workspace, meta.monitorIndex);
            }
        });
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
    }
}
