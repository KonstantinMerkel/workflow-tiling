import { describe, it, expect } from 'vitest';
import { TilingState } from '../../lib/domain/tiling-state.js';
import { ALL_WORKSPACES, Mode, location } from '../../lib/domain/types.js';

const A = location(1, 'DP-1');
const B = location(1, 'DP-2');

function stateWith(ids, loc = A) {
    const state = new TilingState();
    ids.forEach((id) => state.place(id, id, loc, Mode.TILED));
    return state;
}

describe('TilingState', () => {
    it('places windows in slot order and floating windows outside the list', () => {
        const state = stateWith([1, 2]);
        state.place(3, 3, A, Mode.TILED, 0);
        state.place(4, 4, A, Mode.FLOATING);
        expect(state.slotsAt(A)).toEqual([3, 1, 2]);
        expect(state.slotOf(4)).toBe(-1);
        expect(state.floatingAt(A).map((r) => r.id)).toEqual([4]);
    });

    it('keys locations by value, not by object identity', () => {
        const state = stateWith([1]);
        expect(state.slotsAt(location(1, 'DP-1'))).toEqual([1]);
    });

    it('removes windows and closes the gap', () => {
        const state = stateWith([1, 2, 3]);
        expect(state.remove(2).id).toBe(2);
        expect(state.slotsAt(A)).toEqual([1, 3]);
        expect(state.has(2)).toBe(false);
    });

    it('relocates into a slot or as floating', () => {
        const state = stateWith([1, 2]);
        state.relocate(2, B, 0);
        expect(state.slotsAt(A)).toEqual([1]);
        expect(state.slotsAt(B)).toEqual([2]);
        expect(state.record(2).location).toEqual(B);

        state.relocate(1, B, null);
        expect(state.record(1).mode).toBe(Mode.FLOATING);
        expect(state.slotsAt(B)).toEqual([2]);

        state.relocate(1, A, 0);
        expect(state.record(1).mode).toBe(Mode.TILED);
    });

    it('swaps slots within and across locations', () => {
        const state = stateWith([1, 2, 3]);
        state.swap(1, 3);
        expect(state.slotsAt(A)).toEqual([3, 2, 1]);

        state.place(4, 4, B, Mode.TILED);
        state.swap(3, 4);
        expect(state.slotsAt(A)).toEqual([4, 2, 1]);
        expect(state.slotsAt(B)).toEqual([3]);
        expect(state.record(4).location).toEqual(A);
    });

    it('swaps whole monitors including floating windows', () => {
        const state = stateWith([1, 2]);
        state.place(3, 3, B, Mode.TILED);
        state.place(4, 4, A, Mode.FLOATING);
        state.swapMonitors(A, B);
        expect(state.slotsAt(A)).toEqual([3]);
        expect(state.slotsAt(B)).toEqual([1, 2]);
        expect(state.record(4).location).toEqual(B);
    });

    it('frees and reclaims slots when the mode changes to and from FLOATING', () => {
        const state = stateWith([1, 2]);
        state.setMode(1, Mode.FLOATING);
        expect(state.slotsAt(A)).toEqual([2]);
        state.setMode(1, Mode.MAXIMIZED);
        expect(state.slotsAt(A)).toEqual([2, 1]);
        state.setMode(1, Mode.TILED);
        expect(state.slotsAt(A)).toEqual([2, 1]);
    });

    it('evacuates with slot and identity, and restores into a slot or as floating', () => {
        const state = stateWith([1, 2]);
        state.evacuate(2, 'EDID:X', 'DP-1');
        expect(state.slotsAt(A)).toEqual([1]);
        expect(state.record(2).evacuated).toEqual({ slot: 1, edid: 'EDID:X', connector: 'DP-1' });
        expect(state.evacuated().map((r) => r.id)).toEqual([2]);
        expect(state.locations()).toEqual([A]);

        state.restore(2, B, 0);
        expect(state.record(2).evacuated).toBeNull();
        expect(state.slotsAt(B)).toEqual([2]);

        state.evacuate(1, null, 'DP-1');
        state.restore(1, B, null);
        expect(state.record(1).mode).toBe(Mode.FLOATING);
    });

    it('rekeys keeping order and merges by sequence', () => {
        const all = location(ALL_WORKSPACES, 'DP-2');
        const state = new TilingState();
        state.place(5, 5, all, Mode.TILED);
        state.place(2, 2, all, Mode.TILED);
        state.rekey(all, location(3, 'DP-2'));
        expect(state.slotsAt(location(3, 'DP-2'))).toEqual([5, 2]);
        expect(state.record(5).location).toEqual(location(3, 'DP-2'));

        state.place(1, 1, location(4, 'DP-2'), Mode.TILED);
        state.merge([location(3, 'DP-2'), location(4, 'DP-2')], all);
        expect(state.slotsAt(all)).toEqual([1, 2, 5]);
    });

    it('drops only empty lists of a removed workspace', () => {
        const state = stateWith([1]);
        state.remove(1);
        state.dropWorkspace(1);
        expect(state.locations()).toEqual([]);
    });

    it('exposes a read-only view with immutable records', () => {
        const state = stateWith([1, 2]);
        const view = state.view();
        expect(view.place).toBeUndefined();
        expect(() => {
            view.record(1).mode = Mode.FLOATING;
        }).toThrow();
        view.slotsAt(A).push(99);
        expect(state.slotsAt(A)).toEqual([1, 2]);
        state.remove(1);
        expect(view.slotsAt(A)).toEqual([2]);
    });

    it('clones independently', () => {
        const state = stateWith([1, 2]);
        const copy = state.clone();
        copy.swap(1, 2);
        copy.remove(1);
        expect(state.slotsAt(A)).toEqual([1, 2]);
        expect(copy.slotsAt(A)).toEqual([2]);
    });
});
