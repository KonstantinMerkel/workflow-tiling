import { describe, it, expect, vi, beforeEach } from 'vitest';
import Meta from 'gi://Meta';
import { classifyGrab, ShellEvents } from '../../lib/shell/shell-events.js';
import { GSettingsConfigSource } from '../../lib/shell/config-source.js';
import { MutterWindowPort } from '../../lib/shell/window-port.js';
import { MutterDisplayPort } from '../../lib/shell/display-port.js';
import { ShadowManager } from '../../lib/shell/shadows.js';
import { KeybindingAdapter } from '../../lib/shell/keybindings.js';
import { ALL_WORKSPACES, Mode } from '../../lib/domain/types.js';
import { DEFAULT_LAYOUTS } from '../helpers/fakes.js';

function fakeSettings(values) {
    const store = { ...values };
    const listeners = {};
    return {
        store,
        get_boolean: (k) => store[k],
        get_int: (k) => store[k],
        get_string: (k) => store[k] ?? '',
        set_string: vi.fn((k, v) => {
            store[k] = v;
        }),
        get_strv: (k) => store[k] ?? [],
        connect: (signal, cb) => {
            (listeners[signal] ??= []).push(cb);
            return signal;
        },
        disconnect: vi.fn(),
        emit: (key) => (listeners[`changed::${key}`] ?? []).forEach((cb) => cb()),
    };
}

function fakeMonitor(connector, vendor = 'DEL', product = 'U27', serial = '1') {
    return {
        get_connector: () => connector,
        get_vendor: () => vendor,
        get_product: () => product,
        get_serial: () => serial,
    };
}

function fakeWindow(id, overrides = {}) {
    const window = {
        get_id: () => id,
        get_title: () => `window ${id}`,
        get_stable_sequence: () => id,
        get_window_type: () => Meta.WindowType.NORMAL,
        is_skip_taskbar: () => false,
        is_on_all_workspaces: () => false,
        is_on_primary_monitor: () => true,
        get_workspace: () => 'ws-a',
        get_monitor: () => 0,
        main_monitor: { get_monitors: () => [fakeMonitor('DP-1')] },
        minimized: false,
        maximized_horizontally: false,
        maximized_vertically: false,
        is_fullscreen: () => false,
        get_frame_rect: () => ({ x: 1, y: 2, width: 3, height: 4 }),
        move_resize_frame: vi.fn(),
        unmaximize: vi.fn(),
        maximize: vi.fn(),
        unmake_fullscreen: vi.fn(),
        make_fullscreen: vi.fn(),
        connect: vi.fn(() => Math.random()),
        disconnect: vi.fn(),
        ...overrides,
    };
    return window;
}

describe('classifyGrab', () => {
    it('classifies by bit mask', () => {
        expect(classifyGrab(0x0001)).toBe('move'); // MOVING
        expect(classifyGrab(0x0401)).toBe('move'); // MOVING_UNCONSTRAINED
        expect(classifyGrab(0x0101)).toBe('move'); // KEYBOARD_MOVING
        expect(classifyGrab(0x6001)).toBe('resize'); // RESIZING_SE
        expect(classifyGrab(0x0301)).toBe('resize'); // KEYBOARD_RESIZING_UNKNOWN
        expect(classifyGrab(0)).toBeNull();
    });
});

describe('GSettingsConfigSource', () => {
    const base = {
        'enable-gaps': true,
        'inner-gaps': 6,
        'outer-gaps': 4,
        'debug-logging': false,
        'custom-layouts': DEFAULT_LAYOUTS,
    };

    it('builds a config snapshot and keeps the last valid one on invalid JSON', () => {
        const settings = fakeSettings(base);
        const source = new GSettingsConfigSource(settings);
        expect(source.isValid()).toBe(true);
        expect(source.current().gaps).toEqual({ inner: 6, outer: 4 });
        const valid = source.current();

        const invalid = vi.fn();
        source.onConfigInvalid(invalid);
        settings.store['custom-layouts'] = '{ bad';
        settings.emit('custom-layouts');
        expect(invalid).toHaveBeenCalled();
        expect(source.current()).toBe(valid);

        const changed = vi.fn();
        source.onConfigChanged(changed);
        settings.store['custom-layouts'] = DEFAULT_LAYOUTS;
        settings.store['enable-gaps'] = false;
        settings.emit('enable-gaps');
        expect(changed.mock.calls[0][0].gaps).toEqual({ inner: 0, outer: 0 });
    });

    it('reuses the escalator while the layout JSON is unchanged', () => {
        const settings = fakeSettings(base);
        const source = new GSettingsConfigSource(settings);
        const changed = vi.fn();
        source.onConfigChanged(changed);
        const escalator = source.current().escalator;

        settings.store['inner-gaps'] = 10;
        settings.emit('inner-gaps');
        expect(changed.mock.calls[0][0].escalator).toBe(escalator);

        settings.store['custom-layouts'] = JSON.stringify(JSON.parse(DEFAULT_LAYOUTS), null, 2); // same layouts, new text
        settings.emit('custom-layouts');
        expect(changed.mock.calls[1][0].escalator).not.toBe(escalator);
    });

    it('fires the keybinding callback separately', () => {
        const settings = fakeSettings(base);
        const source = new GSettingsConfigSource(settings);
        const rebind = vi.fn();
        source.onKeybindingsChanged(rebind);
        settings.emit('move-window-left');
        expect(rebind).toHaveBeenCalledTimes(1);
    });
});

describe('MutterWindowPort', () => {
    const displayPort = { workspaceKey: (ws) => (ws === 'ws-a' ? 7 : null), workspace: () => 'ws-a' };

    it('reports facts in domain vocabulary', () => {
        const port = new MutterWindowPort(displayPort);
        port.register(fakeWindow(1, { maximized_vertically: true }));
        expect(port.facts(1)).toMatchObject({
            id: 1,
            tilable: true,
            workspace: 7,
            monitor: 'DP-1',
            maximized: true,
            frame: { x: 1, y: 2, width: 3, height: 4 },
        });
    });

    it('treats user-sticky windows as untilable and monitor-sticky ones as ALL_WORKSPACES', () => {
        const port = new MutterWindowPort(displayPort);
        port.register(fakeWindow(1, { is_on_all_workspaces: () => true }));
        expect(port.facts(1)).toMatchObject({ userSticky: true, tilable: false, workspace: ALL_WORKSPACES });

        Meta.prefs_get_workspaces_only_on_primary.mockReturnValueOnce(true);
        port.register(fakeWindow(2, { is_on_all_workspaces: () => true, is_on_primary_monitor: () => false }));
        expect(port.facts(2)).toMatchObject({ userSticky: false, tilable: true, workspace: ALL_WORKSPACES });
    });

    it('executes commands only for known windows', () => {
        const port = new MutterWindowPort(displayPort);
        const window = fakeWindow(1, { maximized_horizontally: true });
        port.register(window);
        port.setMode(1, Mode.TILED);
        port.setFrame(1, { x: 1, y: 2, width: 3, height: 4 });
        port.setFrame(99, { x: 0, y: 0, width: 1, height: 1 });
        expect(window.unmaximize).toHaveBeenCalled();
        expect(window.move_resize_frame).toHaveBeenCalledWith(false, 1, 2, 3, 4);
        expect(port.idOf(fakeWindow(42))).toBeNull();
    });
});

describe('MutterDisplayPort', () => {
    beforeEach(() => {
        const logical = (connector, number, monitor) => ({
            get_number: () => number,
            get_monitors: () => [monitor ?? fakeMonitor(connector)],
        });
        global.backend = {
            get_monitor_manager: () => ({
                get_logical_monitors: () => [
                    logical('eDP-1', 0, fakeMonitor('eDP-1', 'unknown', 'x', 'y')),
                    logical('DP-1', 1),
                ],
            }),
        };
        global.display.get_primary_monitor = () => 0;
        global.display.get_monitor_geometry = (i) => ({ x: i * 1000, y: 0, width: 1000, height: 1000 });
    });

    it('builds a topology with connector ids and Mutter-style EDID ids', () => {
        const topology = new MutterDisplayPort().topology();
        expect(topology.monitors.map((m) => [m.id, m.edid, m.primary])).toEqual([
            ['eDP-1', 'CONNECTOR:eDP-1', true],
            ['DP-1', 'EDID:DEL:U27:1', false],
        ]);
    });

    it('assigns stable workspace tokens and reports removed ones', () => {
        const port = new MutterDisplayPort();
        const a = { index: () => 0 };
        const b = { index: () => 1 };
        expect(port.workspaceKey(a)).toBe(port.workspaceKey(a));
        const tokenB = port.workspaceKey(b);
        expect(port.workspace(tokenB)).toBe(b);

        global.workspace_manager.get_n_workspaces = () => 1;
        global.workspace_manager.get_workspace_by_index = () => a;
        expect(port.syncWorkspaces()).toEqual([tokenB]);
        expect(port.workspace(tokenB)).toBeNull();
    });
});

describe('ShellEvents', () => {
    it('places a window on its initial configure and hands Mutter the initial frame', () => {
        const engine = { onWindowAppeared: vi.fn(), initialFrame: vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 })) };
        const windowPort = { register: (w) => w.get_id(), facts: (id) => ({ id }), unregister: vi.fn() };
        const events = new ShellEvents({ windowPort, displayPort: {}, engine });
        const handlers = {};
        const window = fakeWindow(5, {
            connect: (signal, cb) => {
                handlers[signal] = cb;
                return signal;
            },
        });
        events._addWindow(window);

        const config = { get_is_initial: () => true, set_position: vi.fn(), set_size: vi.fn(), set_rect: vi.fn() };
        handlers.configure(window, config);
        expect(engine.onWindowAppeared).toHaveBeenCalledWith({ id: 5 });
        expect(config.set_position).toHaveBeenCalledWith(1, 2);
        expect(config.set_size).toHaveBeenCalledWith(3, 4);
        expect(config.set_rect).not.toHaveBeenCalled(); // MtkRectangle by value arrives as a garbage position
    });

    it('drops every signal of a closing window except unmanaged', () => {
        const engine = { onWindowGone: vi.fn(), onWindowMoved: vi.fn(), onMinimizedChanged: vi.fn() };
        const windowPort = { register: (w) => w.get_id(), facts: (id) => ({ id }), unregister: vi.fn() };
        const events = new ShellEvents({ windowPort, displayPort: {}, engine });
        const handlers = {};
        const window = fakeWindow(6, {
            connect: (signal, cb) => {
                handlers[signal] = cb;
                return signal;
            },
        });
        events._addWindow(window);

        handlers.unmanaging();
        handlers['notify::main-monitor']();
        handlers['notify::minimized']();
        handlers.unmanaged();
        expect(engine.onWindowGone).toHaveBeenCalledWith(6);
        expect(engine.onWindowMoved).not.toHaveBeenCalled();
        expect(engine.onMinimizedChanged).not.toHaveBeenCalled();
        expect(windowPort.unregister).toHaveBeenCalledWith(6);
    });

    it('routes frame changes of the grabbed window away from onFrameChanged', () => {
        const engine = { onGrabBegin: vi.fn(), onPointerMoved: vi.fn(), onFrameChanged: vi.fn(), onGrabEnd: vi.fn() };
        const windowPort = { idOf: (w) => w.get_id() };
        const events = new ShellEvents({ windowPort, displayPort: { pointer: () => ({ x: 9, y: 9 }) }, engine });
        events._onGrabBegin(fakeWindow(1), 0x0001);
        events._onFrameChanged(1, false);
        events._onFrameChanged(1, true);
        events._onFrameChanged(2, true);
        events._onGrabEnd(fakeWindow(1), 0x0001);
        expect(engine.onPointerMoved).toHaveBeenCalledWith({ x: 9, y: 9 });
        expect(engine.onFrameChanged.mock.calls).toEqual([[2, true]]);
        expect(engine.onGrabEnd).toHaveBeenCalledWith(1, 'move');
    });
});

describe('ShadowManager', () => {
    let settings;
    let native;

    beforeEach(() => {
        settings = fakeSettings({ 'shadowed-keybindings': '{}', 'move-window-left': ['<Super><Alt>Left'] });
        const nativeStore = { 'switch-to-workspace-1': ['<Super>1'], 'conflict-key': ['<Alt><Super>Left', '<Super>Up'] };
        native = {
            schema_id: 'org.gnome.desktop.wm.keybindings',
            list_keys: () => Object.keys(nativeStore),
            get_value: () => ({ get_type_string: () => 'as' }),
            get_strv: (k) => nativeStore[k],
            set_strv: vi.fn((k, v) => {
                nativeStore[k] = v;
            }),
        };
    });

    it('restores protected keys and keeps backups of schemas that are not installed', () => {
        settings.store['shadowed-keybindings'] = JSON.stringify({
            'org.gnome.desktop.wm.keybindings': { 'conflict-key': ['<Super>X'] },
            'org.example.missing': { foo: ['<Super>Y'] },
        });
        const shadows = new ShadowManager(settings, ['conflict-key']);
        shadows._nativeSchemas = [native];
        shadows.restoreAll();
        expect(native.set_strv).toHaveBeenCalledWith('conflict-key', ['<Super>X']);
        expect(JSON.parse(settings.store['shadowed-keybindings'])).toEqual({ 'org.example.missing': { foo: ['<Super>Y'] } });
    });

    it('normalizes accelerators', () => {
        const shadows = new ShadowManager(settings);
        expect(shadows._normalize('<Super><Alt>Left')).toBe('<Alt><Super>Left');
        expect(shadows._normalize('<Primary><Alt>t')).toBe('<Alt><Control>t');
        expect(shadows._normalize('<mod1><mod4>Right')).toBe('<Alt><Super>Right');
        expect(shadows._normalize(null)).toBe('');
    });

    it('backs up before shadowing, restores, and respects protected keys', () => {
        const shadows = new ShadowManager(settings);
        shadows._nativeSchemas = [native];
        shadows.shadowShortcuts(['move-window-left']);
        expect(native.set_strv).toHaveBeenCalledWith('conflict-key', ['<Super>Up']);
        expect(JSON.parse(settings.store['shadowed-keybindings'])['org.gnome.desktop.wm.keybindings']).toEqual({
            'conflict-key': ['<Alt><Super>Left', '<Super>Up'],
        });

        shadows.restoreAll();
        expect(native.set_strv).toHaveBeenLastCalledWith('conflict-key', ['<Alt><Super>Left', '<Super>Up']);
        expect(settings.store['shadowed-keybindings']).toBe('{}');

        const guarded = new ShadowManager(settings, ['conflict-key']);
        guarded._nativeSchemas = [native];
        native.set_strv.mockClear();
        guarded.shadowShortcuts(['move-window-left']);
        expect(native.set_strv).not.toHaveBeenCalled();
    });
});

describe('KeybindingAdapter', () => {
    it('takes over native window-state shortcuts and routes them to toggleOverride', () => {
        const settings = fakeSettings({ 'keybindings-mode': 'default', 'focus-window-mode': 'disabled', 'shadowed-keybindings': '{}' });
        const engine = { toggleOverride: vi.fn(), moveDirection: vi.fn() };
        const adapter = new KeybindingAdapter({ settings, engine, windowPort: { idOf: (w) => w?.get_id() ?? null } });
        Meta.keybindings_set_custom_handler.mockClear();
        adapter.bindAll();

        const handlers = Object.fromEntries(Meta.keybindings_set_custom_handler.mock.calls);
        expect(Object.keys(handlers)).toEqual(
            expect.arrayContaining(['toggle-tiled-left', 'toggle-tiled-right', 'maximize', 'toggle-maximized', 'toggle-fullscreen']),
        );
        handlers['toggle-maximized'](null, fakeWindow(3));
        handlers['toggle-tiled-left'](null, fakeWindow(3));
        expect(engine.toggleOverride).toHaveBeenCalledWith(3, 'maximize');
        expect(engine.moveDirection).toHaveBeenCalledWith(3, 'left');

        adapter.suspend();
        expect(Meta.keybindings_set_custom_handler).toHaveBeenLastCalledWith(expect.any(String), null);
    });
});
