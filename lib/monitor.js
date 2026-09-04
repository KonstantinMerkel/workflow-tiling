import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import { Logger } from './utils/logger.js';
import { isTilable } from './utils/helper.js';
import { findMonitorInDirection } from './utils/geometry.js';

/**
 * Briges the gap between physical monitor events (e.g. docking, spacial),
 * the windows and topology on said monitor and
 * the layout and topology managment
 */
export class MonitorManager {
    constructor(controller) {
         // pragmatic reference to avoid event plumbing via callbacks; controller owns this!!!
        this.controller = controller;
        this.manager = global.backend.get_monitor_manager(); //link to Mutter

        this._lastMonitorCount = 0;
        this._knownMonitorIds = new Set();
        this._evacuatedWindows = new Map();
        this._monitorsChangedPending = false;
        this._idleSourceIds = new Set();
        
        this.initializeMonitorState();
    }

    // seperate for test
    initializeMonitorState() {
        try {
            const logicalMonitors = this.manager.get_logical_monitors();
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
            return this.manager.get_logical_monitors().length;
        } catch (e) {
            return global.display.get_n_monitors();
        }
    }


    monitorExists(monitorId) {
        return this.getMonitorIndex(monitorId) >= 0;
    }

    /**
     * Resolves MonitorIndex to Id from source 
     * @param {Int} monitorIndex transistent id (may change with docking events)
     * @returns stable HardwareId (e.g. DP-1)
     */
    getMonitorId(monitorIndex) {
        try {
            const logicalMonitors = this.manager.get_logical_monitors();
            const logicalMonitor = logicalMonitors[monitorIndex];
            if (logicalMonitor) {
                // info: logical monitor can be mirrored to multiple physical monitors
                const physicalMonitors = logicalMonitor.get_monitors();
                const monitor = physicalMonitors && physicalMonitors.length > 0 ? physicalMonitors[0] : null;
                if (monitor) {
                    // older GNOME versions may not have get_stable_id; there connecter is used
                    return monitor.get_stable_id?.() || monitor.get_connector?.();
                }
            }
        } catch (e) {
            Logger.warn(`Could not get monitor ID for index ${monitorIndex}`, e);
        }
        return `idx-${monitorIndex}`; //try to fallback to selfcreated id; last resort only
    }

    /**
     * Resolves MonitorId to Index from source
     * @param  monitorId stable HardwareId (e.g. DP-1)
     * @returns transistent id (may change with docking events)
     */
    getMonitorIndex(monitorId) {
        try {
            const logicalMonitors = this.manager.get_logical_monitors();
            for (let i = 0; i < logicalMonitors.length; i++) {
                const physicalMonitors = logicalMonitors[i].get_monitors();
                if (physicalMonitors) {
                    for (let m of physicalMonitors) {
                        const id = m.get_stable_id?.() || m.get_connector?.();
                        if (id === monitorId) return i;
                    }
                }
            }
        } catch (e) {}
        return -1;
    }

    /**
     * saves window to information object
     * @param {Meta.window} window 
     */
    recordEvacuation(window, oldMonitorId, oldWorkspace, slot) {
        this._evacuatedWindows.set(window, { monitorId: oldMonitorId, workspace: oldWorkspace, slot });
    }

    /**
     * checks if window is know as having been evacuated
     * @param {Meta.window} window 
     */
    isEvacuated(window) {
        return this._evacuatedWindows.has(window);
    }

    /**
     * clears all known evacuated windows
     */
    clearEvacuations() {
        this._evacuatedWindows.clear();
    }

    /**
     * clears single window from known evacuatees
     * @param {Meta.window} window 
     */
    clearEvacuation(window) {
        this._evacuatedWindows.delete(window);
    }

    /**
     * Removes a from a the tracking on it's old Workspace (and Monitor)
     * @returns the slot it held before untracking
     */
    _untrackEvacuatedWindow(window, oldMonitorId, oldWorkspace, title) {
        try {
            const oldGrid = this.controller.workspaceManager.getLayout(oldWorkspace);
            const slot = oldGrid._getTracker(oldMonitorId).getSlot(window);
            oldGrid.untrackWindow(window, oldMonitorId);
            return slot;
        } catch (e) {
            Logger.warn(`Evacuation untrack failed for "${title}"`, e);
            return undefined;
        }
    }

    /**
     * Check if this was an evacuation if so handle all "homeless" windows,
     * minimise so the other screens layout remains intakt; 
     * @param {Meta.window} window the window to check
     * @param {WindowWrapper} wrapper the wrapper of the window containing the non-updated information
     * @param {String} newMonitorId 
     * @param {Meta.workspace} newWorkspace 
     * @returns was it an Evacuation Event?
     */
    interceptEvacuation(window, wrapper, newMonitorId, newWorkspace) {
        const oldMonitorId = wrapper.monitorId;
        const oldWorkspace = wrapper.workspace;
        
        // Abort if not a cross-monitor move, or if already evacuated
        if (!oldWorkspace || !oldMonitorId || oldMonitorId === newMonitorId) return false;
        if (this.monitorExists(oldMonitorId) || this.isEvacuated(window)) return false;

        Logger.info(`Evacuation detected for "${wrapper.title}" (Monitor ${oldMonitorId} removed)`);
        this.controller.setBatchMode(true); // Choke retiles
        
        let idleId = 0;
        let ranSync = false; // HACK; in production strickly async - not needed - test however syncronously (Temporal Dead Zone)
        // schedule minimize for next frame
        idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            ranSync = true;
            if (idleId) {
                this._idleSourceIds.delete(idleId);
            }
            if (isTilable(window) && !window.minimized) {
                window.minimize();
            }
            this.controller.setBatchMode(false);
            return GLib.SOURCE_REMOVE;
        });
        if (idleId && !ranSync) {
            this._idleSourceIds.add(idleId);
        }

        // untrack the window from it's old spot and record as having been evacuated
        const slot = this._untrackEvacuatedWindow(window, oldMonitorId, oldWorkspace, wrapper.title);
        this.recordEvacuation(window, oldMonitorId, oldWorkspace, slot);
        
        return true;
    }

    /**
     * Master conductor for hardware topology
     * Handles dis-/reconnects and resyncs the world
     */
    handleMonitorsChanged() {
        // Ensure this only runs once
        if (this._monitorsChangedPending) return;
        this._monitorsChangedPending = true;

        try {
            const logicalMonitors = this.manager.get_logical_monitors();
            const currentMonitorCount = logicalMonitors.length;
            const currentMonitorIds = new Set(
                logicalMonitors.map((_, i) => this.getMonitorId(i))
            );

            Logger.info(`Topology Change. Count: ${this._lastMonitorCount}->${currentMonitorCount}`);

            this._pendingLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._pendingLaterId = 0; //currently running, don't cancel now
                this._monitorsChangedPending = false;
                try {
                    this.controller.setBatchMode(false);
                    
                    //case: undocking
                    if (currentMonitorCount < this._lastMonitorCount) {
                        this.controller.clearRestoringWindows(); 
                    } 

                    //case redocking
                    if (currentMonitorCount > this._lastMonitorCount && this._evacuatedWindows.size > 0) {
                        this._restoreEvacuatedWindows(currentMonitorIds);
                    }

                    this.controller.hydrate();
                    this._lastMonitorCount = currentMonitorCount;
                    this._knownMonitorIds = new Set(currentMonitorIds);

                } catch (e) {
                    Logger.error('Monitor change processing failed', e);
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

    /**
     * Restores Windows to their orignal monitor on redocking
     * @param {Set(String)} currentMonitorIds the current id's as direct from mutter; must not be the cached known!
     */
    _restoreEvacuatedWindows(currentMonitorIds) {
        const currentMonitorCount = currentMonitorIds.size;
        const newMonitorIds = [...currentMonitorIds].filter(id => !this._knownMonitorIds.has(id));
        const targetMonitorId = newMonitorIds.length > 0 ? newMonitorIds[0] : this.getMonitorId(currentMonitorCount - 1);
        const targetIndex = this.getMonitorIndex(targetMonitorId);

        const restoredCount = this._evacuatedWindows.size;
        Logger.info(`Restoring ${restoredCount} window(s) to new monitor ${targetMonitorId} (index ${targetIndex})`);

        for (const [win, info] of this._evacuatedWindows) {
            if (isTilable(win)) {
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

    /**
     * Finds the nearest monitor in the given direction.
     * @param {number} currentMonitorIndex 
     * @param {'left'|'right'|'up'|'down'} direction 
     * @returns {number} The index of the (best fitting) monitor from currentMonitor in direction, or -1 if none found
     */
    getMonitorInDirection(currentMonitorIndex, direction) {
        try {
            const logicalMonitors = this.manager.get_logical_monitors();
            
            // outsource to geometry helper
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
            Logger.warn(`Failed to get monitor in direction ${direction}`, e);
            return -1;
        }
    }

    /**
     * clears all pending jobs; leaves clean slate when disabling extension
     */
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
}
