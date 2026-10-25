import { Topology } from '../../lib/domain/topology.js';
import { LayoutParser } from '../../lib/domain/layout/parser.js';
import { ALL_WORKSPACES } from '../../lib/domain/types.js';

export const DEFAULT_LAYOUTS = JSON.stringify({
    1: [{ x: 0, y: 0, w: 100, h: 100, id: 0 }],
    2: [
        { x: 0, y: 0, w: 50, h: 100, id: 0 },
        { x: 50, y: 0, w: 50, h: 100, id: 1 },
    ],
    3: [
        { x: 0, y: 0, w: 50, h: 100, id: 0 },
        { x: 50, y: 0, w: 50, h: 50, id: 1 },
        { x: 50, y: 50, w: 50, h: 50, id: 2 },
    ],
});

export const DEFAULT_SELF_MAXIMIZE = { mode: 'never', allowList: [], blockList: [] };

export function makeConfig(
    layouts = DEFAULT_LAYOUTS,
    { gaps = { inner: 0, outer: 0 }, selfMaximize = DEFAULT_SELF_MAXIMIZE, focusPolicy = 'unmaximize',
        hotplugPolicy = 'restore-by-monitor',
    } = {},
) {
    return { gaps, escalator: LayoutParser.parse(layouts), selfMaximize, focusPolicy, hotplugPolicy };
}

export function monitor(id, index, x, { primary = false, width = 1000, height = 1000, edid = null } = {}) {
    return { id, edid: edid ?? `EDID:V:${id}:1`, index, geometry: { x, y: 0, width, height }, primary };
}

/** Display port with a manual frame queue (`flushLaters`). Work area = monitor geometry. */
export class FakeDisplayPort {
    constructor(monitors, { workspacesOnlyOnPrimary = false, active = 1 } = {}) {
        this.monitors = monitors;
        this.onlyPrimary = workspacesOnlyOnPrimary;
        this.active = active;
        this.current = monitors[0]?.id ?? null;
        this._laters = new Map();
        this._nextLater = 1;
    }

    topology() {
        return new Topology(this.monitors, this.onlyPrimary);
    }

    workspacesOnlyOnPrimary() {
        return this.onlyPrimary;
    }

    workArea(_workspace, index) {
        const m = this.monitors.find((mon) => mon.index === index);
        return { ...m.geometry };
    }

    activeWorkspace() {
        return this.active;
    }

    currentMonitorId() {
        return this.current;
    }

    pointer() {
        return { x: 0, y: 0 };
    }

    beforeRedraw(callback) {
        const id = this._nextLater++;
        this._laters.set(id, callback);
        return id;
    }

    cancelLater(id) {
        this._laters.delete(id);
    }

    get pendingLaters() {
        return this._laters.size;
    }

    /** Runs queued frame callbacks (and those they queue) until none are left. */
    flushLaters(max = 20) {
        for (let i = 0; i < max && this._laters.size > 0; i++) {
            const callbacks = [...this._laters.values()];
            this._laters.clear();
            callbacks.forEach((cb) => cb());
        }
    }
}

/**
 * Window port emulating Mutter synchronously: commands change the facts immediately. `constrain` lets a test model
 * clients that settle on a different size.
 */
export class FakeWindowPort {
    constructor(displayPort) {
        this.displayPort = displayPort;
        this.windows = new Map();
        this.calls = [];
        this.constrain = (frame) => frame;
    }

    add(id, overrides = {}) {
        const facts = {
            id,
            sequence: id,
            tilable: true,
            workspace: 1,
            monitor: this.displayPort.monitors[0].id,
            minimized: false,
            maximized: false,
            maximizedFully: false,
            fullscreen: false,
            frame: { x: 0, y: 0, width: 10, height: 10 },
            app: { appId: null, wmClass: null },
            ...overrides,
        };
        this.windows.set(id, facts);
        return { ...facts };
    }

    set(id, patch) {
        Object.assign(this.windows.get(id), patch);
        return this.facts(id);
    }

    facts(id) {
        const f = this.windows.get(id);
        return f ? { ...f, frame: { ...f.frame } } : null;
    }

    all() {
        return [...this.windows.keys()].map((id) => this.facts(id));
    }

    idOf(window) {
        return window?.id ?? null;
    }

    callsOf(name, id = undefined) {
        return this.calls.filter((c) => c.name === name && (id === undefined || c.id === id));
    }

    _record(name, id, arg) {
        this.calls.push({ name, id, arg });
    }

    setFrame(id, frame) {
        this._record('setFrame', id, frame);
        if (this.windows.has(id)) this.windows.get(id).frame = this.constrain({ ...frame }, id);
    }

    moveToMonitor(id, index) {
        this._record('moveToMonitor', id, index);
        const m = this.displayPort.monitors.find((mon) => mon.index === index);
        if (this.windows.has(id) && m) Object.assign(this.windows.get(id), { monitor: m.id });
    }

    changeWorkspace(id, key) {
        this._record('changeWorkspace', id, key);
        if (this.windows.has(id)) this.windows.get(id).workspace = key;
    }

    /** `onSetMode(id, facts)` runs between the two steps of a mode command, as Mutter's notifications do. */
    setMode(id, mode) {
        this._record('setMode', id, mode);
        const f = this.windows.get(id);
        if (!f) return;
        f.fullscreen = mode === 'fullscreen';
        this.onSetMode?.(id, this.facts(id));
        f.maximized = mode === 'maximized';
        f.maximizedFully = f.maximized;
    }

    appOf(id) {
        return this.windows.get(id)?.app ?? null;
    }

    toggleNative(id, kind) {
        this._record('toggleNative', id, kind);
    }

    minimize(id) {
        this._record('minimize', id);
        if (this.windows.has(id)) this.windows.get(id).minimized = true;
    }

    unminimize(id) {
        this._record('unminimize', id);
        if (this.windows.has(id)) this.windows.get(id).minimized = false;
    }

    activate(id) {
        this._record('activate', id);
    }

    close(id) {
        this._record('close', id);
    }
}

export class FakeIndicator {
    constructor() {
        this.visible = false;
        this.frame = null;
    }

    show(frame) {
        this.visible = true;
        this.frame = frame;
    }

    hide() {
        this.visible = false;
    }

    destroy() {}
}

export { ALL_WORKSPACES };
