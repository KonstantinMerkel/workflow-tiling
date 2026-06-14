import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Layout, ScreenEstate, LayoutParser } from '../lib/layout.js';
import { WorkspaceLayout } from '../lib/workspace.js';
import { SettingsManager } from '../lib/settings.js';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';

const DEFAULT_JSON = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';

describe('Edging Tile Identification', () => {
    it('should identify edging tile for layout of size 1', () => {
        const estates = [new ScreenEstate(0, 0, 100, 100)];
        const layout = new Layout(estates);
        expect(layout.getEdgingSlot('left')).toBe(0);
        expect(layout.getEdgingSlot('right')).toBe(0);
        expect(layout.getEdgingSlot('top')).toBe(0);
        expect(layout.getEdgingSlot('bottom')).toBe(0);
    });

    it('should identify edging tile for layout of size 2 (tie-break right/upper)', () => {
        // Vertical split: left slot 0, right slot 1
        const estates = [
            new ScreenEstate(0, 0, 50, 100),
            new ScreenEstate(50, 0, 50, 100)
        ];
        const layout = new Layout(estates);
        expect(layout.getEdgingSlot('left')).toBe(0);
        expect(layout.getEdgingSlot('right')).toBe(1);
        // Tie breaker for top/bottom edge: right-most (slot 1)
        expect(layout.getEdgingSlot('top')).toBe(1);
        expect(layout.getEdgingSlot('bottom')).toBe(1);
    });

    it('should identify edging tile for layout of size 3 (escalator layout)', () => {
        // Left slot 0, top-right slot 1, bottom-right slot 2
        const estates = [
            new ScreenEstate(0, 0, 50, 100),
            new ScreenEstate(50, 0, 50, 50),
            new ScreenEstate(50, 50, 50, 50)
        ];
        const layout = new Layout(estates);
        expect(layout.getEdgingSlot('left')).toBe(0);
        // Tie breaker for right edge: upper (slot 1)
        expect(layout.getEdgingSlot('right')).toBe(1);
        // Tie breaker for top edge: right-most (slot 1)
        expect(layout.getEdgingSlot('top')).toBe(1);
        // Tie breaker for bottom edge: right-most (slot 2)
        expect(layout.getEdgingSlot('bottom')).toBe(2);
    });

    it('should prioritize longest edge for edging tile identification', () => {
        // Left slot 0 (30 width), top-right slot 1 (70 width, 40 height), bottom-right slot 2 (70 width, 60 height)
        const estates = [
            new ScreenEstate(0, 0, 30, 100),
            new ScreenEstate(30, 0, 70, 40),
            new ScreenEstate(30, 40, 70, 60)
        ];
        const layout = new Layout(estates);
        expect(layout.getEdgingSlot('left')).toBe(0);
        // Right edge: slot 2 has height 60, slot 1 has height 40 -> slot 2 is longer edge
        expect(layout.getEdgingSlot('right')).toBe(2);
        // Top edge: slot 1 has width 70, slot 0 has width 30 -> slot 1 is longer edge
        expect(layout.getEdgingSlot('top')).toBe(1);
        // Bottom edge: slot 2 has width 70, slot 0 has width 30 -> slot 2 is longer edge
        expect(layout.getEdgingSlot('bottom')).toBe(2);
    });
});

describe('Monitor Transitions', () => {
    let controller;
    let mockMonitorManager;
    let mockSettings;
    const escalator = LayoutParser.parse(DEFAULT_JSON);

    const createMockWindow = (id, workspace, initialMonitorIndex) => {
        let monitor = initialMonitorIndex;
        return {
            id,
            get_workspace: () => workspace,
            get_monitor: vi.fn(() => monitor),
            get_frame_rect: () => ({ x: monitor * 1920 + 10, y: 10, width: 100, height: 100 }),
            move_to_monitor: vi.fn((m) => { monitor = m; }),
            get_title: () => `Window ${id}`,
            unmaximize: vi.fn(),
            maximized_horizontally: false,
            maximized_vertically: false,
            minimized: false
        };
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockMonitorManager = {
            getMonitorIndex: vi.fn((id) => id === 'monitor-0' ? 0 : 1),
            getMonitorInDirection: vi.fn((idx, dir) => idx === 0 && dir === 'right' ? 1 : (idx === 1 && dir === 'left' ? 0 : -1)),
            getMonitorId: vi.fn((idx) => idx === 0 ? 'monitor-0' : 'monitor-1')
        };

        mockSettings = {
            getGaps: () => ({ inner: 6, outer: 4 }),
            getMonitorTransitionBehavior: vi.fn(() => 'escalate')
        };

        controller = {
            escalator: escalator,
            monitorManager: mockMonitorManager,
            settings: mockSettings,
            _windowWrappers: new Map(),
            _scheduleRetile: vi.fn(),
            updateWindowWrapperMonitor: function(win, id, idx) {
                const w = this._windowWrappers.get(win);
                if (w) { w.monitorId = id; w.monitorIndex = idx; }
            }
        };
    });

    describe('Escalate/De-escalate monitor transition behavior', () => {
        it('should de-escalate source and escalate target into edging slot', () => {
            mockSettings.getMonitorTransitionBehavior.mockReturnValue('escalate');
            const ws = { index: () => 0 };
            const layout = new WorkspaceLayout(ws, controller);

            // Source: 2 windows. Target: 2 windows.
            const winA = createMockWindow('A', ws, 0);
            const winB = createMockWindow('B', ws, 0);
            const winC = createMockWindow('C', ws, 1);
            const winD = createMockWindow('D', ws, 1);

            controller._windowWrappers.set(winA, { monitorId: 'monitor-0', monitorIndex: 0 });
            controller._windowWrappers.set(winB, { monitorId: 'monitor-0', monitorIndex: 0 });
            controller._windowWrappers.set(winC, { monitorId: 'monitor-1', monitorIndex: 1 });
            controller._windowWrappers.set(winD, { monitorId: 'monitor-1', monitorIndex: 1 });

            layout.trackWindow(winA, 'monitor-0');
            layout.trackWindow(winB, 'monitor-0');
            layout.trackWindow(winC, 'monitor-1');
            layout.trackWindow(winD, 'monitor-1');

            // Move winB to right (cross-monitor movement DP-1 -> HDMI-1)
            const result = layout.moveWindowDirection('monitor-0', winB, 'right');
            expect(result).toBe(true);

            const tracker0 = layout._getTracker('monitor-0');
            const tracker1 = layout._getTracker('monitor-1');

            // Source de-escalates: winB untracked, winA remains at slot 0
            expect(tracker0.size).toBe(1);
            expect(tracker0.getSlot(winA)).toBe(0);
            expect(tracker0.getSlot(winB)).toBeUndefined();

            // Target escalates: new layout size is 3. Entering edge is 'left'.
            // size 3 'left' edging slot is 0.
            // winB should be at slot 0, winC pushed to 1, winD pushed to 2.
            expect(tracker1.size).toBe(3);
            expect(tracker1.getSlot(winB)).toBe(0);
            expect(tracker1.getSlot(winC)).toBe(1);
            expect(tracker1.getSlot(winD)).toBe(2);

            expect(winB.move_to_monitor).toHaveBeenCalledWith(1);
            expect(controller._windowWrappers.get(winB).monitorId).toBe('monitor-1');
            expect(controller._windowWrappers.get(winB).monitorIndex).toBe(1);
        });
    });

    describe('Swap monitor transition behavior', () => {
        it('should swap moved window with target edged window without escalation/de-escalation', () => {
            mockSettings.getMonitorTransitionBehavior.mockReturnValue('swap');
            const ws = { index: () => 0 };
            const layout = new WorkspaceLayout(ws, controller);

            // Source: 2 windows. Target: 2 windows.
            const winA = createMockWindow('A', ws, 0);
            const winB = createMockWindow('B', ws, 0);
            const winC = createMockWindow('C', ws, 1);
            const winD = createMockWindow('D', ws, 1);

            controller._windowWrappers.set(winA, { monitorId: 'monitor-0', monitorIndex: 0 });
            controller._windowWrappers.set(winB, { monitorId: 'monitor-0', monitorIndex: 0 });
            controller._windowWrappers.set(winC, { monitorId: 'monitor-1', monitorIndex: 1 });
            controller._windowWrappers.set(winD, { monitorId: 'monitor-1', monitorIndex: 1 });

            layout.trackWindow(winA, 'monitor-0');
            layout.trackWindow(winB, 'monitor-0'); // slot 1
            layout.trackWindow(winC, 'monitor-1'); // slot 0
            layout.trackWindow(winD, 'monitor-1'); // slot 1

            // Move winB to right
            const result = layout.moveWindowDirection('monitor-0', winB, 'right');
            expect(result).toBe(true);

            const tracker0 = layout._getTracker('monitor-0');
            const tracker1 = layout._getTracker('monitor-1');

            // No change in sizes
            expect(tracker0.size).toBe(2);
            expect(tracker1.size).toBe(2);

            // winB swaps with winC (edged window on target for entering edge 'left')
            // winB gets slot 0 on monitor 1
            // winC gets slot 1 on monitor 0 (winB's old slot)
            expect(tracker0.getSlot(winA)).toBe(0);
            expect(tracker0.getSlot(winC)).toBe(1);
            expect(tracker0.getSlot(winB)).toBeUndefined();

            expect(tracker1.getSlot(winB)).toBe(0);
            expect(tracker1.getSlot(winD)).toBe(1);
            expect(tracker1.getSlot(winC)).toBeUndefined();

            // Check physical movement
            expect(winB.move_to_monitor).toHaveBeenCalledWith(1);
            expect(winC.move_to_monitor).toHaveBeenCalledWith(0);

            // Check wrapper updates
            expect(controller._windowWrappers.get(winB).monitorId).toBe('monitor-1');
            expect(controller._windowWrappers.get(winB).monitorIndex).toBe(1);
            expect(controller._windowWrappers.get(winC).monitorId).toBe('monitor-0');
            expect(controller._windowWrappers.get(winC).monitorIndex).toBe(0);
        });

        it('should fall back to moving window if target monitor has no windows', () => {
            mockSettings.getMonitorTransitionBehavior.mockReturnValue('swap');
            const ws = { index: () => 0 };
            const layout = new WorkspaceLayout(ws, controller);

            // Source: 1 window. Target: 0 windows.
            const winA = createMockWindow('A', ws, 0);

            controller._windowWrappers.set(winA, { monitorId: 'monitor-0', monitorIndex: 0 });

            layout.trackWindow(winA, 'monitor-0');

            const result = layout.moveWindowDirection('monitor-0', winA, 'right');
            expect(result).toBe(true);

            const tracker0 = layout._getTracker('monitor-0');
            const tracker1 = layout._getTracker('monitor-1');

            expect(tracker0.size).toBe(0);
            expect(tracker1.size).toBe(1);
            expect(tracker1.getSlot(winA)).toBe(0);

            expect(winA.move_to_monitor).toHaveBeenCalledWith(1);
            expect(controller._windowWrappers.get(winA).monitorId).toBe('monitor-1');
            expect(controller._windowWrappers.get(winA).monitorIndex).toBe(1);
        });
    });
});

describe('Settings Binding Toggle Updates', () => {
    let mockGioSettings;
    let mockExtension;

    beforeEach(() => {
        vi.clearAllMocks();

        mockGioSettings = {
            connect: vi.fn((signal, cb) => {
                if (signal.startsWith('changed::')) {
                    mockGioSettings._callbacks = mockGioSettings._callbacks || {};
                    mockGioSettings._callbacks[signal] = cb;
                }
                return 123;
            }),
            disconnect: vi.fn(),
            get_boolean: vi.fn(() => false),
            get_int: vi.fn(() => 0),
            get_string: vi.fn((key) => {
                if (key === 'monitor-transition-behavior') return 'swap';
                return '';
            })
        };

        mockExtension = {
            getSettings: () => mockGioSettings
        };
    });

    it('should connect settings change signal for monitor-transition-behavior', () => {
        const onSettingsChanged = vi.fn();
        const settingsManager = new SettingsManager(mockExtension, onSettingsChanged);

        // Verify connected change handler
        expect(mockGioSettings.connect).toHaveBeenCalledWith(
            'changed::monitor-transition-behavior',
            expect.any(Function)
        );

        // Verify loading of setting
        expect(mockGioSettings.get_string).toHaveBeenCalledWith('monitor-transition-behavior');

        // Trigger the signal callback
        const callback = mockGioSettings._callbacks['changed::monitor-transition-behavior'];
        expect(callback).toBeDefined();

        callback();

        expect(onSettingsChanged).toHaveBeenCalled();
    });
});
