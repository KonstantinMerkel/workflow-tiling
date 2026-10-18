import { describe, it, expect } from 'vitest';
import { TilingState } from '../../lib/domain/tiling-state.js';
import { Topology } from '../../lib/domain/topology.js';
import { entrySlot } from '../../lib/domain/entry-slot.js';
import { planHotplug } from '../../lib/domain/policies/hotplug.js';
import { toggledMode, overridesClearedByArrival } from '../../lib/domain/policies/override.js';
import { ALL_WORKSPACES, Direction, Mode, location, opposite } from '../../lib/domain/types.js';
import { makeConfig, monitor } from '../helpers/fakes.js';

const { escalator } = makeConfig();
const A = location(1, 'DP-1');

describe('types', () => {
    it('opposite', () => {
        expect(opposite(Direction.LEFT)).toBe(Direction.RIGHT);
        expect(opposite(Direction.UP)).toBe(Direction.DOWN);
    });
});

describe('entrySlot', () => {
    it('appends, uses the escalated edging slot, or a clamped preferred slot', () => {
        const state = new TilingState();
        expect(entrySlot(state.view(), escalator, A)).toBe(0);
        state.place(1, 1, A, Mode.TILED);
        expect(entrySlot(state.view(), escalator, A)).toBe(1);
        // two windows → right edge of the 2-layout is slot 1, left edge slot 0
        expect(entrySlot(state.view(), escalator, A, { edge: Direction.LEFT })).toBe(0);
        expect(entrySlot(state.view(), escalator, A, { preferred: 9 })).toBe(1);
    });

    it('returns null when the location holds the maximum', () => {
        const state = new TilingState();
        [1, 2, 3].forEach((id) => state.place(id, id, A, Mode.TILED));
        expect(entrySlot(state.view(), escalator, A, { preferred: 0 })).toBeNull();
    });
});

describe('Topology', () => {
    const topology = new Topology(
        [monitor('eDP-1', 0, 0, { primary: true }), monitor('DP-1', 1, 1000), monitor('DP-2', 2, 2000)],
        true,
    );

    it('finds monitors by direction and point', () => {
        expect(topology.inDirection('eDP-1', Direction.RIGHT)).toBe('DP-1');
        expect(topology.inDirection('DP-1', Direction.LEFT)).toBe('eDP-1');
        expect(topology.inDirection('eDP-1', Direction.LEFT)).toBeNull();
        expect(topology.monitorAt({ x: 1500, y: 10 })).toBe('DP-1');
        expect(topology.monitorAt({ x: 5000, y: 10 })).toBeNull();
    });

    it('names the edge a window enters through', () => {
        expect(topology.edgeBetween('eDP-1', 'DP-1')).toBe(Direction.LEFT);
        expect(topology.edgeBetween('DP-1', 'eDP-1')).toBe(Direction.RIGHT);
    });

    it('decides the workspace key per monitor', () => {
        expect(topology.locationFor(4, 'eDP-1')).toEqual(location(4, 'eDP-1'));
        expect(topology.locationFor(4, 'DP-1')).toEqual(location(ALL_WORKSPACES, 'DP-1'));
        expect(new Topology(topology.monitors, false).locationFor(4, 'DP-1')).toEqual(location(4, 'DP-1'));
    });
});

describe('planHotplug', () => {
    const laptop = monitor('eDP-1', 0, 0, { primary: true });
    const office = monitor('DP-3', 1, 1000, { edid: 'EDID:DEL:U27:111' });

    function evacuatedState(edid, connector) {
        const state = new TilingState();
        state.place(1, 1, location(1, 'DP-3'), Mode.TILED);
        state.evacuate(1, edid, connector);
        return state;
    }

    it('evacuates windows of vanished monitors with their identity', () => {
        const state = new TilingState();
        state.place(1, 1, location(1, 'DP-3'), Mode.TILED);
        state.place(2, 2, location(1, 'eDP-1'), Mode.TILED);
        const plan = planHotplug(state.view(), new Topology([laptop, office]), new Topology([laptop]));
        expect(plan.evacuate).toEqual([{ id: 1, edid: 'EDID:DEL:U27:111', connector: 'DP-3' }]);
        expect(plan.restore).toEqual([]);
    });

    it('restores to the same EDID under a different connector', () => {
        const state = evacuatedState('EDID:DEL:U27:111', 'DP-3');
        const renamed = { ...office, id: 'DP-5' };
        const plan = planHotplug(state.view(), new Topology([laptop]), new Topology([laptop, renamed]));
        expect(plan.restore).toEqual([{ id: 1, monitorId: 'DP-5' }]);
    });

    it('never restores to a different monitor on the same connector', () => {
        const state = evacuatedState('EDID:DEL:U27:111', 'DP-3');
        const other = { ...office, edid: 'EDID:LG:27UK:999' };
        expect(planHotplug(state.view(), new Topology([laptop]), new Topology([laptop, other])).restore).toEqual([]);
    });

    it('lets the connector decide between identical twins and without EDID', () => {
        const twinA = { ...office, id: 'DP-3' };
        const twinB = { ...office, id: 'DP-4', index: 2 };
        const state = evacuatedState('EDID:DEL:U27:111', 'DP-4');
        const plan = planHotplug(state.view(), new Topology([laptop]), new Topology([laptop, twinA, twinB]));
        expect(plan.restore).toEqual([{ id: 1, monitorId: 'DP-4' }]);

        const noEdid = evacuatedState('CONNECTOR:DP-3', 'DP-3');
        expect(planHotplug(noEdid.view(), new Topology([laptop]), new Topology([laptop, office])).restore).toEqual([
            { id: 1, monitorId: 'DP-3' },
        ]);
    });
});

describe('override rules', () => {
    it('toggles between tiled and the requested override', () => {
        expect(toggledMode(Mode.TILED, 'maximize')).toBe(Mode.MAXIMIZED);
        expect(toggledMode(Mode.MAXIMIZED, 'maximize')).toBe(Mode.TILED);
        expect(toggledMode(Mode.MAXIMIZED, 'fullscreen')).toBe(Mode.FULLSCREEN);
    });

    it('clears overrides of neighbours when a window arrives', () => {
        const state = new TilingState();
        state.place(1, 1, A, Mode.MAXIMIZED);
        state.place(2, 2, A, Mode.TILED);
        state.place(3, 3, A, Mode.TILED);
        expect(overridesClearedByArrival(state.view(), A, 3)).toEqual([1]);
    });
});
