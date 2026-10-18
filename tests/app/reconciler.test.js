import { describe, it, expect } from 'vitest';
import { Reconciler } from '../../lib/app/reconciler.js';
import { TilingState } from '../../lib/domain/tiling-state.js';
import { Mode, location } from '../../lib/domain/types.js';
import { FakeDisplayPort, FakeWindowPort, makeConfig, monitor } from '../helpers/fakes.js';

const LOC = location(1, 'DP-1');
const FULL = { x: 0, y: 0, width: 1000, height: 1000 };
const OLD = { x: 0, y: 0, width: 10, height: 10 };

function setup() {
    const display = new FakeDisplayPort([monitor('DP-1', 0, 0, { primary: true })]);
    const windows = new FakeWindowPort(display);
    const state = new TilingState();
    const config = makeConfig();
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

    it('heals a late commit with one re-request of the same frame', () => {
        const { display, windows, state, reconciler } = setup();
        windows.constrain = () => ({ ...OLD });
        windows.add(1);
        state.place(1, 1, LOC, Mode.TILED);
        reconciler.markDirty(LOC);
        display.flushLaters(); // follow-up pass settles on the old frame

        windows.constrain = (frame) => frame;
        windows.set(1, { frame: { ...FULL } }); // the client commits after the follow-up pass
        reconciler.noteFrameChanged(1, true);
        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame').map((c) => c.arg)).toEqual([FULL, FULL]);

        reconciler.markDirty(LOC);
        display.flushLaters();
        expect(windows.callsOf('setFrame')).toHaveLength(2);
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
