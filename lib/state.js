import { Logger } from './utils/logger.js';

/**
 * StateTracker: Ordered window list where array position equals slot id.
 * Invariant: this._windows contains no duplicates. Position = slot.
 */
export class StateTracker {
    constructor() {
        this._wrappers = [];
    }

    /**
     * Registers a window at a specific position (insert) or appends to end.
     * Rejects already-tracked windows (insert-only semantics).
     */
    startTracking(wrapper, index) {
        if (!wrapper) return;
        if (this._wrappers.includes(wrapper)) return;
        if (index !== undefined && index >= 0 && index <= this._wrappers.length) {
            this._wrappers.splice(index, 0, wrapper);
        } else {
            this._wrappers.push(wrapper);
        }
        const slot = this._wrappers.indexOf(wrapper);
        const win = wrapper.window || wrapper;
        const title = wrapper.title || (win.get_title ? win.get_title() : 'unknown');
        Logger.debug(`StateTracker: startTracking window ID ${win.get_id ? win.get_id() : 'unknown'} ("${title}") at slot ${slot}`);
    }

    /**
     * Unregisters a window. Remaining windows shift down naturally.
     */
    stopTracking(wrapper) {
        const idx = this._wrappers.indexOf(wrapper);
        if (idx !== -1) {
            this._wrappers.splice(idx, 1);
            const win = wrapper.window || wrapper;
            const title = wrapper.title || (win.get_title ? win.get_title() : 'unknown');
            Logger.debug(`StateTracker: stopTracking window ID ${win.get_id ? win.get_id() : 'unknown'} ("${title}") from slot ${idx}`);
        }
    }

    /**
     * Atomically replaces one window with another in the same slot.
     * Avoids transient state from sequential stopTracking+startTracking.
     */
    replace(oldWrapper, newWrapper) {
        const idx = this._wrappers.indexOf(oldWrapper);
        if (idx === -1) return;
        this._wrappers[idx] = newWrapper;
        const oldWin = oldWrapper.window || oldWrapper;
        const newWin = newWrapper.window || newWrapper;
        Logger.debug(`StateTracker: replace window ID ${oldWin.get_id ? oldWin.get_id() : 'unknown'} with ${newWin.get_id ? newWin.get_id() : 'unknown'} at slot ${idx}`);
    }

    swapWindows(wrap1, wrap2) {
        const i = this._wrappers.indexOf(wrap1);
        const j = this._wrappers.indexOf(wrap2);
        if (i === -1 || j === -1) return;
        [this._wrappers[i], this._wrappers[j]] = [this._wrappers[j], this._wrappers[i]];
        const win1 = wrap1.window || wrap1;
        const win2 = wrap2.window || wrap2;
        Logger.debug(`StateTracker: Swapped windows ID ${win1.get_id ? win1.get_id() : 'unknown'} (slot ${i} -> ${j}) and ID ${win2.get_id ? win2.get_id() : 'unknown'} (slot ${j} -> ${i})`);
    }

    getSlot(wrapper) {
        let idx = this._wrappers.indexOf(wrapper);
        if (idx === -1) {
            idx = this._wrappers.findIndex(w => w.window === wrapper);
        }
        return idx === -1 ? undefined : idx;
    }

    get wrappers() {
        return [...this._wrappers]; // defensive copy, already ordered
    }

    get size() {
        return this._wrappers.length;
    }

    clear() {
        this._wrappers = [];
    }

    swapWith(otherTracker) {
        const temp = this._wrappers;
        this._wrappers = otherTracker._wrappers;
        otherTracker._wrappers = temp;
    }
}
