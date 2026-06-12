import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TilingController } from '../lib/controller.js';
import { LayoutParser } from '../lib/layout.js';
import { WorkspaceLayout } from '../lib/workspace.js';
import Meta from 'gi://Meta';

const DEFAULT_JSON = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';
const escalator = LayoutParser.parse(DEFAULT_JSON);

describe('Regressions', () => {
    beforeEach(() => {
        global.get_current_time = vi.fn(() => 1234);
    });

    describe('R1: Focus Jumping over Monitor Boundary', () => {
        it('should select the closest edge window on the target monitor when focusing right over boundary', () => {
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

            const winSource = {
                id: 'source',
                get_monitor: () => 0,
                get_frame_rect: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
                activate: vi.fn()
            };
            const winClose = {
                id: 'close',
                get_monitor: () => 1,
                get_frame_rect: () => ({ x: 1000, y: 0, width: 500, height: 1000 }),
                activate: vi.fn()
            };
            const winFar = {
                id: 'far',
                get_monitor: () => 1,
                get_frame_rect: () => ({ x: 1500, y: 0, width: 500, height: 1000 }),
                activate: vi.fn()
            };

            layout.trackWindow(winSource, 'monitor-0');
            layout.trackWindow(winClose, 'monitor-1');
            layout.trackWindow(winFar, 'monitor-1');

            const result = layout.focusWindowDirection('monitor-0', winSource, 'right');
            expect(result).toBe(true);
            expect(winClose.activate).toHaveBeenCalled();
            expect(winFar.activate).not.toHaveBeenCalled();
        });

        it('should select the closest edge window on the target monitor when focusing up over boundary', () => {
            const mockMonitorManager = {
                getMonitorIndex: vi.fn(id => id === 'monitor-1' ? 1 : 0),
                getMonitorInDirection: vi.fn((idx, dir) => idx === 1 && dir === 'up' ? 0 : -1),
                getMonitorId: vi.fn(idx => idx === 0 ? 'monitor-0' : 'monitor-1')
            };
            const controller = {
                escalator: escalator,
                monitorManager: mockMonitorManager
            };
            const layout = new WorkspaceLayout({}, controller);

            const winSource = {
                id: 'source',
                get_monitor: () => 1,
                get_frame_rect: () => ({ x: 0, y: 1000, width: 1000, height: 1000 }),
                activate: vi.fn()
            };
            const winClose = {
                id: 'close',
                get_monitor: () => 0,
                get_frame_rect: () => ({ x: 0, y: 500, width: 1000, height: 500 }),
                activate: vi.fn()
            };
            const winFar = {
                id: 'far',
                get_monitor: () => 0,
                get_frame_rect: () => ({ x: 0, y: 0, width: 1000, height: 500 }),
                activate: vi.fn()
            };

            layout.trackWindow(winSource, 'monitor-1');
            layout.trackWindow(winClose, 'monitor-0');
            layout.trackWindow(winFar, 'monitor-0');

            const result = layout.focusWindowDirection('monitor-1', winSource, 'up');
            expect(result).toBe(true);
            expect(winClose.activate).toHaveBeenCalled();
            expect(winFar.activate).not.toHaveBeenCalled();
        });
    });

    describe('R3: Drag-and-Drop Swap Slot Confusion', () => {
        let controller;
        let ws;

        beforeEach(() => {
            const manager = Meta.Backend.get_monitor_manager();
            vi.mocked(manager.get_logical_monitors).mockReturnValue([
                { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
                { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
            ]);
            vi.mocked(manager.get_primary_monitor).mockReturnValue(0);
            
            global.display.get_primary_monitor = () => manager.get_primary_monitor();
            global.display.get_current_monitor = vi.fn(() => 1);

            const mockSettings = {
                getGaps: () => ({ inner: 6, outer: 4 }),
                getMonitorTransitionBehavior: () => 'swap',
                settings: {
                    get_boolean: () => false
                }
            };

            TilingController.activeInstance = null;
            controller = new TilingController(mockSettings);
            controller.setEscalator(LayoutParser.parse(DEFAULT_JSON));
            controller.monitorManager.initializeMonitorState();

            ws = {
                id: 'ws1',
                get_work_area_for_monitor: vi.fn((idx) => {
                    if (idx === 1) return { x: 1000, y: 0, width: 1000, height: 1000 };
                    return { x: 0, y: 0, width: 1000, height: 1000 };
                }),
                get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 2000, height: 1000 })
            };
        });

        afterEach(() => {
            if (controller) {
                controller.clear();
            }
            TilingController.activeInstance = null;
        });

        const createMockWindow = (id, workspace, initialMonitor) => {
            let monitor = initialMonitor;
            return {
                id,
                get_workspace: () => workspace,
                get_monitor: vi.fn(() => monitor),
                get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 2000, height: 1000 }),
                get_frame_rect: () => ({
                    x: monitor === 1 ? 1010 : 10,
                    y: 10,
                    width: 100,
                    height: 100
                }),
                move_resize_frame: vi.fn(),
                move_to_monitor: vi.fn((m) => { monitor = m; }),
                get_title: () => `Window ${id}`,
                get_id: () => id,
                unmaximize: vi.fn(),
                maximized_horizontally: false,
                maximized_vertically: false,
                minimized: false,
                connect: vi.fn(() => 123),
                disconnect: vi.fn(),
                handler_is_connected: vi.fn(() => true),
                minimize: vi.fn(function() { this.minimized = true; }),
                unminimize: vi.fn(function() { this.minimized = false; }),
                delete: vi.fn()
            };
        };

        it('should swap dragged window with target window exactly and not shift other windows', () => {
            const winA = createMockWindow('A', ws, 0);
            const winB = createMockWindow('B', ws, 0);
            const winC = createMockWindow('C', ws, 1);
            const winD = createMockWindow('D', ws, 1);

            controller.tilingRequest(winA);
            controller.tilingRequest(winB);
            controller.tilingRequest(winC);
            controller.tilingRequest(winD);

            const layout = controller.workspaceManager.getLayout(ws);
            const sourceTracker = layout._getTracker('monitor-0');
            const targetTracker = layout._getTracker('monitor-1');

            expect(sourceTracker.getSlot(winA)).toBe(0);
            expect(sourceTracker.getSlot(winB)).toBe(1);
            expect(targetTracker.getSlot(winC)).toBe(0);
            expect(targetTracker.getSlot(winD)).toBe(1);

            controller.dragManager.startDragTracking(winB);

            global.get_pointer = vi.fn(() => [1200, 500]);
            
            const dragInfo = controller.dragManager._activeDrag;
            expect(dragInfo).toBeDefined();
            
            controller.dragManager._handlePositionChanged(
                controller._windowWrappers.get(winB),
                layout,
                sourceTracker,
                1,
                dragInfo.indicator
            );

            expect(dragInfo.lastHoveredSlot).toBe(0);
            expect(dragInfo.lastHoveredMonitorId).toBe('monitor-1');

            const retileSpy = vi.spyOn(controller, '_scheduleRetile').mockImplementation(() => {});
            controller.dragManager.endDragTracking(winB);

            expect(targetTracker.getSlot(winB)).toBe(0);
            expect(targetTracker.getSlot(winD)).toBe(1);
            expect(sourceTracker.getSlot(winC)).toBe(1);
            expect(sourceTracker.getSlot(winA)).toBe(0);
        });
    });

    describe('R4: Swap Monitor Keyboard Shortcut', () => {
        let controller;
        let ws;

        beforeEach(() => {
            const manager = Meta.Backend.get_monitor_manager();
            vi.mocked(manager.get_logical_monitors).mockReturnValue([
                { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
                { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
            ]);
            vi.mocked(manager.get_primary_monitor).mockReturnValue(0);
            
            global.display.get_primary_monitor = () => manager.get_primary_monitor();
            global.display.get_current_monitor = vi.fn(() => 0);

            const mockSettings = {
                getGaps: () => ({ inner: 6, outer: 4 }),
                getMonitorTransitionBehavior: () => 'escalate',
                settings: {
                    get_boolean: () => false
                }
            };

            TilingController.activeInstance = null;
            controller = new TilingController(mockSettings);
            controller.setEscalator(LayoutParser.parse(DEFAULT_JSON));
            controller.monitorManager.initializeMonitorState();

            ws = {
                id: 'ws1',
                get_work_area_for_monitor: vi.fn((idx) => {
                    if (idx === 1) return { x: 1000, y: 0, width: 1000, height: 1000 };
                    return { x: 0, y: 0, width: 1000, height: 1000 };
                }),
                get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 2000, height: 1000 }),
                list_windows: vi.fn()
            };
            global.workspace_manager.get_active_workspace = () => ws;
        });

        afterEach(() => {
            if (controller) {
                controller.clear();
            }
            TilingController.activeInstance = null;
        });

        const createMockWindow = (id, workspace, initialMonitor) => {
            let monitor = initialMonitor;
            return {
                id,
                get_workspace: () => workspace,
                get_monitor: vi.fn(() => monitor),
                get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 2000, height: 1000 }),
                get_frame_rect: () => ({
                    x: monitor === 1 ? 1010 : 10,
                    y: 10,
                    width: 100,
                    height: 100
                }),
                move_resize_frame: vi.fn(),
                move_to_monitor: vi.fn((m) => { monitor = m; }),
                get_title: () => `Window ${id}`,
                get_id: () => id,
                unmaximize: vi.fn(),
                maximized_horizontally: false,
                maximized_vertically: false,
                minimized: false,
                connect: vi.fn(() => 123),
                disconnect: vi.fn(),
                handler_is_connected: vi.fn(() => true),
                minimize: vi.fn(function() { this.minimized = true; }),
                unminimize: vi.fn(function() { this.minimized = false; }),
                delete: vi.fn()
            };
        };

        it('should successfully swap all windows between monitors and preserve slots', () => {
            const winA = createMockWindow(101, ws, 0);
            const winB = createMockWindow(102, ws, 0);
            const winC = createMockWindow(201, ws, 1);
            const winD = createMockWindow(202, ws, 1);

            ws.list_windows.mockReturnValue([winA, winB, winC, winD]);

            controller.tilingRequest(winA);
            controller.tilingRequest(winB);
            controller.tilingRequest(winC);
            controller.tilingRequest(winD);

            const layout = controller.workspaceManager.getLayout(ws);
            const sourceTracker = layout._getTracker('monitor-0');
            const targetTracker = layout._getTracker('monitor-1');

            expect(sourceTracker.getSlot(winA)).toBe(0);
            expect(sourceTracker.getSlot(winB)).toBe(1);
            expect(targetTracker.getSlot(winC)).toBe(0);
            expect(targetTracker.getSlot(winD)).toBe(1);

            controller.switchMonitors(0);

            expect(sourceTracker.getSlot(winC)).toBe(0);
            expect(sourceTracker.getSlot(winD)).toBe(1);
            expect(targetTracker.getSlot(winA)).toBe(0);
            expect(targetTracker.getSlot(winB)).toBe(1);

            expect(winA.get_monitor()).toBe(1);
            expect(winB.get_monitor()).toBe(1);
            expect(winC.get_monitor()).toBe(0);
            expect(winD.get_monitor()).toBe(0);
        });
    });
});
