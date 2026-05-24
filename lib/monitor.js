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

    recordEvacuation(window, oldMonitorId, oldWorkspace) {
        this._evacuatedWindows.set(window, { monitorId: oldMonitorId, workspace: oldWorkspace });
    }

    isEvacuated(window) {
        return this._evacuatedWindows.has(window);
    }

    clearEvacuations() {
        this._evacuatedWindows.clear();
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
                    this.controller.clearWorkspaceGrids();
                    
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
                                this.controller.addRestoringWindow(win);
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
}
