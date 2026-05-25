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

    _getTargetWindowInDirection(monitorId, window, direction) {
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(window);
        if (slot === undefined) return null;
        
        const windowCount = tracker.size;
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return null;

        const estate = layout.getEstate(slot);
        if (!estate) return null;

        const targetSlot = this._findTargetSlotInDirection(layout, slot, estate, direction);
        if (targetSlot === -1) return null;

        return tracker.windows.find(w => tracker.getSlot(w) === targetSlot) || null;
    }

    /**
     * Finds the nearest window in the specified geometric direction and swaps slots.
     * Computes orthogonal overlap and distance to determine the best candidate.
     */
    moveWindowDirection(monitorId, window, direction) {
        const targetWindow = this._getTargetWindowInDirection(monitorId, window, direction);
        if (targetWindow) {
            const tracker = this._getTracker(monitorId);
            tracker.swapWindows(window, targetWindow);
            return true;
        }
        return false;
    }

    /**
     * Finds the nearest window in the specified geometric direction and activates it.
     */
    focusWindowDirection(monitorId, window, direction) {
        const targetWindow = this._getTargetWindowInDirection(monitorId, window, direction);
        if (targetWindow) {
            targetWindow.activate(global.get_current_time());
            return true;
        }
        return false;
    }

    _findTargetSlotInDirection(layout, slot, estate, direction) {
        const eps = 0.01;
        let candidates = [];

        for (let i = 0; i < layout.size; i++) {
            if (i === slot) continue;
            const c = layout.getEstate(i);
            
            if (this._isSlotInDirection(estate, c, direction, eps)) {
                candidates.push({ 
                    index: i, 
                    distance: this._calculateSlotDistance(estate, c, direction) 
                });
            }
        }

        if (candidates.length === 0) return -1;

        candidates.sort((a, b) => a.distance - b.distance);
        const minDist = candidates[0].distance;
        
        candidates = candidates.filter(c => c.distance <= minDist + eps);
        candidates.sort((a, b) => a.index - b.index);
        
        return candidates[0].index;
    }

    _isSlotInDirection(estate, c, direction, eps) {
        let orthoOverlap = false;

        if (direction === 'left' || direction === 'right') {
            orthoOverlap = Math.max(c.pct_y, estate.pct_y) < Math.min(c.pct_y + c.pct_h, estate.pct_y + estate.pct_h) - eps;
            if (direction === 'left') {
                return orthoOverlap && c.pct_x + c.pct_w <= estate.pct_x + eps;
            }
            return orthoOverlap && c.pct_x >= estate.pct_x + estate.pct_w - eps;
        } else if (direction === 'up' || direction === 'down') {
            orthoOverlap = Math.max(c.pct_x, estate.pct_x) < Math.min(c.pct_x + c.pct_w, estate.pct_x + estate.pct_w) - eps;
            if (direction === 'up') {
                return orthoOverlap && c.pct_y + c.pct_h <= estate.pct_y + eps;
            }
            return orthoOverlap && c.pct_y >= estate.pct_y + estate.pct_h - eps;
        }
        return false;
    }

    _calculateSlotDistance(estate, c, direction) {
        if (direction === 'left') return estate.pct_x - (c.pct_x + c.pct_w);
        if (direction === 'right') return c.pct_x - (estate.pct_x + estate.pct_w);
        if (direction === 'up') return estate.pct_y - (c.pct_y + c.pct_h);
        if (direction === 'down') return c.pct_y - (estate.pct_y + estate.pct_h);
        return 0;
    }

    /**
     * Resolves absolute pointer coordinates to a window layout slot index.
     * Returns -1 if pointer does not intersect any calculated slot estate.
     */
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

    /**
     * Swaps the dragged window's slot with the window occupying the slot under the pointer.
     */
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
