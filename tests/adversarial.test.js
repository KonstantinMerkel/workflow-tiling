import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TilingController } from '../lib/controller.js';
import { LayoutParser } from '../lib/layout.js';
import Meta from 'gi://Meta';

const DEFAULT_JSON = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';

describe('Adversarial Tests', () => {
    describe('enteringEdge calculation in tilingRequest', () => {
        let controller;
        let mockMonitorGeometries;
        
        beforeEach(() => {
            vi.clearAllMocks();
            const manager = Meta.Backend.get_monitor_manager();
            
            // Set up mock monitor list
            vi.mocked(manager.get_logical_monitors).mockReturnValue([
                { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
                { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
            ]);
            vi.mocked(manager.get_primary_monitor).mockReturnValue(0);
            global.display.get_primary_monitor = () => manager.get_primary_monitor();

            TilingController.activeInstance = null;
            controller = new TilingController();
            controller.setEscalator(LayoutParser.parse(DEFAULT_JSON));
            controller.monitorManager.initializeMonitorState();

            mockMonitorGeometries = {
                0: { x: 0, y: 0, width: 1920, height: 1080 },
                1: { x: 0, y: 0, width: 1920, height: 1080 }
            };

            global.display.get_monitor_geometry = vi.fn(idx => mockMonitorGeometries[idx]);
        });

        afterEach(() => {
            if (controller) {
                controller.clear();
            }
            TilingController.activeInstance = null;
        });

        const testEnteringEdge = (sourceRect, targetRect) => {
            mockMonitorGeometries[0] = sourceRect;
            mockMonitorGeometries[1] = targetRect;

            const ws = { id: 'ws1', index: () => 0, get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
            const win = {
                id: 'win1',
                get_workspace: () => ws,
                get_monitor: vi.fn(() => 1),
                get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 3840, height: 1080 }),
                get_frame_rect: () => ({ x: 10, y: 10, width: 100, height: 100 }),
                move_resize_frame: vi.fn(),
                move_to_monitor: vi.fn(),
                get_title: () => 'Window 1',
                unmaximize: vi.fn(),
                maximized_horizontally: false,
                maximized_vertically: false,
                minimized: false,
                connect: vi.fn(() => 123),
                disconnect: vi.fn(),
                handler_is_connected: vi.fn(() => true)
            };

            // Setup wrapper to make it look like a monitor change
            const wrapper = {
                workspace: ws,
                get effectiveWorkspace() { return ws; },
                monitorIndex: 0,
                get effectiveMonitorIndex() { return win.get_monitor(); },
                monitorId: 'monitor-0',
                applyGeometry: vi.fn(),
                bindSignals: vi.fn(),
                bindSizeChanged: vi.fn(),
                destroy: vi.fn()
            };
            controller._windowWrappers.set(win, wrapper);

            // Spy on handleMonitorTransition
            const layout = controller.workspaceManager.getLayout(ws);
            const spy = vi.spyOn(layout, 'handleMonitorTransition').mockImplementation(() => {});

            controller.tilingRequest(win);

            expect(spy).toHaveBeenCalled();
            const calledEdge = spy.mock.calls[0][3];
            return calledEdge;
        };

        it('should detect top edge when target is below source', () => {
            const edge = testEnteringEdge(
                { x: 0, y: 0, width: 1920, height: 1080 },
                { x: 0, y: 1080, width: 1920, height: 1080 }
            );
            expect(edge).toBe('top');
        });

        it('should detect bottom edge when target is above source', () => {
            const edge = testEnteringEdge(
                { x: 0, y: 1080, width: 1920, height: 1080 },
                { x: 0, y: 0, width: 1920, height: 1080 }
            );
            expect(edge).toBe('bottom');
        });

        it('should detect left edge when target is right of source', () => {
            const edge = testEnteringEdge(
                { x: 0, y: 0, width: 1920, height: 1080 },
                { x: 1920, y: 0, width: 1920, height: 1080 }
            );
            expect(edge).toBe('left');
        });

        it('should detect right edge when target is left of source', () => {
            const edge = testEnteringEdge(
                { x: 1920, y: 0, width: 1920, height: 1080 },
                { x: 0, y: 0, width: 1920, height: 1080 }
            );
            expect(edge).toBe('right');
        });

        it('should handle vertical stack with slight horizontal misalignment', () => {
            const edge = testEnteringEdge(
                { x: 0, y: 0, width: 1920, height: 1080 },
                { x: 10, y: 1080, width: 1920, height: 1080 }
            );
            expect(edge).toBe('top');
        });

        it('should handle diagonal layout (45 degrees)', () => {
            const edge = testEnteringEdge(
                { x: 0, y: 0, width: 1000, height: 1000 },
                { x: 1000, y: 1000, width: 1000, height: 1000 }
            );
            expect(edge).toBe('left'); // Math.abs(dx) >= Math.abs(dy) (1000 >= 1000) -> left
        });
    });

    describe('switchMonitors modulo arithmetic', () => {
        let controller;
        beforeEach(() => {
            vi.clearAllMocks();
            TilingController.activeInstance = null;
            controller = new TilingController();
            controller.setEscalator(LayoutParser.parse(DEFAULT_JSON));
        });

        afterEach(() => {
            if (controller) {
                controller.clear();
            }
            TilingController.activeInstance = null;
        });

        const setupMonitors = (num) => {
            const manager = Meta.Backend.get_monitor_manager();
            const list = [];
            for (let i = 0; i < num; i++) {
                list.push({
                    get_monitors: () => [{
                        get_stable_id: () => `monitor-${i}`,
                        get_connector: () => `CONN-${i}`
                    }]
                });
            }
            vi.mocked(manager.get_logical_monitors).mockReturnValue(list);
            controller.monitorManager.initializeMonitorState();
        };

        it('should cycle correctly on 3 monitors', () => {
            setupMonitors(3);
            const ws = {
                id: 'ws1',
                list_windows: () => [win0, win1, win2],
                get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 })
            };
            global.workspace_manager.get_active_workspace.mockReturnValue(ws);

            const win0 = { move_to_monitor: vi.fn(), get_monitor: () => 0, is_skip_taskbar: () => false };
            const win1 = { move_to_monitor: vi.fn(), get_monitor: () => 1, is_skip_taskbar: () => false };
            const win2 = { move_to_monitor: vi.fn(), get_monitor: () => 2, is_skip_taskbar: () => false };

            // Wrap them
            controller._windowWrappers.set(win0, { monitorId: 'monitor-0', monitorIndex: 0, destroy: vi.fn() });
            controller._windowWrappers.set(win1, { monitorId: 'monitor-1', monitorIndex: 1, destroy: vi.fn() });
            controller._windowWrappers.set(win2, { monitorId: 'monitor-2', monitorIndex: 2, destroy: vi.fn() });

            // Switch monitors with active index = 0
            // targetMonitorIndex = (0 + 1) % 3 = 1
            // Windows on 0 should move to 1, windows on 1 should move to 0. Win2 remains untouched.
            controller.switchMonitors(0);

            expect(win0.move_to_monitor).toHaveBeenCalledWith(1);
            expect(win1.move_to_monitor).toHaveBeenCalledWith(0);
            expect(win2.move_to_monitor).not.toHaveBeenCalled();
        });

        it('should cycle correctly on 4 monitors', () => {
            setupMonitors(4);
            const ws = {
                id: 'ws1',
                list_windows: () => [win0, win1, win2, win3],
                get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 })
            };
            global.workspace_manager.get_active_workspace.mockReturnValue(ws);

            const win0 = { move_to_monitor: vi.fn(), get_monitor: () => 0, is_skip_taskbar: () => false };
            const win1 = { move_to_monitor: vi.fn(), get_monitor: () => 1, is_skip_taskbar: () => false };
            const win2 = { move_to_monitor: vi.fn(), get_monitor: () => 2, is_skip_taskbar: () => false };
            const win3 = { move_to_monitor: vi.fn(), get_monitor: () => 3, is_skip_taskbar: () => false };

            // Wrap them
            controller._windowWrappers.set(win0, { monitorId: 'monitor-0', monitorIndex: 0, destroy: vi.fn() });
            controller._windowWrappers.set(win1, { monitorId: 'monitor-1', monitorIndex: 1, destroy: vi.fn() });
            controller._windowWrappers.set(win2, { monitorId: 'monitor-2', monitorIndex: 2, destroy: vi.fn() });
            controller._windowWrappers.set(win3, { monitorId: 'monitor-3', monitorIndex: 3, destroy: vi.fn() });

            // Switch monitors with active index = 2
            // targetMonitorIndex = (2 + 1) % 4 = 3
            // Windows on 2 should move to 3, windows on 3 should move to 2. Others untouched.
            controller.switchMonitors(2);

            expect(win2.move_to_monitor).toHaveBeenCalledWith(3);
            expect(win3.move_to_monitor).toHaveBeenCalledWith(2);
            expect(win0.move_to_monitor).not.toHaveBeenCalled();
            expect(win1.move_to_monitor).not.toHaveBeenCalled();
        });
    });
});
