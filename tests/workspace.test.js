import { describe, it, expect } from 'vitest';
import { WorkspaceGrid } from '../lib/workspace.js';
import { createDefaultEscalator } from '../lib/layout.js';

describe('WorkspaceGrid', () => {
    const escalator = createDefaultEscalator();
    const monitorRect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('should track windows in sequence with gaps', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const win1 = { id: 1 };
        const win2 = { id: 2 };

        grid.trackWindow(win1, 0);
        grid.trackWindow(win2, 0);

        const ops = grid.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        // 50% split with 4px outer and 3px inner (half of 6)
        expect(ops[0].rect.width).toBe(493); 
    });

    it('should handle multiple monitors independently', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const rectM0 = { x: 0, y: 0, width: 1920, height: 1080 };
        const rectM1 = { x: 1920, y: 0, width: 1920, height: 1080 }; 

        grid.trackWindow({ id: 'w1M0' }, 0);
        grid.trackWindow({ id: 'w1M1' }, 1);

        const opsM0 = grid.getRetileOperations(0, rectM0);
        const opsM1 = grid.getRetileOperations(1, rectM1);

        expect(opsM0.length).toBe(1);
        expect(opsM1.length).toBe(1);
        // Monitor 1 starts at 1920, with 4px outer gap -> 1924
        expect(opsM1[0].rect.x).toBe(1924);
    });

    it('should handle different resolutions on different monitors', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const rect4K = { x: 0, y: 0, width: 3840, height: 2160 };
        const rectHD = { x: 3840, y: 0, width: 1920, height: 1080 };

        grid.trackWindow({ id: '4k' }, 0);
        grid.trackWindow({ id: 'hd' }, 1);

        const ops4K = grid.getRetileOperations(0, rect4K);
        const opsHD = grid.getRetileOperations(1, rectHD);

        // 3840 - 4(left) - 4(right) = 3832
        expect(ops4K[0].rect.width).toBe(3832);
        // 1920 - 4(left) - 4(right) = 1912
        expect(opsHD[0].rect.width).toBe(1912);
    });

    it('should provide retile operations when a window is removed', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const w1 = { id: 1 };
        const w2 = { id: 2 };
        const w3 = { id: 3 };

        grid.trackWindow(w1, 0);
        grid.trackWindow(w2, 0);
        grid.trackWindow(w3, 0);

        grid.untrackWindow(w1, 0);

        const ops = grid.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        expect(ops[0].rect.width).toBe(493);
    });

    it('should maintain independent window counts across monitors', () => {
        const grid = new WorkspaceGrid({}, escalator);
        grid.trackWindow({ id: 1 }, 0);
        grid.trackWindow({ id: 2 }, 1);
        grid.trackWindow({ id: 3 }, 1);

        expect(grid.getRetileOperations(0, monitorRect).length).toBe(1);
        expect(grid.getRetileOperations(1, monitorRect).length).toBe(2);
    });

    describe('moveWindowDirection', () => {
        it('should correctly swap windows left/right with 2 windows', () => {
            const grid = new WorkspaceGrid({}, escalator);
            const w1 = { id: 1 };
            const w2 = { id: 2 };
            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);

            // initially w1 is slot 0, w2 is slot 1
            const moved = grid.moveWindowDirection(0, w1, 'right');
            expect(moved).toBe(true);

            const tracker = grid._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(1);
            expect(tracker.getSlot(w2)).toBe(0);

            const ops = grid.getRetileOperations(0, monitorRect);
            expect(ops.find(o => o.window === w1).rect.x).toBeGreaterThan(0);
        });

        it('should correctly prioritize older windows when moving left/right in 3-window layout', () => {
            const grid = new WorkspaceGrid({}, escalator);
            const w1 = { id: 1 }; // left
            const w2 = { id: 2 }; // top right
            const w3 = { id: 3 }; // bottom right

            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);
            grid.trackWindow(w3, 0);

            // moving right from w1 (slot 0) should target w2 (slot 1), not w3
            grid.moveWindowDirection(0, w1, 'right');

            const tracker = grid._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(1); // w1 moved to top right
            expect(tracker.getSlot(w2)).toBe(0); // w2 moved to left
            expect(tracker.getSlot(w3)).toBe(2); // w3 stayed bottom right
        });

        it('should swap up/down in 3-window layout', () => {
            const grid = new WorkspaceGrid({}, escalator);
            const w1 = { id: 1 }; // left
            const w2 = { id: 2 }; // top right
            const w3 = { id: 3 }; // bottom right

            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);
            grid.trackWindow(w3, 0);

            // moving down from w2 (slot 1) should target w3 (slot 2)
            grid.moveWindowDirection(0, w2, 'down');

            const tracker = grid._getTracker(0);
            expect(tracker.getSlot(w2)).toBe(2); // w2 moved to bottom right
            expect(tracker.getSlot(w3)).toBe(1); // w3 moved to top right
        });

        it('should not move if no window in that direction', () => {
            const grid = new WorkspaceGrid({}, escalator);
            const w1 = { id: 1 }; // left
            const w2 = { id: 2 }; // right

            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);

            const moved = grid.moveWindowDirection(0, w1, 'left');
            expect(moved).toBe(false);

            const tracker = grid._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(0);
        });
    });

    describe('swapWindowByPointer', () => {
        const gaps = { inner: 0, outer: 0 }; // no gaps for simpler math
        const mockRect = { x: 0, y: 0, width: 1000, height: 1000 };

        it('should swap windows if center is dropped over another window', () => {
            const grid = new WorkspaceGrid({}, escalator);
            const w1 = { id: 1, get_frame_rect: () => ({ x: 700, y: 100, width: 100, height: 100 }) }; // dropped center at (750, 150), which is in the right half
            const w2 = { id: 2, get_frame_rect: () => ({ x: 500, y: 0, width: 500, height: 1000 }) };

            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);

            // pointer at (750, 150) in w2's estate
            const swapped = grid.swapWindowByPointer(0, w1, 750, 150, mockRect, gaps);
            expect(swapped).toBe(true);

            const tracker = grid._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(1);
            expect(tracker.getSlot(w2)).toBe(0);
        });

        it('should not swap if dropped outside of any other window', () => {
            const grid = new WorkspaceGrid({}, escalator);
            // Dropped way off screen (e.g. invalid drag or over a panel)
            const w1 = { id: 1, get_frame_rect: () => ({ x: 2000, y: 2000, width: 100, height: 100 }) };
            const w2 = { id: 2, get_frame_rect: () => ({ x: 500, y: 0, width: 500, height: 1000 }) };

            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);

            // pointer at 2050, 2050
            const swapped = grid.swapWindowByPointer(0, w1, 2050, 2050, mockRect, gaps);
            expect(swapped).toBe(false);

            const tracker = grid._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(0);
            expect(tracker.getSlot(w2)).toBe(1);
        });

        it('should not swap with itself if dropped in its own original area', () => {
            const grid = new WorkspaceGrid({}, escalator);
            // Dropped in the left half (its own area in 2-window layout)
            const w1 = { id: 1, get_frame_rect: () => ({ x: 100, y: 100, width: 100, height: 100 }) };
            const w2 = { id: 2, get_frame_rect: () => ({ x: 500, y: 0, width: 500, height: 1000 }) };

            grid.trackWindow(w1, 0);
            grid.trackWindow(w2, 0);

            // pointer at 150, 150
            const swapped = grid.swapWindowByPointer(0, w1, 150, 150, mockRect, gaps);
            expect(swapped).toBe(false);
        });
    });
});
