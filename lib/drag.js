import St from 'gi://St';
import GLib from 'gi://GLib';
import { Logger } from './utils/logger.js';
import { MonitorRef } from './monitor.js';

/**
 * DragManager: Manages pointer drag tracking and visual drop indicators.
 */
export class DragManager {
    constructor(controller) {
        this.controller = controller;
        this._activeDrag = null; // { window, originalSlot, indicator, signalId, lastHoveredSlot, lastHoveredMonitorId, origRect }
        this._pendingIdles = new Set();
    }

    /**
     * Unconditional teardown — disconnects signal, destroys indicator, clears
     * deferred retiles. Safe to call on finalized GObjects.
     */
    forceCleanup() {
        if (this._pendingIdles) {
            this._pendingIdles.forEach(id => GLib.source_remove(id));
            this._pendingIdles.clear();
        }
        if (!this._activeDrag) return;
        try {
            this._activeDrag.window.disconnect(this._activeDrag.signalId);
        } catch (e) {
            Logger.warn('DragManager: Failed to disconnect drag signal during cleanup', e);
        }
        if (this._activeDrag.indicator) {
            this._activeDrag.indicator.destroy();
        }
        this._activeDrag = null;
        this._deferredRetiles = [];
    }

    isWindowInDragPreview(window) {
        if (!this._activeDrag) return false;
        if (this._activeDrag.window === window) return true;

        const wrapper = this.controller.getWrapper(window);
        if (!wrapper) return false;

        const draggedWrapper = this.controller.getWrapper(this._activeDrag.window);
        const sourceMonitorId = draggedWrapper ? draggedWrapper.monitorId : null;
        
        if (wrapper.monitorId === sourceMonitorId) return true;
        if (this._activeDrag.lastHoveredMonitorId && wrapper.monitorId === this._activeDrag.lastHoveredMonitorId) return true;

        return false;
    }

    /** @returns {boolean} */
    isDragActive() {
        return this._activeDrag !== null;
    }

    /** @returns {boolean} */
    isDraggingWindow(window) {
        return this._activeDrag !== null && this._activeDrag.window === window;
    }

    /** Defers a retile until the drag ends */
    deferRetile(workspace, monitor) {
        this._deferredRetiles = this._deferredRetiles || [];
        const exists = this._deferredRetiles.some(r => r.workspace === workspace && r.monitor.id === monitor.id);
        if (!exists) {
            this._deferredRetiles.push({workspace, monitor});
        }
    }

    startDragTracking(window) {
        if (this._activeDrag) this.endDragTracking(this._activeDrag.window);
        const wrapper = this.controller.getWrapper(window);
        if (!wrapper || !wrapper.workspace || !wrapper.monitorId) return;

        const workspace = wrapper.workspace;
        const layout = this.controller.workspaceManager.getLayout(workspace);
        let originalSlot = layout.getWindowSlot(wrapper);
        if (originalSlot === undefined) {
            originalSlot = -1;
        }

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
        const numM1 = global.display.get_n_monitors();
        const safe1 = (monitorIndex >= 0 && monitorIndex < numM1) ? monitorIndex : 0;
        const monitorRect = workspace.get_work_area_for_monitor(safe1);

        let hoveredSlot;
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
            const isTracked = originalSlot !== -1;
            const matrixCount = (monitorId === wrapper.monitorId && isTracked || behavior === 'swap') ? targetWindowCount : (targetWindowCount + 1);
            
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
        const wrapper = this.controller.getWrapper(this._activeDrag.window);
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
        if (sourceMonitorIndex === -1) return;
        const numM2 = global.display.get_n_monitors();
        const safe2 = (sourceMonitorIndex >= 0 && sourceMonitorIndex < numM2) ? sourceMonitorIndex : 0;
        const sourceMonitorRect = wrapper.workspace.get_work_area_for_monitor(safe2);
        
        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';

        if (behavior === 'escalate') {
            const sourceCount = layout.getWindowCount(wrapper.monitorId);
            const sourceMatrix = layout.escalator.getLayoutForCount(sourceCount > 0 ? sourceCount - 1 : 0);
            if (sourceMatrix) {
                const origSlot = this._activeDrag.originalSlot;
                const windows = layout.getWindowsForMonitor(wrapper.monitorId);
                for (const win of windows) {
                    if (win === this._activeDrag.window) continue;
                    const slot = layout.getWindowSlot(win);
                    if (slot !== undefined) {
                        const targetSlot = (slot > origSlot) ? (slot - 1) : slot;
                        const wrap = this.controller.getWrapper(win);
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
                const sourceMonitorRect = sourceMonitorIndex !== -1 ? wrapper.workspace.get_work_area_for_monitor(sourceMonitorIndex) : { x: 0, y: 0, width: 0, height: 0 };

                const windows = layout.getWindowsForMonitor(monitorId);
                for (const win of windows) {
                    const slot = layout.getWindowSlot(win);
                    if (slot !== undefined) {
                        const wrap = this.controller.getWrapper(win);
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
                    const slot = layout.getWindowSlot(win);
                    if (slot !== undefined) {
                        const targetEstateSlot = (slot >= hoveredSlot) ? (slot + 1) : slot;
                        const wrap = this.controller.getWrapper(win);
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
        const wrapper = this.controller.getWrapper(this._activeDrag.window);
        const sourceMonId = wrapper ? wrapper.monitorId : null;

        if (lastMonId && lastMonId !== sourceMonId) {
            const lastMonitorIndex = this.controller.monitorManager.getMonitorIndex(lastMonId);
            if (lastMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const numM3 = global.display.get_n_monitors();
                const safe3 = (lastMonitorIndex >= 0 && lastMonitorIndex < numM3) ? lastMonitorIndex : 0;
                const lastMonitorRect = workspace.get_work_area_for_monitor(safe3);
                this._restoreTrackerGeometries(lastMonId, layout, lastMonitorRect, gaps);
            }
        }
        
        if (sourceMonId) {
            const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(sourceMonId);
            if (sourceMonitorIndex !== -1) {
                const workspace = wrapper ? wrapper.workspace : layout.workspace;
                const numM4 = global.display.get_n_monitors();
                const safe4 = (sourceMonitorIndex >= 0 && sourceMonitorIndex < numM4) ? sourceMonitorIndex : 0;
                const sourceMonitorRect = workspace.get_work_area_for_monitor(safe4);
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
            const slot = layout.getWindowSlot(win);
            if (slot !== undefined) {
                const wrap = this.controller.getWrapper(win);
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
        const win = layout.getWindowsForMonitor(monitorId).find(w => layout.getWindowSlot(w) === slotToFind);
        if (!win) return;
        const wrap = this.controller.getWrapper(win);
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

        const wrapper = this.controller.getWrapper(window);
        if (!wrapper || !wrapper.workspace || !wrapper.monitorId) {
            this.forceCleanup();
            return;
        }

        const workspace = wrapper.workspace;
        if (!workspace.get_work_area_for_monitor) {
            this.forceCleanup();
            return;
        }

        const numM5 = global.display.get_n_monitors();
        const safe5 = (wrapper.monitorIndex >= 0 && wrapper.monitorIndex < numM5) ? wrapper.monitorIndex : 0;
        const monitorRect = workspace.get_work_area_for_monitor(safe5);
        const gaps = this.controller.settings ? this.controller.settings.getGaps() : { inner: 6, outer: 4 };
        const layout = this.controller.workspaceManager.getLayout(workspace);

        // Revert temporary visual swaps before performing final tracking and retile
        this._revertVisualSwap(layout, gaps, false);

        try {
            window.disconnect(activeDrag.signalId);
        } catch {
            // Signal might already be disconnected by window destruction
        }
        if (activeDrag.indicator) {
            activeDrag.indicator.destroy();
        }
        
        this._activeDrag = null;

        if (this._deferredRetiles && this._deferredRetiles.length > 0) {
            this._deferredRetiles.forEach(r => this.controller.scheduleRetile(r.workspace, r.monitor));
            this._deferredRetiles = [];
        }

        if (lastHoveredMonitorId && lastHoveredMonitorId !== wrapper.monitorId) {
            this._commitCrossMonitorTransfer(wrapper, layout, lastHoveredMonitorId, lastHoveredSlot, activeDrag.originalSlot);
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
                this._commitCrossMonitorTransfer(wrapper, layout, pointerMonitorId, -1, activeDrag.originalSlot, pointerMonitorIndex);
            } else {
                const targetSlot = lastHoveredMonitorId === wrapper.monitorId ? lastHoveredSlot : -1;
                this._commitSameMonitorDrop(wrapper, layout, x, y, monitorRect, gaps, origRect, activeDrag.originalSlot, targetSlot);
            }
        }
    }

    _commitCrossMonitorTransfer(wrapper, layout, targetMonitorId, targetSlot, sourceSlot, targetMonitorIndexOverride = -1) {
        const sourceMonitor = new MonitorRef(wrapper.monitorId, wrapper.monitorIndex);
        const workspace = wrapper.workspace;
        let targetMonitorIndex = targetMonitorIndexOverride !== -1 ? targetMonitorIndexOverride : this.controller.monitorManager.getMonitorIndex(targetMonitorId);
        const targetMonitor = new MonitorRef(targetMonitorId, targetMonitorIndex);
        
        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';
        const targetWrappers = layout.getWindowsForMonitor(targetMonitorId);
        const targetWrapper = targetWrappers.find(w => layout.getWindowSlot(w) === targetSlot);

        if (behavior === 'swap' && targetWrapper) {
            layout.replaceWindow(targetWrapper, wrapper);
            layout.replaceWindow(wrapper, targetWrapper);

            const targetWin = targetWrapper.window || targetWrapper;
            wrapper.updateMonitor(targetMonitor);
            targetWrapper.updateMonitor(sourceMonitor);

            let sourceId;
            sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (sourceId !== undefined) this._pendingIdles.delete(sourceId);
                const win = wrapper.window || wrapper;
                if (targetMonitor.index !== -1 && win.move_to_monitor) win.move_to_monitor(targetMonitor.index);
                if (sourceMonitor.index !== -1 && targetWin.move_to_monitor) targetWin.move_to_monitor(sourceMonitor.index);
                return GLib.SOURCE_REMOVE;
            });
            this._pendingIdles.add(sourceId);

        } else {
            layout.untrackWindow(wrapper);
            
            wrapper.updateMonitor(targetMonitor);

            const maxCount = layout.escalator.getMaxCount();
            if (behavior === 'swap' || layout.getWindowCount(targetMonitorId) < maxCount) {
                layout.trackWindow(wrapper, targetSlot !== -1 ? targetSlot : undefined);
            }
            
            let sourceId;
            sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (sourceId !== undefined) this._pendingIdles.delete(sourceId);
                const win = wrapper.window || wrapper;
                if (targetMonitor.index !== -1 && win.move_to_monitor) win.move_to_monitor(targetMonitor.index);
                return GLib.SOURCE_REMOVE;
            });
            this._pendingIdles.add(sourceId);
        }

        this.controller.scheduleRetile(workspace, sourceMonitor);
        this.controller.scheduleRetile(workspace, targetMonitor);
    }

    _commitSameMonitorDrop(wrapper, layout, x, y, monitorRect, gaps, origRect, originalSlot, targetSlot) {
        let swapped = false;
        
        if (originalSlot === -1) {
            if (targetSlot !== -1) {
                const targetWindowCount = layout.getWindowCount(wrapper.monitorId);
                const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';
                
                if (behavior === 'swap' && targetWindowCount > 0) {
                    const targetWrappers = layout.getWindowsForMonitor(wrapper.monitorId);
                    const targetWrapper = targetWrappers.find(w => layout.getWindowSlot(w) === targetSlot);
                    if (targetWrapper) {
                        layout.replaceWindow(targetWrapper, wrapper);
                        swapped = true;
                    }
                } else if (targetWindowCount < layout.escalator.getMaxCount()) {
                    layout.trackWindow(wrapper, targetSlot);
                    swapped = true;
                }
            }
        } else {
            swapped = layout.swapWindowByPointer(wrapper, x, y, monitorRect, gaps);
        }
        
        const win = wrapper.window || wrapper;
        const currRect = win.get_frame_rect ? win.get_frame_rect() : { x: 0, y: 0, width: 0, height: 0 };
        const rectChanged = currRect.x !== origRect.x || currRect.y !== origRect.y || currRect.width !== origRect.width || currRect.height !== origRect.height;

        if (swapped || rectChanged) {
            this.controller.scheduleRetile(wrapper.workspace, new MonitorRef(wrapper.monitorId, wrapper.monitorIndex));
        }
    }
}
