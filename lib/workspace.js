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
    getRetileOperations(monitorId, monitorRect, gaps) {
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
                rect: estate.toAbsolute(monitorRect, gaps)
            };
        });
    }

    moveWindowDirection(monitorId, window, direction) {
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(window);
        if (slot === undefined) return false;
        
        const windowCount = tracker.size;
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return false;

        const estate = layout.getEstate(slot);
        if (!estate) return false;

        const eps = 0.01;
        let candidates = [];

        for (let i = 0; i < layout.size; i++) {
            if (i === slot) continue;
            const c = layout.getEstate(i);
            
            let isCandidate = false;
            let orthoOverlap = false;

            if (direction === 'left' || direction === 'right') {
                orthoOverlap = Math.max(c.pct_y, estate.pct_y) < Math.min(c.pct_y + c.pct_h, estate.pct_y + estate.pct_h) - eps;
                if (direction === 'left') {
                    isCandidate = orthoOverlap && c.pct_x + c.pct_w <= estate.pct_x + eps;
                } else {
                    isCandidate = orthoOverlap && c.pct_x >= estate.pct_x + estate.pct_w - eps;
                }
            } else if (direction === 'up' || direction === 'down') {
                orthoOverlap = Math.max(c.pct_x, estate.pct_x) < Math.min(c.pct_x + c.pct_w, estate.pct_x + estate.pct_w) - eps;
                if (direction === 'up') {
                    isCandidate = orthoOverlap && c.pct_y + c.pct_h <= estate.pct_y + eps;
                } else {
                    isCandidate = orthoOverlap && c.pct_y >= estate.pct_y + estate.pct_h - eps;
                }
            }

            if (isCandidate) {
                // calculate distance
                let dist = 0;
                if (direction === 'left') dist = estate.pct_x - (c.pct_x + c.pct_w);
                else if (direction === 'right') dist = c.pct_x - (estate.pct_x + estate.pct_w);
                else if (direction === 'up') dist = estate.pct_y - (c.pct_y + c.pct_h);
                else if (direction === 'down') dist = c.pct_y - (estate.pct_y + estate.pct_h);

                candidates.push({ index: i, distance: dist });
            }
        }

        if (candidates.length === 0) return false;

        // find min distance
        candidates.sort((a, b) => a.distance - b.distance);
        const minDist = candidates[0].distance;
        
        // filter by min distance
        candidates = candidates.filter(c => c.distance <= minDist + eps);
        
        // tie-break by index
        candidates.sort((a, b) => a.index - b.index);
        
        const targetSlot = candidates[0].index;
        const targetWindow = tracker.windows.find(w => tracker.getSlot(w) === targetSlot);

        if (targetWindow) {
            tracker.swapWindows(window, targetWindow);
            return true;
        }
        return false;
    }

    getSlotAtPointer(monitorId, pointerX, pointerY, monitorRect, gaps) {
        const tracker = this._getTracker(monitorId);
        const windowCount = tracker.size;
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return -1;

        for (let i = 0; i < layout.size; i++) {
            const estate = layout.getEstate(i);
            const rect = estate.toAbsolute(monitorRect, gaps);

            if (pointerX >= rect.x && pointerX <= rect.x + rect.width &&
                pointerY >= rect.y && pointerY <= rect.y + rect.height) {
                return i;
            }
        }
        return -1;
    }

    swapWindowByPointer(monitorId, window, pointerX, pointerY, monitorRect, gaps) {
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(window);
        if (slot === undefined) return false;

        const targetSlot = this.getSlotAtPointer(monitorId, pointerX, pointerY, monitorRect, gaps);

        if (targetSlot !== -1 && targetSlot !== slot) {
            const targetWindow = tracker.windows.find(w => tracker.getSlot(w) === targetSlot);
            if (targetWindow) {
                tracker.swapWindows(window, targetWindow);
                return true;
            }
        }

        return false;
    }

    _getTracker(monitorId) {
        if (!this.monitors.has(monitorId)) {
            this.monitors.set(monitorId, new StateTracker());
        }
        return this.monitors.get(monitorId);
    }
}
