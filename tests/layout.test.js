import { describe, it, expect } from 'vitest';
import { ScreenEstate, Layout, LayoutEscalator, createDefaultEscalator } from '../lib/layout.js';

describe('ScreenEstate', () => {
    it('should calculate absolute coordinates correctly', () => {
        const estate = new ScreenEstate(10, 20, 30, 40);
        const monitor = { x: 100, y: 100, width: 1000, height: 1000 };
        const absolute = estate.toAbsolute(monitor);

        expect(absolute).toEqual({
            x: 200,      // 100 + 10% of 1000
            y: 300,      // 100 + 20% of 1000
            width: 300,  // 30% of 1000
            height: 400  // 40% of 1000
        });
    });

    it('should handle rounding', () => {
        const estate = new ScreenEstate(33.33, 0, 33.33, 100);
        const monitor = { x: 0, y: 0, width: 1920, height: 1080 };
        const absolute = estate.toAbsolute(monitor);
        
        expect(absolute.x).toBe(640); 
        expect(absolute.width).toBe(640);
    });
});

describe('Validation & Immutability', () => {
    it('should allow correct layouts', () => {
        expect(() => new Layout([
            new ScreenEstate(0, 0, 50, 100),
            new ScreenEstate(50, 0, 50, 100)
        ])).not.toThrow();
    });

    it('should throw on out of bounds ScreenEstate', () => {
        expect(() => new ScreenEstate(0, 0, 110, 100)).toThrow('out of bounds');
    });

    it('should throw on overlapping estates in Layout', () => {
        const e1 = new ScreenEstate(0, 0, 60, 100);
        const e2 = new ScreenEstate(40, 0, 60, 100);
        expect(() => new Layout([e1, e2])).toThrow('Overlap detected');
    });

    it('should be immutable', () => {
        const estate = new ScreenEstate(0, 0, 100, 100);
        expect(() => { estate.pct_x = 10; }).toThrow();

        const layout = new Layout([estate]);
        expect(() => { layout.estates = []; }).toThrow();
        expect(() => { layout.estates.push(estate); }).toThrow();
    });

    it('should allow adjacent edges without overlap', () => {
        expect(() => new Layout([
            new ScreenEstate(0, 0, 50, 100),
            new ScreenEstate(50, 0, 50, 100)
        ])).not.toThrow();
    });

    it('should validate the default escalator layouts', () => {
        const escalator = createDefaultEscalator();
        for (let i = 1; i <= 3; i++) {
            const layout = escalator.getLayoutForCount(i);
            expect(layout).toBeDefined();
            expect(layout.size).toBe(i);
        }
    });
});
