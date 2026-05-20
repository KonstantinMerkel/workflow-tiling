import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TilingController } from '../lib/controller.js';
import Meta from 'gi://Meta';

describe('TilingController', () => {
    let controller;
    beforeEach(() => {
        vi.clearAllMocks();
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_monitors).mockReturnValue([
            { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' },
            { get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }
        ]);
        vi.mocked(manager.get_primary_monitor).mockReturnValue(0);
        
        // Ensure global.display is in sync with manager mock
        global.display.get_primary_monitor = () => manager.get_primary_monitor();

        controller = new TilingController();
        controller.initializeMonitorState();
    });

    const createMockWindow = (id, workspace, initialMonitor) => {
        let monitor = initialMonitor;
        return {
            id,
            get_workspace: () => workspace,
            get_monitor: vi.fn(() => monitor),
            get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
            get_frame_rect: () => ({ x: 10, y: 10, width: 100, height: 100 }),
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
            unminimize: vi.fn(function() { this.minimized = false; })
        };
    };

    it('should register a window and request retile', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);

        controller.tilingRequest(win);
        // We verify it doesn't crash and caches the window.
        expect(controller._windowMetaCache.has(win)).toBe(true);
    });

    it('should untile window when minimized', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);

        // First register as normal
        controller.tilingRequest(win);
        const grid = controller.getWorkspaceGrid(ws);
        expect(grid.monitors.get('monitor-0').size).toBe(1);

        // Minimize
        win.minimized = true;
        controller.tilingRequest(win);
        expect(grid.monitors.get('monitor-0').size).toBe(0);
    });

    it('should re-tile window when restored from minimization', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        win.minimized = true;

        controller.tilingRequest(win);
        const grid = controller.getWorkspaceGrid(ws);
        expect(grid.monitors.get('monitor-0').size).toBe(0);

        // Restore
        win.minimized = false;
        controller.tilingRequest(win);
        expect(grid.monitors.get('monitor-0').size).toBe(1);
    });

    it('should handle movement between workspaces', () => {
        const ws1 = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const ws2 = { id: 'ws2', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        
        let currentWs = ws1;
        const win = createMockWindow(1, currentWs, 0);
        win.get_workspace = () => currentWs;

        controller.tilingRequest(win);
        const grid1 = controller.getWorkspaceGrid(ws1);
        expect(grid1.monitors.get('monitor-0').size).toBe(1);

        // Move to workspace 2
        currentWs = ws2;
        controller.tilingRequest(win);

        const grid2 = controller.getWorkspaceGrid(ws2);
        expect(grid1.monitors.get('monitor-0').size).toBe(0);
        expect(grid2.monitors.get('monitor-0').size).toBe(1);
    });

    it('should maintain correct order after minimize/restore', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const winA = createMockWindow('A', ws, 0);
        const winB = createMockWindow('B', ws, 0);

        // A, B -> [A, B]
        controller.tilingRequest(winA);
        controller.tilingRequest(winB);
        const grid = controller.getWorkspaceGrid(ws);
        const tracker = grid.monitors.get('monitor-0');
        
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
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const winA = createMockWindow('A', ws, 0);
        const winB = createMockWindow('B', ws, 0);

        // A, B -> [A, B]
        controller.tilingRequest(winA);
        controller.tilingRequest(winB);
        const grid = controller.getWorkspaceGrid(ws);
        const tracker = grid.monitors.get('monitor-0');
        
        expect(tracker.windows).toEqual([winA, winB]);

        // A again (e.g. size-changed)
        controller.tilingRequest(winA);
        expect(tracker.windows).toEqual([winA, winB]); // Should still be [A, B]
    });

    it('should handle monitor removal and minimize evacuated windows in tilingRequest', () => {
        const ws = { 
            id: 'ws1', 
            get_work_area_for_monitor: vi.fn(() => ({ x: 0, y: 0, width: 1000, height: 1000 })),
            get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 2000, height: 1000 })
        };
        
        // Window on monitor-1 (HDMI-1)
        const win = createMockWindow(1, ws, 1);

        controller.tilingRequest(win);
        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-1');
        
        // Mock monitor removal: only monitor-0 remains
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_monitors).mockReturnValue([
            { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }
        ]);
        vi.mocked(manager.get_primary_monitor).mockReturnValue(0);

        // Simulate GNOME moving the window to monitor 0 upon disconnect (triggers tilingRequest)
        vi.mocked(win.get_monitor).mockReturnValue(0);
        controller.tilingRequest(win);

        // Window should have been minimized by our controller because monitor-1 is gone
        expect(win.minimize).toHaveBeenCalled();
        expect(controller._batchMode).toBe(true);
        
        // Window tracked for restoration (keyed by window reference)
        expect(controller._evacuatedWindows.has(win)).toBe(true);
        expect(controller._evacuatedWindows.get(win).monitorId).toBe('monitor-1');
        
        // Metadata should have been updated to the new monitor
        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-0');

        // Finalize change via signal
        controller._handleMonitorsChanged();
        expect(controller._batchMode).toBe(false);

        // Simulate signal firing when window is minimized/moved (after hydration or during)
        controller.tilingRequest(win);

        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-0');
        expect(controller._windowMetaCache.get(win).monitorIndex).toBe(0);
        expect(win.minimized).toBe(true);
    });

    it('should not double-evacuate when duplicate signals fire', () => {
        const ws = { 
            id: 'ws1', 
            get_work_area_for_monitor: vi.fn(() => ({ x: 0, y: 0, width: 1000, height: 1000 }))
        };
        
        const win = createMockWindow(1, ws, 1);
        controller.tilingRequest(win);
        
        // Remove monitor-1
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_monitors).mockReturnValue([
            { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }
        ]);
        vi.mocked(win.get_monitor).mockReturnValue(0);

        // First signal: evacuation triggers
        controller.tilingRequest(win);
        expect(win.minimize).toHaveBeenCalledTimes(1);

        // Second signal (duplicate): should be suppressed
        controller.tilingRequest(win);
        expect(win.minimize).toHaveBeenCalledTimes(1); // still 1, not 2
    });

    it('should restore evacuated windows when monitor reappears', () => {
        const ws = { 
            id: 'ws1', 
            get_work_area_for_monitor: vi.fn(() => ({ x: 0, y: 0, width: 1000, height: 1000 })),
            list_windows: () => [win]
        };
        
        const win = createMockWindow(1, ws, 1);
        // Simulate GNOME async unminimize: property does NOT flip synchronously
        win.unminimize = vi.fn(); // no-op — minimized stays true
        vi.mocked(global.workspace_manager.get_active_workspace).mockReturnValue(ws);

        controller.tilingRequest(win);
        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-1');
        
        // Remove monitor-1
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_monitors).mockReturnValue([
            { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }
        ]);
        vi.mocked(win.get_monitor).mockReturnValue(0);
        controller.tilingRequest(win);

        expect(win.minimize).toHaveBeenCalled();
        expect(win.minimized).toBe(true);

        // Process topology change for removal (updates _lastMonitorCount to 1)
        controller._handleMonitorsChanged();

        // Re-plug monitor-1 (at index 1)
        vi.mocked(manager.get_monitors).mockReturnValue([
            { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' },
            { get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }
        ]);

        // Restore get_monitor to reflect move_to_monitor updates
        vi.mocked(win.get_monitor).mockRestore();
        win.get_monitor = vi.fn(() => win._monitor ?? 0);
        win.move_to_monitor = vi.fn((m) => { win._monitor = m; });

        controller._handleMonitorsChanged();

        // unminimize called, but minimized stays true (async)
        expect(win.unminimize).toHaveBeenCalled();
        expect(win.minimized).toBe(true); // still true — GNOME hasn't processed yet
        
        // Evacuation map cleaned
        expect(controller._evacuatedWindows.size).toBe(0);

        // Meta cache updated to restored monitor
        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-1');
        expect(controller._windowMetaCache.get(win).monitorIndex).toBe(1);

        // Window tracked in grid despite minimized=true (restoring bypass)
        const grid = controller.getWorkspaceGrid(ws);
        expect(grid.monitors.get('monitor-1').windows).toContain(win);
    });

    it('should handle monitor index shifting via hydration sweep', () => {
        const ws = { 
            id: 'ws1', 
            get_work_area_for_monitor: vi.fn(() => ({ x: 0, y: 0, width: 1000, height: 1000 })),
            get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 2000, height: 1000 }),
            list_windows: () => [win]
        };
        
        // Window on monitor-1 (HDMI-1)
        const win = createMockWindow(1, ws, 1);
        vi.mocked(global.workspace_manager.get_active_workspace).mockReturnValue(ws);

        controller.tilingRequest(win);
        expect(controller._windowMetaCache.get(win).monitorIndex).toBe(1);
        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-1');

        // Mock index shift: monitor-1 becomes index 0, monitor-0 becomes index 1
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_monitors).mockReturnValue([
            { get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' },
            { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }
        ]);

        // When win.get_monitor() is called, it should now return 0 because monitor-1 is at index 0
        vi.mocked(win.get_monitor).mockReturnValue(0);

        // In this case, monitorId ('monitor-1') STILL EXISTS, so it's NOT an evacuation.
        // It's just an index shift. _handleMonitorsChanged will trigger hydration.
        controller._handleMonitorsChanged();

        expect(controller._windowMetaCache.get(win).monitorIndex).toBe(0);
        expect(controller._windowMetaCache.get(win).monitorId).toBe('monitor-1');
        expect(win.minimize).not.toHaveBeenCalled();
    });
});
