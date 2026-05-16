import { describe, it, expect } from 'vitest';
import { ScreenEstate, Layout, createDefaultEscalator } from '../lib/layout.js';

describe('ScreenEstate', () => {
    it('should calculate absolute coordinates correctly', () => {
        const estate = new ScreenEstate(10, 20, 30, 40);
        const monitor = { x: 100, y: 100, width: 1000, height: 1000 };
        const absolute = estate.toAbsolute(monitor);
        expect(absolute).toEqual({ x: 200, y: 300, width: 300, height: 400 });
    });

    it('should throw on out of bounds', () => {
        expect(() => new ScreenEstate(-1, 0, 100, 100)).toThrow();
    });
});

describe('Layout Validation', () => {
    it('should detect overlaps', () => {
        const e1 = new ScreenEstate(0, 0, 60, 100);
        const e2 = new ScreenEstate(40, 0, 60, 100);
        expect(() => new Layout([e1, e2])).toThrow('Overlap detected');
    });

    it('should validate default layouts', () => {
        const escalator = createDefaultEscalator();
        for (let i = 1; i <= 3; i++) {
            const layout = escalator.getLayoutForCount(i);
            expect(layout).toBeDefined();
            expect(layout.size).toBe(i);
        }
    });
});
