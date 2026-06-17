import Meta from 'gi://Meta';
import St from 'gi://St';
import GLib from 'gi://GLib';
import { Logger } from './logger.js';

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
        const windowCount = layout.getWindowCount(wrapper.monitorId);
        const originalSlot = layout.getWindowSlot(wrapper.monitorId, window);
        if (originalSlot === undefined) return;

        const matrix = layout.escalator.getLayoutForCount(windowCount);
        // We do not require a valid matrix or originalSlot < matrix.size here.
        // We must still track the drag so `isWindowInDragPreview` correctly suppresses 
        // monitor-changed retiles when the user drags this floating window to another monitor.

        const indicator = this._createIndicator();
        
        const signalId = window.connect('position-changed', () => {
            this._handlePositionChanged(wrapper, layout, originalSlot, indicator);
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
                background-color: --st-accent-color;
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
    _handlePositionChanged(wrapper, layout, originalSlot, indicator) {
        const workspace = wrapper.workspace;
        if (!workspace.get_work_area_for_monitor) return;
        
        const gaps = this.controller.settings ? this.controller.settings.getGaps() : { inner: 6, outer: 4 };
        
        const [x, y] = global.get_pointer();
        let monitorIndex = global.display.get_current_monitor();
        if (monitorIndex === -1) {
            monitorIndex = wrapper.monitorIndex;
        }

        const monitorId = this.controller.monitorManager.getMonitorId(monitorIndex);
        const targetWindowCount = layout.getWindowCount(monitorId);
        const monitorRect = workspace.get_work_area_for_monitor(monitorIndex);

        let hoveredSlot = -1;
        let targetRect = null;

        if (targetWindowCount === 0) {
            hoveredSlot = 0;
            targetRect = {
                x: monitorRect.x + gaps.outer,
                y: monitorRect.y + gaps.outer,
                width: monitorRect.width - (gaps.outer * 2),
                height: monitorRect.height - (gaps.outer * 2)
            };
        } else {
            const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';
            const matrixCount = (monitorId === wrapper.monitorId || behavior === 'swap') ? targetWindowCount : (targetWindowCount + 1);
            
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
                this._applyCrossMonitorVisualSwap(wrapper, targetWindowCount, layout, monitorId, hoveredSlot, monitorRect, gaps);
            } else {
                this._applyVisualSwap(monitorId, layout, originalSlot, hoveredSlot, monitorRect, gaps);
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
    _applyVisualSwap(monitorId, layout, originalSlot, hoveredSlot, monitorRect, gaps) {
        if (!this._activeDrag) return;
        const wrapper = this.controller._windowWrappers.get(this._activeDrag.window);
        const sourceMonId = wrapper ? wrapper.monitorId : null;

        if (this._activeDrag.lastHoveredMonitorId === sourceMonId && this._activeDrag.lastHoveredSlot === hoveredSlot) return;

        // Revert previous hover
        this._revertVisualSwap(layout, gaps);

        const windowCount = layout.getWindowCount(monitorId);
        const matrix = layout.escalator.getLayoutForCount(windowCount);
        if (!matrix) return;

        this._activeDrag.lastHoveredSlot = hoveredSlot;
        this._activeDrag.lastHoveredMonitorId = sourceMonId;

        this._restoreWindowGeometry(monitorId, layout, matrix, hoveredSlot, originalSlot, monitorRect, gaps);
    }

    _applyCrossMonitorVisualSwap(wrapper, targetWindowCount, layout, monitorId, hoveredSlot, monitorRect, gaps) {
        if (!this._activeDrag) return;
        if (this._activeDrag.lastHoveredMonitorId === monitorId && this._activeDrag.lastHoveredSlot === hoveredSlot) return;

        // Revert previous hover
        const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(wrapper.monitorId);
        const sourceMonitorRect = wrapper.workspace.get_work_area_for_monitor(sourceMonitorIndex);
        
        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';

        if (behavior === 'escalate') {
            const sourceCount = layout.getWindowCount(wrapper.monitorId);
            const sourceMatrix = layout.escalator.getLayoutForCount(sourceCount > 0 ? sourceCount - 1 : 0);
            if (sourceMatrix) {
                const origSlot = this._activeDrag.originalSlot;
                const windows = layout.getWindowsForMonitor(wrapper.monitorId);
                for (const win of windows) {
                    if (win === this._activeDrag.window) continue;
                    const slot = layout.getWindowSlot(wrapper.monitorId, win);
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
        const matrix = layout.escalator.getLayoutForCount(behavior === 'swap' && targetWindowCount > 0 ? targetWindowCount : targetWindowCount + 1);
        
        if (matrix) {
            if (behavior === 'swap' && targetWindowCount > 0) {
                const sourceMatrix = layout.escalator.getLayoutForCount(layout.getWindowCount(wrapper.monitorId));
                const sourceEstate = sourceMatrix ? sourceMatrix.getEstate(this._activeDrag.originalSlot) : null;
                const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(wrapper.monitorId);
                const sourceMonitorRect = wrapper.workspace.get_work_area_for_monitor(sourceMonitorIndex);

                const windows = layout.getWindowsForMonitor(monitorId);
                for (const win of windows) {
                    const slot = layout.getWindowSlot(monitorId, win);
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
                const windows = layout.getWindowsForMonitor(monitorId);
                for (const win of windows) {
                    const slot = layout.getWindowSlot(monitorId, win);
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
            const lastMonitorIndex = this.controller.monitorManager.getMonitorIndex(lastMonId);
            if (lastMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const lastMonitorRect = workspace.get_work_area_for_monitor(lastMonitorIndex);
                this._restoreTrackerGeometries(lastMonId, layout, lastMonitorRect, gaps);
            }
        }
        
        if (sourceMonId) {
            const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(sourceMonId);
            if (sourceMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const sourceMonitorRect = workspace.get_work_area_for_monitor(sourceMonitorIndex);
                this._restoreTrackerGeometries(sourceMonId, layout, sourceMonitorRect, gaps);
            }
        }

        if (clearState) {
            this._activeDrag.lastHoveredSlot = -1;
            this._activeDrag.lastHoveredMonitorId = null;
        }
    }

    _restoreTrackerGeometries(monitorId, layout, monitorRect, gaps) {
        const matrix = layout.escalator.getLayoutForCount(layout.getWindowCount(monitorId));
        if (!matrix) return;
        const draggedWindow = this._activeDrag ? this._activeDrag.window : null;
        const windows = layout.getWindowsForMonitor(monitorId);
        for (const win of windows) {
            if (win === draggedWindow) continue;
            const slot = layout.getWindowSlot(monitorId, win);
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

    _restoreWindowGeometry(monitorId, layout, matrix, slotToFind, targetEstateSlot, monitorRect, gaps) {
        const win = layout.getWindowsForMonitor(monitorId).find(w => layout.getWindowSlot(monitorId, w) === slotToFind);
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
            this._commitCrossMonitorTransfer(window, wrapper, layout, lastHoveredMonitorId, lastHoveredSlot, activeDrag.originalSlot);
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
                // Pointer fallback cross-monitor drop
                this._commitCrossMonitorTransfer(window, wrapper, layout, pointerMonitorId, -1, activeDrag.originalSlot, pointerMonitorIndex);
            } else {
                this._commitSameMonitorDrop(window, wrapper, layout, x, y, monitorRect, gaps, origRect);
            }
        }
    }

    _commitCrossMonitorTransfer(window, wrapper, layout, targetMonitorId, targetSlot, sourceSlot, targetMonitorIndexOverride = -1) {
        const sourceMonitorId = wrapper.monitorId;
        const sourceMonitorIndex = wrapper.monitorIndex;
        const workspace = wrapper.workspace;
        let targetMonitorIndex = targetMonitorIndexOverride !== -1 ? targetMonitorIndexOverride : this.controller.monitorManager.getMonitorIndex(targetMonitorId);
        
        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';
        const targetWindows = layout.getWindowsForMonitor(targetMonitorId);
        const targetWindow = targetWindows.find(w => layout.getWindowSlot(targetMonitorId, w) === targetSlot);

        if (behavior === 'swap' && targetWindow) {
            layout.replaceWindow(targetWindow, window, targetMonitorId);
            layout.replaceWindow(window, targetWindow, sourceMonitorId);

            this.controller.updateWindowWrapperMonitor(window, targetMonitorId, targetMonitorIndex);
            this.controller.updateWindowWrapperMonitor(targetWindow, sourceMonitorId, sourceMonitorIndex);

            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (targetMonitorIndex !== -1 && window.move_to_monitor) window.move_to_monitor(targetMonitorIndex);
                if (sourceMonitorIndex !== -1 && targetWindow.move_to_monitor) targetWindow.move_to_monitor(sourceMonitorIndex);
                return GLib.SOURCE_REMOVE;
            });

        } else {
            layout.untrackWindow(window, sourceMonitorId);
            layout.trackWindow(window, targetMonitorId, targetSlot !== -1 ? targetSlot : undefined);
            
            this.controller.updateWindowWrapperMonitor(window, targetMonitorId, targetMonitorIndex);
            
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (targetMonitorIndex !== -1 && window.move_to_monitor) window.move_to_monitor(targetMonitorIndex);
                return GLib.SOURCE_REMOVE;
            });
        }

        this.controller._scheduleRetile(workspace, sourceMonitorId, sourceMonitorIndex);
        this.controller._scheduleRetile(workspace, targetMonitorId, targetMonitorIndex);
    }

    _commitSameMonitorDrop(window, wrapper, layout, x, y, monitorRect, gaps, origRect) {
        const swapped = layout.swapWindowByPointer(wrapper.monitorId, window, x, y, monitorRect, gaps);
        
        const currRect = window.get_frame_rect ? window.get_frame_rect() : { x: 0, y: 0, width: 0, height: 0 };
        const rectChanged = currRect.x !== origRect.x || currRect.y !== origRect.y || currRect.width !== origRect.width || currRect.height !== origRect.height;

        if (swapped || rectChanged) {
            this.controller._scheduleRetile(wrapper.workspace, wrapper.monitorId, wrapper.monitorIndex);
        }
    }
}
