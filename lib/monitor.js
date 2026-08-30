import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import { Logger } from './logger.js';
import { findMonitorInDirection } from './utils/geometry.js';

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
        this._idleSourceIds = new Set();
        
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

    getMonitorCount() {
        try {
            return global.backend.get_monitor_manager().get_logical_monitors().length;
        } catch (e) {
            return global.display.get_n_monitors();
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

    clearEvacuation(window) {
        this._evacuatedWindows.delete(window);
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
                let idleId = 0;
                let ranSync = false;
                idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    ranSync = true;
                    if (idleId) {
                        this._idleSourceIds.delete(idleId);
                    }
                    if (window && !window.unmanaged && !window.minimized) {
                        window.minimize();
                    }
                    this.controller.setBatchMode(false);
                    return GLib.SOURCE_REMOVE;
                });
                if (idleId && !ranSync) {
                    this._idleSourceIds.add(idleId);
                }

                let slot = undefined;
                try {
                    const oldGrid = this.controller.workspaceManager.getLayout(oldWorkspace);
                    slot = oldGrid._getTracker(oldMonitorId).getSlot(window);
                    oldGrid.untrackWindow(window, oldMonitorId);
                } catch (e) {
                    Logger.warn(`Evacuation untrack failed for "${wrapper.title}"`, e);
                }

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

            this._pendingLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._pendingLaterId = 0;
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
        if (this._pendingLaterId) {
            global.compositor.get_laters().remove(this._pendingLaterId);
            this._pendingLaterId = 0;
        }
        for (const idleId of this._idleSourceIds) {
            GLib.source_remove(idleId);
        }
        this._idleSourceIds.clear();
        this._evacuatedWindows.clear();
        this._monitorsChangedPending = false;
    }



    getMonitorInDirection(currentMonitorIndex, direction) {
        try {
            const manager = global.backend.get_monitor_manager();
            const logicalMonitors = manager.get_logical_monitors();
            
            const index = findMonitorInDirection(
                currentMonitorIndex, 
                direction, 
                logicalMonitors, 
                (i) => global.display.get_monitor_geometry(i)
            );
            
            if (index !== -1) {
                Logger.debug(`getMonitorInDirection: best candidate is ${index}`);
            } else {
                Logger.debug('getMonitorInDirection: no candidates found or invalid source monitor');
            }
            return index;
        } catch (e) {
            Logger.error(`Failed to get monitor in direction ${direction}`, e);
            return -1;
        }
    }
}
