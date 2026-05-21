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
        connect: vi.fn(() => 1),
        disconnect: vi.fn(),
        handler_is_connected: vi.fn(() => true)
    });

    it('should register a window and request retile', () => {
        const controller = new TilingController();
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);

        controller.tilingRequest(win);
        // We can't easily test the GLib timeout in unit tests without more complex mocks,
        // but we verify it doesn't crash during registration.
        expect(controller._windowMetaCache.has(win)).toBe(true);
    });

    it('should respect workspace isolation', () => {
        const controller = new TilingController();
        const ws1 = { id: 'ws1' };
        const ws2 = { id: 'ws2' };
        
        const win1 = createMockWindow(1, ws1, 0);
        const win2 = createMockWindow(2, ws2, 0);

        controller.tilingRequest(win1);
        controller.tilingRequest(win2);

        expect(controller.getWorkspaceGrid(ws1)).not.toBe(controller.getWorkspaceGrid(ws2));
    });
});
