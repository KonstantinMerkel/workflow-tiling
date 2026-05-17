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
        this._signals.push(global.display.connect('window-created', (display, window) => {
            if (this._shouldTile(window)) {
                this.controller.tilingRequest(window);
                
                // Fire and forget removal signal
                window.connect('unmanaged', (win) => {
                    this.controller.untile(win);
                });
            }
        }));
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
