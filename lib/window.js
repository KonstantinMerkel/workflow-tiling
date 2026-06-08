import Meta from 'gi://Meta';
import { Logger } from './logger.js';

/**
 * WindowWrapper class. Wraps Meta.Window.
 */
export class WindowWrapper {
    constructor(window, controller) {
        this.window = window;
        this.controller = controller;
        this.signals = new Map();
        
        this.workspace = null;
        this.monitorIndex = -1;
        this.monitorId = null;
        
        this._sizeChangedHandled = false;
        this._pendingLaters = [];
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

    // Expected State Cache to prevent race condition when working with monitors in rapid succession
    get effectiveMonitorIndex() {
        let m = this.window.get_monitor ? this.window.get_monitor() : -1;
        if (this._expectedMonitorIndex !== undefined) {
            if (m !== this._expectedMonitorIndex) {
                if (!this._monitorWaitCycles) this._monitorWaitCycles = 0;
                if (++this._monitorWaitCycles > 15) {
                    delete this._expectedMonitorIndex;
                    this._monitorWaitCycles = 0;
                } else {
                    m = this._expectedMonitorIndex;
                }
            } else {
                delete this._expectedMonitorIndex;
                this._monitorWaitCycles = 0;
            }
        }
        return m;
    }

    // Expected State Cache to prevent race condition when working with workspaces in rapid succession
    get effectiveWorkspace() {
        let w = this.window.get_workspace ? this.window.get_workspace() : null;
        if (this._expectedWorkspace !== undefined) {
            if (w !== this._expectedWorkspace) {
                if (!this._workspaceWaitCycles) this._workspaceWaitCycles = 0;
                if (++this._workspaceWaitCycles > 15) {
                    delete this._expectedWorkspace;
                    this._workspaceWaitCycles = 0;
                } else {
                    w = this._expectedWorkspace;
                }
            } else {
                delete this._expectedWorkspace;
                this._workspaceWaitCycles = 0;
            }
        }
        return w;
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
        if (!this.signals.has('notify::monitor')) {
            this.signals.set('notify::monitor', this.window.connect('notify::monitor', () => this.controller.tilingRequest(this.window)));
        }
        if (!this.signals.has('notify::maximized-horizontally')) {
            this.signals.set('notify::maximized-horizontally', this.window.connect('notify::maximized-horizontally', () => {
                if (this.window.maximized_horizontally || this.window.maximized_vertically) {
                    this.controller.tilingRequest(this.window);
                }
            }));
        }
        if (!this.signals.has('notify::maximized-vertically')) {
            this.signals.set('notify::maximized-vertically', this.window.connect('notify::maximized-vertically', () => {
                if (this.window.maximized_horizontally || this.window.maximized_vertically) {
                    this.controller.tilingRequest(this.window);
                }
            }));
        }
        if (!this.signals.has('notify::skip-taskbar')) {
            this.signals.set('notify::skip-taskbar', this.window.connect('notify::skip-taskbar', () => this.controller.tilingRequest(this.window)));
        }
    }

    // Continuous size-changed listener guarded by _isResizing flag.
    bindSizeChanged() {
        if (!this.signals.has('size-changed')) {
            this.signals.set('size-changed', this.window.connect('size-changed', () => {
                if (this._isResizing) return;
                this.controller.tilingRequest(this.window);
            }));
        }
    }

    disconnectSignal(name) {
        try {
            const id = this.signals.get(name);
            if (id && this.window) {
                this.window.disconnect(id);
            }
        } catch (e) {
            // Window is likely destroyed/finalized by GNOME. Silently ignore.
        }
        this.signals.delete(name);
    }

    destroy() {
        const laters = global.compositor.get_laters();
        for (const id of this._pendingLaters) {
            try { laters.remove(id); } catch (e) { /* already fired */ }
        }
        this._pendingLaters = [];

        const keys = Array.from(this.signals.keys());
        for (const name of keys) {
            this.disconnectSignal(name);
        }
    }

    applyGeometry(rect) {
        if (this.unmanaged || !this.window.move_resize_frame || this.window.minimized) return;

        // Prevent infinite resize loops caused by Wayland clamping premature out-of-bounds resizes.
        // Wait for Mutter's asynchronous state to catch up to our Expected State Cache.
        if (this._expectedMonitorIndex !== undefined && this.window.get_monitor() !== this._expectedMonitorIndex) return;
        if (this._expectedWorkspace !== undefined && this.window.get_workspace() !== this._expectedWorkspace) return;

        try {
            if (this.window.get_monitor && this.monitorIndex >= 0 && this.window.get_monitor() !== this.monitorIndex) {
                if (this.window.move_to_monitor) {
                    this.window.move_to_monitor(this.monitorIndex);
                }
            }

            if (this.isOverrideActive()) {
                return;
            }

            if (this.window.maximized_horizontally || this.window.maximized_vertically) {
                this.window.unmaximize(3);
                const laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    if (this.unmanaged) return false;
                    this._doResize(rect);
                    return false;
                });
                this._pendingLaters.push(laterId);
            } else if (this.window.is_fullscreen()) {
                this.window.unmake_fullscreen();
                const laterId2 = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                    if (this.unmanaged) return false;
                    this._doResize(rect);
                    return false;
                });
                this._pendingLaters.push(laterId2);
            } else {
                this._doResize(rect);
            }
        } catch (e) {
            Logger.warn(`Skipping resize for "${this.title}"`, e);
        }
    }

    isOverrideActive() {
        if (this.unmanaged) return false;
        return this.controller._authorizedOverrides && this.controller._authorizedOverrides.has(this.window);
    }

    _doResize(rect) {
        try {
            this._isResizing = true;
            this.window.move_resize_frame(
                false,
                Math.round(rect.x),
                Math.round(rect.y),
                Math.round(rect.width),
                Math.round(rect.height)
            );
            const laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._isResizing = false;
                return false;
            });
            this._pendingLaters.push(laterId);
        } catch (e) {
            this._isResizing = false;
            Logger.warn(`Resize failed for "${this.title}"`, e);
        }
    }
}
