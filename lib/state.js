import { Logger } from './logger.js';

/**
 * StateTracker class. Maps windows to slots.
 */
export class StateTracker {
    constructor() {
        this._windowToSlot = new Map();
        this._originalGeometries = new Map();
    }

    track(window, index) {
        if (!this._originalGeometries.has(window)) {
            const rect = window.get_frame_rect ? window.get_frame_rect() : { x: 0, y: 0, width: 0, height: 0 };
            this._originalGeometries.set(window, rect);
            Logger.debug(`StateTracker: Tracked new window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}") to slot ${index}`);
        } else {
            Logger.debug(`StateTracker: Updated window ID ${window.get_id ? window.get_id() : 'unknown'} to slot ${index}`);
        }
        this._windowToSlot.set(window, index);
    }

    untrack(window) {
        const original = this._originalGeometries.get(window);
        const slot = this._windowToSlot.get(window);
        this._windowToSlot.delete(window);
        this._originalGeometries.delete(window);
        Logger.debug(`StateTracker: Untracked window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}") from slot ${slot}`);
        return original;
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
        this._originalGeometries.clear();
    }
}
