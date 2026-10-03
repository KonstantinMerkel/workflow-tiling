import { StateTracker } from './state.js';
import { Logger } from './utils/logger.js';
import { MonitorRef } from './monitor.js';
import { findTargetSlotInDirection, findClosestBoundaryWindow } from './utils/geometry.js';

/**
 * WorkspaceLayout: Manages internal state for a specific Meta.Workspace.
 */
export class WorkspaceLayout {
    constructor(workspace, controller) {
        this.workspace = workspace;
        this.controller = controller;
        this.escalator = controller.escalator;
        this.monitors = new Map();
    }

    /**
     * Registers window and returns logical state.
     */
    trackWindow(wrapper, preferredSlot) {
        if (!wrapper) return;
        const monitorId = wrapper.monitorId;
        const tracker = this._getTracker(monitorId);
        if (tracker.getSlot(wrapper) === undefined) {
            tracker.startTracking(wrapper, preferredSlot);
        }
    }

    /**
     * Unregisters a window.
     */
    untrackWindow(wrapper) {
        if (!wrapper) return;
        const monitorId = wrapper.monitorId;
        const tracker = this._getTracker(monitorId);
        tracker.stopTracking(wrapper);
    }

    /**
     * Replaces an existing window with a new window in the exact same slot.
     */
    replaceWindow(oldWrapper, newWrapper) {
        if (!oldWrapper) return;
        const tracker = this._getTracker(oldWrapper.monitorId);
        tracker.replace(oldWrapper, newWrapper);
    }

    /**
     * Tracker proxy methods
     */
    getWindowSlot(wrapper) {
        if (!wrapper) return undefined;
        return this._getTracker(wrapper.monitorId).getSlot(wrapper);
    }

    getWindowsForMonitor(monitorId) {
        return this._getTracker(monitorId).wrappers;
    }

    getWindowCount(monitorId) {
        return this._getTracker(monitorId).size;
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

        return tracker.wrappers.map((wrapper, index) => {
            const estate = layout.getEstate(index);
            if (!estate) return null;
            return {
                window: wrapper.window || wrapper,
                rect: estate.toAbsolute(monitorRect, gaps)
            };
        }).filter(op => op !== null);
    }

    _findClosestBoundaryWindow(targetTracker, direction, sourceRect) {
        if (!targetTracker || targetTracker.size === 0) return null;
        let candidates = [];
        for (const wrapper of targetTracker.wrappers) {
            const win = wrapper.window || wrapper;
            if (!win) continue;
            const targetRect = win.get_frame_rect ? win.get_frame_rect() : { x: 0, y: 0, width: 100, height: 100 };
            candidates.push({ win: win, rect: targetRect });
        }

        return findClosestBoundaryWindow(candidates, direction, sourceRect);
    }


    _getTargetWindowInDirection(monitorId, wrapper, direction) {
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(wrapper);
        if (slot === undefined) return null;
        
        const windowCount = tracker.size;
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return null;

        const estate = layout.getEstate(slot);
        if (!estate) return null;

        const targetSlot = findTargetSlotInDirection(layout, slot, estate, direction);
        if (targetSlot !== -1) {
            const targetWrapper = tracker.wrappers.find(w => tracker.getSlot(w) === targetSlot);
            return targetWrapper ? (targetWrapper.window || targetWrapper) : null;
        }

        const win = wrapper.window || wrapper;
        let currentMonitorIndex = win.get_monitor ? win.get_monitor() : -1;
        if (currentMonitorIndex === -1 && this.controller && this.controller.monitorManager) {
            currentMonitorIndex = this.controller.monitorManager.getMonitorIndex(monitorId);
        }
        
        Logger.debug(`_getTargetWindowInDirection: targetSlot=-1, currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);

        if (currentMonitorIndex === -1) return null;

        if (this.controller && this.controller.monitorManager) {
            Logger.debug(`calling getMonitorInDirection with currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);
            const adjacentMonitorIndex = this.controller.monitorManager.getMonitorInDirection(currentMonitorIndex, direction);
            Logger.debug(`getMonitorInDirection returned ${adjacentMonitorIndex}`);
            Logger.debug(`_getTargetWindowInDirection: adjacentMonitorIndex=${adjacentMonitorIndex}`);
            if (adjacentMonitorIndex !== -1) {
                const targetMonitorId = this.controller.monitorManager.getMonitorId(adjacentMonitorIndex);
                const targetTracker = this._getTracker(targetMonitorId);
                const sourceRect = win.get_frame_rect ? win.get_frame_rect() : { x: 0, y: 0, width: 100, height: 100 };
                return this._findClosestBoundaryWindow(targetTracker, direction, sourceRect);
            }
        }
        return null;
    }

    /**
     * Handles the transition of a window moving between monitors.
     * Depending on configuration, it either swaps the window with another window
     * at the entering edge of the target monitor, or scales/escalates the layouts.
     */
    handleMonitorTransition(wrapper, sourceMonitorId, targetMonitorId, enteringEdge, sourceSlot) {
        if (!this.controller) return null;
        const sourceTracker = this._getTracker(sourceMonitorId);
        const targetTracker = this._getTracker(targetMonitorId);

        const behavior = this.controller.settings ? this.controller.settings.getMonitorTransitionBehavior() : 'escalate';

        if (behavior !== 'swap' && targetTracker.size >= this.escalator.getMaxCount()) {
            return { aborted: true };
        }

        if (behavior === 'swap' && targetTracker.size > 0) {
            const targetLayout = this.escalator.getLayoutForCount(targetTracker.size);
            if (targetLayout) {
                const targetEdgingSlot = targetLayout.getEdgingSlot(enteringEdge);
                if (targetEdgingSlot !== -1) {
                    const targetWrapper = targetTracker.wrappers.find(w => targetTracker.getSlot(w) === targetEdgingSlot);
                    if (targetWrapper) {
                        sourceTracker.stopTracking(wrapper);
                        targetTracker.stopTracking(targetWrapper);

                        wrapper.monitorId = targetMonitorId;
                        targetWrapper.monitorId = sourceMonitorId;

                        targetTracker.startTracking(wrapper, targetEdgingSlot);
                        sourceTracker.startTracking(targetWrapper, sourceSlot);

                        return { swappedWrapper: targetWrapper, behavior: 'swap' };
                    }
                }
            }
        }

        sourceTracker.stopTracking(wrapper);
        wrapper.monitorId = targetMonitorId;

        const targetLayout = this.escalator.getLayoutForCount(targetTracker.size + 1);
        let preferredSlot = targetTracker.size;
        if (targetLayout) {
            const edgingSlot = targetLayout.getEdgingSlot(enteringEdge);
            if (edgingSlot !== -1) {
                preferredSlot = edgingSlot;
            }
        }

        this.trackWindow(wrapper, preferredSlot);
        return { swappedWrapper: null, behavior: 'escalate' };
    }

    /**
     * Finds the nearest window in the specified geometric direction and swaps slots.
     * Computes orthogonal overlap and distance to determine the best candidate.
     */
    moveWindowDirection(wrapper, direction) {
        if (!wrapper) return false;
        const monitorId = wrapper.monitorId;
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(wrapper);
        if (slot === undefined) return false;
        
        const windowCount = tracker.size;
        const layout = this.escalator.getLayoutForCount(windowCount);
        if (!layout) return false;

        const estate = layout.getEstate(slot);
        if (!estate) return false;

        const targetSlot = findTargetSlotInDirection(layout, slot, estate, direction);
        if (targetSlot !== -1) {
            const targetWrapper = tracker.wrappers.find(w => tracker.getSlot(w) === targetSlot);
            if (targetWrapper) {
                tracker.swapWindows(wrapper, targetWrapper);
                return true;
            }
        }

        const win = wrapper.window || wrapper;
        let currentMonitorIndex = win.get_monitor ? win.get_monitor() : -1;
        if (currentMonitorIndex === -1 && this.controller && this.controller.monitorManager) {
            currentMonitorIndex = this.controller.monitorManager.getMonitorIndex(monitorId);
        }

        if (currentMonitorIndex === -1) return false;

        if (this.controller && this.controller.monitorManager) {
            Logger.debug(`calling getMonitorInDirection with currentMonitorIndex=${currentMonitorIndex}, direction=${direction}`);
            const adjacentMonitorIndex = this.controller.monitorManager.getMonitorInDirection(currentMonitorIndex, direction);
            Logger.debug(`getMonitorInDirection returned ${adjacentMonitorIndex}`);
            if (adjacentMonitorIndex !== -1) {
                const targetMonitorId = this.controller.monitorManager.getMonitorId(adjacentMonitorIndex);
                const targetMonitor = new MonitorRef(targetMonitorId, adjacentMonitorIndex);
                const sourceMonitor = new MonitorRef(monitorId, currentMonitorIndex);
                const enteringEdgeMap = {
                    'left': 'right',
                    'right': 'left',
                    'up': 'bottom',
                    'down': 'top'
                };
                const enteringEdge = enteringEdgeMap[direction];

                const result = this.handleMonitorTransition(wrapper, monitorId, targetMonitorId, enteringEdge, slot);
                
                if (result && result.aborted) {
                    return false;
                }

                // Update wrappers and physical monitors
                const moveWin = wrapper.window || wrapper;
                wrapper.updateMonitor(targetMonitor);
                if (wrapper.beginMonitorTransit) wrapper.beginMonitorTransit();
                if (moveWin.move_to_monitor) moveWin.move_to_monitor(adjacentMonitorIndex);
                
                if (result && result.swappedWrapper) {
                    const swappedWin = result.swappedWrapper.window || result.swappedWrapper;
                    result.swappedWrapper.updateMonitor(sourceMonitor);
                    if (result.swappedWrapper.beginMonitorTransit) result.swappedWrapper.beginMonitorTransit();
                    if (swappedWin.move_to_monitor) swappedWin.move_to_monitor(currentMonitorIndex);
                }

                if (this.controller && this.controller._scheduleRetile) {
                    this.controller._scheduleRetile(this.workspace, sourceMonitor);
                    this.controller._scheduleRetile(this.workspace, targetMonitor);
                }
                return true;
            }
        }
        return false;
    }


    /**
     * Finds the nearest window in the specified geometric direction and activates it.
     */
    focusWindowDirection(wrapper, direction) {
        if (!wrapper) return false;
        const targetWindow = this._getTargetWindowInDirection(wrapper.monitorId, wrapper, direction);
        if (targetWindow) {
            targetWindow.activate(global.get_current_time());
            return true;
        }
        return false;
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
    swapWindowByPointer(wrapper, pointerX, pointerY, monitorRect, gaps) {
        if (!wrapper) return false;
        const monitorId = wrapper.monitorId;
        const tracker = this._getTracker(monitorId);
        const slot = tracker.getSlot(wrapper);
        if (slot === undefined) return false;

        const targetSlot = this.getSlotAtPointer(monitorId, pointerX, pointerY, monitorRect, gaps);

        const maxCount = this.escalator.getMaxCount();
        if (slot >= maxCount) return false;

        if (targetSlot !== -1 && targetSlot !== slot) {
            const targetWrapper = tracker.wrappers.find(w => tracker.getSlot(w) === targetSlot);
            if (targetWrapper) {
                tracker.swapWindows(wrapper, targetWrapper);
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

    pruneLayouts() {
        const activeWorkspaces = new Set();
        const numWorkspaces = global.workspace_manager.n_workspaces;
        for (let i = 0; i < numWorkspaces; i++) {
            const ws = global.workspace_manager.get_workspace_by_index(i);
            if (ws) activeWorkspaces.add(ws);
        }
        
        for (const [workspace, layout] of this.layouts.entries()) {
            if (!activeWorkspaces.has(workspace)) {
                this.layouts.delete(workspace);
                Logger.info('WorkspaceManager: Pruned dead workspace from layouts map');
            }
        }
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

        const targetMonitorIndex = (activeMonitorIndex + 1) % numMonitors;

        const activeMonitor = this.controller.monitorManager ? this.controller.monitorManager.createRef(activeMonitorIndex) : new MonitorRef(`monitor-${activeMonitorIndex}`, activeMonitorIndex);
        const targetMonitor = this.controller.monitorManager ? this.controller.monitorManager.createRef(targetMonitorIndex) : new MonitorRef(`monitor-${targetMonitorIndex}`, targetMonitorIndex);

        const layout = this.getLayout(workspace);

        // Swap layout trackers
        const trackerA = layout._getTracker(activeMonitor.id);
        const trackerB = layout._getTracker(targetMonitor.id);
        trackerA.swapWith(trackerB);

        // Update window wrapper cache and set transit flag
        const windows = workspace.list_windows();
        windows.forEach(w => {
            let wrapper = this.controller._windowWrappers.get(w);
            if (wrapper) {
                const m = w.get_monitor();
                if (m === activeMonitorIndex) {
                    wrapper.updateMonitor(targetMonitor);
                } else if (m === targetMonitorIndex) {
                    wrapper.updateMonitor(activeMonitor);
                }
                wrapper.beginMonitorTransit();
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
        if (this.controller && this.controller._scheduleRetile) {
            this.controller._scheduleRetile(workspace, activeMonitor);
            this.controller._scheduleRetile(workspace, targetMonitor);
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
