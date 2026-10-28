import { describe, it, expect } from 'vitest';
import { Reconciler } from '../../lib/app/reconciler.js';
import { TilingState } from '../../lib/domain/tiling-state.js';
import { Mode, location } from '../../lib/domain/types.js';
import { FakeDisplayPort, FakeWindowPort, makeConfig, monitor } from '../helpers/fakes.js';

const LOC = location(1, 'DP-1');
const FULL = { x: 0, y: 0, width: 1000, height: 1000 };
const OLD = { x: 0, y: 0, width: 10, height: 10 };

function setup(config = makeConfig()) {
    const display = new FakeDisplayPort([monitor('DP-1', 0, 0, { primary: true })]);
    const windows = new FakeWindowPort(display);
    const state = new TilingState();
    const reconciler = new Reconciler({ view: state.view(), windowPort: windows, displayPort: display, getConfig: () => config });
    return { display, windows, state, reconciler };
}

describe('Reconciler', () => {
    it('resolves a request at the next size-changed', () => {
        const { display, windows, state, reconciler } = setup();
        windows.constrain = () => ({ ...OLD }); // Wayland: the size arrives later
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters(1);
        expect(windows.callsOf('setFrame')).toHaveLength(1);

        windows.set(1, { frame: { ...FULL, width: 990 } }); // client commits its own size
        reconciler.noteFrameChanged(1, true);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame')).toHaveLength(1); // settled: constraint left alone
    });

    it('accepts a late answer without re-requesting the frame', () => {
        const { display, windows, state, reconciler } = setup();
        windows.constrain = () => ({ ...OLD });
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters(); // follow-up pass settles provisionally on the old frame

        windows.set(1, { frame: { ...FULL } }); // the client answers after the follow-up pass
        reconciler.noteFrameChanged(1, true);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame').map((c) => c.arg)).toEqual([FULL]);
    });

    it('requests once more when the answer lands at another position', () => {
        const { display, windows, state, reconciler } = setup();
        windows.constrain = () => ({ ...OLD });
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters(); // follow-up pass settles provisionally on the old frame

        // the answer has the requested size, but the position of an unmaximize that raced the request
        windows.set(1, { frame: { ...FULL, x: 37 } });
        expect(reconciler.noteFrameChanged(1, true)).toBe(false); // needs a pass
        windows.constrain = (frame) => ({ ...frame, x: 37 }); // Mutter keeps the window there
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame').map((c) => c.arg)).toEqual([FULL, FULL]);

        reconciler.markDirty(LOC); // the repeat landed at the same position: left alone
        display.flushLaters();
        expect(windows.callsOf('setFrame')).toHaveLength(2);

        windows.constrain = (frame) => frame;
        windows.set(1, { frame: { ...FULL, x: 99 } }); // a later move by someone else is still reverted
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.facts(1).frame).toEqual(FULL);
    });

    it('reverts a size change that follows the answer', () => {
        const { display, windows, state, reconciler } = setup();
        windows.constrain = () => ({ ...OLD });
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters();
        windows.set(1, { frame: { ...FULL } });
        reconciler.noteFrameChanged(1, true); // the answer

        windows.constrain = (frame) => frame;
        windows.set(1, { frame: { x: 5, y: 5, width: 300, height: 300 } });
        reconciler.noteFrameChanged(1, true); // someone else
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame').map((c) => c.arg)).toEqual([FULL, FULL]);
        expect(windows.facts(1).frame).toEqual(FULL);
    });

    it('awaits no answer for a request that keeps the size', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1, { frame: { x: 9, y: 9, width: 1000, height: 1000 } });
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters(); // pure move, settled

        windows.set(1, { frame: { x: 0, y: 0, width: 400, height: 400 } });
        reconciler.noteFrameChanged(1, true); // not an answer: reverted
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame')).toHaveLength(2);
        expect(windows.facts(1).frame).toEqual(FULL);
    });

    it('never clamps a request to an empty size', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1, { sizeLimits: { min: { width: 0, height: 0 }, max: { width: 0, height: 0 } } });
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame').map((c) => c.arg)).toEqual([FULL]);
    });

    it('requests at least 1x1 when the gaps exceed the tile', () => {
        const { display, windows, state, reconciler } = setup(makeConfig(undefined, { gaps: { inner: 0, outer: 600 } }));
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame')[0].arg).toMatchObject({ width: 1, height: 1 });
    });

    it('clamps requests to the window size limits', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1, { sizeLimits: { min: { width: 1200, height: 100 }, max: { width: 2000, height: 600 } } });
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame').map((c) => c.arg)).toEqual([{ x: 0, y: 0, width: 1200, height: 600 }]);
    });

    it('keeps a request resolving while the window has no frame yet (not mapped)', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1, { frame: { x: 0, y: 0, width: 0, height: 0 } });
        state.place(1, 1, LOC, Mode.TILED);
        expect(reconciler.desiredFrame(1)).toEqual(FULL);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame')).toEqual([]);

        windows.set(1, { frame: { ...FULL } }); // first commit
        reconciler.noteFrameChanged(1, true);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame')).toEqual([]); // settled on the commit, nothing re-requested
    });

    it('never commands the excluded window of a preview source', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1);
        windows.add(2);
        state.place(1, 1, LOC, Mode.TILED);
        state.place(2, 2, LOC, Mode.TILED);
        reconciler.setSource(state.view(), 1);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame', 1)).toEqual([]);
        expect(windows.callsOf('setFrame', 2)).toHaveLength(1);
    });

    it('minimizes evacuated windows and runs callbacks after the next flush', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        state.evacuate(1, null, 'DP-9');
        let flushed = false;
        reconciler.markAllDirty();
        reconciler.afterNextFlush(() => {
            flushed = true;
        });
        display.flushLaters();
        expect(windows.facts(1).minimized).toBe(true);
        expect(flushed).toBe(true);
    });

    it('pauses without dropping work and resumes it', () => {
        const { display, windows, state, reconciler } = setup();
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.pause();
        reconciler.markDirty(LOC);
        expect(display.pendingLaters).toBe(0);
        reconciler.resume();
        display.flushLaters();
        expect(windows.facts(1).frame).toEqual(FULL);
    });
});
