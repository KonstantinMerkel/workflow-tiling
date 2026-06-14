import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import { Logger } from './logger.js';

/**
 * MonitorManager class. Tracks monitor changes.
 */
export class MonitorManager {
    constructor(controller) {
        this.controller = controller;
        this._lastMonitorCount = 0;
        this._knownMonitorIds = new Set();
        this._evacuatedWindows = new Map();
        this._monitorsChangedPending = false;
        
        this.initializeMonitorState();
    }

    initializeMonitorState() {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            this._lastMonitorCount = logicalMonitors.length;
            this._knownMonitorIds.clear();
            for (let i = 0; i < logicalMonitors.length; i++) {
                this._knownMonitorIds.add(this.getMonitorId(i));
            }
            Logger.info(`Initialized monitor state. Count: ${this._lastMonitorCount}`);
        } catch (e) {
            Logger.error('Failed to initialize monitor state', e);
        }
    }

    getMonitorId(monitorIndex) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            const logicalMonitor = logicalMonitors[monitorIndex];
            if (logicalMonitor) {
                const physicalMonitors = logicalMonitor.get_monitors();
                const monitor = physicalMonitors && physicalMonitors.length > 0 ? physicalMonitors[0] : null;
                if (monitor) {
                    if (monitor.get_stable_id) return monitor.get_stable_id() || monitor.get_connector();
                    if (monitor.get_connector) return monitor.get_connector();
                }
            }
        } catch (e) {
            Logger.warn(`Could not get monitor ID for index ${monitorIndex}`, e);
        }
        return `idx-${monitorIndex}`;
    }

    monitorExists(monitorId) {
        return this.getMonitorIndex(monitorId) >= 0;
    }

    getMonitorIndex(monitorId) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            for (let i = 0; i < logicalMonitors.length; i++) {
                const physicalMonitors = logicalMonitors[i].get_monitors();
                if (physicalMonitors) {
                    for (let m of physicalMonitors) {
                        const id = m.get_stable_id ? (m.get_stable_id() || m.get_connector()) : m.get_connector();
                        if (id === monitorId) return i;
                    }
                }
            }
        } catch (e) {}
        return -1;
    }

    recordEvacuation(window, oldMonitorId, oldWorkspace, slot) {
        this._evacuatedWindows.set(window, { monitorId: oldMonitorId, workspace: oldWorkspace, slot });
    }

    isEvacuated(window) {
        return this._evacuatedWindows.has(window);
    }

    clearEvacuations() {
        this._evacuatedWindows.clear();
    }

    checkEvacuation(window, wrapper, newMonitorId, newWorkspace) {
        const oldMonitorId = wrapper.monitorId;
        const oldWorkspace = wrapper.workspace;
        
        if (oldWorkspace && (oldWorkspace !== newWorkspace || oldMonitorId !== newMonitorId)) {
            // Guard: skip if already evacuated.
            if (oldMonitorId && oldMonitorId !== newMonitorId && !this.monitorExists(oldMonitorId)
                && !this.isEvacuated(window)) {
                Logger.info(`Evacuation detected for "${wrapper.title}" (Monitor ${oldMonitorId} removed)`);
                this.controller.setBatchMode(true); // Choke retiles
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (window && !window.unmanaged && !window.minimized) {
                        window.minimize();
                    }
                    return GLib.SOURCE_REMOVE;
                });

                let slot = undefined;
                try {
                    const oldGrid = this.controller.workspaceManager.getLayout(oldWorkspace);
                    slot = oldGrid._getTracker(oldMonitorId).getSlot(window);
                    oldGrid.untrackWindow(window, oldMonitorId);
                } catch (e) {}

                // Track by window reference with original monitor info and slot.
                this.recordEvacuation(window, oldMonitorId, oldWorkspace, slot);
                
                return true;
            }
        }
        return false;
    }

    handleMonitorsChanged() {
        if (this._monitorsChangedPending) return;
        this._monitorsChangedPending = true;

        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            const currentMonitorCount = logicalMonitors.length;

            Logger.info(`Topology Change. Count: ${this._lastMonitorCount}->${currentMonitorCount}`);

            global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._monitorsChangedPending = false;
                try {
                    this.controller.setBatchMode(false);
                    
                    if (currentMonitorCount < this._lastMonitorCount) {
                        this.controller.clearRestoringWindows(); 
                    } 

                    const currentMonitorIds = new Set();
                    for (let i = 0; i < currentMonitorCount; i++) {
                        currentMonitorIds.add(this.getMonitorId(i));
                    }

                    if (currentMonitorCount > this._lastMonitorCount && this._evacuatedWindows.size > 0) {
                        const newMonitorIds = [...currentMonitorIds].filter(id => !this._knownMonitorIds.has(id));
                        const targetMonitorId = newMonitorIds.length > 0 ? newMonitorIds[0] : this.getMonitorId(currentMonitorCount - 1);
                        const targetIndex = this.getMonitorIndex(targetMonitorId);

                        const restoredCount = this._evacuatedWindows.size;
                        Logger.info(`Restoring ${restoredCount} window(s) to new monitor ${targetMonitorId} (index ${targetIndex})`);

                        for (const [win, info] of this._evacuatedWindows) {
                            if (win && !win.unmanaged) {
                                if (targetIndex >= 0 && win.move_to_monitor) {
                                    win.move_to_monitor(targetIndex);
                                }
                                win.unminimize();
                                this.controller.updateWindowWrapperMonitor(win, targetMonitorId, targetIndex);
                                this.controller.addRestoringWindow(win, info.slot);
                            }
                        }
                        this._evacuatedWindows.clear();
                    }

                    this.controller.hydrate();

                    this._lastMonitorCount = currentMonitorCount;
                    this._knownMonitorIds = new Set(currentMonitorIds);

                } catch (e) {
                    Logger.error('Hydration failed', e);
                    this.controller.setBatchMode(false);
                    this._monitorsChangedPending = false;
                }
                return false;
            });

        } catch (e) {
            Logger.error('Monitor change processing failed', e);
            this.controller.setBatchMode(false);
            this._monitorsChangedPending = false;
        }
    }

    clear() {
        this._evacuatedWindows.clear();
        this._monitorsChangedPending = false;
    }

    closeMonitorWindows(monitorIndex, includeMinimized) {
        const workspace = global.workspace_manager.get_active_workspace();
        if (!workspace) return;
        this.controller.setBatchMode(true);
        const windows = workspace.list_windows();
        windows.forEach(w => {
            const wrapper = this.controller._windowWrappers.get(w);
            const m = wrapper ? wrapper.effectiveMonitorIndex : w.get_monitor();
            if (m === monitorIndex && (!w.minimized || includeMinimized)) {
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

        this.controller.setBatchMode(true);
        const windows = workspace.list_windows();
        windows.forEach(w => {
            const wrapper = this.controller._windowWrappers.get(w);
            const m = wrapper ? wrapper.effectiveMonitorIndex : w.get_monitor();
            if (m === activeMonitorIndex) {
                if (wrapper) wrapper._expectedMonitorIndex = targetMonitorIndex;
                w.move_to_monitor(targetMonitorIndex);
            } else if (m === targetMonitorIndex) {
                if (wrapper) wrapper._expectedMonitorIndex = activeMonitorIndex;
                w.move_to_monitor(activeMonitorIndex);
            }
        });
        this.controller.setBatchMode(false);
        this.controller.hydrate(workspace);
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
            const wrapper = this.controller._windowWrappers.get(w);
            const m = wrapper ? wrapper.effectiveMonitorIndex : w.get_monitor();
            if (m === monitorIndex) {
                if (wrapper) wrapper._expectedWorkspace = targetWorkspace;
                w.change_workspace(targetWorkspace);
            }
        });
        this.controller.setBatchMode(false);
        
        this.controller.hydrate(activeWorkspace);
        this.controller.hydrate(targetWorkspace);
    }

    getMonitorInDirection(currentMonitorIndex, direction) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            const sourceMonitor = logicalMonitors[currentMonitorIndex];
            if (!sourceMonitor) {
                Logger.debug(`getMonitorInDirection: invalid sourceMonitor for index ${currentMonitorIndex}`);
                return -1;
            }

            const sRect = global.display.get_monitor_geometry(currentMonitorIndex);
            Logger.debug(`getMonitorInDirection: source monitor ${currentMonitorIndex} rect: ${sRect.x}, ${sRect.y}, ${sRect.width}, ${sRect.height}`);

            let candidates = [];
            const eps = 1;

            for (let i = 0; i < logicalMonitors.length; i++) {
                if (i === currentMonitorIndex) continue;
                const cRect = global.display.get_monitor_geometry(i);
                
                let inDirection = false;
                let dist = Infinity;

                if (direction === 'left') {
                    inDirection = cRect.x + cRect.width <= sRect.x + eps;
                    dist = sRect.x - (cRect.x + cRect.width);
                } else if (direction === 'right') {
                    inDirection = cRect.x >= sRect.x + sRect.width - eps;
                    dist = cRect.x - (sRect.x + sRect.width);
                } else if (direction === 'up') {
                    inDirection = cRect.y + cRect.height <= sRect.y + eps;
                    dist = sRect.y - (cRect.y + cRect.height);
                } else if (direction === 'down') {
                    inDirection = cRect.y >= sRect.y + sRect.height - eps;
                    dist = cRect.y - (sRect.y + sRect.height);
                }

                Logger.debug(`getMonitorInDirection: checking monitor ${i} (${cRect.x},${cRect.y},${cRect.width},${cRect.height}) for direction ${direction}: inDirection=${inDirection}`);

                if (inDirection) {
                    let overlap = 0;
                    if (direction === 'left' || direction === 'right') {
                        overlap = Math.max(0, Math.min(cRect.y + cRect.height, sRect.y + sRect.height) - Math.max(cRect.y, sRect.y));
                    } else {
                        overlap = Math.max(0, Math.min(cRect.x + cRect.width, sRect.x + sRect.width) - Math.max(cRect.x, sRect.x));
                    }
                    candidates.push({ index: i, dist, overlap, rect: cRect });
                }
            }

            if (candidates.length === 0) {
                Logger.debug('getMonitorInDirection: no candidates found');
                return -1;
            }

            candidates.sort((a, b) => {
                if (Math.abs(a.dist - b.dist) > eps) {
                    return a.dist - b.dist;
                }
                if (Math.abs(a.overlap - b.overlap) > eps) {
                    return b.overlap - a.overlap;
                }
                return a.index - b.index;
            });

            Logger.debug(`getMonitorInDirection: best candidate is ${candidates[0].index}`);
            return candidates[0].index;
        } catch (e) {
            Logger.error(`Failed to get monitor in direction ${direction}`, e);
            return -1;
        }
    }
}
