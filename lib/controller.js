import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { WorkspaceGrid } from './workspace.js';
import { createDefaultEscalator } from './layout.js';

/**
 * TilingController: The central orchestration layer.
 * Manages WorkspaceGrids and translates logical tiling into Mutter actions.
 */
export class TilingController {
    constructor() {
        this.escalator = createDefaultEscalator();
        this.workspaceGrids = new Map();
        this._windowMetaCache = new Map();
        this._retileTimeouts = new Map(); // monitorKey -> timeoutId
    }

    /**
     * Registers a new window for tiling.
     */
    tilingRequest(window) {
        if (!window || !window.get_workspace || !window.get_monitor) return;

        try {
            const workspace = window.get_workspace();
            const monitorIndex = window.get_monitor();
            
            if (!workspace || monitorIndex < 0) return;

            // Track metadata immediately
            this._windowMetaCache.set(window, { workspace, monitorIndex });
            
            // Add to logical state
            const grid = this.getWorkspaceGrid(workspace);
            grid.trackWindow(window, monitorIndex);

            // Schedule physical retiling
            this._scheduleRetile(workspace, monitorIndex);
        } catch (e) {
            console.error(`WorkflowTiling: Error in tilingRequest: ${e.message}`);
        }
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
            // Remove from logical state immediately
            const grid = this.getWorkspaceGrid(workspace);
            grid.untrackWindow(window, monitorIndex);

            // Schedule physical retiling
            this._scheduleRetile(workspace, monitorIndex);
        } catch (e) {
            console.error(`WorkflowTiling: Error in untile: ${e.message}`);
        }
    }

    /**
     * Debounces the physical move/resize operations to handle rapid window events.
     */
    _scheduleRetile(workspace, monitorIndex) {
        // Use a weak key for the workspace if possible, or a string
        const key = `${workspace}-${monitorIndex}`;
        
        if (this._retileTimeouts.has(key)) {
            GLib.source_remove(this._retileTimeouts.get(key));
        }

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            try {
                // Final check: is the workspace still valid?
                if (!workspace || !workspace.get_work_area_for_monitor) {
                    this._retileTimeouts.delete(key);
                    return GLib.SOURCE_REMOVE;
                }

                const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);
                const grid = this.getWorkspaceGrid(workspace);
                const operations = grid.getRetileOperations(monitorIndex, monitorRect);
                
                operations.forEach(op => {
                    this._applyGeometry(op.window, op.rect);
                });
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
            // Defensive check for window validity
            if (!window || !window.move_resize_frame) return;
            
            // Check if window is still "alive" by trying a simple method
            // If it's being destroyed, this might throw or return invalid
            if (window.get_workspace() === null && !window.is_on_all_workspaces) return;

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
            // Log but don't crash
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
