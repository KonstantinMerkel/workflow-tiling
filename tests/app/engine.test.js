import { describe, it, expect } from 'vitest';
import { Engine } from '../../lib/app/engine/engine.js';
import { ALL_WORKSPACES, Direction, Mode, location } from '../../lib/domain/types.js';
import {
    DEFAULT_LAYOUTS,
    FakeDisplayPort,
    FakeIndicator,
    FakeWindowPort,
    makeConfig,
    monitor,
} from '../helpers/fakes.js';

const LEFT_HALF = { x: 0, y: 0, width: 500, height: 1000 };
const RIGHT_HALF = { x: 500, y: 0, width: 500, height: 1000 };
const FULL = { x: 0, y: 0, width: 1000, height: 1000 };

function setup({ monitors, onlyPrimary = false, layouts = DEFAULT_LAYOUTS, selfMaximize, focusPolicy, hotplugPolicy } = {}) {
    const display = new FakeDisplayPort(
        monitors ?? [monitor('DP-1', 0, 0, { primary: true }), monitor('DP-2', 1, 1000)],
        { workspacesOnlyOnPrimary: onlyPrimary },
    );
    const windows = new FakeWindowPort(display);
    const indicator = new FakeIndicator();
    const config = makeConfig(layouts, { selfMaximize, focusPolicy, hotplugPolicy });
    const engine = new Engine({ windowPort: windows, displayPort: display, indicator, config });
    const open = (id, overrides = {}) => {
        windows.add(id, overrides);
        engine.onWindowAppeared(windows.facts(id));
        display.flushLaters();
    };
    return { display, windows, engine, indicator, open };
}

const DP1 = location(1, 'DP-1');
const DP2 = location(1, 'DP-2');

describe('arrival and layout', () => {
    it('tiles arriving windows by insertion order', () => {
        const { windows, engine, open } = setup();
        open(1);
        expect(windows.facts(1).frame).toEqual(FULL);
        open(2);
        expect(engine.state.slotsAt(DP1)).toEqual([1, 2]);
        expect(windows.facts(1).frame).toEqual(LEFT_HALF);
        expect(windows.facts(2).frame).toEqual(RIGHT_HALF);
    });

    it('ignores untilable and minimized windows', () => {
        const { engine, open } = setup();
        open(1, { tilable: false });
        open(2, { minimized: true });
        expect(engine.view.records()).toEqual([]);
    });

    it('floats windows beyond the maximum and promotes them when a slot frees up', () => {
        const { windows, engine, display, open } = setup();
        [1, 2, 3, 4].forEach((id) => open(id));
        expect(engine.state.record(4).mode).toBe(Mode.FLOATING);
        expect(windows.callsOf('setFrame', 4)).toEqual([]);

        engine.onWindowGone(1);
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([2, 3, 4]);
        expect(engine.state.record(4).mode).toBe(Mode.TILED);
    });

    it('stops issuing frames once requests are settled', () => {
        const { windows, display, open } = setup();
        open(1);
        open(2);
        const count = windows.callsOf('setFrame').length;
        display.flushLaters();
        expect(windows.callsOf('setFrame').length).toBe(count);
    });

    it('leaves a constrained client at its settled size', () => {
        const { windows, display, open } = setup();
        windows.constrain = (frame) => ({ ...frame, width: frame.width - 7 });
        open(1);
        open(2);
        const count = windows.callsOf('setFrame').length;
        display.flushLaters();
        expect(windows.callsOf('setFrame').length).toBe(count);
        expect(windows.facts(1).frame.width).toBe(493);
    });

    it('reverts external moves and resizes every time', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        for (let i = 0; i < 2; i++) {
            windows.set(1, { frame: { x: 33, y: 33, width: 100, height: 100 } });
            engine.onFrameChanged(1, true);
            display.flushLaters();
            expect(windows.facts(1).frame).toEqual(FULL);
        }
    });

    it('schedules no pass for the answer to a request', () => {
        const { windows, engine, display, open } = setup();
        windows.constrain = (frame) => ({ ...frame, width: 10 }); // the client answers after the follow-up pass
        open(1);
        windows.constrain = (frame) => frame;
        windows.set(1, { frame: FULL });
        engine.onFrameChanged(1, true);
        expect(display.pendingLaters).toBe(0);

        windows.set(1, { frame: { x: 33, y: 33, width: 100, height: 100 } }); // someone else
        engine.onFrameChanged(1, true);
        expect(display.pendingLaters).toBe(1);
    });

    it('computes the initial frame for a window about to be mapped without re-requesting it', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        windows.add(2);
        engine.onWindowAppeared(windows.facts(2));
        expect(engine.initialFrame(2)).toEqual(RIGHT_HALF);
        windows.set(2, { frame: RIGHT_HALF });
        display.flushLaters();
        expect(windows.callsOf('setFrame', 2)).toEqual([]);
    });
});

describe('minimize', () => {
    it('frees the slot on minimize and appends on unminimize', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.onMinimizedChanged(windows.set(1, { minimized: true }));
        display.flushLaters();
        expect(engine.state.has(1)).toBe(false);
        expect(windows.facts(2).frame).toEqual(FULL);

        engine.onMinimizedChanged(windows.set(1, { minimized: false }));
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([2, 1]);
    });
});

describe('moves', () => {
    it('swaps with the neighbouring tile', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.moveDirection(1, Direction.RIGHT);
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([2, 1]);
        expect(windows.facts(1).frame).toEqual(RIGHT_HALF);
    });

    it('enters the neighbouring monitor through its facing edge', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        open(3, { monitor: 'DP-2' });
        engine.moveDirection(2, Direction.RIGHT);
        display.flushLaters();
        expect(engine.state.slotsAt(DP2)).toEqual([2, 3]); // left edge of the 2-layout is slot 0
        expect(windows.callsOf('moveToMonitor', 2)).toEqual([{ name: 'moveToMonitor', id: 2, arg: 1 }]);
        expect(windows.facts(2).monitor).toBe('DP-2');
        expect(windows.facts(1).frame).toEqual(FULL);
    });

    it('floats a window moved by keyboard onto a full monitor', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        [2, 3, 4].forEach((id) => open(id, { monitor: 'DP-2' }));
        engine.moveDirection(1, Direction.RIGHT);
        display.flushLaters();
        expect(engine.state.record(1)).toMatchObject({ location: DP2, mode: Mode.FLOATING });
        expect(windows.facts(1).monitor).toBe('DP-2');
    });

    it('moves a floating window to the neighbouring monitor, taking a slot there when free', () => {
        const { windows, engine, display, open } = setup();
        [1, 2, 3, 4].forEach((id) => open(id));
        expect(engine.state.record(4).mode).toBe(Mode.FLOATING);
        engine.moveDirection(4, Direction.RIGHT);
        display.flushLaters();
        expect(engine.state.slotsAt(DP2)).toEqual([4]);
        expect(windows.facts(4).frame).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 });
    });

    it('floats a window moved by Mutter onto a full monitor', () => {
        const { windows, engine, open } = setup();
        open(1);
        [2, 3, 4].forEach((id) => open(id, { monitor: 'DP-2' }));
        engine.onWindowMoved(windows.set(1, { monitor: 'DP-2' }));
        expect(engine.state.record(1)).toMatchObject({ location: DP2, mode: Mode.FLOATING });
    });

    it('treats echoes of its own moves as no-ops', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        engine.moveDirection(1, Direction.RIGHT);
        display.flushLaters();
        engine.onWindowMoved(windows.facts(1));
        expect(engine.state.slotsAt(DP2)).toEqual([1]);
    });

    it('appends a window moved to another workspace', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        open(3, { workspace: 2 });
        engine.onWindowMoved(windows.set(1, { workspace: 2 }));
        display.flushLaters();
        expect(engine.state.slotsAt(location(2, 'DP-1'))).toEqual([3, 1]);
        expect(engine.state.slotsAt(DP1)).toEqual([2]);
    });

    it('focuses the neighbour, then the edging slot of the next monitor', () => {
        const { windows, engine, open } = setup();
        open(1);
        open(2);
        open(3, { monitor: 'DP-2' });
        engine.focusDirection(1, Direction.RIGHT);
        engine.focusDirection(2, Direction.RIGHT);
        expect(windows.callsOf('activate').map((c) => c.id)).toEqual([2, 3]);
    });

    it('switches the content of two monitors', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2, { monitor: 'DP-2' });
        engine.switchMonitors(1);
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([2]);
        expect(windows.facts(1).monitor).toBe('DP-2');
        expect(windows.facts(2).monitor).toBe('DP-1');
    });
});

describe('overrides', () => {
    it('toggles maximise through the state and back to the tile', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        expect(windows.facts(1).maximized).toBe(true);

        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        expect(windows.facts(1).maximized).toBe(false);
        expect(windows.facts(1).frame).toEqual(LEFT_HALF);
    });

    it('reverts an external maximise', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        windows.set(1, { maximized: true, frame: { x: 0, y: 0, width: 1, height: 1 } });
        engine.onModeChanged(windows.facts(1));
        display.flushLaters();
        expect(windows.facts(1)).toMatchObject({ maximized: false, frame: FULL });
    });

    it('clears neighbour overrides when a window arrives', () => {
        const { engine, display, open } = setup();
        open(1);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        open(2);
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
    });

    it('uses the native toggle for floating windows', () => {
        const { windows, engine, open } = setup();
        [1, 2, 3, 4].forEach((id) => open(id));
        engine.toggleOverride(4, 'fullscreen');
        expect(windows.callsOf('toggleNative', 4)).toHaveLength(1);
    });
});

describe('hotplug', () => {
    it('evacuates on unplug, ignores the consequences, and restores to the same EDID', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2, { monitor: 'DP-2' });
        open(3, { monitor: 'DP-2' });
        const office = display.monitors[1];

        engine.onTopologyChanging();
        display.monitors = [display.monitors[0]];
        engine.onWindowMoved(windows.set(2, { monitor: 'DP-1' }));
        engine.onWindowMoved(windows.set(3, { monitor: 'DP-1' }));
        engine.onTopologyChanged();
        display.flushLaters();

        expect(engine.state.slotsAt(DP1)).toEqual([1]);
        expect(engine.state.record(3).evacuated).toMatchObject({ slot: 1, connector: 'DP-2' });
        expect(windows.facts(2).minimized).toBe(true);
        expect(windows.facts(1).frame).toEqual(FULL);

        engine.onTopologyChanging();
        display.monitors = [display.monitors[0], { ...office, id: 'DP-7' }];
        engine.onTopologyChanged();
        display.flushLaters();

        expect(engine.state.slotsAt(location(1, 'DP-7'))).toEqual([2, 3]);
        expect(windows.facts(3)).toMatchObject({ monitor: 'DP-7', minimized: false });
    });

    it('forgets evacuated windows of a removed workspace; they stay minimized on redock', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2, { workspace: 3, monitor: 'DP-2' });
        const office = display.monitors[1];
        engine.onTopologyChanging();
        display.monitors = [display.monitors[0]];
        engine.onWindowMoved(windows.set(2, { monitor: 'DP-1' }));
        engine.onTopologyChanged();
        display.flushLaters();

        // Fixed workspace count lowered: Mutter moves window 2 to the last remaining workspace, then removes 3
        engine.onWindowMoved(windows.set(2, { workspace: 2 }));
        engine.onWorkspaceRemoved(3);
        expect(engine.state.has(2)).toBe(false);

        windows.calls = [];
        engine.onTopologyChanging();
        display.monitors = [display.monitors[0], office];
        engine.onTopologyChanged();
        display.flushLaters();
        expect(windows.calls.filter((c) => c.id === 2)).toEqual([]);
        expect(windows.facts(2).minimized).toBe(true);

        engine.onMinimizedChanged(windows.set(2, { minimized: false })); // the user takes it back
        expect(engine.state.record(2)).toMatchObject({ location: location(2, 'DP-1'), evacuated: null });
    });

    it('catches up on workspaces removed while suspended', () => {
        const { windows, engine, display, open } = setup();
        open(1, { workspace: 3, monitor: 'DP-2' });
        engine.onTopologyChanging();
        display.monitors = [display.monitors[0]];
        engine.onTopologyChanged();
        display.flushLaters();

        engine.suspend();
        windows.set(1, { workspace: 2 });
        display.removedWorkspaces = [3];
        engine.resync(windows.all());
        expect(engine.state.has(1)).toBe(false);
    });

    it('lets a restored floating window take a free slot', () => {
        const { windows, engine, display, open } = setup();
        [1, 2, 3, 4].forEach((id) => open(id, { monitor: 'DP-2' }));
        const office = display.monitors[1];
        engine.onTopologyChanging();
        display.monitors = [display.monitors[0]];
        engine.onTopologyChanged();
        display.flushLaters();
        windows.windows.delete(1);
        engine.onWindowGone(1); // one window closes while its monitor is unplugged

        engine.onTopologyChanging();
        display.monitors = [display.monitors[0], office];
        engine.onTopologyChanged();
        display.flushLaters();
        expect(engine.state.slotsAt(DP2)).toEqual([2, 3, 4]);
        expect(engine.state.record(4).mode).toBe(Mode.TILED);
    });

    it('lets the user take an evacuated window back by unminimizing it', () => {
        const { windows, engine, display, open } = setup();
        open(1, { monitor: 'DP-2' });
        engine.onTopologyChanging();
        display.monitors = [display.monitors[0]];
        windows.set(1, { monitor: 'DP-1' });
        engine.onTopologyChanged();
        display.flushLaters();

        engine.onMinimizedChanged(windows.set(1, { minimized: false }));
        display.flushLaters();
        expect(engine.state.record(1)).toMatchObject({ location: DP1, evacuated: null, mode: Mode.TILED });
    });

    it('follows the primary monitor through undock and redock', () => {
        const laptop = monitor('eDP-1', 0, 0);
        const external = monitor('DP-6', 1, 1000, { primary: true });
        const { windows, engine, display, open } = setup({ monitors: [laptop, external], hotplugPolicy: 'follow-primary' });
        const onExternal = { monitor: 'DP-6' };
        open(1, onExternal);
        open(2, onExternal);
        open(3);
        const LAPTOP = location(1, 'eDP-1');
        const EXTERNAL = location(1, 'DP-6');

        engine.onTopologyChanging();
        display.monitors = [{ ...laptop, primary: true }];
        engine.onTopologyChanged();
        display.flushLaters();
        expect(engine.state.slotsAt(LAPTOP)).toEqual([1, 2]);
        expect(windows.facts(1)).toMatchObject({ monitor: 'eDP-1', frame: LEFT_HALF });
        expect(engine.state.record(3).evacuated).toMatchObject({ connector: 'eDP-1', slot: 0 });
        expect(windows.facts(3).minimized).toBe(true);

        open(4); // opened while undocked: a primary window
        expect(engine.state.slotsAt(LAPTOP)).toEqual([1, 2, 4]);

        engine.onTopologyChanging();
        display.monitors = [laptop, external];
        engine.onTopologyChanged();
        display.flushLaters();
        expect(engine.state.slotsAt(EXTERNAL)).toEqual([1, 2, 4]);
        expect(engine.state.slotsAt(LAPTOP)).toEqual([3]);
        expect(windows.facts(4).monitor).toBe('DP-6');
        expect(windows.facts(3)).toMatchObject({ monitor: 'eDP-1', minimized: false, frame: FULL });
    });

    it('re-keys monitors whose primary role changed with workspaces-only-on-primary', () => {
        const { engine, display, open } = setup({ onlyPrimary: true });
        open(1);
        open(2, { monitor: 'DP-2', workspace: ALL_WORKSPACES });
        engine.onTopologyChanging();
        display.monitors = display.monitors.map((m) => ({ ...m, primary: m.id === 'DP-2' }));
        engine.onTopologyChanged();
        display.flushLaters();
        expect(engine.state.slotsAt(location(ALL_WORKSPACES, 'DP-1'))).toEqual([1]);
        expect(engine.state.slotsAt(location(1, 'DP-2'))).toEqual([2]);
        expect(engine.state.slotsAt(DP1)).toEqual([]);
    });

    it('keeps ignoring window moves until the first flush after the change', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        engine.onTopologyChanging();
        engine.onTopologyChanged();
        engine.onWindowMoved(windows.set(1, { monitor: 'DP-2' }));
        expect(engine.state.record(1).location).toEqual(DP1);
        display.flushLaters();
        expect(engine.topologyChanging).toBe(false);
        expect(windows.facts(1).monitor).toBe('DP-1');
    });
});

describe('workspaces', () => {
    it('re-keys secondary monitors when workspaces-only-on-primary is turned off', () => {
        const { windows, engine, display, open } = setup({ onlyPrimary: true });
        open(1, { monitor: 'DP-2', workspace: ALL_WORKSPACES });
        open(2, { monitor: 'DP-2', workspace: ALL_WORKSPACES });
        display.onlyPrimary = false;
        engine.onWorkspaceModeChanged();
        expect(engine.state.slotsAt(location(1, 'DP-2'))).toEqual([1, 2]);

        display.onlyPrimary = true;
        engine.onWindowMoved(windows.facts(1));
        expect(engine.state.slotsAt(location(ALL_WORKSPACES, 'DP-2'))).toEqual([1, 2]);
    });

    it('marks windows on all workspaces dirty when the active workspace changes', () => {
        const { windows, engine, display, open } = setup({ onlyPrimary: true });
        open(1, { monitor: 'DP-2', workspace: ALL_WORKSPACES });
        windows.set(1, { frame: { x: 1, y: 1, width: 1, height: 1 } });
        display.active = 2;
        engine.onActiveWorkspaceChanged();
        display.flushLaters();
        expect(windows.facts(1).frame).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 });
    });

    it('closes and unminimizes from facts, then activates slot 0', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        windows.add(3, { minimized: true });
        engine.unminimizeWorkspace();
        expect(windows.callsOf('unminimize', 3)).toHaveLength(1);
        expect(windows.callsOf('activate').at(-1).id).toBe(1);

        engine.closeWorkspace();
        display.flushLaters();
        expect(windows.callsOf('close').map((c) => c.id)).toEqual([1, 2, 3]);
    });
});

describe('configuration and resync', () => {
    it('demotes the tail when the escalator shrinks and promotes when it grows', () => {
        const { engine, open } = setup();
        [1, 2, 3].forEach((id) => open(id));
        const two = JSON.stringify({ 1: JSON.parse(DEFAULT_LAYOUTS)[1], 2: JSON.parse(DEFAULT_LAYOUTS)[2] });
        engine.applyConfig(makeConfig(two));
        expect(engine.state.slotsAt(DP1)).toEqual([1, 2]);
        expect(engine.state.record(3).mode).toBe(Mode.FLOATING);

        engine.applyConfig(makeConfig());
        expect(engine.state.slotsAt(DP1)).toEqual([1, 2, 3]);
    });

    it('resync drops vanished windows and adds new ones in creation order', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.suspend();
        windows.windows.delete(1);
        windows.add(5, { sequence: 5 });
        windows.add(4, { sequence: 4 });
        engine.resync(windows.all());
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([2, 4, 5]);
    });

    it('does not flush while suspended', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        engine.suspend();
        windows.set(1, { frame: { x: 9, y: 9, width: 9, height: 9 } });
        engine.markDirty(DP1);
        expect(display.pendingLaters).toBe(0);
    });
});

describe('drag', () => {
    it('renders the preview through the Reconciler and commits on drop', () => {
        const { windows, engine, display, indicator, open } = setup();
        open(1);
        open(2);
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 750, y: 500 });
        display.flushLaters();
        expect(windows.facts(2).frame).toEqual(LEFT_HALF); // neighbour previews the swap
        expect(indicator.frame).toEqual(RIGHT_HALF);
        expect(engine.state.slotsAt(DP1)).toEqual([1, 2]); // live state untouched

        windows.set(1, { frame: { x: 700, y: 400, width: 500, height: 1000 } });
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([2, 1]);
        expect(windows.facts(1).frame).toEqual(RIGHT_HALF);
        expect(indicator.visible).toBe(false);
    });

    it('snaps a tile back after a drag without a target', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 100, y: 100 });
        windows.set(1, { frame: { x: 200, y: 200, width: 1000, height: 1000 } });
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(windows.facts(1).frame).toEqual(FULL);
    });

    it('drops onto another monitor, floating when it is full', () => {
        const { engine, display, open } = setup();
        open(1);
        open(2);
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 1500, y: 500 });
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(engine.state.slotsAt(DP2)).toEqual([1]);

        [3, 4].forEach((id) => open(id, { monitor: 'DP-2' }));
        engine.onGrabBegin(2, 'move');
        engine.onPointerMoved({ x: 1500, y: 500 });
        engine.onGrabEnd(2, 'move');
        expect(engine.state.record(2)).toMatchObject({ location: DP2, mode: Mode.FLOATING });
    });

    it('ends a maximise override when the window is dragged', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        engine.onGrabBegin(1, 'move');
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
        engine.onModeChanged(windows.set(1, { maximized: false, maximizedFully: false })); // Mutter unmaximizes on drag
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(windows.facts(1)).toMatchObject({ maximized: false, frame: LEFT_HALF });
    });

    it('schedules no pass for pointer moves that keep the drop target', () => {
        const { engine, display, open } = setup();
        open(1);
        open(2);
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 750, y: 500 });
        display.flushLaters();
        engine.onPointerMoved({ x: 760, y: 520 }); // same swap target
        expect(display.pendingLaters).toBe(0);
        engine.onPointerMoved({ x: 100, y: 500 }); // back over its own tile: no target
        expect(display.pendingLaters).toBe(1);
    });

    it('retiles other monitors when a window closes mid-drag', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        [3, 4].forEach((id) => open(id, { monitor: 'DP-2' }));
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 100, y: 100 });
        engine.onWindowGone(4);
        display.flushLaters();
        expect(windows.facts(3).frame).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 });
    });

    it('opens a window in its tile mid-drag', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(3, { monitor: 'DP-2' });
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 100, y: 100 });
        windows.add(2, { monitor: 'DP-2' });
        engine.onWindowAppeared(windows.facts(2));
        expect(engine.initialFrame(2)).toEqual({ x: 1500, y: 0, width: 500, height: 1000 });
        display.flushLaters();
        expect(windows.facts(3).frame).toEqual({ x: 1000, y: 0, width: 500, height: 1000 });
    });

    it('floats the drop when the target fills up mid-drag', () => {
        const { engine, display, open } = setup();
        open(1);
        open(2);
        [3, 4].forEach((id) => open(id, { monitor: 'DP-2' }));
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 1500, y: 500 });
        expect(engine.drag.target()).toMatchObject({ kind: 'relocate', location: DP2 });
        expect(engine.drag.target().slot).not.toBeNull();

        open(5, { monitor: 'DP-2' });
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(engine.state.slotsAt(DP2)).toEqual([3, 4, 5]);
        expect(engine.state.record(1)).toMatchObject({ location: DP2, mode: Mode.FLOATING });
    });

    it('drops a swap whose partner closed mid-drag', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 750, y: 500 });
        expect(engine.drag.target()).toEqual({ kind: 'swap', other: 2 });

        engine.onWindowGone(2);
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([1]);
        expect(windows.facts(1).frame).toEqual(FULL);
    });

    it('snaps back after a manual resize', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        engine.onGrabBegin(1, 'resize');
        windows.set(1, { frame: { x: 0, y: 0, width: 300, height: 300 } });
        engine.onFrameChanged(1, true);
        engine.onGrabEnd(1, 'resize');
        display.flushLaters();
        expect(windows.facts(1).frame).toEqual(FULL);
    });
});

describe('maximization', () => {
    const FIREFOX = { appId: 'firefox.desktop', wmClass: 'firefox' };
    const allowFirefox = { mode: 'allow-listed', allowList: ['firefox'], blockList: [] };
    const MAXIMIZED_FACTS = { maximized: true, maximizedFully: true };

    it('unmaximizes with Super+Down and never maximizes with it', () => {
        const { engine, display, open } = setup();
        open(1);
        engine.toggleOverride(1, 'unmaximize');
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        engine.toggleOverride(1, 'unmaximize');
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
    });

    it('keeps a self-maximization of an allowed app and reverts the others', () => {
        const { windows, engine, display, open } = setup({ selfMaximize: allowFirefox });
        open(1, { app: FIREFOX });
        open(2);
        engine.onModeChanged(windows.set(1, MAXIMIZED_FACTS));
        engine.onModeChanged(windows.set(2, MAXIMIZED_FACTS));
        display.flushLaters();
        expect(engine.state.record(1).mode).toBe(Mode.MAXIMIZED);
        expect(windows.facts(1).maximized).toBe(true);
        expect(engine.state.record(2).mode).toBe(Mode.TILED);
        expect(windows.facts(2).maximized).toBe(false);

        engine.onModeChanged(windows.set(1, { maximized: false, maximizedFully: false })); // the app unmaximizes
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
    });

    it('keeps fullscreen of an allowed app and treats half-tiling as tiled', () => {
        const { windows, engine, open } = setup({ selfMaximize: allowFirefox });
        open(1, { app: FIREFOX });
        engine.onModeChanged(windows.set(1, { fullscreen: true }));
        expect(engine.state.record(1).mode).toBe(Mode.FULLSCREEN);
        engine.onModeChanged(windows.set(1, { fullscreen: false, maximized: true, maximizedFully: false }));
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
    });

    it('lets an allowed app open maximized', () => {
        const { engine, open } = setup({ selfMaximize: allowFirefox, focusPolicy: 'keep' });
        open(1, { app: FIREFOX, ...MAXIMIZED_FACTS });
        open(2, MAXIMIZED_FACTS);
        expect(engine.state.record(1).mode).toBe(Mode.MAXIMIZED);
        expect(engine.state.record(2).mode).toBe(Mode.TILED);
    });

    it('ignores the intermediate states of its own mode commands', () => {
        const { windows, engine, display, open } = setup({ selfMaximize: allowFirefox, focusPolicy: 'keep' });
        open(1, { app: FIREFOX });
        engine.toggleOverride(1, 'fullscreen');
        display.flushLaters();
        windows.set(1, { maximized: true, maximizedFully: true }); // fullscreen on top of a maximization
        windows.onSetMode = (_id, facts) => engine.onModeChanged(facts); // unfullscreened, still maximized
        engine.toggleOverride(1, 'fullscreen');
        display.flushLaters();
        expect(engine.state.record(1).mode).toBe(Mode.TILED);
        expect(windows.facts(1)).toMatchObject({ maximized: false, fullscreen: false });
    });

    it('applies the focus policy when another window of the layout gains focus', () => {
        for (const [policy, expected] of [
            ['keep', [Mode.MAXIMIZED, Mode.TILED]],
            ['unmaximize', [Mode.TILED, Mode.TILED]],
            ['pass-on', [Mode.TILED, Mode.MAXIMIZED]],
        ]) {
            const { engine, display, open } = setup({ focusPolicy: policy });
            open(1);
            open(2);
            engine.toggleOverride(1, 'maximize');
            display.flushLaters();
            engine.onFocusChanged(2);
            expect([engine.state.record(1).mode, engine.state.record(2).mode]).toEqual(expected);
        }
    });

    it('keeps one maximized window per layout when another one maximizes', () => {
        const { windows, engine, display, open } = setup({ selfMaximize: allowFirefox });
        open(1);
        open(2, { app: FIREFOX });
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        engine.onModeChanged(windows.set(2, { fullscreen: true })); // the browser goes fullscreen itself
        display.flushLaters();
        expect([engine.state.record(1).mode, engine.state.record(2).mode]).toEqual([Mode.TILED, Mode.FULLSCREEN]);

        engine.toggleOverride(1, 'maximize'); // and back by shortcut
        display.flushLaters();
        expect([engine.state.record(1).mode, engine.state.record(2).mode]).toEqual([Mode.MAXIMIZED, Mode.TILED]);
    });

    it('corrects half-tiling of a maximized window', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        engine.onModeChanged(windows.set(1, { maximized: true, maximizedFully: false })); // half-tiled by Mutter
        display.flushLaters();
        expect(windows.facts(1)).toMatchObject({ maximized: true, maximizedFully: true });
        expect(windows.callsOf('setMode', 1).map((c) => c.arg)).toEqual([Mode.MAXIMIZED, Mode.MAXIMIZED]);
    });

    it('applies the focus rule only when a request actually changes the mode', () => {
        const { engine, display, open } = setup({ focusPolicy: 'keep' });
        open(1);
        open(2);
        engine.toggleOverride(1, 'fullscreen');
        engine.toggleOverride(2, 'maximize');
        display.flushLaters();
        engine.config = { ...engine.config, focusPolicy: 'unmaximize' };
        engine.toggleOverride(1, 'unmaximize'); // Super+Down on the fullscreen window: no change
        expect([engine.state.record(1).mode, engine.state.record(2).mode]).toEqual([Mode.FULLSCREEN, Mode.MAXIMIZED]);
    });

    it('keeps the override of a maximized window that was only clicked', () => {
        const { windows, engine, display, open } = setup({ focusPolicy: 'keep' });
        open(1);
        open(2);
        engine.toggleOverride(1, 'maximize');
        engine.toggleOverride(2, 'fullscreen');
        display.flushLaters();
        engine.config = { ...engine.config, focusPolicy: 'unmaximize' };
        engine.onGrabBegin(1, 'move'); // a click on the title bar: Mutter never unmaximizes
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect([engine.state.record(1).mode, engine.state.record(2).mode]).toEqual([Mode.MAXIMIZED, Mode.FULLSCREEN]);
        expect(windows.facts(1).maximizedFully).toBe(true);
    });

    it('maximizes a maximized window dragged back onto the top edge', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        engine.onGrabBegin(1, 'move');
        engine.onModeChanged(windows.set(1, { maximized: false, maximizedFully: false })); // dragged loose
        engine.onModeChanged(windows.set(1, MAXIMIZED_FACTS)); // dropped on the top edge
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(engine.state.record(1).mode).toBe(Mode.MAXIMIZED);
    });

    it('applies the focus policy to arrivals', () => {
        const { engine, display, open } = setup({ focusPolicy: 'pass-on' });
        open(1);
        engine.toggleOverride(1, 'maximize');
        display.flushLaters();
        open(2);
        expect([engine.state.record(1).mode, engine.state.record(2).mode]).toEqual([Mode.TILED, Mode.MAXIMIZED]);
    });

    it('maximizes a tile dropped on the top screen edge instead of swapping it', () => {
        const { windows, engine, display, open } = setup();
        open(1);
        open(2);
        engine.onGrabBegin(1, 'move');
        engine.onPointerMoved({ x: 750, y: 0 }); // over the neighbour's tile, at the top edge
        engine.onModeChanged(windows.set(1, MAXIMIZED_FACTS)); // Mutter maximizes before the grab ends
        engine.onGrabEnd(1, 'move');
        display.flushLaters();
        expect(engine.state.slotsAt(DP1)).toEqual([1, 2]);
        expect(engine.state.record(1).mode).toBe(Mode.MAXIMIZED);
        expect(windows.facts(1).maximized).toBe(true);
    });
});
