import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WindowRegistry } from '../lib/window-registry.js';

describe('WindowRegistry', () => {
    let callbacks;
    let registry;

    beforeEach(() => {
        callbacks = {
            onTilingRequest: vi.fn(),
            onUntile: vi.fn(),
            isOverrideActive: vi.fn(() => false),
        };
        registry = new WindowRegistry(callbacks);
    });

    function createMockWindow(id = 1) {
        return {
            get_id: () => id,
            get_title: () => `Window ${id}`,
            connect: vi.fn(() => 1),
            disconnect: vi.fn(),
            is_override_redirect: () => false,
        };
    }

    it('creates and tracks wrapper with ensure()', () => {
        const win = createMockWindow(10);
        expect(registry.has(win)).toBe(false);

        const wrapper = registry.ensure(win);
        expect(wrapper).toBeDefined();
        expect(registry.has(win)).toBe(true);
        expect(registry.get(win)).toBe(wrapper);
        expect(registry.size).toBe(1);

        // Subsequent ensure returns identical instance
        const wrapper2 = registry.ensure(win);
        expect(wrapper2).toBe(wrapper);
        expect(registry.size).toBe(1);
    });

    it('removes window from registry with delete()', () => {
        const win = createMockWindow(20);
        const wrapper = registry.ensure(win);

        const removed = registry.delete(win);
        expect(removed).toBe(wrapper);
        expect(registry.has(win)).toBe(false);
        expect(registry.get(win)).toBeUndefined();
        expect(registry.size).toBe(0);
    });

    it('iterates over tracked wrappers with forEach()', () => {
        const win1 = createMockWindow(1);
        const win2 = createMockWindow(2);
        const w1 = registry.ensure(win1);
        const w2 = registry.ensure(win2);

        const tracked = [];
        registry.forEach((wrapper, win) => {
            tracked.push({ wrapper, win });
        });

        expect(tracked.length).toBe(2);
        expect(tracked[0].wrapper).toBe(w1);
        expect(tracked[1].wrapper).toBe(w2);
    });

    it('destroys all wrappers and clears registry with destroyAll()', () => {
        const win1 = createMockWindow(1);
        const win2 = createMockWindow(2);
        const w1 = registry.ensure(win1);
        const w2 = registry.ensure(win2);

        const destroySpy1 = vi.spyOn(w1, 'destroy');
        const destroySpy2 = vi.spyOn(w2, 'destroy');

        registry.destroyAll();

        expect(destroySpy1).toHaveBeenCalled();
        expect(destroySpy2).toHaveBeenCalled();
        expect(registry.size).toBe(0);
        expect(registry.has(win1)).toBe(false);
        expect(registry.has(win2)).toBe(false);
    });
});
