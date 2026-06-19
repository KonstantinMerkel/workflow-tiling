import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowWrapper } from '../lib/window.js';

describe('WindowWrapper', () => {
    let mockWindow;
    let mockController;

    beforeEach(() => {
        mockWindow = {
            unmanaged: false,
            minimized: false,
            get_title: vi.fn(() => 'Test Window'),
            connect: vi.fn((name, cb) => {
                return name === 'size-changed' ? 99 : 1;
            }),
            disconnect: vi.fn(),
            handler_is_connected: vi.fn(() => true),
            move_resize_frame: vi.fn(),
            unmaximize: vi.fn(),
            maximized_horizontally: false,
            maximized_vertically: false,
            is_fullscreen: vi.fn(() => false),
        };

        mockController = {
            untile: vi.fn(),
            tilingRequest: vi.fn()
        };
        
        vi.clearAllMocks();
    });

    it('should initialize correctly', () => {
        const wrapper = new WindowWrapper(mockWindow, mockController);
        expect(wrapper.window).toBe(mockWindow);
        expect(wrapper.controller).toBe(mockController);
        expect(wrapper.unmanaged).toBe(false);
        expect(wrapper.minimized).toBe(false);
        expect(wrapper.title).toBe('Test Window');
    });

    it('should handle unmanaged fallback title', () => {
        mockWindow.get_title = undefined;
        const wrapper = new WindowWrapper(mockWindow, mockController);
        expect(wrapper.title).toBe('Unknown');
    });

    it('should bind signals only once', () => {
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.bindSignals();
        wrapper.bindSignals(); // should not connect again
        expect(mockWindow.connect).toHaveBeenCalledTimes(7);
    });

    it('should bind size changed and respect _isResizing', () => {
        let sizeChangedCb = null;
        mockWindow.connect = vi.fn((name, cb) => {
            if (name === 'size-changed') sizeChangedCb = cb;
            return 99;
        });

        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.bindSizeChanged();
        
        expect(mockWindow.connect).toHaveBeenCalledWith('size-changed', expect.any(Function));
        
        // Fire it
        sizeChangedCb();
        expect(mockController.tilingRequest).toHaveBeenCalledWith(mockWindow);

        // Fire it while resizing
        wrapper._isResizing = true;
        mockController.tilingRequest.mockClear();
        sizeChangedCb();
        expect(mockController.tilingRequest).not.toHaveBeenCalled();
    });

    it('should destroy and disconnect all signals', () => {
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.bindSignals();
        wrapper.bindSizeChanged();
        
        wrapper.destroy();
        expect(mockWindow.disconnect).toHaveBeenCalledTimes(9);
    });

    it('should apply geometry skipping unmanaged', () => {
        mockWindow.unmanaged = true;
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 });
        expect(mockWindow.move_resize_frame).not.toHaveBeenCalled();
    });

    it('should apply geometry', () => {
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.applyGeometry({ x: 10.4, y: 10.5, width: 100.1, height: 100.9 });
        expect(mockWindow.move_resize_frame).toHaveBeenCalledWith(false, 10, 11, 100, 101);
    });

    it('should unmaximize before applying geometry if maximized', () => {
        mockWindow.maximized_horizontally = true;
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 });
        
        expect(mockWindow.unmaximize).toHaveBeenCalled();
        // The compositor mock triggers callback immediately in tests (LatertType.BEFORE_REDRAW)
        expect(mockWindow.move_resize_frame).toHaveBeenCalledWith(false, 10, 10, 100, 100);
    });

    it('should catch error on disconnect fail', () => {
        mockWindow.handler_is_connected = vi.fn(() => { throw new Error('fail'); });
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.bindSignals();
        wrapper.destroy(); // should not throw
    });

    it('should catch error on apply geometry fail', () => {
        mockWindow.move_resize_frame = vi.fn(() => { throw new Error('fail'); });
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 }); // should not throw
    });

    describe('_pendingLaters tracking', () => {
        let originalGetLaters;
        beforeEach(() => {
            originalGetLaters = global.compositor.get_laters;
        });
        afterEach(() => {
            global.compositor.get_laters = originalGetLaters;
        });

        it('should track and remove compositor laters on destroy', () => {
            const wrapper = new WindowWrapper(mockWindow, mockController);
            const mockLaters = { add: vi.fn(() => 42), remove: vi.fn() };
            global.compositor.get_laters = vi.fn(() => mockLaters);

            wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 });
            expect(wrapper._pendingLaters.length).toBeGreaterThan(0);
            expect(wrapper._pendingLaters.includes(42)).toBe(true);

            wrapper.destroy();
            expect(mockLaters.remove).toHaveBeenCalledWith(42);
            expect(wrapper._pendingLaters.length).toBe(0);
        });

        it('should catch errors when removing already-fired laters in destroy', () => {
            const wrapper = new WindowWrapper(mockWindow, mockController);
            const mockLaters = {
                add: vi.fn(() => 42),
                remove: vi.fn(() => { throw new Error('Already removed'); })
            };
            global.compositor.get_laters = vi.fn(() => mockLaters);

            wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 });
            expect(() => wrapper.destroy()).not.toThrow();
        });
    });

    it('should correctly identify active override', () => {
        mockController._authorizedOverrides = new Set([mockWindow]);
        const wrapper = new WindowWrapper(mockWindow, mockController);
        expect(wrapper.isOverrideActive()).toBe(true);

        mockController._authorizedOverrides = new Set();
        expect(wrapper.isOverrideActive()).toBe(false);
    });

    it('should skip applyGeometry if override is active', () => {
        mockController._authorizedOverrides = new Set([mockWindow]);
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 });
        expect(mockWindow.move_resize_frame).not.toHaveBeenCalled();
    });

    it('should unmake fullscreen before applying geometry if fullscreen', () => {
        mockWindow.is_fullscreen = vi.fn(() => true);
        mockWindow.unmake_fullscreen = vi.fn();
        const wrapper = new WindowWrapper(mockWindow, mockController);
        wrapper.applyGeometry({ x: 10, y: 10, width: 100, height: 100 });
        
        expect(mockWindow.unmake_fullscreen).toHaveBeenCalled();
        expect(mockWindow.move_resize_frame).toHaveBeenCalledWith(false, 10, 10, 100, 100);
    });
});
