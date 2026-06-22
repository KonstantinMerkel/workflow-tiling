import { Logger } from './logger.js';

/**
 * StateTracker class. Maps windows to slots.
 */
export class StateTracker {
    constructor() {
        this._windowToSlot = new Map();

    }

    track(window, index) {
        if (true) {
            Logger.debug(`StateTracker: Tracked new window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}") to slot ${index}`);
        } else {
            Logger.debug(`StateTracker: Updated window ID ${window.get_id ? window.get_id() : 'unknown'} to slot ${index}`);
        }
        this._windowToSlot.set(window, index);
    }

    untrack(window) {
        const slot = this._windowToSlot.get(window);
        this._windowToSlot.delete(window);
        Logger.debug(`StateTracker: Untracked window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}") from slot ${slot}`);
    }

    swapWindows(win1, win2) {
        if (!this._windowToSlot.has(win1) || !this._windowToSlot.has(win2)) return;
        const slot1 = this._windowToSlot.get(win1);
        const slot2 = this._windowToSlot.get(win2);
        this._windowToSlot.set(win1, slot2);
        this._windowToSlot.set(win2, slot1);
        Logger.debug(`StateTracker: Swapped windows ID ${win1.get_id ? win1.get_id() : 'unknown'} (slot ${slot1} -> ${slot2}) and ID ${win2.get_id ? win2.get_id() : 'unknown'} (slot ${slot2} -> ${slot1})`);
    }

    getSlot(window) {
        return this._windowToSlot.get(window);
    }

    get windows() {
        return [...this._windowToSlot.entries()]
            .sort((a, b) => a[1] - b[1])
            .map(entry => entry[0]);
    }

    get size() {
        return this._windowToSlot.size;
    }

    clear() {
        this._windowToSlot.clear();
    }

    swapWith(otherTracker) {
        const tempWindowToSlot = this._windowToSlot;
        this._windowToSlot = otherTracker._windowToSlot;
        otherTracker._windowToSlot = tempWindowToSlot;
    }
}
