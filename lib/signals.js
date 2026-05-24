import Meta from 'gi://Meta';
import { Logger } from './logger.js';

/**
 * SignalListener: Manages GNOME Shell event connections.
 */
export class SignalListener {
    constructor(controller) {
        this.controller = controller;
        this._signals = [];
    }

    bind() {
        const connect = (obj, name, cb) => {
            if (!obj) return;
            const id = obj.connect(name, cb);
            this._signals.push({ obj, id });
        };

        // Listen for window-created signals.
        connect(global.display, 'window-created', (display, window) => {
            this._addWindow(window);
        });

        // Monitor window movement.
        connect(global.display, 'window-entered-monitor', (display, monitorIndex, window) => {
            this._addWindow(window);
        });

        connect(global.display, 'window-left-monitor', (display, monitorIndex, window) => {
            // Re-tile the monitor the window left
            this.controller.tilingRequest(window);
        });

        // Monitor Hotplugging.
        try {
            const manager = global.backend.get_monitor_manager();
            connect(manager, 'monitors-changed', () => {
                this.controller.monitorManager.handleMonitorsChanged();
            });
        } catch (e) {
            Logger.error('Failed to connect monitors-changed', e);
        }

        // Tile tracked windows.
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
        this._signals.forEach(({ obj, id }) => {
            try {
                if (obj && obj.handler_is_connected(id)) {
                    obj.disconnect(id);
                }
            } catch (e) {
                Logger.warn('Failed to unbind signal for object', e);
            }
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
