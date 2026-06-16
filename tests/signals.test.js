import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GLib from 'gi://GLib';
import { SignalListener, TILABLE_WINDOW_TYPES } from '../lib/signals.js';
import Meta from 'gi://Meta';

describe('SignalListener', () => {
    let mockController;

    beforeEach(() => {
        SignalListener.activeInstance = null;
        vi.clearAllMocks();

        mockController = {
            tilingRequest: vi.fn(),
            handleMonitorsChanged: vi.fn(),
            startDragTracking: vi.fn(),
            endDragTracking: vi.fn(),
            hydrate: vi.fn(),
        };
    });

    afterEach(() => {
        SignalListener.activeInstance = null;
    });

    describe('_pendingIdles tracking', () => {
        it('should initialize _pendingIdles as empty Set', () => {
            const listener = new SignalListener(mockController);
            expect(listener._pendingIdles).toBeInstanceOf(Set);
            expect(listener._pendingIdles.size).toBe(0);
        });

        it('should track idle source IDs when _addWindow is called', () => {
            // Override idle_add to NOT execute callback (simulate async)
            GLib.idle_add = vi.fn((priority, cb) => 42);

            const listener = new SignalListener(mockController);
            const mockWindow = {
                get_window_type: () => Meta.WindowType.NORMAL,
                is_skip_taskbar: () => false,
            };

            listener._addWindow(mockWindow);
            expect(listener._pendingIdles.has(42)).toBe(true);
        });

        it('should clear pending idles on unbind and call source_remove', () => {
            GLib.idle_add = vi.fn((priority, cb) => 77);

            const listener = new SignalListener(mockController);
            const mockWindow = {
                get_window_type: () => Meta.WindowType.NORMAL,
                is_skip_taskbar: () => false,
            };

            listener._addWindow(mockWindow);
            expect(listener._pendingIdles.size).toBe(1);

            listener.unbind();
            expect(GLib.source_remove).toHaveBeenCalledWith(77);
            expect(listener._pendingIdles.size).toBe(0);
        });

        it('should reject idle callback when activeInstance is null', () => {
            let capturedCb;
            GLib.idle_add = vi.fn((priority, cb) => {
                capturedCb = cb;
                return 88;
            });

            const listener = new SignalListener(mockController);
            const mockWindow = {
                get_window_type: () => Meta.WindowType.NORMAL,
                is_skip_taskbar: () => false,
            };

            listener._addWindow(mockWindow);
            listener.unbind(); // sets activeInstance = null

            // Simulate late callback firing
            capturedCb();
            expect(mockController.tilingRequest).not.toHaveBeenCalled();
        });
    });
});
