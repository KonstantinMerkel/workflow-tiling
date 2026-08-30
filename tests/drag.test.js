import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TilingController } from '../lib/controller.js';
import { LayoutParser } from '../lib/utils/layout-parser.js';
import Meta from 'gi://Meta';

const DEFAULT_JSON = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":0}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":0},{"x":50,"y":0,"w":50,"h":100,"id":1}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":0},{"x":50,"y":0,"w":50,"h":50,"id":1},{"x":50,"y":50,"w":50,"h":50,"id":2}]}';

describe('DragManager Cross-Monitor', () => {
    let controller;
    let dragManager;
    let ws;

    beforeEach(() => {
        vi.clearAllMocks();
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
            { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
        ]);
        vi.mocked(manager.get_primary_monitor).mockReturnValue(0);
        
        global.display.get_primary_monitor = () => manager.get_primary_monitor();
        global.display.get_current_monitor = vi.fn(() => {
            const [x, y] = global.get_pointer ? global.get_pointer() : [0, 0];
            if (x >= 1000) return 1;
            return 0;
        });

        TilingController.activeInstance = null;
        controller = new TilingController();
        controller.setEscalator(LayoutParser.parse(DEFAULT_JSON));
        controller.monitorManager.initializeMonitorState();
        dragManager = controller.dragManager;

        ws = { 
            id: 'ws1', 
            get_work_area_for_monitor: vi.fn((idx) => {
                if (idx === 1) {
                    return { x: 1000, y: 0, width: 1000, height: 1000 };
                }
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

    it('should initialize and cleanup active drag state', () => {
        const win = createMockWindow(1, ws, 0);
        controller.tilingRequest(win);

        dragManager.startDragTracking(win);
        expect(dragManager._activeDrag).toBeDefined();
        expect(dragManager._activeDrag.window).toBe(win);
        expect(dragManager._activeDrag.lastHoveredSlot).toBe(-1);
        expect(dragManager._activeDrag.lastHoveredMonitorId).toBeNull();

        dragManager.endDragTracking(win);
        expect(dragManager._activeDrag).toBeNull();
    });

    it('should map pointer to slot and position indicator on same monitor', () => {
        const win1 = createMockWindow(1, ws, 0);
        const win2 = createMockWindow(2, ws, 0);
        controller.tilingRequest(win1);
        controller.tilingRequest(win2);

        let posChangedCb;
        win1.connect = vi.fn((event, cb) => {
            if (event === 'position-changed') posChangedCb = cb;
            return 123;
        });

        dragManager.startDragTracking(win1);
        expect(posChangedCb).toBeDefined();

        // Hover over slot 1 on DP-1 (same monitor)
        global.get_pointer = vi.fn(() => [600, 500]); // right side of monitor-0
        
        posChangedCb();

        expect(dragManager._activeDrag.lastHoveredSlot).toBe(1);
        expect(dragManager._activeDrag.lastHoveredMonitorId).toBe('monitor-0');
        expect(dragManager._activeDrag.indicator).toBeDefined();
    });

    it('should map pointer to slot and position indicator on different monitor', () => {
        const win1 = createMockWindow(1, ws, 0); // on monitor-0
        const win2 = createMockWindow(2, ws, 1); // on monitor-1
        controller.tilingRequest(win1);
        controller.tilingRequest(win2);

        let posChangedCb;
        win1.connect = vi.fn((event, cb) => {
            if (event === 'position-changed') posChangedCb = cb;
            return 123;
        });

        dragManager.startDragTracking(win1);

        // Hover on different monitor (HDMI-1) at slot 0 (which has win2)
        global.get_pointer = vi.fn(() => [1200, 500]); // coordinates on monitor-1
        
        posChangedCb();

        expect(dragManager._activeDrag.lastHoveredSlot).toBe(0);
        expect(dragManager._activeDrag.lastHoveredMonitorId).toBe('monitor-1');
    });

    it('should handle cross-monitor drop behavior', () => {
        const win1 = createMockWindow(1, ws, 0); // monitor-0
        const win2 = createMockWindow(2, ws, 1); // monitor-1
        controller.tilingRequest(win1);
        controller.tilingRequest(win2);

        let posChangedCb;
        win1.connect = vi.fn((event, cb) => {
            if (event === 'position-changed') posChangedCb = cb;
            return 123;
        });

        dragManager.startDragTracking(win1);

        // Hover on different monitor (HDMI-1) at slot 0
        global.get_pointer = vi.fn(() => [1200, 500]);
        posChangedCb();

        vi.spyOn(controller, '_scheduleRetile');

        dragManager.endDragTracking(win1);

        // Verify window physical movement
        expect(win1.move_to_monitor).toHaveBeenCalledWith(1);

        // Verify window tracked on target and untracked on source
        const layout = controller.workspaceManager.getLayout(ws);
        const sourceTracker = layout._getTracker('monitor-0');
        const targetTracker = layout._getTracker('monitor-1');

        expect(sourceTracker.getSlot(win1)).toBeUndefined();
        expect(targetTracker.getSlot(win1)).toBe(0); // target slot preferred slot 0

        // Verify wrapper monitor details updated
        const wrapper = controller._windowWrappers.get(win1);
        expect(wrapper.monitorId).toBe('monitor-1');
        expect(wrapper.monitorIndex).toBe(1);

        // Verify schedule retiles called on both
        expect(controller._scheduleRetile).toHaveBeenCalledWith(ws, 'monitor-0', 0);
        expect(controller._scheduleRetile).toHaveBeenCalledWith(ws, 'monitor-1', 1);
    });

    it('should handle empty monitor target drop', () => {
        const win1 = createMockWindow(1, ws, 0); // monitor-0
        controller.tilingRequest(win1);

        // target monitor-1 starts empty

        let posChangedCb;
        win1.connect = vi.fn((event, cb) => {
            if (event === 'position-changed') posChangedCb = cb;
            return 123;
        });

        dragManager.startDragTracking(win1);

        // Hover on empty monitor-1
        global.get_pointer = vi.fn(() => [1200, 500]);
        posChangedCb();

        // Check active drag preview mapping
        expect(dragManager._activeDrag.lastHoveredSlot).toBe(0);
        expect(dragManager._activeDrag.lastHoveredMonitorId).toBe('monitor-1');

        dragManager.endDragTracking(win1);

        // Verify window tracked on target monitor-1 slot 0
        const layout = controller.workspaceManager.getLayout(ws);
        const targetTracker = layout._getTracker('monitor-1');
        expect(targetTracker.getSlot(win1)).toBe(0);
    });
});
