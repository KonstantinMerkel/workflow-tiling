import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * DragManager: Manages pointer drag tracking and visual drop indicators.
 */
export class DragManager {
    constructor(controller) {
        this.controller = controller;
        this._activeDrag = null; // { window, originalSlot, indicator, signalId, lastHoveredSlot, lastHoveredMonitorId, origRect }
    }

    isWindowInDragPreview(window) {
        if (!this._activeDrag) return false;
        if (this._activeDrag.window === window) return true;

        const wrapper = this.controller._windowWrappers.get(window);
        if (!wrapper) return false;

        const draggedWrapper = this.controller._windowWrappers.get(this._activeDrag.window);
        const sourceMonitorId = draggedWrapper ? draggedWrapper.monitorId : null;
        
        if (wrapper.monitorId === sourceMonitorId) return true;
        if (this._activeDrag.lastHoveredMonitorId && wrapper.monitorId === this._activeDrag.lastHoveredMonitorId) return true;

        return false;
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
            const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';
            const matrixCount = (monitorId === wrapper.monitorId || behavior === 'swap') ? targetTracker.size : (targetTracker.size + 1);
            
            if (matrixCount > layout.escalator.getMaxCount()) {
                hoveredSlot = -1;
            } else {
                hoveredSlot = layout.getSlotAtPointer(monitorId, x, y, monitorRect, gaps, matrixCount);
            }
            
            if (hoveredSlot !== -1) {
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
            this._revertVisualSwap(layout, gaps);
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
        this._revertVisualSwap(layout, gaps);

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
        
        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';

        if (behavior === 'escalate') {
            const sourceMatrix = layout.escalator.getLayoutForCount(sourceTracker.size > 0 ? sourceTracker.size - 1 : 0);
            if (sourceMatrix) {
                const origSlot = this._activeDrag.originalSlot;
                for (const win of sourceTracker.windows) {
                    if (win === this._activeDrag.window) continue;
                    const slot = sourceTracker.getSlot(win);
                    if (slot !== undefined) {
                        const targetSlot = (slot > origSlot) ? (slot - 1) : slot;
                        const wrap = this.controller._windowWrappers.get(win);
                        const estate = sourceMatrix.getEstate(targetSlot);
                        if (wrap && estate) {
                            const rect = estate.toAbsolute(sourceMonitorRect, gaps);
                            wrap.applyGeometry(rect);
                        }
                    }
                }
            }
        } else {
            this._revertVisualSwap(layout, gaps);
        }

        // Apply new cross-monitor visual swap preview using size N+1 matrix
        const matrix = layout.escalator.getLayoutForCount(behavior === 'swap' && targetTracker.size > 0 ? targetTracker.size : targetTracker.size + 1);
        
        if (matrix) {
            if (behavior === 'swap' && targetTracker.size > 0) {
                // In swap mode, we visually move the hovered target window to the source window's slot
                const sourceTracker = layout._getTracker(wrapper.monitorId);
                const sourceMatrix = layout.escalator.getLayoutForCount(sourceTracker.size);
                const sourceEstate = sourceMatrix ? sourceMatrix.getEstate(this._activeDrag.originalSlot) : null;
                const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(wrapper.monitorId);
                const sourceMonitorRect = wrapper.workspace.get_work_area_for_monitor(sourceMonitorIndex);

                for (const win of targetTracker.windows) {
                    const slot = targetTracker.getSlot(win);
                    if (slot !== undefined) {
                        const wrap = this.controller._windowWrappers.get(win);
                        if (wrap) {
                            if (slot === hoveredSlot && sourceEstate) {
                                const targetRect = sourceEstate.toAbsolute(sourceMonitorRect, gaps);
                                wrap.applyGeometry(targetRect);
                            } else {
                                const estate = matrix.getEstate(slot);
                                if (estate) {
                                    const targetRect = estate.toAbsolute(monitorRect, gaps);
                                    wrap.applyGeometry(targetRect);
                                }
                            }
                        }
                    }
                }
            } else {
                // Escalate N+1 preview
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
        }

        this._activeDrag.lastHoveredSlot = hoveredSlot;
        this._activeDrag.lastHoveredMonitorId = monitorId;
    }

    /**
     * Restores window geometry to its original slot when the pointer leaves an active tile.
     */
    _revertVisualSwap(layout, gaps, clearState = true) {
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
        }
        
        if (sourceMonId) {
            const sourceTracker = layout._getTracker(sourceMonId);
            const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(sourceMonId);
            if (sourceMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const sourceMonitorRect = workspace.get_work_area_for_monitor(sourceMonitorIndex);
                this._restoreTrackerGeometries(sourceTracker, layout, sourceMonitorRect, gaps);
            }
        }

        if (clearState) {
            this._activeDrag.lastHoveredSlot = -1;
            this._activeDrag.lastHoveredMonitorId = null;
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
        this._revertVisualSwap(layout, gaps, false);

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
            const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';

            const targetTracker = layout._getTracker(lastHoveredMonitorId);
            const targetWindow = targetTracker.windows.find(w => targetTracker.getSlot(w) === lastHoveredSlot);

            if (behavior === 'swap' && targetWindow) {
                layout.untrackWindow(window, sourceMonitorId);
                layout.untrackWindow(targetWindow, lastHoveredMonitorId);

                wrapper.monitorId = lastHoveredMonitorId;
                wrapper.monitorIndex = targetMonitorIndex;

                const targetWrapper = this.controller._windowWrappers.get(targetWindow);
                if (targetWrapper) {
                    targetWrapper.monitorId = sourceMonitorId;
                    targetWrapper.monitorIndex = sourceMonitorIndex;
                }

                targetTracker.track(window, lastHoveredSlot);
                const sourceTracker = layout._getTracker(sourceMonitorId);
                sourceTracker.track(targetWindow, activeDrag.originalSlot);

                if (targetMonitorIndex !== -1) window.move_to_monitor(targetMonitorIndex);
                if (sourceMonitorIndex !== -1) targetWindow.move_to_monitor(sourceMonitorIndex);

                this.controller._scheduleRetile(workspace, sourceMonitorId, sourceMonitorIndex);
                this.controller._scheduleRetile(workspace, lastHoveredMonitorId, targetMonitorIndex);
            } else {
                layout.untrackWindow(window, sourceMonitorId);
                
                wrapper.monitorId = lastHoveredMonitorId;
                wrapper.monitorIndex = targetMonitorIndex;
                
                layout.trackWindow(window, lastHoveredMonitorId, lastHoveredSlot !== -1 ? lastHoveredSlot : undefined);
                
                if (targetMonitorIndex !== -1) window.move_to_monitor(targetMonitorIndex);
                
                this.controller._scheduleRetile(workspace, sourceMonitorId, sourceMonitorIndex);
                this.controller._scheduleRetile(workspace, lastHoveredMonitorId, targetMonitorIndex);
            }
        } else {
            const [x, y] = global.get_pointer();
            
            let pointerMonitorIndex = -1;
            const numMonitors = global.display.get_n_monitors();
            for (let i = 0; i < numMonitors; i++) {
                const rect = global.display.get_monitor_geometry(i);
                if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) {
                    pointerMonitorIndex = i;
                    break;
                }
            }
            
            if (pointerMonitorIndex === -1) pointerMonitorIndex = wrapper.monitorIndex;
            const pointerMonitorId = this.controller.monitorManager.getMonitorId(pointerMonitorIndex);

            if (pointerMonitorId && pointerMonitorId !== wrapper.monitorId) {
                const sourceMonitorId = wrapper.monitorId;
                const sourceMonitorIndex = wrapper.monitorIndex;
                
                layout.untrackWindow(window, sourceMonitorId);
                
                wrapper.monitorId = pointerMonitorId;
                wrapper.monitorIndex = pointerMonitorIndex;
                
                if (pointerMonitorIndex !== -1) window.move_to_monitor(pointerMonitorIndex);
                
                this.controller._scheduleRetile(workspace, sourceMonitorId, sourceMonitorIndex);
            } else {
                const swapped = layout.swapWindowByPointer(wrapper.monitorId, window, x, y, monitorRect, gaps);
                
                const currRect = window.get_frame_rect ? window.get_frame_rect() : { x: 0, y: 0, width: 0, height: 0 };
                const rectChanged = currRect.x !== origRect.x || currRect.y !== origRect.y || currRect.width !== origRect.width || currRect.height !== origRect.height;

                if (swapped || rectChanged) {
                    this.controller._scheduleRetile(wrapper.workspace, wrapper.monitorId, wrapper.monitorIndex);
                }
            }
        }
    }
}
