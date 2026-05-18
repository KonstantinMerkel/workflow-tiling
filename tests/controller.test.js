import { describe, it, expect, vi } from 'vitest';
import { TilingController } from '../lib/controller.js';

describe('TilingController', () => {
    const createMockWindow = (id, workspace, monitor) => ({
        id,
        get_workspace: () => workspace,
        get_monitor: () => monitor,
        get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
        get_frame_rect: () => ({ x: 10, y: 10, width: 100, height: 100 }),
        move_resize_frame: vi.fn(),
        get_title: () => `Window ${id}`,
        unmaximize: vi.fn(),
        maximized_horizontally: false,
        maximized_vertically: false,
        minimized: false,
        connect: vi.fn(() => 123),
        disconnect: vi.fn(),
        handler_is_connected: vi.fn(() => true)
    });

    it('should register a window and request retile', () => {
        const controller = new TilingController();
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);

        controller.tilingRequest(win);
        // We verify it doesn't crash and caches the window.
        expect(controller._windowMetaCache.has(win)).toBe(true);
    });

    it('should untile window when minimized', () => {
        const controller = new TilingController();
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);

        // First register as normal
        controller.tilingRequest(win);
        const grid = controller.getWorkspaceGrid(ws);
        expect(grid.monitors.get(0).size).toBe(1);

        // Minimize
        win.minimized = true;
        controller.tilingRequest(win);
        expect(grid.monitors.get(0).size).toBe(0);
    });

    it('should re-tile window when restored from minimization', () => {
        const controller = new TilingController();
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        win.minimized = true;

        controller.tilingRequest(win);
        const grid = controller.getWorkspaceGrid(ws);
        expect(grid.monitors.get(0).size).toBe(0);

        // Restore
        win.minimized = false;
        controller.tilingRequest(win);
        expect(grid.monitors.get(0).size).toBe(1);
    });

    it('should handle movement between workspaces', () => {
        const controller = new TilingController();
        const ws1 = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const ws2 = { id: 'ws2', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        
        let currentWs = ws1;
        const win = createMockWindow(1, currentWs, 0);
        win.get_workspace = () => currentWs;

        controller.tilingRequest(win);
        const grid1 = controller.getWorkspaceGrid(ws1);
        expect(grid1.monitors.get(0).size).toBe(1);

        // Move to workspace 2
        currentWs = ws2;
        controller.tilingRequest(win);

        const grid2 = controller.getWorkspaceGrid(ws2);
        expect(grid1.monitors.get(0).size).toBe(0);
        expect(grid2.monitors.get(0).size).toBe(1);
    });

    it('should maintain correct order after minimize/restore', () => {
        const controller = new TilingController();
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const winA = createMockWindow('A', ws, 0);
        const winB = createMockWindow('B', ws, 0);

        // A, B -> [A, B]
        controller.tilingRequest(winA);
        controller.tilingRequest(winB);
        const grid = controller.getWorkspaceGrid(ws);
        const tracker = grid.monitors.get(0);
        
        expect(tracker.windows).toEqual([winA, winB]);

        // Minimize A -> [B]
        winA.minimized = true;
        controller.tilingRequest(winA);
        expect(tracker.windows).toEqual([winB]);

        // Restore A -> [B, A] (A becomes the "new" window at the end)
        winA.minimized = false;
        controller.tilingRequest(winA);
        expect(tracker.windows).toEqual([winB, winA]);
    });

    it('should NOT reverse order when tilingRequest is called multiple times', () => {
        const controller = new TilingController();
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const winA = createMockWindow('A', ws, 0);
        const winB = createMockWindow('B', ws, 0);

        // A, B -> [A, B]
        controller.tilingRequest(winA);
        controller.tilingRequest(winB);
        const grid = controller.getWorkspaceGrid(ws);
        const tracker = grid.monitors.get(0);
        
        expect(tracker.windows).toEqual([winA, winB]);

        // A again (e.g. size-changed)
        controller.tilingRequest(winA);
        expect(tracker.windows).toEqual([winA, winB]); // Should still be [A, B]
    });
});
