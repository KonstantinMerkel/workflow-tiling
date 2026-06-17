import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceLayout, WorkspaceManager } from '../lib/workspace.js';
import { LayoutParser } from '../lib/layout.js';

describe('WorkspaceLayout', () => {
    const defaultJson = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';
    const escalator = LayoutParser.parse(defaultJson);
    const controller = { escalator };
    const monitorRect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('should track windows in sequence with gaps', () => {
        const layout = new WorkspaceLayout({}, controller);
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
        const layout = new WorkspaceLayout({}, controller);
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
        const layout = new WorkspaceLayout({}, controller);
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
        const layout = new WorkspaceLayout({}, controller);
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
        const layout = new WorkspaceLayout({}, controller);
        layout.trackWindow({ id: 1 }, 0);
        layout.trackWindow({ id: 2 }, 1);
        layout.trackWindow({ id: 3 }, 1);

        expect(layout.getRetileOperations(0, monitorRect).length).toBe(1);
        expect(layout.getRetileOperations(1, monitorRect).length).toBe(2);
    });

    describe('moveWindowDirection', () => {
        it('should correctly swap windows left/right with 2 windows', () => {
            const layout = new WorkspaceLayout({}, controller);
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
            const layout = new WorkspaceLayout({}, controller);
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
            const layout = new WorkspaceLayout({}, controller);
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
            const layout = new WorkspaceLayout({}, controller);
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
            const layout = new WorkspaceLayout({}, controller);
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
            const layout = new WorkspaceLayout({}, controller);
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
            const layout = new WorkspaceLayout({}, controller);
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
        global.workspace_manager = {
            get_active_workspace: vi.fn(),
            get_active_workspace_index: vi.fn(() => 0),
            get_workspace_by_index: vi.fn(),
            n_workspaces: 4
        };
        controller = {
            setBatchMode: vi.fn(),
            retileAll: vi.fn(),
            hydrate: vi.fn(),
            _windowWrappers: new Map(),
            updateWindowWrapperMonitor: function(win, id, idx) {
                const w = this._windowWrappers.get(win);
                if (w) { w.monitorId = id; w.monitorIndex = idx; }
            },
            escalator: LayoutParser.parse('{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}')
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

    it('should close all windows on a monitor', () => {
        const win1 = { delete: vi.fn(), get_monitor: () => 0, is_skip_taskbar: () => false, minimized: false };
        const win2 = { delete: vi.fn(), get_monitor: () => 0, is_skip_taskbar: () => false, minimized: false };
        const win3 = { delete: vi.fn(), get_monitor: () => 1, is_skip_taskbar: () => false, minimized: false };
        const ws = { list_windows: () => [win1, win2, win3] };
        global.workspace_manager.get_active_workspace.mockReturnValue(ws);

        manager.closeMonitorWindows(0, false);
        
        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(win1.delete).toHaveBeenCalled();
        expect(win2.delete).toHaveBeenCalled();
        expect(win3.delete).not.toHaveBeenCalled();
        expect(controller.hydrate).toHaveBeenCalledWith(ws);
    });

    it('should switch monitors for all windows', () => {
        const win1 = { move_to_monitor: vi.fn(), get_monitor: () => 0, minimized: false, is_skip_taskbar: () => false };
        const win2 = { move_to_monitor: vi.fn(), get_monitor: () => 1, minimized: false, is_skip_taskbar: () => false };
        const ws = { list_windows: () => [win1, win2] };
        global.workspace_manager.get_active_workspace.mockReturnValue(ws);

        const mockManager = {
            get_logical_monitors: () => [{}, {}]
        };
        global.backend = {
            get_monitor_manager: () => mockManager
        };

        manager.switchMonitors(0);
        
        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(win1.move_to_monitor).toHaveBeenCalledWith(1);
        expect(win2.move_to_monitor).toHaveBeenCalledWith(0);
        expect(controller.hydrate).toHaveBeenCalledWith(ws);
    });

    it('should port all monitor windows to another workspace', () => {
        const win1 = { change_workspace: vi.fn(), get_monitor: () => 0, minimized: false, is_skip_taskbar: () => false };
        const win2 = { change_workspace: vi.fn(), get_monitor: () => 1, minimized: false, is_skip_taskbar: () => false };
        const sourceWorkspace = { list_windows: () => [win1, win2] };
        const targetWorkspace = { list_windows: () => [] };
        
        global.workspace_manager.get_active_workspace.mockReturnValue(sourceWorkspace);
        global.workspace_manager.get_workspace_by_index.mockReturnValue(targetWorkspace);

        manager.portMonitorToWorkspace(0, 'right');
        
        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(win1.change_workspace).toHaveBeenCalledWith(targetWorkspace);
        expect(win2.change_workspace).not.toHaveBeenCalled();
        expect(controller.hydrate).toHaveBeenCalledWith(sourceWorkspace);
        expect(controller.hydrate).toHaveBeenCalledWith(targetWorkspace);
    });
});

describe('WorkspaceLayout Cross-Monitor Fallback', () => {
    const defaultJson = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';
    const escalator = LayoutParser.parse(defaultJson);
    const controller = { escalator };

    describe('_findClosestBoundaryWindow', () => {
        it('should choose the window with highest overlap on adjacent edge', () => {
            const layout = new WorkspaceLayout({}, controller);
            const targetTracker = {
                size: 2,
                windows: [
                    { get_frame_rect: () => ({ x: 1000, y: 0, width: 500, height: 150 }) },
                    { get_frame_rect: () => ({ x: 1000, y: 150, width: 500, height: 850 }) }
                ]
            };
            const sourceRect = { x: 0, y: 100, width: 1000, height: 400 };
            
            const best = layout._findClosestBoundaryWindow(targetTracker, 'right', sourceRect);
            expect(best).toBe(targetTracker.windows[1]);
        });

        it('should resolve ties using top-most/right-most tie breakers', () => {
            const layout = new WorkspaceLayout({}, controller);
            const targetTrackerY = {
                size: 2,
                windows: [
                    { get_frame_rect: () => ({ x: 1000, y: 200, width: 500, height: 300 }) },
                    { get_frame_rect: () => ({ x: 1000, y: 100, width: 500, height: 300 }) }
                ]
            };
            const sourceRectY = { x: 0, y: 200, width: 1000, height: 200 };
            const bestY = layout._findClosestBoundaryWindow(targetTrackerY, 'right', sourceRectY);
            expect(bestY).toBe(targetTrackerY.windows[1]);

            const targetTrackerX = {
                size: 2,
                windows: [
                    { get_frame_rect: () => ({ x: 100, y: 1000, width: 300, height: 500 }) },
                    { get_frame_rect: () => ({ x: 200, y: 1000, width: 300, height: 500 }) }
                ]
            };
            const sourceRectX = { x: 200, y: 0, width: 200, height: 1000 };
            const bestX = layout._findClosestBoundaryWindow(targetTrackerX, 'down', sourceRectX);
            expect(bestX).toBe(targetTrackerX.windows[1]);
        });
    });

    it('should fall back to cross-monitor focus when intra-monitor search fails', () => {
        const mockMonitorManager = {
            getMonitorIndex: vi.fn(id => id === 'monitor-0' ? 0 : 1),
            getMonitorInDirection: vi.fn((idx, dir) => idx === 0 && dir === 'right' ? 1 : -1),
            getMonitorId: vi.fn(idx => idx === 0 ? 'monitor-0' : 'monitor-1')
        };
        const controller = {
            escalator: escalator,
            monitorManager: mockMonitorManager
        };
        const layout = new WorkspaceLayout({}, controller);

        const win0 = {
            get_monitor: () => 0,
            get_frame_rect: () => ({ x: 0, y: 0, width: 1000, height: 1000 })
        };
        const win1 = {
            get_monitor: () => 1,
            get_frame_rect: () => ({ x: 1000, y: 0, width: 1000, height: 1000 }),
            activate: vi.fn()
        };

        layout.trackWindow(win0, 'monitor-0');
        layout.trackWindow(win1, 'monitor-1');

        const result = layout.focusWindowDirection('monitor-0', win0, 'right');
        expect(result).toBe(true);
        expect(win1.activate).toHaveBeenCalled();
    });

    it('should fall back to cross-monitor movement when intra-monitor swap fails', () => {
        const mockMonitorManager = {
            getMonitorIndex: vi.fn(id => id === 'monitor-0' ? 0 : 1),
            getMonitorInDirection: vi.fn((idx, dir) => idx === 0 && dir === 'right' ? 1 : -1),
            getMonitorId: vi.fn(idx => idx === 0 ? 'monitor-0' : 'monitor-1')
        };
        const controller = {
            escalator: escalator,
            monitorManager: mockMonitorManager,
            _windowWrappers: new Map(),
            _scheduleRetile: vi.fn(),
            updateWindowWrapperMonitor: function(win, id, idx) {
                const w = this._windowWrappers.get(win);
                if (w) { w.monitorId = id; w.monitorIndex = idx; }
            }
        };
        const ws = { index: () => 0 };
        const layout = new WorkspaceLayout(ws, controller);

        const win0 = {
            get_monitor: () => 0,
            get_frame_rect: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
            move_to_monitor: vi.fn()
        };
        const wrapper0 = { monitorId: 'monitor-0', monitorIndex: 0 };
        controller._windowWrappers.set(win0, wrapper0);

        layout.trackWindow(win0, 'monitor-0');

        const result = layout.moveWindowDirection('monitor-0', win0, 'right');
        expect(result).toBe(true);
        
        const tracker0 = layout._getTracker('monitor-0');
        const tracker1 = layout._getTracker('monitor-1');
        expect(tracker0.getSlot(win0)).toBeUndefined();
        expect(tracker1.getSlot(win0)).toBe(0);

        expect(wrapper0.monitorId).toBe('monitor-1');
        expect(wrapper0.monitorIndex).toBe(1);
        expect(win0.move_to_monitor).toHaveBeenCalledWith(1);

        expect(controller._scheduleRetile).toHaveBeenCalledWith(ws, 'monitor-0', 0);
        expect(controller._scheduleRetile).toHaveBeenCalledWith(ws, 'monitor-1', 1);
    });
});
