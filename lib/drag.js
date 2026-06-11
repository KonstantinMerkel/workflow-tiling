import Gio from 'gi://Gio';
import St from 'gi://St';

/**
 * DragManager: Manages pointer drag tracking and visual drop indicators.
 */
export class DragManager {
    constructor(controller) {
        this.controller = controller;
        this._activeDrag = null; // { window, originalSlot, indicator, signalId, lastHoveredSlot, lastHoveredMonitorId, origRect }
    }

    startDragTracking(window) {
        if (this._activeDrag) this.endDragTracking(this._activeDrag.window);
        const wrapper = this.controller._windowWrappers.get(window);
        if (!wrapper || !wrapper.workspace || !wrapper.monitorId) return;

        const workspace = wrapper.workspace;
        const layout = this.controller.workspaceManager.getLayout(workspace);
        const tracker = layout._getTracker(wrapper.monitorId);
        const originalSlot = tracker.getSlot(window);
        if (originalSlot === undefined) return;

        const matrix = layout.escalator.getLayoutForCount(tracker.size);
        if (!matrix || originalSlot >= matrix.size) return;

        const indicator = this._createIndicator();
        
        const signalId = window.connect('position-changed', () => {
            this._handlePositionChanged(wrapper, layout, tracker, originalSlot, indicator);
        });

        const origRect = window.get_frame_rect ? window.get_frame_rect() : { x: 0, y: 0, width: 0, height: 0 };
        this._activeDrag = { window, originalSlot, indicator, signalId, lastHoveredSlot: -1, lastHoveredMonitorId: null, origRect };
    }

    /**
     * Creates and attaches a visual indicator for dragged windows.
     */
    _createIndicator() {
        const indicator = new St.Widget({
            style: `
                border: 2px solid var(--accent-color, #3584e4);
                border-radius: 8px;
            `,
            visible: false
        });

        const bg = new St.Widget({
            style: `
                background-color: var(--accent-bg-color, rgba(53, 132, 228, 0.3));
                border-radius: 6px;
            `
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
    _handlePositionChanged(wrapper, layout, tracker, originalSlot, indicator) {
        const workspace = wrapper.workspace;
        if (!workspace.get_work_area_for_monitor) return;
        
        const gaps = this.controller.settings ? this.controller.settings.getGaps() : { inner: 6, outer: 4 };
        
        const [x, y] = global.get_pointer();
        let monitorIndex = global.display.get_current_monitor();
        if (monitorIndex === -1) {
            monitorIndex = wrapper.monitorIndex;
        }

        const monitorId = this.controller.monitorManager.getMonitorId(monitorIndex);
        const targetTracker = layout._getTracker(monitorId);
        const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);

        let hoveredSlot = -1;
        let targetRect = null;

        if (targetTracker.size === 0) {
            hoveredSlot = 0;
            targetRect = {
                x: monitorRect.x + gaps.outer,
                y: monitorRect.y + gaps.outer,
                width: monitorRect.width - (gaps.outer * 2),
                height: monitorRect.height - (gaps.outer * 2)
            };
        } else {
            hoveredSlot = layout.getSlotAtPointer(monitorId, x, y, monitorRect, gaps);
            if (hoveredSlot !== -1) {
                const matrixCount = (monitorId === wrapper.monitorId) ? targetTracker.size : (targetTracker.size + 1);
                const matrix = layout.escalator.getLayoutForCount(matrixCount);
                if (matrix) {
                    const estate = matrix.getEstate(hoveredSlot);
                    if (estate) {
                        targetRect = estate.toAbsolute(monitorRect, gaps);
                    } else {
                        hoveredSlot = -1;
                    }
                } else {
                    hoveredSlot = -1;
                }
            }
        }

        if (hoveredSlot !== -1 && targetRect) {
            indicator.set_position(targetRect.x, targetRect.y);
            indicator.set_size(targetRect.width, targetRect.height);
            if (indicator._bg) indicator._bg.set_size(targetRect.width, targetRect.height);
            indicator.show();

            if (monitorId !== wrapper.monitorId) {
                this._applyCrossMonitorVisualSwap(wrapper, targetTracker, layout, monitorId, hoveredSlot, monitorRect, gaps);
            } else {
                this._applyVisualSwap(tracker, layout, originalSlot, hoveredSlot, monitorRect, gaps);
            }
        } else {
            indicator.hide();
            this._revertVisualSwap(tracker, layout, monitorRect, gaps);
        }
    }

    /**
     * Applies a temporary visual preview of window positions, reverting the
     * previously hovered window and shifting the newly hovered window.
     */
    _applyVisualSwap(tracker, layout, originalSlot, hoveredSlot, monitorRect, gaps) {
        if (!this._activeDrag) return;
        const wrapper = this.controller._windowWrappers.get(this._activeDrag.window);
        const sourceMonId = wrapper ? wrapper.monitorId : null;
        if (this._activeDrag.lastHoveredMonitorId === sourceMonId && this._activeDrag.lastHoveredSlot === hoveredSlot) return;

        // Revert previous hover
        this._revertVisualSwap(tracker, layout, monitorRect, gaps);

        const matrix = layout.escalator.getLayoutForCount(tracker.size);
        if (matrix) {
            // Apply new hover (move hovered window to dragged window's original slot)
            this._restoreWindowGeometry(tracker, matrix, hoveredSlot, originalSlot, monitorRect, gaps);
        }

        this._activeDrag.lastHoveredSlot = hoveredSlot;
        this._activeDrag.lastHoveredMonitorId = sourceMonId;
    }

    _applyCrossMonitorVisualSwap(wrapper, targetTracker, layout, monitorId, hoveredSlot, monitorRect, gaps) {
        if (!this._activeDrag) return;
        if (this._activeDrag.lastHoveredMonitorId === monitorId && this._activeDrag.lastHoveredSlot === hoveredSlot) return;

        // Revert previous hover
        const sourceTracker = layout._getTracker(wrapper.monitorId);
        const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(wrapper.monitorId);
        const sourceMonitorRect = wrapper.workspace.get_work_area_for_monitor(sourceMonitorIndex);
        this._revertVisualSwap(sourceTracker, layout, sourceMonitorRect, gaps);

        // Apply new cross-monitor visual swap preview using size N+1 matrix
        const matrix = layout.escalator.getLayoutForCount(targetTracker.size + 1);
        if (matrix) {
            for (const win of targetTracker.windows) {
                const slot = targetTracker.getSlot(win);
                if (slot !== undefined) {
                    const targetEstateSlot = (slot >= hoveredSlot) ? (slot + 1) : slot;
                    const wrap = this.controller._windowWrappers.get(win);
                    const estate = matrix.getEstate(targetEstateSlot);
                    if (wrap && estate) {
                        const targetRect = estate.toAbsolute(monitorRect, gaps);
                        wrap.applyGeometry(targetRect);
                    }
                }
            }
        }

        this._activeDrag.lastHoveredSlot = hoveredSlot;
        this._activeDrag.lastHoveredMonitorId = monitorId;
    }

    /**
     * Restores window geometry to its original slot when the pointer leaves an active tile.
     */
    _revertVisualSwap(tracker, layout, monitorRect, gaps) {
        if (!this._activeDrag || this._activeDrag.lastHoveredSlot === -1) return;

        const lastMonId = this._activeDrag.lastHoveredMonitorId;
        const wrapper = this.controller._windowWrappers.get(this._activeDrag.window);
        const sourceMonId = wrapper ? wrapper.monitorId : null;

        if (lastMonId && lastMonId !== sourceMonId) {
            const lastTracker = layout._getTracker(lastMonId);
            const lastMonitorIndex = this.controller.monitorManager.getMonitorIndex(lastMonId);
            if (lastMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const lastMonitorRect = workspace.get_work_area_for_monitor(lastMonitorIndex);
                this._restoreTrackerGeometries(lastTracker, layout, lastMonitorRect, gaps);
            }
        } else {
            this._restoreTrackerGeometries(tracker, layout, monitorRect, gaps);
        }

        this._activeDrag.lastHoveredSlot = -1;
        this._activeDrag.lastHoveredMonitorId = null;
    }

    _revertVisualSwapForEnd(tracker, layout, monitorRect, gaps) {
        if (!this._activeDrag || this._activeDrag.lastHoveredSlot === -1) return;

        const lastMonId = this._activeDrag.lastHoveredMonitorId;
        const wrapper = this.controller._windowWrappers.get(this._activeDrag.window);
        const sourceMonId = wrapper ? wrapper.monitorId : null;

        if (lastMonId && lastMonId !== sourceMonId) {
            const lastTracker = layout._getTracker(lastMonId);
            const lastMonitorIndex = this.controller.monitorManager.getMonitorIndex(lastMonId);
            if (lastMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const lastMonitorRect = workspace.get_work_area_for_monitor(lastMonitorIndex);
                this._restoreTrackerGeometries(lastTracker, layout, lastMonitorRect, gaps);
            }
        } else {
            this._restoreTrackerGeometries(tracker, layout, monitorRect, gaps);
        }
    }

    _restoreTrackerGeometries(tracker, layout, monitorRect, gaps) {
        const matrix = layout.escalator.getLayoutForCount(tracker.size);
        if (!matrix) return;
        const draggedWindow = this._activeDrag ? this._activeDrag.window : null;
        for (const win of tracker.windows) {
            if (win === draggedWindow) continue;
            const slot = tracker.getSlot(win);
            if (slot !== undefined) {
                const wrap = this.controller._windowWrappers.get(win);
                if (wrap) {
                    const estate = matrix.getEstate(slot);
                    if (estate) {
                        const targetRect = estate.toAbsolute(monitorRect, gaps);
                        wrap.applyGeometry(targetRect);
                    }
                }
            }
        }
    }

    _restoreWindowGeometry(tracker, matrix, slotToFind, targetEstateSlot, monitorRect, gaps) {
        if (!matrix || targetEstateSlot >= matrix.size) return;
        const win = tracker.windows.find(w => tracker.getSlot(w) === slotToFind);
        if (!win) return;
        const wrap = this.controller._windowWrappers.get(win);
        if (wrap) {
            const estate = matrix.getEstate(targetEstateSlot);
            if (estate) {
                const targetRect = estate.toAbsolute(monitorRect, gaps);
                wrap.applyGeometry(targetRect);
            }
        }
    }

    endDragTracking(window) {
        if (!this._activeDrag || this._activeDrag.window !== window) return;

        const activeDrag = this._activeDrag;
        const origRect = activeDrag.origRect;
        const lastHoveredSlot = activeDrag.lastHoveredSlot;
        const lastHoveredMonitorId = activeDrag.lastHoveredMonitorId;

        const wrapper = this.controller._windowWrappers.get(window);
        if (!wrapper || !wrapper.workspace || !wrapper.monitorId) {
            window.disconnect(activeDrag.signalId);
            if (activeDrag.indicator) activeDrag.indicator.destroy();
            this._activeDrag = null;
            return;
        }

        const workspace = wrapper.workspace;
        if (!workspace.get_work_area_for_monitor) {
            window.disconnect(activeDrag.signalId);
            if (activeDrag.indicator) activeDrag.indicator.destroy();
            this._activeDrag = null;
            return;
        }

        const monitorRect = workspace.get_work_area_for_monitor(wrapper.monitorIndex);
        const gaps = this.controller.settings ? this.controller.settings.getGaps() : { inner: 6, outer: 4 };
        const layout = this.controller.workspaceManager.getLayout(workspace);

        // Revert temporary visual swaps before performing final tracking and retile
        const sourceTracker = layout._getTracker(wrapper.monitorId);
        this._revertVisualSwapForEnd(sourceTracker, layout, monitorRect, gaps);

        window.disconnect(activeDrag.signalId);
        if (activeDrag.indicator) {
            activeDrag.indicator.destroy();
        }
        
        this._activeDrag = null;

        if (this._deferredRetiles && this._deferredRetiles.length > 0) {
            this._deferredRetiles.forEach(r => this.controller._scheduleRetile(r.workspace, r.monitorId, r.monitorIndex));
            this._deferredRetiles = [];
        }

        if (lastHoveredMonitorId && lastHoveredMonitorId !== wrapper.monitorId) {
            const targetMonitorIndex = this.controller.monitorManager.getMonitorIndex(lastHoveredMonitorId);
            const sourceMonitorId = wrapper.monitorId;
            const sourceMonitorIndex = wrapper.monitorIndex;

            layout.untrackWindow(window, sourceMonitorId);
            if (targetMonitorIndex !== -1) {
                window.move_to_monitor(targetMonitorIndex);
            }
            layout.trackWindow(window, lastHoveredMonitorId, lastHoveredSlot !== -1 ? lastHoveredSlot : undefined);

            wrapper.monitorId = lastHoveredMonitorId;
            wrapper.monitorIndex = targetMonitorIndex;

            this.controller._scheduleRetile(workspace, sourceMonitorId, sourceMonitorIndex);
            this.controller._scheduleRetile(workspace, lastHoveredMonitorId, targetMonitorIndex);
        } else {
            const [x, y] = global.get_pointer();
            const swapped = layout.swapWindowByPointer(wrapper.monitorId, window, x, y, monitorRect, gaps);
            
            const currRect = window.get_frame_rect ? window.get_frame_rect() : { x: 0, y: 0, width: 0, height: 0 };
            const rectChanged = currRect.x !== origRect.x || currRect.y !== origRect.y || currRect.width !== origRect.width || currRect.height !== origRect.height;

            if (swapped || rectChanged) {
                this.controller._scheduleRetile(wrapper.workspace, wrapper.monitorId, wrapper.monitorIndex);
            }
        }
    }
}
