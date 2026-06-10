import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TilingController } from '../lib/controller.js';
import { LayoutParser } from '../lib/layout.js';
import Meta from 'gi://Meta';

const DEFAULT_JSON = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';

describe('TilingController', () => {
    let controller;
    beforeEach(() => {
        vi.clearAllMocks();
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
            { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
        ]);
        vi.mocked(manager.get_primary_monitor).mockReturnValue(0);
        
        // Ensure global.display is in sync with manager mock
        global.display.get_primary_monitor = () => manager.get_primary_monitor();

        TilingController.activeInstance = null;
        controller = new TilingController();
        controller.setEscalator(LayoutParser.parse(DEFAULT_JSON));
        controller.monitorManager.initializeMonitorState();
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
            get_work_area_all_monitors: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
            get_frame_rect: () => ({ x: 10, y: 10, width: 100, height: 100 }),
            move_resize_frame: vi.fn(),
            move_to_monitor: vi.fn((m) => { monitor = m; }),
            get_title: () => `Window ${id}`,
            unmaximize: vi.fn(),
            maximized_horizontally: false,
            maximized_vertically: false,
            is_fullscreen: vi.fn(() => false),
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
        expect(controller._windowWrappers.has(win)).toBe(true);
    });

    it('should untile window when minimized', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);

        // First register as normal
        controller.tilingRequest(win);
        const layout = controller.workspaceManager.getLayout(ws);
        expect(layout.monitors.get('monitor-0').size).toBe(1);

        // Minimize
        win.minimized = true;
        controller.tilingRequest(win);
        expect(layout.monitors.get('monitor-0').size).toBe(0);
    });

    it('should re-tile window when restored from minimization', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        win.minimized = true;

        controller.tilingRequest(win);
        const layout = controller.workspaceManager.getLayout(ws);
        expect(layout.monitors.get('monitor-0').size).toBe(0);

        // Restore
        win.minimized = false;
        controller.tilingRequest(win);
        expect(layout.monitors.get('monitor-0').size).toBe(1);
    });

    it('should handle movement between workspaces', () => {
        const ws1 = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const ws2 = { id: 'ws2', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        
        let currentWs = ws1;
        const win = createMockWindow(1, currentWs, 0);
        win.get_workspace = () => currentWs;

        controller.tilingRequest(win);
        const grid1 = controller.workspaceManager.getLayout(ws1);
        expect(grid1.monitors.get('monitor-0').size).toBe(1);

        // Move to workspace 2
        currentWs = ws2;
        controller.tilingRequest(win);

        const grid2 = controller.workspaceManager.getLayout(ws2);
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
        const layout = controller.workspaceManager.getLayout(ws);
        const tracker = layout.monitors.get('monitor-0');
        
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
        const layout = controller.workspaceManager.getLayout(ws);
        const tracker = layout.monitors.get('monitor-0');
        
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
        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-1');
        
        // Mock monitor removal: only monitor-0 remains
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] }
        ]);
        vi.mocked(manager.get_primary_monitor).mockReturnValue(0);

        // Simulate GNOME moving the window to monitor 0 upon disconnect (triggers tilingRequest)
        vi.mocked(win.get_monitor).mockReturnValue(0);
        controller.tilingRequest(win);

        // Window should have been minimized by our controller because monitor-1 is gone
        expect(win.minimize).toHaveBeenCalled();
        expect(controller._batchMode).toBe(false);
        
        // Window tracked for restoration (keyed by window reference)
        expect(controller.monitorManager._evacuatedWindows.has(win)).toBe(true);
        expect(controller.monitorManager._evacuatedWindows.get(win).monitorId).toBe('monitor-1');
        
        // Metadata should have been updated to the new monitor
        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-0');

        // Finalize change via signal
        controller.monitorManager.handleMonitorsChanged();
        expect(controller._batchMode).toBe(false);

        // Simulate signal firing when window is minimized/moved (after hydration or during)
        controller.tilingRequest(win);

        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-0');
        expect(controller._windowWrappers.get(win).monitorIndex).toBe(0);
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
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] }
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
        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-1');
        
        // Remove monitor-1
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] }
        ]);
        vi.mocked(win.get_monitor).mockReturnValue(0);
        controller.tilingRequest(win);

        expect(win.minimize).toHaveBeenCalled();
        expect(win.minimized).toBe(true);

        // Process topology change for removal (updates _lastMonitorCount to 1)
        controller.monitorManager.handleMonitorsChanged();

        // Re-plug monitor-1 (at index 1)
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
            { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
        ]);

        // Restore get_monitor to reflect move_to_monitor updates
        vi.mocked(win.get_monitor).mockRestore();
        win.get_monitor = vi.fn(() => win._monitor ?? 0);
        win.move_to_monitor = vi.fn((m) => { win._monitor = m; });

        controller.monitorManager.handleMonitorsChanged();

        // unminimize called, but minimized stays true (async)
        expect(win.unminimize).toHaveBeenCalled();
        expect(win.minimized).toBe(true); // still true — GNOME hasn't processed yet
        
        // Evacuation map cleaned
        expect(controller.monitorManager._evacuatedWindows.size).toBe(0);

        // Meta cache updated to restored monitor
        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-1');
        expect(controller._windowWrappers.get(win).monitorIndex).toBe(1);

        // Window tracked in layout despite minimized=true (restoring bypass)
        const layout = controller.workspaceManager.getLayout(ws);
        expect(layout.monitors.get('monitor-1').windows).toContain(win);
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
        vi.mocked(global.display.list_all_windows).mockReturnValue([win]);

        controller.tilingRequest(win);
        expect(controller._windowWrappers.get(win).monitorIndex).toBe(1);
        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-1');

        // Mock index shift: monitor-1 becomes index 0, monitor-0 becomes index 1
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockReturnValue([
            { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] },
            { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] }
        ]);

        // When win.get_monitor() is called, it should now return 0 because monitor-1 is at index 0
        vi.mocked(win.get_monitor).mockReturnValue(0);

        // In this case, monitorId ('monitor-1') STILL EXISTS, so it's NOT an evacuation.
        // It's just an index shift. handleMonitorsChanged will trigger hydration.
        controller.monitorManager.handleMonitorsChanged();

        expect(controller._windowWrappers.get(win).monitorIndex).toBe(0);
        expect(controller._windowWrappers.get(win).monitorId).toBe('monitor-1');
        expect(win.minimize).not.toHaveBeenCalled();
    });

    it('should clear all resources and timeouts', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        
        controller.tilingRequest(win);
        controller._batchMode = true;
        controller.monitorManager._monitorsChangedPending = true;
        
        controller.clear();
        
        expect(controller._windowWrappers.size).toBe(0);
        expect(controller.workspaceManager.layouts.size).toBe(0);
        expect(controller._retileTimeouts.size).toBe(0);
        expect(controller.monitorManager._evacuatedWindows.size).toBe(0);
        expect(controller._restoringWindows.size).toBe(0);
        expect(controller.monitorManager._monitorsChangedPending).toBe(false);
    });

    it('should gracefully handle errors in tilingRequest', () => {
        const win = createMockWindow(1, null, 0);
        // Force an error by mocking global.workspace_manager to throw
        vi.mocked(global.workspace_manager.get_active_workspace).mockImplementationOnce(() => {
            throw new Error('test error');
        });
        
        // Should not throw, should be caught
        expect(() => controller.tilingRequest(win)).not.toThrow();
    });

    it('should gracefully handle errors in untile', () => {
        const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        controller.tilingRequest(win);
        
        // Sabotage the workspace to throw on untrack
        vi.spyOn(controller.workspaceManager, 'getLayout').mockImplementation(() => {
            throw new Error('test error');
        });
        
        // Should not throw
        expect(() => controller.untile(win)).not.toThrow();
        expect(controller._windowWrappers.has(win)).toBe(false);
    });

    it('should gracefully handle errors during monitor initialization', () => {
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockImplementation(() => {
            throw new Error('init error');
        });
        
        TilingController.activeInstance = null;
        const newController = new TilingController();
        expect(() => newController.monitorManager.initializeMonitorState()).not.toThrow();
        newController.clear();
    });

    it('should gracefully handle handleMonitorsChanged failures', () => {
        const manager = Meta.Backend.get_monitor_manager();
        vi.mocked(manager.get_logical_monitors).mockImplementation(() => {
            throw new Error('hotplug error');
        });
        
        expect(() => controller.monitorManager.handleMonitorsChanged()).not.toThrow();
        expect(controller.monitorManager._monitorsChangedPending).toBe(false);
    });

    it('should hydrate with active workspace', () => {
        const ws = { id: 'ws1', list_windows: vi.fn(() => []), get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        vi.mocked(global.display.list_all_windows).mockReturnValue([win]);
        
        vi.spyOn(controller, 'tilingRequest');
        controller.hydrate();
        
        expect(controller.tilingRequest).toHaveBeenCalledWith(win);
    });

    it('should hydrate including restoring windows', () => {
        const ws = { id: 'ws1', list_windows: vi.fn(() => []), get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win1 = createMockWindow(1, ws, 0); // Active workspace
        const win2 = createMockWindow(2, ws, 0); // Evacuated/Restoring

        vi.mocked(global.display.list_all_windows).mockReturnValue([win1]);
        controller._restoringWindows.set(win2, 0);
        
        vi.spyOn(controller, 'tilingRequest');
        controller.hydrate();
        
        expect(controller.tilingRequest).toHaveBeenCalledWith(win1);
        expect(controller.tilingRequest).toHaveBeenCalledWith(win2);
    });

    it('should hydrate ignoring unmanaged windows', () => {
        const ws = { id: 'ws1', list_windows: vi.fn(() => []), get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
        const win = createMockWindow(1, ws, 0);
        win.unmanaged = true;
        vi.mocked(global.display.list_all_windows).mockReturnValue([win]);
        
        vi.spyOn(controller, 'tilingRequest');
        controller.hydrate();
        
        expect(controller.tilingRequest).not.toHaveBeenCalledWith(win);
    });

    describe('moveWindowDirection', () => {
        it('should delegate to layout and schedule retile if moved', () => {
            const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
            const win = createMockWindow(1, ws, 0);
            controller.tilingRequest(win);

            const layout = controller.workspaceManager.getLayout(ws);
            vi.spyOn(layout, 'moveWindowDirection').mockReturnValue(true);
            vi.spyOn(controller, '_scheduleRetile');

            controller.moveWindowDirection(win, 'left');

            expect(layout.moveWindowDirection).toHaveBeenCalledWith('monitor-0', win, 'left');
            expect(controller._scheduleRetile).toHaveBeenCalledWith(ws, 'monitor-0', 0);
        });

        it('should do nothing if window is untracked', () => {
            const win = createMockWindow(1, null, 0);
            vi.spyOn(controller, '_scheduleRetile');
            controller.moveWindowDirection(win, 'left');
            expect(controller._scheduleRetile).not.toHaveBeenCalled();
        });
    });

    describe('Drag Tracking', () => {
        it('should create indicator and bind position-changed on startDragTracking', () => {
            const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
            const win = createMockWindow(1, ws, 0);
            controller.tilingRequest(win);

            controller.dragManager.startDragTracking(win);

            expect(controller.dragManager._activeDrag).toBeDefined();
            expect(controller.dragManager._activeDrag.window).toBe(win);
            expect(controller.dragManager._activeDrag.indicator).toBeDefined();
            expect(win.connect).toHaveBeenCalledWith('position-changed', expect.any(Function));
        });

        it('should remove indicator and call swapWindowByPointer on endDragTracking', () => {
            const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
            const win = createMockWindow(1, ws, 0);
            controller.tilingRequest(win);
            controller.dragManager.startDragTracking(win);

            const indicator = controller.dragManager._activeDrag.indicator;
            vi.spyOn(indicator, 'destroy');
            const layout = controller.workspaceManager.getLayout(ws);
            vi.spyOn(layout, 'swapWindowByPointer').mockReturnValue(true);
            vi.spyOn(controller, '_scheduleRetile');

            controller.dragManager.endDragTracking(win);

            expect(win.disconnect).toHaveBeenCalledWith(123);
            expect(indicator.destroy).toHaveBeenCalled();
            expect(controller.dragManager._activeDrag).toBeNull();
            expect(layout.swapWindowByPointer).toHaveBeenCalledWith('monitor-0', win, expect.any(Number), expect.any(Number), expect.any(Object), expect.any(Object));
            expect(controller._scheduleRetile).toHaveBeenCalledWith(ws, 'monitor-0', 0);
        });

        it('should handle position-changed and update indicator', () => {
            const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
            const win = createMockWindow(1, ws, 0);
            controller.tilingRequest(win);

            let posChangedCb;
            win.connect = vi.fn((event, cb) => {
                if (event === 'position-changed') posChangedCb = cb;
                return 123;
            });

            controller.dragManager.startDragTracking(win);
            expect(posChangedCb).toBeDefined();
            
            global.get_pointer = vi.fn(() => [500, 500]);
            const layout = controller.workspaceManager.getLayout(ws);
            vi.spyOn(layout, 'getSlotAtPointer').mockReturnValue(0);

            expect(() => posChangedCb()).not.toThrow();
        });

        it('should apply and revert visual swap during drag', () => {
            const ws = { id: 'ws1', get_work_area_for_monitor: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) };
            const win1 = createMockWindow(1, ws, 0);
            const win2 = createMockWindow(2, ws, 0);
            controller.tilingRequest(win1);
            controller.tilingRequest(win2);
            
            let posChangedCb;
            win1.connect = vi.fn((event, cb) => {
                if (event === 'position-changed') posChangedCb = cb;
                return 123;
            });

            controller.dragManager.startDragTracking(win1);
            
            global.get_pointer = vi.fn(() => [500, 500]);
            const layout = controller.workspaceManager.getLayout(ws);
            
            // Hover over slot 1
            vi.spyOn(layout, 'getSlotAtPointer').mockReturnValue(1);
            vi.spyOn(controller.dragManager, '_applyVisualSwap');
            
            posChangedCb();
            
            expect(controller.dragManager._applyVisualSwap).toHaveBeenCalled();
            expect(controller.dragManager._activeDrag.lastHoveredSlot).toBe(1);
            
            // Hover over nothing
            vi.spyOn(layout, 'getSlotAtPointer').mockReturnValue(-1);
            vi.spyOn(controller.dragManager, '_revertVisualSwap');
            
            posChangedCb();
            
            expect(controller.dragManager._revertVisualSwap).toHaveBeenCalled();
            expect(controller.dragManager._activeDrag.lastHoveredSlot).toBe(-1);
        });
    });

    describe('Overrides', () => {
        it('should toggle override for maximize', () => {
            const win = createMockWindow(1, { id: 'ws1' }, 0);
            global.display.get_focus_window = vi.fn(() => win);
            win.maximize = vi.fn();
            
            controller.toggleOverrideActiveWindow('maximize');
            expect(controller._authorizedOverrides.has(win)).toBe(true);
            expect(win.maximize).toHaveBeenCalledWith(3);

            // Toggle off
            win.maximized_horizontally = true;
            win.maximized_vertically = true;
            controller.toggleOverrideActiveWindow('maximize');
            expect(controller._authorizedOverrides.has(win)).toBe(false);
            expect(win.unmaximize).toHaveBeenCalledWith(3);
        });

        it('should toggle override for fullscreen', () => {
            const win = createMockWindow(1, { id: 'ws1' }, 0);
            global.display.get_focus_window = vi.fn(() => win);
            win.make_fullscreen = vi.fn();
            win.unmake_fullscreen = vi.fn();
            
            controller.toggleOverrideActiveWindow('fullscreen');
            expect(controller._authorizedOverrides.has(win)).toBe(true);
            expect(win.make_fullscreen).toHaveBeenCalled();

            // Toggle off
            win.is_fullscreen = vi.fn(() => true);
            controller.toggleOverrideActiveWindow('fullscreen');
            expect(controller._authorizedOverrides.has(win)).toBe(false);
            expect(win.unmake_fullscreen).toHaveBeenCalled();
        });

        it('should clear overrides on monitor', () => {
            const ws = { id: 'ws1' };
            global.workspace_manager.get_active_workspace = vi.fn(() => ws);
            const win = createMockWindow(1, ws, 0);
            win.maximized_horizontally = true;
            win.maximized_vertically = true;
            win.is_fullscreen = vi.fn(() => true);
            win.unmake_fullscreen = vi.fn();
            
            controller.tilingRequest(win);
            controller._authorizedOverrides.add(win);
            
            controller._clearOverridesOnMonitor(0);
            
            expect(controller._authorizedOverrides.has(win)).toBe(false);
            expect(win.unmaximize).toHaveBeenCalledWith(3);
            expect(win.unmake_fullscreen).toHaveBeenCalled();
        });
    });
});

