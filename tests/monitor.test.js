import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorManager } from '../lib/monitor.js';
import Meta from 'gi://Meta';

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

    it('should close all windows on a monitor', () => {
        const win1 = { delete: vi.fn(), get_monitor: () => 0, is_skip_taskbar: () => false, minimized: false };
        const win2 = { delete: vi.fn(), get_monitor: () => 0, is_skip_taskbar: () => false, minimized: false };
        const win3 = { delete: vi.fn(), get_monitor: () => 1, is_skip_taskbar: () => false, minimized: false };
        const ws = { list_windows: () => [win1, win2, win3] };
        global.workspace_manager.get_active_workspace.mockReturnValue(ws);

        monitorManager.closeMonitorWindows(0, false);
        
        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(win1.delete).toHaveBeenCalled();
        expect(win2.delete).toHaveBeenCalled();
        expect(win3.delete).not.toHaveBeenCalled();
        expect(controller.hydrate).toHaveBeenCalled();
    });

    it('should switch monitors for all windows', () => {
        const win1 = { move_to_monitor: vi.fn(), get_monitor: () => 0, minimized: false, is_skip_taskbar: () => false };
        const win2 = { move_to_monitor: vi.fn(), get_monitor: () => 1, minimized: false, is_skip_taskbar: () => false };
        const ws = { list_windows: () => [win1, win2] };
        global.workspace_manager.get_active_workspace.mockReturnValue(ws);

        monitorManager.switchMonitors(0, 1);
        
        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(win1.move_to_monitor).toHaveBeenCalledWith(1);
        expect(win2.move_to_monitor).toHaveBeenCalledWith(0);
        expect(controller.hydrate).toHaveBeenCalled();
    });

    it('should port all monitor windows to another workspace', () => {
        const win1 = { change_workspace: vi.fn(), get_monitor: () => 0, minimized: false, is_skip_taskbar: () => false };
        const win2 = { change_workspace: vi.fn(), get_monitor: () => 1, minimized: false, is_skip_taskbar: () => false };
        const sourceWorkspace = { list_windows: () => [win1, win2] };
        const targetWorkspace = { list_windows: () => [] };
        
        global.workspace_manager.get_active_workspace.mockReturnValue(sourceWorkspace);
        global.workspace_manager.get_workspace_by_index.mockReturnValue(targetWorkspace);

        monitorManager.portMonitorToWorkspace(0, 'right');
        
        expect(controller.setBatchMode).toHaveBeenCalledWith(true);
        expect(controller.setBatchMode).toHaveBeenCalledWith(false);
        expect(win1.change_workspace).toHaveBeenCalledWith(targetWorkspace);
        expect(win2.change_workspace).not.toHaveBeenCalled();
        expect(controller.hydrate).toHaveBeenCalled();
    });
});
