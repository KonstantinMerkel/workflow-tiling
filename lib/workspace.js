import { StateTracker } from './state.js';
import { Logger } from './logger.js';

/**
 * WorkspaceLayout: Manages internal state for a specific Meta.Workspace.
 */
export class WorkspaceLayout {
    constructor(workspace, controller) {
        this.workspace = workspace;
        this.controller = controller;
        this.escalator = (controller && controller.escalator) ? controller.escalator : controller;
        this.monitors = new Map();
    }

    /**
     * Registers window and returns logical state.
     */
    trackWindow(window, monitorId, preferredSlot) {
        const tracker = this._getTracker(monitorId);
        if (tracker.getSlot(window) === undefined) {
            if (preferredSlot !== undefined) {
                tracker.windows.forEach(w => {
                    const s = tracker.getSlot(w);
                    if (s >= preferredSlot) {
                        tracker.track(w, s + 1);
                    }
                });
                tracker.track(window, preferredSlot);
            } else {
                tracker.track(window, tracker.size);
            }
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
            if (!estate) return null;
            return {
                window: win,
                rect: estate.toAbsolute(monitorRect, gaps)
            };
        }).filter(op => op !== null);
    }

    _findClosestBoundaryWindow(targetTracker, direction, sourceRect) {
        if (!targetTracker || targetTracker.size === 0) return null;
        let candidates = [];
        for (const win of targetTracker.windows) {
            if (!win) continue;
            const targetRect = win.get_frame_rect ? win.get_frame_rect() : { x: 0, y: 0, width: 100, height: 100 };
            candidates.push({ win, rect: targetRect });
        }

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            if (direction === 'left') {
                if (a.rect.x !== b.rect.x) {
                    return b.rect.x - a.rect.x;
                }
                return a.rect.y - b.rect.y;
            } else if (direction === 'right') {
                if (a.rect.x !== b.rect.x) {
                    return a.rect.x - b.rect.x;
                }
                return a.rect.y - b.rect.y;
            } else if (direction === 'up') {
                if (a.rect.y !== b.rect.y) {
                    return b.rect.y - a.rect.y;
                }
                return b.rect.x - a.rect.x;
            } else if (direction === 'down') {
                if (a.rect.y !== b.rect.y) {
                    return a.rect.y - b.rect.y;
                }
                return b.rect.x - a.rect.x;
            }
            return 0;
        });

        return candidates[0].win;
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
        if (targetSlot !== -1) {
            return tracker.windows.find(w => tracker.getSlot(w) === targetSlot) || null;
        }

        let currentMonitorIndex = window.get_monitor ? window.get_monitor() : -1;
        Logger.info(`[DEBUG] _getTargetWindowInDirection: targetSlot=-1, currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);
        if (currentMonitorIndex === -1 && this.controller && this.controller.monitorManager) {
            currentMonitorIndex = this.controller.monitorManager.getMonitorIndex(monitorId);
        }
        
        Logger.info(`[DEBUG] _getTargetWindowInDirection: targetSlot=-1, currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);

        if (currentMonitorIndex === -1) return null;

        if (this.controller && this.controller.monitorManager) {
            Logger.info(`[DEBUG] calling getMonitorInDirection with currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);
            const adjacentMonitorIndex = this.controller.monitorManager.getMonitorInDirection(currentMonitorIndex, direction);
            Logger.info(`[DEBUG] getMonitorInDirection returned ${adjacentMonitorIndex}`);
            Logger.info(`[DEBUG] _getTargetWindowInDirection: adjacentMonitorIndex=${adjacentMonitorIndex}`);
            if (adjacentMonitorIndex !== -1) {
                const targetMonitorId = this.controller.monitorManager.getMonitorId(adjacentMonitorIndex);
                const targetTracker = this._getTracker(targetMonitorId);
                const sourceRect = window.get_frame_rect ? window.get_frame_rect() : { x: 0, y: 0, width: 100, height: 100 };
                return this._findClosestBoundaryWindow(targetTracker, direction, sourceRect);
            }
        }
        return null;
    }

    /**
     * Finds the nearest window in the specified geometric direction and swaps slots.
     * Computes orthogonal overlap and distance to determine the best candidate.
     */
    handleMonitorTransition(window, sourceMonitorId, targetMonitorId, enteringEdge, sourceSlot) {
        const sourceTracker = this._getTracker(sourceMonitorId);
        const targetTracker = this._getTracker(targetMonitorId);

        const sourceMonitorIndex = this.controller.monitorManager.getMonitorIndex(sourceMonitorId);
        const targetMonitorIndex = this.controller.monitorManager.getMonitorIndex(targetMonitorId);

        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';

        if (behavior === 'swap' && targetTracker.size > 0) {
            const targetLayout = this.escalator.getLayoutForCount(targetTracker.size);
            if (targetLayout) {
                const targetEdgingSlot = targetLayout.getEdgingSlot(enteringEdge);
                if (targetEdgingSlot !== -1) {
                    const targetWindow = targetTracker.windows.find(w => targetTracker.getSlot(w) === targetEdgingSlot);
                    if (targetWindow) {
                        sourceTracker.untrack(window);
                        targetTracker.untrack(targetWindow);

                        targetTracker.track(window, targetEdgingSlot);
                        sourceTracker.track(targetWindow, sourceSlot);

                        const wrapper = this.controller._windowWrappers.get(window);
                        if (wrapper) {
                            wrapper.monitorId = targetMonitorId;
                            wrapper.monitorIndex = targetMonitorIndex;
                        }
                        const targetWrapper = this.controller._windowWrappers.get(targetWindow);
                        if (targetWrapper) {
                            targetWrapper.monitorId = sourceMonitorId;
                            targetWrapper.monitorIndex = sourceMonitorIndex;
                        }

                        if (window.move_to_monitor) {
                            window.move_to_monitor(targetMonitorIndex);
                        }
                        if (targetWindow.move_to_monitor) {
                            targetWindow.move_to_monitor(sourceMonitorIndex);
                        }
                        return;
                    }
                }
            }
        }

        sourceTracker.untrack(window);

        const targetLayout = this.escalator.getLayoutForCount(targetTracker.size + 1);
        let preferredSlot = targetTracker.size;
        if (targetLayout) {
            const edgingSlot = targetLayout.getEdgingSlot(enteringEdge);
            if (edgingSlot !== -1) {
                preferredSlot = edgingSlot;
            }
        }

        this.trackWindow(window, targetMonitorId, preferredSlot);

        const wrapper = this.controller._windowWrappers.get(window);
        if (wrapper) {
            wrapper.monitorId = targetMonitorId;
            wrapper.monitorIndex = targetMonitorIndex;
        }

        if (window.move_to_monitor) {
            window.move_to_monitor(targetMonitorIndex);
        }
    }

    /**
     * Finds the nearest window in the specified geometric direction and swaps slots.
     * Computes orthogonal overlap and distance to determine the best candidate.
     */
    moveWindowDirection(monitorId, window, direction) {
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(window);
        if (slot === undefined) return false;
        
        const windowCount = tracker.size;
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return false;

        const estate = layout.getEstate(slot);
        if (!estate) return false;

        const targetSlot = this._findTargetSlotInDirection(layout, slot, estate, direction);
        if (targetSlot !== -1) {
            const targetWindow = tracker.windows.find(w => tracker.getSlot(w) === targetSlot);
            if (targetWindow) {
                tracker.swapWindows(window, targetWindow);
                return true;
            }
        }

        let currentMonitorIndex = window.get_monitor ? window.get_monitor() : -1;
        Logger.info(`[DEBUG] _getTargetWindowInDirection: targetSlot=-1, currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);
        if (currentMonitorIndex === -1 && this.controller && this.controller.monitorManager) {
            currentMonitorIndex = this.controller.monitorManager.getMonitorIndex(monitorId);
        }
        
        Logger.info(`[DEBUG] moveWindowDirection: targetSlot=-1, currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);

        if (currentMonitorIndex === -1) return false;

        if (this.controller && this.controller.monitorManager) {
            Logger.info(`[DEBUG] calling getMonitorInDirection with currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);
            const adjacentMonitorIndex = this.controller.monitorManager.getMonitorInDirection(currentMonitorIndex, direction);
            Logger.info(`[DEBUG] getMonitorInDirection returned ${adjacentMonitorIndex}`);
            Logger.info(`[DEBUG] moveWindowDirection: adjacentMonitorIndex=${adjacentMonitorIndex}`);
            if (adjacentMonitorIndex !== -1) {
                const targetMonitorId = this.controller.monitorManager.getMonitorId(adjacentMonitorIndex);
                const enteringEdgeMap = {
                    'left': 'right',
                    'right': 'left',
                    'up': 'bottom',
                    'down': 'top'
                };
                const enteringEdge = enteringEdgeMap[direction];

                this.handleMonitorTransition(window, monitorId, targetMonitorId, enteringEdge, slot);

                if (this.controller._scheduleRetile) {
                    this.controller._scheduleRetile(this.workspace, monitorId, currentMonitorIndex);
                    this.controller._scheduleRetile(this.workspace, targetMonitorId, adjacentMonitorIndex);
                }
                return true;
            }
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
    getSlotAtPointer(monitorId, pointerX, pointerY, monitorRect, gaps, customCount = null) {
        const tracker = this._getTracker(monitorId);
        const windowCount = customCount !== null ? customCount : tracker.size;
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

/**
 * WorkspaceManager: Interworkspace Operations
 */
export class WorkspaceManager {
    constructor(controller) {
        this.controller = controller;
        this.layouts = new Map();
    }

    getLayout(workspace) {
        if (!this.layouts.has(workspace)) {
            this.layouts.set(workspace, new WorkspaceLayout(workspace, this.controller));
        }
        return this.layouts.get(workspace);
    }

    clearLayouts() {
        this.layouts.clear();
    }

    closeWorkspaceWindows(workspace) {
        if (!workspace) return;
        this.controller.setBatchMode(true);
        const windows = workspace.list_windows();
        windows.forEach(w => w.delete(global.get_current_time()));
        this.controller.setBatchMode(false);
        this.controller.hydrate(workspace);
    }

    unminimizeWorkspace(workspace) {
        if (!workspace) return;
        this.controller.setBatchMode(true);
        const windows = workspace.list_windows();
        windows.forEach(w => {
            if (w.minimized) w.unminimize();
        });
        this.controller.setBatchMode(false);
        this.controller.hydrate(workspace);
        
        if (windows.length > 0) {
            windows[0].activate(global.get_current_time());
        }
    }

    closeMonitorWindows(monitorIndex, includeMinimized) {
        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace) return;
        this.controller.setBatchMode(true);
        const windows = workspace.list_windows();
        windows.forEach(w => {
            if (w.get_monitor() === monitorIndex && (!w.minimized || includeMinimized)) {
                w.delete(global.get_current_time());
            }
        });
        this.controller.setBatchMode(false);
        this.controller.hydrate(workspace);
    }

    switchMonitors(activeMonitorIndex) {
        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace) return;
        
        const manager = global.backend.get_monitor_manager();
        const numMonitors = manager.get_logical_monitors().length;
        if (numMonitors < 2) return;

        let targetMonitorIndex;
        if (numMonitors === 2) {
            targetMonitorIndex = activeMonitorIndex === 0 ? 1 : 0;
        } else {
            const primaryIndex = global.display.get_primary_monitor();
            if (activeMonitorIndex === primaryIndex) return;
            targetMonitorIndex = primaryIndex;
        }

        const activeMonitorId = this.controller.monitorManager ? this.controller.monitorManager.getMonitorId(activeMonitorIndex) : `monitor-${activeMonitorIndex}`;
        const targetMonitorId = this.controller.monitorManager ? this.controller.monitorManager.getMonitorId(targetMonitorIndex) : `monitor-${targetMonitorIndex}`;

        const layout = this.getLayout(workspace);

        // Swap layout trackers
        const trackerA = layout._getTracker(activeMonitorId);
        const trackerB = layout._getTracker(targetMonitorId);
        const tempWindowToSlot = trackerA._windowToSlot;
        const tempOriginalGeometries = trackerA._originalGeometries;
        trackerA._windowToSlot = trackerB._windowToSlot;
        trackerA._originalGeometries = trackerB._originalGeometries;
        trackerB._windowToSlot = tempWindowToSlot;
        trackerB._originalGeometries = tempOriginalGeometries;

        // Update window wrapper cache
        const windows = workspace.list_windows();
        windows.forEach(w => {
            const m = w.get_monitor();
            const wrapper = this.controller._windowWrappers.get(w);
            if (wrapper) {
                if (m === activeMonitorIndex) {
                    wrapper.monitorId = targetMonitorId;
                    wrapper.monitorIndex = targetMonitorIndex;
                } else if (m === targetMonitorIndex) {
                    wrapper.monitorId = activeMonitorId;
                    wrapper.monitorIndex = activeMonitorIndex;
                }
            }
        });

        // Move windows
        this.controller.setBatchMode(true);
        windows.forEach(w => {
            const m = w.get_monitor();
            if (m === activeMonitorIndex) {
                w.move_to_monitor(targetMonitorIndex);
            } else if (m === targetMonitorIndex) {
                w.move_to_monitor(activeMonitorIndex);
            }
        });
        this.controller.setBatchMode(false);

        // Schedule retile rather than hydrate
        if (this.controller._scheduleRetile) {
            this.controller._scheduleRetile(workspace, activeMonitorId, activeMonitorIndex);
            this.controller._scheduleRetile(workspace, targetMonitorId, targetMonitorIndex);
        } else {
            this.controller.hydrate(workspace);
        }
    }

    portMonitorToWorkspace(monitorIndex, direction) {
        const activeWorkspaceIndex = global.workspace_manager.get_active_workspace_index();
        const numWorkspaces = global.workspace_manager.n_workspaces;
        let targetIndex = activeWorkspaceIndex;

        if (direction === 'left' && activeWorkspaceIndex > 0) {
            targetIndex--;
        } else if (direction === 'right' && activeWorkspaceIndex < numWorkspaces - 1) {
            targetIndex++;
        }

        if (targetIndex === activeWorkspaceIndex) return;

        const targetWorkspace = global.workspace_manager.get_workspace_by_index(targetIndex);
        const activeWorkspace = global.workspace_manager.get_active_workspace();

        this.controller.setBatchMode(true);
        const windows = activeWorkspace.list_windows();
        windows.forEach(w => {
            if (w.get_monitor() === monitorIndex) {
                w.change_workspace(targetWorkspace);
            }
        });
        this.controller.setBatchMode(false);
        
        this.controller.hydrate(activeWorkspace);
        this.controller.hydrate(targetWorkspace);
    }
}
