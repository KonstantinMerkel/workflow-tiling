import Meta from 'gi://Meta';
import { ALL_WORKSPACES, Mode } from '../domain/types.js';

const TILABLE_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.UTILITY];

/**
 * The only holder of Meta.Window objects: reads live facts and executes commands. Caches no placement and makes no
 * decisions. Commands for unknown ids are no-ops.
 */
export class MutterWindowPort {
    /**
     * @param {object} displayPort MutterDisplayPort (workspace tokens)
     * @param {number} shellMajor GNOME Shell major version; Meta.Window.get_min_size / get_max_size exist from 50
     */
    constructor(displayPort, shellMajor) {
        this._displayPort = displayPort;
        this._hasSizeHints = shellMajor >= 50;
        this._windows = new Map(); // WindowId -> Meta.Window
    }

    register(window) {
        const id = window.get_id();
        this._windows.set(id, window);
        return id;
    }

    unregister(id) {
        this._windows.delete(id);
    }

    /** @returns {number|null} id of a registered window */
    idOf(window) {
        if (!window) return null;
        const id = window.get_id();
        return this._windows.has(id) ? id : null;
    }

    /**
     * Plain snapshot of what Mutter reports about one window.
     * @returns {object|null} WindowFacts
     */
    facts(id) {
        const window = this._windows.get(id);
        if (!window) return null;

        const onAllWorkspaces = window.is_on_all_workspaces();
        const workspacesApply = !Meta.prefs_get_workspaces_only_on_primary() || window.is_on_primary_monitor();
        const userSticky = onAllWorkspaces && workspacesApply;
        const frame = window.get_frame_rect();

        return {
            id,
            sequence: window.get_stable_sequence(),
            tilable: TILABLE_TYPES.includes(window.get_window_type()) && !window.is_skip_taskbar() && !userSticky,
            userSticky,
            workspace: onAllWorkspaces ? ALL_WORKSPACES : this._displayPort.workspaceKey(window.get_workspace()),
            monitor: connectorOf(window.main_monitor),
            monitorIndex: window.get_monitor(),
            minimized: window.minimized,
            maximized: window.maximized_horizontally || window.maximized_vertically,
            fullscreen: window.is_fullscreen(),
            frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
            sizeLimits: this._sizeLimits(window, frame),
        };
    }

    /**
     * Frame size limits from the client's size hints, `null` where unknown. A window that cannot be resized is
     * limited to its current size. Maximized and fullscreen windows report no limits: allows_resize() is false for
     * them regardless of the client.
     * @returns {{min: {width:number, height:number}|null, max: {width:number, height:number}|null}}
     */
    _sizeLimits(window, frame) {
        if (window.maximized_horizontally || window.maximized_vertically || window.is_fullscreen()) {
            return { min: null, max: null };
        }
        if (!window.allows_resize()) {
            const current = { width: frame.width, height: frame.height };
            return { min: current, max: current };
        }
        if (!this._hasSizeHints) return { min: null, max: null };

        // Size hints are client sizes; the decoration difference converts them to frame sizes.
        const client = window.frame_rect_to_client_rect(frame);
        const toFrame = ([known, width, height]) =>
            known ? { width: width + frame.width - client.width, height: height + frame.height - client.height } : null;
        return { min: toFrame(window.get_min_size()), max: toFrame(window.get_max_size()) };
    }

    /** @returns {Array} WindowFacts of every registered window */
    all() {
        return [...this._windows.keys()].map((id) => this.facts(id)).filter(Boolean);
    }

    setFrame(id, frame) {
        this._windows.get(id)?.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
    }

    moveToMonitor(id, index) {
        this._windows.get(id)?.move_to_monitor(index);
    }

    changeWorkspace(id, workspaceKey) {
        const workspace = this._displayPort.workspace(workspaceKey);
        if (workspace) this._windows.get(id)?.change_workspace(workspace);
    }

    setMode(id, mode) {
        const window = this._windows.get(id);
        if (!window) return;
        const maximized = window.maximized_horizontally || window.maximized_vertically;
        switch (mode) {
            case Mode.TILED:
                if (window.is_fullscreen()) window.unmake_fullscreen();
                if (maximized) window.unmaximize();
                break;
            case Mode.MAXIMIZED:
                if (window.is_fullscreen()) window.unmake_fullscreen();
                window.maximize();
                break;
            case Mode.FULLSCREEN:
                window.make_fullscreen();
                break;
        }
    }

    /** Mutter's own toggle, for windows without a slot. */
    toggleNative(id, kind) {
        const window = this._windows.get(id);
        if (!window) return;
        if (kind === 'fullscreen') {
            if (window.is_fullscreen()) window.unmake_fullscreen();
            else window.make_fullscreen();
        } else if (window.maximized_horizontally || window.maximized_vertically) {
            window.unmaximize();
        } else {
            window.maximize();
        }
    }

    minimize(id) {
        this._windows.get(id)?.minimize();
    }

    unminimize(id) {
        this._windows.get(id)?.unminimize();
    }

    activate(id) {
        this._windows.get(id)?.activate(global.get_current_time());
    }

    close(id) {
        this._windows.get(id)?.delete(global.get_current_time());
    }

    destroy() {
        this._windows.clear();
    }
}

/** Connector of the first physical monitor of a MetaLogicalMonitor. */
function connectorOf(logicalMonitor) {
    return logicalMonitor?.get_monitors()[0]?.get_connector() ?? null;
}
