import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceLayout, WorkspaceManager } from '../lib/workspace.js';
import { createDefaultEscalator } from '../lib/layout.js';

describe('WorkspaceLayout', () => {
    const escalator = createDefaultEscalator();
    const monitorRect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('should track windows in sequence with gaps', () => {
        const layout = new WorkspaceLayout({}, escalator);
        const win1 = { id: 1 };
        const win2 = { id: 2 };

        layout.trackWindow(win1, 0);
        layout.trackWindow(win2, 0);

        const ops = layout.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        // 50% split with 4px outer and 3px inner (half of 6)
        expect(ops[0].rect.width).toBe(493); 
    });

    it('should handle multiple monitors independently', () => {
        const layout = new WorkspaceLayout({}, escalator);
        const rectM0 = { x: 0, y: 0, width: 1920, height: 1080 };
        const rectM1 = { x: 1920, y: 0, width: 1920, height: 1080 }; 

        layout.trackWindow({ id: 'w1M0' }, 0);
        layout.trackWindow({ id: 'w1M1' }, 1);

        const opsM0 = layout.getRetileOperations(0, rectM0);
        const opsM1 = layout.getRetileOperations(1, rectM1);

        expect(opsM0.length).toBe(1);
        expect(opsM1.length).toBe(1);
        // Monitor 1 starts at 1920, with 4px outer gap -> 1924
        expect(opsM1[0].rect.x).toBe(1924);
    });

    it('should handle different resolutions on different monitors', () => {
        const layout = new WorkspaceLayout({}, escalator);
        const rect4K = { x: 0, y: 0, width: 3840, height: 2160 };
        const rectHD = { x: 3840, y: 0, width: 1920, height: 1080 };

        layout.trackWindow({ id: '4k' }, 0);
        layout.trackWindow({ id: 'hd' }, 1);

        const ops4K = layout.getRetileOperations(0, rect4K);
        const opsHD = layout.getRetileOperations(1, rectHD);

        // 3840 - 4(left) - 4(right) = 3832
        expect(ops4K[0].rect.width).toBe(3832);
        // 1920 - 4(left) - 4(right) = 1912
        expect(opsHD[0].rect.width).toBe(1912);
    });

    it('should provide retile operations when a window is removed', () => {
        const layout = new WorkspaceLayout({}, escalator);
        const w1 = { id: 1 };
        const w2 = { id: 2 };
        const w3 = { id: 3 };

        layout.trackWindow(w1, 0);
        layout.trackWindow(w2, 0);
        layout.trackWindow(w3, 0);

        layout.untrackWindow(w1, 0);

        const ops = layout.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        expect(ops[0].rect.width).toBe(493);
    });

    it('should maintain independent window counts across monitors', () => {
        const layout = new WorkspaceLayout({}, escalator);
        layout.trackWindow({ id: 1 }, 0);
        layout.trackWindow({ id: 2 }, 1);
        layout.trackWindow({ id: 3 }, 1);

        expect(layout.getRetileOperations(0, monitorRect).length).toBe(1);
        expect(layout.getRetileOperations(1, monitorRect).length).toBe(2);
    });

    describe('moveWindowDirection', () => {
        it('should correctly swap windows left/right with 2 windows', () => {
            const layout = new WorkspaceLayout({}, escalator);
            const w1 = { id: 1 };
            const w2 = { id: 2 };
            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);

            // initially w1 is slot 0, w2 is slot 1
            const moved = layout.moveWindowDirection(0, w1, 'right');
            expect(moved).toBe(true);

            const tracker = layout._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(1);
            expect(tracker.getSlot(w2)).toBe(0);

            const ops = layout.getRetileOperations(0, monitorRect);
            expect(ops.find(o => o.window === w1).rect.x).toBeGreaterThan(0);
        });

        it('should correctly prioritize older windows when moving left/right in 3-window layout', () => {
            const layout = new WorkspaceLayout({}, escalator);
            const w1 = { id: 1 }; // left
            const w2 = { id: 2 }; // top right
            const w3 = { id: 3 }; // bottom right

            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);
            layout.trackWindow(w3, 0);

            // moving right from w1 (slot 0) should target w2 (slot 1), not w3
            layout.moveWindowDirection(0, w1, 'right');

            const tracker = layout._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(1); // w1 moved to top right
            expect(tracker.getSlot(w2)).toBe(0); // w2 moved to left
            expect(tracker.getSlot(w3)).toBe(2); // w3 stayed bottom right
        });

        it('should swap up/down in 3-window layout', () => {
            const layout = new WorkspaceLayout({}, escalator);
            const w1 = { id: 1 }; // left
            const w2 = { id: 2 }; // top right
            const w3 = { id: 3 }; // bottom right

            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);
            layout.trackWindow(w3, 0);

            // moving down from w2 (slot 1) should target w3 (slot 2)
            layout.moveWindowDirection(0, w2, 'down');

            const tracker = layout._getTracker(0);
            expect(tracker.getSlot(w2)).toBe(2); // w2 moved to bottom right
            expect(tracker.getSlot(w3)).toBe(1); // w3 moved to top right
        });

        it('should not move if no window in that direction', () => {
            const layout = new WorkspaceLayout({}, escalator);
            const w1 = { id: 1 }; // left
            const w2 = { id: 2 }; // right

            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);

            const moved = layout.moveWindowDirection(0, w1, 'left');
            expect(moved).toBe(false);

            const tracker = layout._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(0);
        });
    });

    describe('swapWindowByPointer', () => {
        const gaps = { inner: 0, outer: 0 }; // no gaps for simpler math
        const mockRect = { x: 0, y: 0, width: 1000, height: 1000 };

        it('should swap windows if center is dropped over another window', () => {
            const layout = new WorkspaceLayout({}, escalator);
            const w1 = { id: 1, get_frame_rect: () => ({ x: 700, y: 100, width: 100, height: 100 }) }; // dropped center at (750, 150), which is in the right half
            const w2 = { id: 2, get_frame_rect: () => ({ x: 500, y: 0, width: 500, height: 1000 }) };

            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);

            // pointer at (750, 150) in w2's estate
            const swapped = layout.swapWindowByPointer(0, w1, 750, 150, mockRect, gaps);
            expect(swapped).toBe(true);

            const tracker = layout._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(1);
            expect(tracker.getSlot(w2)).toBe(0);
        });

        it('should not swap if dropped outside of any other window', () => {
            const layout = new WorkspaceLayout({}, escalator);
            // Dropped way off screen (e.g. invalid drag or over a panel)
            const w1 = { id: 1, get_frame_rect: () => ({ x: 2000, y: 2000, width: 100, height: 100 }) };
            const w2 = { id: 2, get_frame_rect: () => ({ x: 500, y: 0, width: 500, height: 1000 }) };

            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);

            // pointer at 2050, 2050
            const swapped = layout.swapWindowByPointer(0, w1, 2050, 2050, mockRect, gaps);
            expect(swapped).toBe(false);

            const tracker = layout._getTracker(0);
            expect(tracker.getSlot(w1)).toBe(0);
            expect(tracker.getSlot(w2)).toBe(1);
        });

        it('should not swap with itself if dropped in its own original area', () => {
            const layout = new WorkspaceLayout({}, escalator);
            // Dropped in the left half (its own area in 2-window layout)
            const w1 = { id: 1, get_frame_rect: () => ({ x: 100, y: 100, width: 100, height: 100 }) };
            const w2 = { id: 2, get_frame_rect: () => ({ x: 500, y: 0, width: 500, height: 1000 }) };

            layout.trackWindow(w1, 0);
            layout.trackWindow(w2, 0);

            // pointer at 150, 150
            const swapped = layout.swapWindowByPointer(0, w1, 150, 150, mockRect, gaps);
            expect(swapped).toBe(false);
        });
    });
});

describe('WorkspaceManager', () => {
    let controller;
    let manager;

    beforeEach(() => {
        global.get_current_time = vi.fn(() => 1234);
        controller = {
            setBatchMode: vi.fn(),
            retileAll: vi.fn(),
            hydrate: vi.fn(),
            _windowWrappers: new Map(),
            escalator: createDefaultEscalator()
        };
        manager = new WorkspaceManager(controller);
    });

    it('should close all windows in a workspace', () => {
        const win1 = { delete: vi.fn(), is_skip_taskbar: () => false };
        const win2 = { delete: vi.fn(), is_skip_taskbar: () => false };
        const ws = { list_windows: () => [win1, win2] };
        
        controller._windowWrappers.set(win1, {}); // Only win1 is tracked
        
        manager.closeWorkspaceWindows(ws);

        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(win1.delete).toHaveBeenCalled();
        expect(win2.delete).toHaveBeenCalled();
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(controller.hydrate).toHaveBeenCalledWith(ws);
    });

    it('should unminimize all windows in a workspace', () => {
        const win1 = { unminimize: vi.fn(), activate: vi.fn(), minimized: true, is_skip_taskbar: () => false };
        const win2 = { unminimize: vi.fn(), activate: vi.fn(), minimized: false, is_skip_taskbar: () => false };
        const ws = { list_windows: () => [win1, win2] };
        
        controller._windowWrappers.set(win1, {});
        controller._windowWrappers.set(win2, {});
        
        manager.unminimizeWorkspace(ws);

        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(win1.unminimize).toHaveBeenCalled();
        expect(win2.unminimize).not.toHaveBeenCalled();
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(controller.hydrate).toHaveBeenCalledWith(ws);
        expect(win1.activate).toHaveBeenCalledWith(1234);
    });
});
