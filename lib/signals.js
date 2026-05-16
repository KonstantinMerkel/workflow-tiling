import Meta from 'gi://Meta';

/**
 * SignalListener: Manages GNOME Shell event connections.
 * Routes window creation and destruction to the TilingController.
 */
export class SignalListener {
    constructor(controller) {
        this.controller = controller;
        this._signals = [];
    }

    /**
     * Binds to global display signals and per-window removal signals.
     */
    bind() {
        console.log('SignalListener: Binding global signals');
        this._signals.push(global.display.connect('window-created', (display, window) => {
            if (this._shouldTile(window)) {
                console.log(`SignalListener: Detected new tileable window: ${window.get_title() || 'Untitled'}`);
                this.controller.tilingRequest(window);
                
                window.connect('unmanaged', (win) => {
                    this.controller.untile(win);
                });
            }
        }));
    }

    /**
     * Disconnects all established signals.
     */
    unbind() {
        console.log('SignalListener: Unbinding signals');
        this._signals.forEach(id => global.display.disconnect(id));
        this._signals = [];
    }

    /**
     * Identifies windows that should be automatically tiled.
     * Includes Normal, Terminal, and Utility windows.
     * Excludes dialogs, splash screens, and skip-taskbar windows.
     */
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
