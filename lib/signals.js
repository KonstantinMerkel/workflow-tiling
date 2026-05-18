import Meta from 'gi://Meta';

/**
 * SignalListener: Manages GNOME Shell event connections.
 */
export class SignalListener {
    constructor(controller) {
        this.controller = controller;
        this._signals = [];
    }

    bind() {
        // 1. Listen for new windows
        this._signals.push(global.display.connect('window-created', (display, window) => {
            this._addWindow(window);
        }));

        // 2. Monitor changes (Global signals are safer than window-level for Wayland)
        this._signals.push(global.display.connect('window-entered-monitor', (display, monitorIndex, window) => {
            this._addWindow(window);
        }));

        this._signals.push(global.display.connect('window-left-monitor', (display, monitorIndex, window) => {
            // Re-tile the monitor the window left
            this.controller.tilingRequest(window);
        }));

        // 3. Tile existing windows
        global.display.list_all_windows().forEach(window => {
            this._addWindow(window);
        });
    }

    _addWindow(window) {
        if (this._shouldTile(window)) {
            this.controller.tilingRequest(window);
        }
    }

    unbind() {
        this._signals.forEach(id => {
            try { global.display.disconnect(id); } catch (e) {}
        });
        this._signals = [];
    }

    _shouldTile(window) {
        if (!window) return false;

        const type = window.get_window_type();
        const skipTaskbar = window.is_skip_taskbar ? window.is_skip_taskbar() : false;
        
        const validTypes = [
            Meta.WindowType.NORMAL,
            Meta.WindowType.TERMINAL,
            Meta.WindowType.UTILITY
        ];

        return validTypes.includes(type) && !skipTaskbar;
    }
}
