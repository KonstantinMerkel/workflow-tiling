import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { WorkspaceGrid } from './workspace.js';
import { createDefaultEscalator } from './layout.js';

/**
 * TilingController: The central orchestration layer.
 * Uses a One-Shot Signal Intercept to handle skeletal GTK4 initialization.
 */
export class TilingController {
    constructor() {
        this.escalator = createDefaultEscalator();
        this.workspaceGrids = new Map();
        this._windowMetaCache = new Map(); // window -> { workspace, monitorIndex }
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
    }

    /**
     * Registers a new window for tiling using a One-Shot Signal Intercept.
     */
    tilingRequest(window) {
        if (!window) return;

        const title = (window.get_title && window.get_title()) || 'New Window';

        const runTiling = () => {
            try {
                if (!window || window.unmanaged || !window.get_workspace) return;
                
                let workspace = window.get_workspace();
                let monitorIndex = window.get_monitor();

                // Fallback for apps that don't report workspace/monitor immediately
                if (!workspace) workspace = global.workspace_manager.get_active_workspace();
                if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();

                this._windowMetaCache.set(window, { workspace, monitorIndex });
                const grid = this.getWorkspaceGrid(workspace);
                grid.trackWindow(window, monitorIndex);

                this._scheduleRetile(workspace, monitorIndex);
            } catch (e) {
                console.error(`WorkflowTiling: Tiling failed for "${title}": ${e.message}`);
            }
        };

        // 1. Fast-Track (Immediate execution)
        runTiling();

        // 2. One-Shot Signal Hook for Verification Snap
        let signalId = window.connect('size-changed', () => {
            if (signalId > 0) {
                window.disconnect(signalId);
                signalId = 0;
            }
            console.log(`TilingController: Verification snap for "${title}" via size-changed`);
            runTiling();
        });

        // 3. Memory Leak Fallback Cleanup
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (signalId > 0 && window && window.handler_is_connected(signalId)) {
                window.disconnect(signalId);
                signalId = 0;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Removes a window from the tiling system.
     */
    untile(window) {
        const cached = this._windowMetaCache.get(window);
        if (!cached) return;

        const { workspace, monitorIndex } = cached;
        this._windowMetaCache.delete(window);

        try {
            const grid = this.getWorkspaceGrid(workspace);
            grid.untrackWindow(window, monitorIndex);
            this._scheduleRetile(workspace, monitorIndex);
        } catch (e) {
            console.error(`WorkflowTiling: Error in untile: ${e.message}`);
        }
    }

    /**
     * Debounces the physical move/resize operations to handle rapid window events.
     */
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
            
            if (window.maximized_horizontally || window.maximized_vertically) {
                window.unmaximize();
            }
            
            window.move_resize_frame(
                true, 
                Math.round(rect.x), 
                Math.round(rect.y), 
                Math.round(rect.width), 
                Math.round(rect.height)
            );
        } catch (e) {
            console.warn(`WorkflowTiling: Skipping window resize: ${e.message}`);
        }
    }

    clear() {
        this._retileTimeouts.forEach(id => GLib.source_remove(id));
        this._retileTimeouts.clear();
        this.workspaceGrids.clear();
        this._windowMetaCache.clear();
    }
}
