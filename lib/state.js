import { Logger } from './utils/logger.js';

/**
 * StateTracker: Ordered window list where array position equals slot id.
 * Invariant: this._windows contains no duplicates. Position = slot.
 */
export class StateTracker {
    constructor() {
        this._windows = [];
    }

    /**
     * Registers a window at a specific position (insert) or appends to end.
     * Rejects already-tracked windows (insert-only semantics).
     */
    startTracking(window, index) {
        if (this._windows.includes(window)) return;
        if (index !== undefined && index >= 0 && index <= this._windows.length) {
            this._windows.splice(index, 0, window);
        } else {
            this._windows.push(window);
        }
        const slot = this._windows.indexOf(window);
        Logger.debug(`StateTracker: startTracking window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}") at slot ${slot}`);
    }

    /**
     * Unregisters a window. Remaining windows shift down naturally.
     */
    stopTracking(window) {
        const idx = this._windows.indexOf(window);
        if (idx !== -1) {
            this._windows.splice(idx, 1);
            Logger.debug(`StateTracker: stopTracking window ID ${window.get_id ? window.get_id() : 'unknown'} ("${window.get_title ? window.get_title() : 'unknown'}") from slot ${idx}`);
        }
    }

    /**
     * Atomically replaces one window with another in the same slot.
     * Avoids transient state from sequential stopTracking+startTracking.
     */
    replace(oldWindow, newWindow) {
        const idx = this._windows.indexOf(oldWindow);
        if (idx === -1) return;
        this._windows[idx] = newWindow;
        Logger.debug(`StateTracker: replace window ID ${oldWindow.get_id ? oldWindow.get_id() : 'unknown'} with ${newWindow.get_id ? newWindow.get_id() : 'unknown'} at slot ${idx}`);
    }

    swapWindows(win1, win2) {
        const i = this._windows.indexOf(win1);
        const j = this._windows.indexOf(win2);
        if (i === -1 || j === -1) return;
        [this._windows[i], this._windows[j]] = [this._windows[j], this._windows[i]];
        Logger.debug(`StateTracker: Swapped windows ID ${win1.get_id ? win1.get_id() : 'unknown'} (slot ${i} -> ${j}) and ID ${win2.get_id ? win2.get_id() : 'unknown'} (slot ${j} -> ${i})`);
    }

    getSlot(window) {
        const idx = this._windows.indexOf(window);
        return idx === -1 ? undefined : idx;
    }

    get windows() {
        return [...this._windows]; // defensive copy, already ordered
    }

    get size() {
        return this._windows.length;
    }

    clear() {
        this._windows = [];
    }

    swapWith(otherTracker) {
        const temp = this._windows;
        this._windows = otherTracker._windows;
        otherTracker._windows = temp;
    }
}
