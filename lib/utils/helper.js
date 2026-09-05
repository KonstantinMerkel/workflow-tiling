import Meta from 'gi://Meta';

export const TILABLE_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.TERMINAL,
    Meta.WindowType.UTILITY
];

/**
 * Validates if a window should be managed by the tiling system.
 * Checks unmanaged state, window type, and taskbar skip status.
 * @param {Meta.Window} window to be checked
 * @returns {boolean}
 */
export function isTilable(window) {
    if (!window || window.unmanaged) return false;

    const type = window.get_window_type ? window.get_window_type() : Meta.WindowType.NORMAL;
    const skipTaskbar = window.is_skip_taskbar ? window.is_skip_taskbar() : false;
    
    return TILABLE_WINDOW_TYPES.includes(type) && !skipTaskbar;
}
