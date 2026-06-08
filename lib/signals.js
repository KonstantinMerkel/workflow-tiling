import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Logger } from './logger.js';

/**
 * SignalListener: Manages GNOME Shell event connections.
 */
export const TILABLE_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.TERMINAL,
    Meta.WindowType.UTILITY
];

export class SignalListener {
    static activeInstance = null;

    constructor(controller) {
        if (SignalListener.activeInstance) {
            throw new Error("WorkflowTiling: Stale SignalListener instance still active!");
        }
        SignalListener.activeInstance = this;

        this.controller = controller;
        this._signals = [];
        this._pendingIdles = new Set();
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
                this.controller.handleMonitorsChanged();
            });
        } catch (e) {
            Logger.error('Failed to connect monitors-changed', e);
        }

        // Handle window drag-to-swap
        connect(global.display, 'grab-op-begin', (display, window, op) => {
            if (window && (op === Meta.GrabOp.MOVING || op === Meta.GrabOp.KEYBOARD_MOVING)) {
                this.controller.startDragTracking(window);
            }
        });

        connect(global.display, 'grab-op-end', (display, window, op) => {
            if (window && (op === Meta.GrabOp.MOVING || op === Meta.GrabOp.KEYBOARD_MOVING)) {
                this.controller.endDragTracking(window);
            }
        });

        // Listen for screen unlock to re-hydrate state
        connect(Main.sessionMode, 'updated', () => {
            if (!Main.sessionMode.isLocked) {
                Logger.info('Session unlocked, triggering hydration');
                this.controller.hydrate();
            }
        });

        // Sort and tile tracked windows geometrically to preserve stable slots.
        this.controller.hydrate();
    }


    _addWindow(window) {
        if (!window) return;
        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._pendingIdles.delete(sourceId);
            if (!SignalListener.activeInstance) return GLib.SOURCE_REMOVE;
            if (this._shouldTile(window)) {
                this.controller.tilingRequest(window);
            }
            return GLib.SOURCE_REMOVE;
        });
        this._pendingIdles.add(sourceId);
    }

    unbind() {
        this._pendingIdles.forEach(id => GLib.source_remove(id));
        this._pendingIdles.clear();

        this._signals.forEach(({ obj, id }) => {
            try {
                if (obj) {
                    obj.disconnect(id);
                }
            } catch (e) {
                Logger.warn('Failed to unbind signal for object', e);
            }
        });
        this._signals = [];

        if (SignalListener.activeInstance === this) {
            SignalListener.activeInstance = null;
        }
    }

    _shouldTile(window) {
        if (!window) return false;

        const type = window.get_window_type();
        const skipTaskbar = window.is_skip_taskbar ? window.is_skip_taskbar() : false;
        
        return TILABLE_WINDOW_TYPES.includes(type) && !skipTaskbar;
    }
}
