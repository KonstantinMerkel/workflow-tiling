import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorManager } from '../lib/monitor.js';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

describe('MonitorManager', () => {
    let controller;
    let monitorManager;

    beforeEach(() => {
        vi.clearAllMocks();
        
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
            clearRestoringWindows: vi.fn(),
            workspaceManager: {
                clearLayouts: vi.fn(),
                getLayout: vi.fn()
            },
            _windowWrappers: new Map(),
            _restoringWindows: new Set(),
            updateWindowWrapperMonitor: vi.fn(),
            addRestoringWindow: vi.fn(),
            tilingRequest: vi.fn()
        };

        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
            { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
        ]);
        vi.mocked(manager.get_primary_monitor).mockReturnValue(0);

        monitorManager = new MonitorManager(controller);
        monitorManager.initializeMonitorState();
    });



    it('should evacuate window when its monitor is disconnected', () => {
        const mockWin = {
            unmanaged: false,
            minimized: false,
            minimize: vi.fn()
        };
        const mockWorkspace = { index: () => 0 };
        const mockWrapper = {
            title: 'Test Window',
            monitorId: 'monitor-1',
            workspace: mockWorkspace
        };

        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] }
        ]);

        const mockTracker = {
            getSlot: vi.fn().mockReturnValue(2)
        };
        const mockGrid = {
            _getTracker: vi.fn().mockReturnValue(mockTracker),
            untrackWindow: vi.fn()
        };
        controller.workspaceManager.getLayout.mockReturnValue(mockGrid);

        const evacuated = monitorManager.checkEvacuation(mockWin, mockWrapper, 'monitor-0', mockWorkspace);

        expect(evacuated).toBe(true);
        expect(mockWin.minimize).toHaveBeenCalled();
        expect(mockGrid._getTracker).toHaveBeenCalledWith('monitor-1');
        expect(mockGrid.untrackWindow).toHaveBeenCalledWith(mockWin, 'monitor-1');
        expect(monitorManager.isEvacuated(mockWin)).toBe(true);
    });

    it('should restore evacuated window when its monitor is reconnected', () => {
        const mockWin = {
            unmanaged: false,
            minimized: true,
            unminimize: vi.fn(),
            move_to_monitor: vi.fn()
        };
        const mockWorkspace = { index: () => 0 };
        const mockInfo = {
            monitorId: 'monitor-1',
            workspace: mockWorkspace,
            slot: 2
        };
        monitorManager._evacuatedWindows.set(mockWin, mockInfo);

        monitorManager._lastMonitorCount = 1;
        monitorManager._knownMonitorIds = new Set(['monitor-0']);

        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
            { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
        ]);

        monitorManager.handleMonitorsChanged();

        expect(mockWin.move_to_monitor).toHaveBeenCalledWith(1);
        expect(mockWin.unminimize).toHaveBeenCalled();
        expect(controller.updateWindowWrapperMonitor).toHaveBeenCalledWith(mockWin, 'monitor-1', 1);
        expect(controller.addRestoringWindow).toHaveBeenCalledWith(mockWin, 2);
        expect(monitorManager.isEvacuated(mockWin)).toBe(false);
        expect(controller.hydrate).toHaveBeenCalled();
        expect(monitorManager._lastMonitorCount).toBe(2);
        expect(monitorManager._knownMonitorIds.has('monitor-1')).toBe(true);
    });

    it('should find adjacent monitor in direction using logical geometries', () => {
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { rect: { x: 0, y: 0, width: 1920, height: 1080 }, get_monitors: () => [] },
            { rect: { x: 1920, y: 0, width: 1920, height: 1080 }, get_monitors: () => [] }
        ]);

        const targetRight = monitorManager.getMonitorInDirection(0, 'right');
        expect(targetRight).toBe(1);

        const targetLeft = monitorManager.getMonitorInDirection(1, 'left');
        expect(targetLeft).toBe(0);

        const targetUp = monitorManager.getMonitorInDirection(0, 'up');
        expect(targetUp).toBe(-1);
    });

    it('should remove all tracked idle sources and laters on clear', () => {
        monitorManager._idleSourceIds.add(42);
        monitorManager._pendingLaterId = 99;
        monitorManager.clear();
        expect(GLib.source_remove).toHaveBeenCalledWith(42);
        expect(global.compositor.get_laters().remove).toHaveBeenCalledWith(99);
        expect(monitorManager._idleSourceIds.size).toBe(0);
        expect(monitorManager._pendingLaterId).toBe(0);
    });
});
