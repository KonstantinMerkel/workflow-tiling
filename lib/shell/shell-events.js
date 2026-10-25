import Gio from 'gi://Gio';
import { Logger, describeFrame } from '../utils/logger.js';

/** MetaGrabOp flag bits (the flag enum is not introspected). */
const GRAB_WINDOW_BASE = 0x0001;
const GRAB_FLAG_UNKNOWN = 0x0200;
const GRAB_DIR_MASK = 0xf000;

/** @returns {'move'|'resize'|null} */
export function classifyGrab(op) {
    if (!(op & GRAB_WINDOW_BASE)) return null;
    return op & GRAB_DIR_MASK || op & GRAB_FLAG_UNKNOWN ? 'resize' : 'move';
}

/**
 * Owns every signal connection (global and per-window) and calls the matching Engine event method.
 */
export class ShellEvents {
    /**
     * @param {object} deps
     * @param {object} deps.windowPort MutterWindowPort
     * @param {object} deps.displayPort MutterDisplayPort
     * @param {object} deps.engine Engine
     */
    constructor({ windowPort, displayPort, engine }) {
        this._windowPort = windowPort;
        this._displayPort = displayPort;
        this._engine = engine;
        this._global = []; // { object, id }
        this._perWindow = new Map(); // WindowId -> { window, ids }
        this._grab = null; // { id, kind }
        this._mutterSettings = null;
    }

    /** Registers existing windows and connects all signals. */
    bind() {
        for (const window of global.display.list_all_windows()) this._addWindow(window);
        Logger.debug(`ShellEvents: bound, ${this._perWindow.size} existing windows registered`);

        const display = global.display;
        this._connect(display, 'window-created', (_display, window) => this._addWindow(window));
        this._connect(display, 'grab-op-begin', (_display, window, op) => this._onGrabBegin(window, op));
        this._connect(display, 'grab-op-end', (_display, window, op) => this._onGrabEnd(window, op));
        this._connect(display, 'workareas-changed', () => this._engine.onWorkAreasChanged());
        this._connect(display, 'notify::focus-window', () =>
            this._engine.onFocusChanged(this._windowPort.idOf(display.get_focus_window())),
        );

        const workspaces = global.workspace_manager;
        this._connect(workspaces, 'active-workspace-changed', () => this._engine.onActiveWorkspaceChanged());
        // Lowering a fixed workspace count removes workspaces without workspace-removed, only notify::n-workspaces
        const syncWorkspaces = () => {
            for (const token of this._displayPort.syncWorkspaces()) this._engine.onWorkspaceRemoved(token);
        };
        this._connect(workspaces, 'workspace-removed', syncWorkspaces);
        this._connect(workspaces, 'notify::n-workspaces', syncWorkspaces);

        const monitors = global.backend.get_monitor_manager();
        this._connect(monitors, 'monitors-changing', () => this._engine.onTopologyChanging());
        this._connect(monitors, 'monitors-changed', () => this._engine.onTopologyChanged());

        this._mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
        this._connect(this._mutterSettings, 'changed::workspaces-only-on-primary', () =>
            this._engine.onWorkspaceModeChanged(),
        );
    }

    unbind() {
        Logger.debug('ShellEvents: unbound');
        for (const { object, id } of this._global) object.disconnect(id);
        this._global = [];
        for (const id of [...this._perWindow.keys()]) this._removeWindow(id);
        this._grab = null;
        this._mutterSettings = null;
    }

    _connect(object, signal, callback) {
        const id = object.connect(signal, (...args) => this._guard(signal, () => callback(...args)));
        this._global.push({ object, id });
    }

    /** Logs an exception with the signal that caused it instead of letting it vanish in the signal emission. */
    _guard(context, fn) {
        try {
            return fn();
        } catch (e) {
            Logger.error(`ShellEvents: handler for ${context} failed`, e);
            return undefined;
        }
    }

    /** Synchronous: the initial `configure` follows window-created. */
    _addWindow(window) {
        const id = this._windowPort.register(window);
        if (this._perWindow.has(id)) return;
        Logger.debug(`ShellEvents: window ${id} registered "${window.get_title() ?? ''}" type ${window.get_window_type()}`);

        const facts = () => this._windowPort.facts(id);
        const moved = () => this._engine.onWindowMoved(facts());
        // After `unmanaging` only `unmanaged` is forwarded: signals of a closing window must not re-add it.
        const entry = { window, ids: [], dying: false };
        const on = (signal, handler) =>
            window.connect(signal, (...args) => {
                if (entry.dying && signal !== 'unmanaged') return;
                this._guard(`${signal} of window ${id}`, () => handler(...args));
            });
        const ids = [
            on('configure', (_window, config) => this._onConfigure(id, config)),
            on('shown', () => this._engine.onWindowAppeared(facts())),
            on('unmanaging', () => {
                entry.dying = true;
                this._engine.onWindowGone(id);
            }),
            on('unmanaged', () => this._removeWindow(id)),
            on('notify::main-monitor', moved),
            on('workspace-changed', moved),
            on('notify::on-all-workspaces', moved),
            on('notify::skip-taskbar', moved),
            on('notify::minimized', () => this._engine.onMinimizedChanged(facts())),
            on('notify::maximized-horizontally', () => this._engine.onModeChanged(facts())),
            on('notify::maximized-vertically', () => this._engine.onModeChanged(facts())),
            on('notify::fullscreen', () => this._engine.onModeChanged(facts())),
            on('size-changed', () => this._onFrameChanged(id, true)),
            on('position-changed', () => this._onFrameChanged(id, false)),
        ];
        entry.ids = ids;
        this._perWindow.set(id, entry);
    }

    _removeWindow(id) {
        const entry = this._perWindow.get(id);
        if (entry) {
            for (const signalId of entry.ids) {
                try {
                    entry.window.disconnect(signalId);
                } catch (e) {
                    Logger.debug(`ShellEvents: disconnect on finalized window ${id}: ${e.message}`);
                }
            }
            this._perWindow.delete(id);
        }
        this._windowPort.unregister(id);
    }

    /** Initial configure: the window is placed and opens directly in its tile. */
    _onConfigure(id, config) {
        if (!config.get_is_initial()) return;
        this._engine.onWindowAppeared(this._windowPort.facts(id));
        const frame = this._engine.initialFrame(id);
        Logger.debug(`ShellEvents: initial configure of window ${id}, frame ${describeFrame(frame)}`);
        if (!frame) return;
        // Integer setters: set_rect takes MtkRectangle by value, which is not passed reliably through GJS.
        config.set_position(frame.x, frame.y);
        config.set_size(frame.width, frame.height);
    }

    /** Frame changes of the grabbed window never reach onFrameChanged. */
    _onFrameChanged(id, sizeChanged) {
        if (this._grab?.id === id) {
            if (this._grab.kind === 'move' && !sizeChanged) this._engine.onPointerMoved(this._displayPort.pointer());
            return;
        }
        this._engine.onFrameChanged(id, sizeChanged);
    }

    _onGrabBegin(window, op) {
        const kind = classifyGrab(op);
        const id = this._windowPort.idOf(window);
        if (!kind || id === null) return;
        this._grab = { id, kind };
        this._engine.onGrabBegin(id, kind);
    }

    _onGrabEnd(window, op) {
        const kind = classifyGrab(op);
        const id = this._windowPort.idOf(window);
        this._grab = null;
        if (!kind || id === null) return;
        this._engine.onGrabEnd(id, kind);
    }
}
