import { StateTracker } from './state.js';

/**
 * WorkspaceGrid: Manages state for a specific Meta.Workspace.
 */
export class WorkspaceGrid {
    constructor(workspace, escalator) {
        this.workspace = workspace;
        this.escalator = escalator;
        this.monitors = new Map();
    }

    /**
     * Registers window and returns logical state.
     */
    trackWindow(window, monitorId) {
        const tracker = this._getTracker(monitorId);
        if (tracker.getSlot(window) === undefined) {
            tracker.track(window, tracker.size);
        }
    }

    /**
     * Unregisters a window.
     */
    untrackWindow(window, monitorId) {
        const tracker = this._getTracker(monitorId);
        tracker.untrack(window);
    }

    /**
     * Calculates absolute rects for all currently tracked windows on a monitor.
     */
    getRetileOperations(monitorId, monitorRect) {
        const tracker = this._getTracker(monitorId);
        const windowCount = tracker.size;
        
        if (windowCount === 0) return [];
        
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return [];

        return tracker.windows.map((win, index) => {
            // Re-normalize slots
            tracker.track(win, index); 
            const estate = layout.getEstate(index);
            return {
                window: win,
                rect: estate.toAbsolute(monitorRect)
            };
        });
    }

    _getTracker(monitorId) {
        if (!this.monitors.has(monitorId)) {
            this.monitors.set(monitorId, new StateTracker());
        }
        return this.monitors.get(monitorId);
    }
}
