import Gio from 'gi://Gio';
import St from 'gi://St';

/**
 * DragManager: Manages pointer drag tracking and visual drop indicators.
 */
export class DragManager {
    constructor(controller) {
        this.controller = controller;
        this._activeDrag = null; // { window, originalSlot, indicator, signalId, lastHoveredSlot }
    }

    startDragTracking(window) {
        if (this._activeDrag) this.endDragTracking(this._activeDrag.window);
        const wrapper = this.controller._windowWrappers.get(window);
        if (!wrapper || !wrapper.workspace || !wrapper.monitorId) return;

        const workspace = wrapper.workspace;
        const grid = this.controller.getWorkspaceGrid(workspace);
        const tracker = grid._getTracker(wrapper.monitorId);
        const originalSlot = tracker.getSlot(window);
        if (originalSlot === undefined) return;

        const indicator = this._createIndicator();
        
        const signalId = window.connect('position-changed', () => {
            this._handlePositionChanged(wrapper, grid, tracker, originalSlot, indicator);
        });

        this._activeDrag = { window, originalSlot, indicator, signalId, lastHoveredSlot: -1 };
    }

    /**
     * Creates and attaches a visual indicator for dragged windows.
     */
    _createIndicator() {
        const indicator = new St.Widget({
            style: `
                border: 2px solid -st-accent-color;
                border-radius: 8px;
            `,
            visible: false
        });

        const bg = new St.Widget({
            style: `
                background-color: -st-accent-color;
                border-radius: 6px;
            `,
            opacity: 76
        });
        indicator.add_child(bg);
        indicator._bg = bg;

        global.window_group.add_child(indicator);
        return indicator;
    }

    /**
     * Continuously handles window pointer positioning during an active drag,
     * triggering visual slot swaps when the pointer crosses bounds.
     */
    _handlePositionChanged(wrapper, grid, tracker, originalSlot, indicator) {
        const workspace = wrapper.workspace;
        if (!workspace.get_work_area_for_monitor) return;
        
        const monitorRect = workspace.get_work_area_for_monitor(wrapper.monitorIndex);
        const gaps = this.controller.settings ? this.controller.settings.getGaps() : { inner: 6, outer: 4 };
        
        const [x, y] = global.get_pointer();
        const hoveredSlot = grid.getSlotAtPointer(wrapper.monitorId, x, y, monitorRect, gaps);

        if (hoveredSlot !== -1 && hoveredSlot !== originalSlot) {
            const layout = grid.escalator.getLayoutForCount(tracker.size);
            const targetRect = layout.getEstate(hoveredSlot).toAbsolute(monitorRect, gaps);
            
            indicator.set_position(targetRect.x, targetRect.y);
            indicator.set_size(targetRect.width, targetRect.height);
            if (indicator._bg) indicator._bg.set_size(targetRect.width, targetRect.height);
            indicator.show();

            this._applyVisualSwap(tracker, layout, originalSlot, hoveredSlot, monitorRect, gaps);
        } else {
            indicator.hide();
            this._revertVisualSwap(tracker, grid, monitorRect, gaps);
        }
    }

    /**
     * Applies a temporary visual preview of window positions, reverting the
     * previously hovered window and shifting the newly hovered window.
     */
    _applyVisualSwap(tracker, layout, originalSlot, hoveredSlot, monitorRect, gaps) {
        if (!this._activeDrag || this._activeDrag.lastHoveredSlot === hoveredSlot) return;

        // Revert previous hover
        if (this._activeDrag.lastHoveredSlot !== -1) {
            this._restoreWindowGeometry(tracker, layout, this._activeDrag.lastHoveredSlot, this._activeDrag.lastHoveredSlot, monitorRect, gaps);
        }

        // Apply new hover (move hovered window to dragged window's original slot)
        this._restoreWindowGeometry(tracker, layout, hoveredSlot, originalSlot, monitorRect, gaps);
        this._activeDrag.lastHoveredSlot = hoveredSlot;
    }

    /**
     * Restores window geometry to its original slot when the pointer leaves an active tile.
     */
    _revertVisualSwap(tracker, grid, monitorRect, gaps) {
        if (!this._activeDrag || this._activeDrag.lastHoveredSlot === -1) return;
        const layout = grid.escalator.getLayoutForCount(tracker.size);
        this._restoreWindowGeometry(tracker, layout, this._activeDrag.lastHoveredSlot, this._activeDrag.lastHoveredSlot, monitorRect, gaps);
        this._activeDrag.lastHoveredSlot = -1;
    }

    _restoreWindowGeometry(tracker, layout, slotToFind, targetEstateSlot, monitorRect, gaps) {
        const win = tracker.windows.find(w => tracker.getSlot(w) === slotToFind);
        if (!win) return;
        const wrap = this.controller._windowWrappers.get(win);
        if (wrap) {
            const targetRect = layout.getEstate(targetEstateSlot).toAbsolute(monitorRect, gaps);
            wrap.applyGeometry(targetRect);
        }
    }

    endDragTracking(window) {
        if (!this._activeDrag || this._activeDrag.window !== window) return;

        window.disconnect(this._activeDrag.signalId);
        if (this._activeDrag.indicator) {
            this._activeDrag.indicator.destroy();
        }
        
        this._activeDrag = null;

        const wrapper = this.controller._windowWrappers.get(window);
        if (!wrapper || !wrapper.workspace || !wrapper.monitorId) return;

        const workspace = wrapper.workspace;
        if (!workspace.get_work_area_for_monitor) return;
        
        const monitorRect = workspace.get_work_area_for_monitor(wrapper.monitorIndex);
        const gaps = this.controller.settings ? this.controller.settings.getGaps() : { inner: 6, outer: 4 };

        const grid = this.controller.getWorkspaceGrid(workspace);
        
        const [x, y] = global.get_pointer();
        grid.swapWindowByPointer(wrapper.monitorId, window, x, y, monitorRect, gaps);
        this.controller._scheduleRetile(wrapper.workspace, wrapper.monitorId, wrapper.monitorIndex);
    }
}
