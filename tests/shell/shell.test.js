import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import { Logger } from '../../lib/utils/logger.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { classifyGrab, ShellEvents } from '../../lib/shell/shell-events.js';
import { GSettingsConfigSource } from '../../lib/shell/config-source.js';
import { MutterWindowPort } from '../../lib/shell/window-port.js';
import { MaximizeButtonHider, withoutMaximize } from '../../lib/shell/button-layout.js';
import { MutterDisplayPort } from '../../lib/shell/display-port.js';
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
        set_strv: vi.fn((k, v) => {
            store[k] = v;
        }),
        connect: (signal, cb) => {
            (listeners[signal] ??= []).push(cb);
            return signal;
        },
        disconnect: vi.fn((id) => delete listeners[id]),
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
        is_maximized: () => false,
        allows_resize: () => true,
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
        'hotplug-policy': 'follow-primary',
    };

    it('builds a config snapshot and keeps the last valid one on invalid JSON', () => {
        const settings = fakeSettings(base);
        const source = new GSettingsConfigSource(settings);
        expect(source.isValid()).toBe(true);
        expect(source.current().gaps).toEqual({ inner: 6, outer: 4 });
        expect(source.current().hotplugPolicy).toBe('follow-primary');
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
        expect(port.facts(1)).toMatchObject({ tilable: false, workspace: ALL_WORKSPACES });

        Meta.prefs_get_workspaces_only_on_primary.mockReturnValueOnce(true);
        port.register(fakeWindow(2, { is_on_all_workspaces: () => true, is_on_primary_monitor: () => false }));
        expect(port.facts(2)).toMatchObject({ tilable: true, workspace: ALL_WORKSPACES });
    });

    it('reports size limits as frame sizes on GNOME 50', () => {
        const port = new MutterWindowPort(displayPort, 50);
        port.register(
            fakeWindow(1, {
                frame_rect_to_client_rect: () => ({ x: 1, y: 2, width: 1, height: 2 }),
                get_min_size: () => [true, 100, 50],
                get_max_size: () => [false, 0, 0],
            }),
        );
        expect(port.facts(1).sizeLimits).toEqual({ min: { width: 102, height: 52 }, max: null });
    });

    it('limits a non-resizable window to its size and reports none for maximized ones', () => {
        const port = new MutterWindowPort(displayPort, 49);
        port.register(fakeWindow(1, { allows_resize: () => false }));
        port.register(fakeWindow(2, { allows_resize: () => false, maximized_horizontally: true }));
        port.register(fakeWindow(3));
        const size = { width: 3, height: 4 };
        expect(port.facts(1).sizeLimits).toEqual({ min: size, max: size });

        port.register(fakeWindow(4, { allows_resize: () => false, get_frame_rect: () => ({ x: 0, y: 0, width: 0, height: 0 }) }));
        expect(port.facts(4).sizeLimits).toEqual({ min: null, max: null }); // not on screen yet
        expect(port.facts(2).sizeLimits).toEqual({ min: null, max: null });
        expect(port.facts(3).sizeLimits).toEqual({ min: null, max: null });
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

    it('reports removed workspaces on workspace-removed and on notify::n-workspaces', () => {
        const engine = { onWorkspaceRemoved: vi.fn() };
        const displayPort = { syncWorkspaces: vi.fn().mockReturnValueOnce([3]).mockReturnValueOnce([4, 5]) };
        const events = new ShellEvents({ windowPort: {}, displayPort, engine });
        const handlers = {};
        events._connect = (_object, signal, callback) => (handlers[signal] = callback);
        events.bind();

        handlers['workspace-removed']();
        handlers['notify::n-workspaces'](); // a lowered fixed workspace count emits only this
        expect(engine.onWorkspaceRemoved.mock.calls).toEqual([[3], [4], [5]]);
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

describe('KeybindingAdapter', () => {
    const windowPort = { idOf: (w) => w?.get_id() ?? null };
    const bound = () => Main.wm.addKeybinding.mock.calls.map(([key]) => key);
    let warn;

    beforeEach(() => {
        Main.wm.addKeybinding.mockClear();
        Main.wm.removeKeybinding.mockClear();
        Meta.keybindings_set_custom_handler.mockClear();
        warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        // mockReset brings back a vi.fn's own implementation; restoreAllMocks undoes the spies
        Main.wm.addKeybinding.mockReset();
        Gio.SettingsSchemaSource.get_default.mockReset();
        vi.restoreAllMocks();
    });

    it('binds its own shortcuts and takes over only the native window-state actions', () => {
        const engine = { toggleOverride: vi.fn(), moveDirection: vi.fn() };
        const adapter = new KeybindingAdapter({ settings: fakeSettings({}), engine, windowPort });
        adapter.bind();

        const handlers = Object.fromEntries(Meta.keybindings_set_custom_handler.mock.calls);
        expect(Object.keys(handlers).sort()).toEqual(['maximize', 'toggle-fullscreen', 'toggle-maximized', 'unmaximize']);
        handlers['toggle-maximized'](null, fakeWindow(3));
        expect(engine.toggleOverride).toHaveBeenCalledWith(3, 'maximize');

        const bindings = Object.fromEntries(Main.wm.addKeybinding.mock.calls.map(([key, , , , cb]) => [key, cb]));
        expect(Object.keys(bindings)).toEqual(expect.arrayContaining(['move-window-left', 'focus-window-down', 'shortcut-close-monitor']));
        expect(Object.keys(bindings).some((key) => key.startsWith('custom-'))).toBe(false); // own keys are never bound directly
        bindings['move-window-left'](null, fakeWindow(3));
        expect(engine.moveDirection).toHaveBeenCalledWith(3, 'left');

        adapter.unbind();
        expect(Meta.keybindings_set_custom_handler).toHaveBeenLastCalledWith(expect.any(String), null);
        expect(Main.wm.removeKeybinding).toHaveBeenCalledWith('move-window-left');
    });

    it('writes the keys of each mode into the bound keys, from anywhere and without touching own keys', () => {
        const settings = fakeSettings({ 'keybindings-mode': 'none', 'custom-move-window-up': ['<Super>k'] });
        const adapter = new KeybindingAdapter({ settings, engine: {}, windowPort });
        expect(settings.get_strv('move-window-up')).toEqual([]);

        settings.store['keybindings-mode'] = 'super-arrows'; // e.g. gsettings set, prefs closed
        settings.emit('keybindings-mode');
        expect(settings.store['move-window-up']).toEqual(['<Super>Up']);
        expect(settings.store['custom-move-window-up']).toEqual(['<Super>k']);

        settings.store['keybindings-mode'] = 'custom';
        settings.emit('keybindings-mode');
        expect(settings.store['move-window-up']).toEqual(['<Super>k']);
        settings.store['custom-move-window-up'] = ['<Super>i'];
        settings.emit('custom-move-window-up');
        expect(settings.store['move-window-up']).toEqual(['<Super>i']);

        adapter.destroy();
        settings.store['keybindings-mode'] = 'none';
        settings.emit('keybindings-mode');
        expect(settings.store['move-window-up']).toEqual(['<Super>i']); // no longer listening
    });

    it('sets a bound key written from outside back to its mode, and leaves a matching one alone', () => {
        const settings = fakeSettings({ 'keybindings-mode': 'super-arrows' });
        new KeybindingAdapter({ settings, engine: {}, windowPort });
        settings.set_strv.mockClear();

        settings.store['move-window-up'] = []; // gsettings reset
        settings.emit('move-window-up');
        expect(settings.store['move-window-up']).toEqual(['<Super>Up']);
        expect(settings.set_strv).toHaveBeenCalledTimes(1);

        settings.emit('move-window-up'); // the change signal of that write
        expect(settings.set_strv).toHaveBeenCalledTimes(1);
    });

    it('never records, and so never removes, a binding whose name another extension holds', () => {
        Main.wm.addKeybinding.mockImplementation((key) => (key === 'move-window-left' ? Meta.KeyBindingAction.NONE : 7));
        const adapter = new KeybindingAdapter({ settings: fakeSettings({}), engine: {}, windowPort });
        adapter.bind();
        adapter.unbind();
        const removed = Main.wm.removeKeybinding.mock.calls.map(([key]) => key);
        expect(removed).not.toContain('move-window-left');
        expect(removed).toContain('move-window-right');
    });

    it('logs keys GNOME or another of its own shortcuts also uses, once per change of the keys', () => {
        Gio.SettingsSchemaSource.get_default.mockReturnValue({
            lookup: (id) =>
                id === 'org.gnome.desktop.wm.keybindings'
                    ? {
                          list_keys: () => ['toggle-tiled-left'],
                          get_key: () => ({ get_value_type: () => ({ dup_string: () => 'as' }), get_summary: () => 'View split on left' }),
                      }
                    : null,
        });
        vi.spyOn(Gio, 'Settings').mockImplementation(function ({ schema_id: schemaId }) {
            return { schema_id: schemaId, get_strv: () => ['<Super>Left'] };
        });
        const settings = fakeSettings({ 'keybindings-mode': 'super-shift-arrows', 'focus-window-mode': 'super-shift-arrows' });
        settings.store['shortcut-close-monitor'] = ['<Super>Left'];
        const adapter = new KeybindingAdapter({ settings, engine: {}, windowPort });
        adapter.bind();
        expect(warn).toHaveBeenCalledWith('Shortcut move-window-left (<Shift><Super>left) is also used by focus-window-left');
        expect(warn).toHaveBeenCalledWith('Shortcut shortcut-close-monitor (<Super>left) is also used by View split on left (GNOME)');

        warn.mockClear();
        adapter.bind(); // unlock: keys unchanged, nothing read or logged again
        expect(warn).not.toHaveBeenCalled();

        settings.store['shortcut-close-workspace'] = ['<Super>Left'];
        settings.emit('shortcut-close-workspace');
        expect(warn).toHaveBeenCalledWith(
            'Shortcut shortcut-close-workspace (<Super>left) is also used by shortcut-close-monitor, View split on left (GNOME)',
        );
    });

    it('keeps its bindings when the conflict check fails', () => {
        Gio.SettingsSchemaSource.get_default.mockImplementation(() => {
            throw new Error('broken schema');
        });
        const settings = fakeSettings({ 'keybindings-mode': 'super-arrows' });
        const adapter = new KeybindingAdapter({ settings, engine: {}, windowPort });
        expect(() => adapter.bind()).not.toThrow();
        expect(bound()).toContain('move-window-left');
        expect(warn).toHaveBeenCalledWith('Failed to check shortcuts for conflicts', expect.any(Error));
    });
});

describe('MaximizeButtonHider', () => {
    const LAYOUT = 'appmenu:minimize,maximize,close';
    const setup = (hide, saved = '') => {
        const settings = fakeSettings({ 'hide-maximize-button': hide, 'saved-button-layout': saved });
        const wm = fakeSettings({ 'button-layout': LAYOUT });
        wm.set_string = vi.fn((k, v) => {
            wm.store[k] = v;
            wm.emit(k);
        });
        return { settings, wm, hider: new MaximizeButtonHider(settings, wm) };
    };

    it('removes only the maximize button', () => {
        expect(withoutMaximize(LAYOUT)).toBe('appmenu:minimize,close');
        expect(withoutMaximize('close,maximize:')).toBe('close:');
        expect(withoutMaximize('appmenu:close')).toBe('appmenu:close');
    });

    it('hides while enabled and restores the original on disable', () => {
        const { settings, wm, hider } = setup(true);
        hider.enable();
        expect(wm.store['button-layout']).toBe('appmenu:minimize,close');
        expect(settings.store['saved-button-layout']).toBe(LAYOUT);
        hider.disable();
        expect(wm.store['button-layout']).toBe(LAYOUT);
        expect(settings.store['saved-button-layout']).toBe('');
    });

    it('follows the toggle and keeps a layout the user sets while hidden', () => {
        const { settings, wm, hider } = setup(false);
        hider.enable();
        expect(wm.store['button-layout']).toBe(LAYOUT);
        settings.store['hide-maximize-button'] = true;
        settings.emit('hide-maximize-button');
        expect(wm.store['button-layout']).toBe('appmenu:minimize,close');

        wm.set_string('button-layout', 'close,maximize:');
        expect(wm.store['button-layout']).toBe('close:');
        expect(settings.store['saved-button-layout']).toBe('close,maximize:');
    });

    it('keeps a layout without maximize button set while hidden', () => {
        const { settings, wm, hider } = setup(true);
        hider.enable();
        wm.set_string('button-layout', 'close:');
        expect(settings.store['saved-button-layout']).toBe('close:');
        hider.disable();
        expect(wm.store['button-layout']).toBe('close:');
    });

    it('takes a value equal to its own earlier write as the user\'s once the echo has passed', () => {
        const { settings, wm, hider } = setup(true);
        hider.enable(); // writes 'appmenu:minimize,close'
        wm.set_string('button-layout', 'appmenu:minimize,close');
        expect(settings.store['saved-button-layout']).toBe('appmenu:minimize,close');
    });

    it('restores a layout left over by a crash once hiding is off', () => {
        const { settings, wm, hider } = setup(false, LAYOUT);
        wm.store['button-layout'] = 'appmenu:minimize,close';
        hider.enable();
        expect(wm.store['button-layout']).toBe(LAYOUT);
        expect(settings.store['saved-button-layout']).toBe('');
    });
});
