import { WindowWrapper } from './window.js';
import { Logger } from './utils/logger.js';

/**
 * WindowRegistry: Manages the lifecycle and lookup of WindowWrapper instances.
 * Owns the window→wrapper mapping. Creation, lookup, removal.
 */
export class WindowRegistry {
    /**
     * @param {Object} callbacks
     * @param {Function} callbacks.onTilingRequest - called when a wrapper requests re-tiling
     * @param {Function} callbacks.onUntile - called when a wrapper signals removal
     * @param {Function} callbacks.isOverrideActive - called to check override state
     */
    constructor(callbacks) {
        this._wrappers = new Map(); //registry of all know windowWrappers
        this._callbacks = callbacks;
    }

    /**
     * @param {Meta.Window} window
     * @returns {WindowWrapper|undefined}
     */
    get(window) {
        return this._wrappers.get(window);
    }

    /**
     * @param {Meta.Window} window
     * @returns {boolean}
     */
    has(window) {
        return this._wrappers.has(window);
    }

    /**
     * Returns existing wrapper or creates, registers, and binds a new one.
     * @param {Meta.Window} window
     * @returns {WindowWrapper}
     */
    ensure(window) {
        let wrapper = this._wrappers.get(window);
        if (!wrapper) {
            wrapper = new WindowWrapper(window, this._callbacks);
            this._wrappers.set(window, wrapper);
            wrapper.bindSignals();
            wrapper.bindSizeChanged();
            Logger.debug(
                `WindowRegistry: Created wrapper for window ID ${window?.get_id?.() ?? 'unknown'}`,
            );
        }
        return wrapper;
    }

    /**
     * Removes a window from the registry without destroying the wrapper.
     * Caller is responsible for wrapper.destroy() and lifecycle coordination.
     * @param {Meta.Window} window
     * @returns {WindowWrapper|undefined} the removed wrapper
     */
    delete(window) {
        const wrapper = this._wrappers.get(window);
        this._wrappers.delete(window);
        return wrapper;
    }

    /**
     * @param {Function} fn callback(wrapper, window)
     */
    forEach(fn) {
        this._wrappers.forEach(fn);
    }

    /**
     * Destroys all wrappers and clears the registry.
     */
    destroyAll() {
        this._wrappers.forEach((wrapper) => wrapper.destroy());
        this._wrappers.clear();
    }

    /** @returns {number} */
    get size() {
        return this._wrappers.size;
    }
}
