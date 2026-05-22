import Meta from 'gi://Meta';
import { Logger } from './logger.js';

export class WindowWrapper {
    constructor(window, controller) {
        this.window = window;
        this.controller = controller;
        this.signals = new Map();
        
        this.workspace = null;
        this.monitorIndex = -1;
        this.monitorId = null;
    }

    get unmanaged() {
        return this.window.unmanaged;
    }

    get minimized() {
        return this.window.minimized;
    }

    get title() {
        return (this.window.get_title && this.window.get_title()) || 'Unknown';
    }

    bindSignals() {
        if (!this.signals.has('unmanaged')) {
            this.signals.set('unmanaged', this.window.connect('unmanaged', () => this.controller.untile(this.window)));
        }
        if (!this.signals.has('workspace-changed')) {
            this.signals.set('workspace-changed', this.window.connect('workspace-changed', () => this.controller.tilingRequest(this.window)));
        }
        if (!this.signals.has('notify::minimized')) {
            this.signals.set('notify::minimized', this.window.connect('notify::minimized', () => this.controller.tilingRequest(this.window)));
        }
    }

    bindOneShotSizeChanged() {
        if (!this.signals.has('size-changed')) {
            this.signals.set('size-changed', this.window.connect('size-changed', () => {
                this.disconnectSignal('size-changed');
                this.controller.tilingRequest(this.window);
            }));
        }
    }

    disconnectSignal(name) {
        try {
            const id = this.signals.get(name);
            if (id && this.window.handler_is_connected(id)) {
                this.window.disconnect(id);
            }
        } catch (e) {
            Logger.warn(`Failed to disconnect signal ${name}`, e);
        }
        this.signals.delete(name);
    }

    destroy() {
        const keys = Array.from(this.signals.keys());
        for (const name of keys) {
            this.disconnectSignal(name);
        }
    }

    applyGeometry(rect) {
        if (this.unmanaged || !this.window.move_resize_frame || this.window.minimized) return;

        try {
            if (this.window.maximized_horizontally || this.window.maximized_vertically) {
                this.window.unmaximize();
                // Delay unmaximize via compositor.
                global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    if (this.unmanaged) return false;
                    this._doResize(rect);
                    return false;
                });
            } else {
                this._doResize(rect);
            }
        } catch (e) {
            Logger.warn(`Skipping resize for "${this.title}"`, e);
        }
    }

    _doResize(rect) {
        try {
            this.window.move_resize_frame(
                true,
                Math.round(rect.x),
                Math.round(rect.y),
                Math.round(rect.width),
                Math.round(rect.height)
            );
        } catch (e) {
            Logger.warn(`Resize failed for "${this.title}"`, e);
        }
    }
}
