import { Logger } from './utils/logger.js';


export class MonitorLayout {
    constructor() {
        this._wrappers = []; // Ordered window list where array position equals slot id.
    }

    /**
     * Swaps the WindowWrappers between two MonitorLayouts.
     */
    static swap(layoutA, layoutB) {
        const temp = layoutA._wrappers;
        layoutA._wrappers = layoutB._wrappers;
        layoutB._wrappers = temp;
    }

    /**
     * Registers a window at a specific position (insert) or appends to end.
     * Rejects already-tracked windows.
     */
    startTracking(wrapper, index) {
        if (!wrapper) return;
        if (this._wrappers.includes(wrapper)) return;
        if (index !== undefined && index >= 0 && index <= this._wrappers.length) {
            this._wrappers.splice(index, 0, wrapper);
        } else {
            this._wrappers.push(wrapper);
        }
        Logger.debug(
            `MonitorLayout: startTracking window ID ${(wrapper.window || wrapper).get_id?.() ?? 'unknown'} ` +
                `("${wrapper.title ?? wrapper.get_title?.() ?? 'unknown'}") at slot ${this._wrappers.indexOf(wrapper)}`,
        );
    }

    /**
     * Unregisters a window. Remaining windows shift down
     */
    stopTracking(wrapper) {
        const idx = this._wrappers.indexOf(wrapper);
        if (idx !== -1) {
            this._wrappers.splice(idx, 1);
            Logger.debug(
                `MonitorLayout: stopTracking window ID ${(wrapper.window || wrapper).get_id?.() ?? 'unknown'} ` +
                    `("${wrapper.title ?? wrapper.get_title?.() ?? 'unknown'}") from slot ${idx}`,
            );
        }
    }

    /**
     * Atomically replaces one window with another in the same slot.
     * Only for Intra-monitor wrappers
     */
    replace(oldWrapper, newWrapper) {
        const idx = this._wrappers.indexOf(oldWrapper);
        if (idx === -1) {
            return Logger.debug(
                `Old WindowWrapper not known. Skip replacing operation between ` +
                `"${oldWrapper.title ?? oldWrapper.get_title?.() ?? 'unknown'}" and ` +
                `"${newWrapper.title ?? newWrapper.get_title?.() ?? 'unknown'}"`
            );
        }
        this._wrappers[idx] = newWrapper;
        Logger.debug(
            `MonitorLayout: replace window ID ${(oldWrapper.window || oldWrapper).get_id?.() ?? 'unknown'} ` +
                `with ${(newWrapper.window || newWrapper).get_id?.() ?? 'unknown'} at slot ${idx}`,
        );
    }

    /**
     * Atomically swaps to wrappers on the monitor. This is Intramonitor only.
     */
    swapWindows(wrap1, wrap2) {
        const i = this._wrappers.indexOf(wrap1);
        const j = this._wrappers.indexOf(wrap2);
        if (i === -1 || j === -1) return;
        [this._wrappers[i], this._wrappers[j]] = [this._wrappers[j], this._wrappers[i]];
        Logger.debug(
            `MonitorLayout: Swapped windows ID ${(wrap1.window || wrap1).get_id?.() ?? 'unknown'} (slot ${i} -> ${j}) ` +
                `and ID ${(wrap2.window || wrap2).get_id?.() ?? 'unknown'} (slot ${j} -> ${i})`,
        );
    }

    /**
     * @returns {Int} The slot of the WindowWrapper
     */
    getSlot(wrapper) {
        let idx = this._wrappers.indexOf(wrapper);
        if (idx === -1) {
            idx = this._wrappers.findIndex((w) => w.window === wrapper);
        }
        return idx === -1 ? undefined : idx;
    }

    get wrappers() {
        return [...this._wrappers]; // defensive copy, already ordered
    }

    get size() {
        return this._wrappers.length;
    }

    /** wipe all tracked wrappers to this monitor */
    clear() {
        this._wrappers = [];
    }
}
