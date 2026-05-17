import { describe, it, expect } from 'vitest';
import { ScreenEstate, Layout, createDefaultEscalator } from '../lib/layout.js';

describe('ScreenEstate', () => {
    it('should calculate absolute coordinates with gaps', () => {
        // TilingConfig.GAPS.OUTER = 4, INNER = 6
        const estate = new ScreenEstate(0, 0, 100, 100);
        const monitor = { x: 0, y: 0, width: 1000, height: 1000 };
        const absolute = estate.toAbsolute(monitor);

        expect(absolute).toEqual({
            x: 4,
            y: 4,
            width: 992,
            height: 992
        });
    });

    it('should calculate inner gaps correctly in a split', () => {
        const leftEstate = new ScreenEstate(0, 0, 50, 100);
        const monitor = { x: 0, y: 0, width: 1000, height: 1000 };
        const leftAbs = leftEstate.toAbsolute(monitor);

        expect(leftAbs.x).toBe(4);
        expect(leftAbs.width).toBe(493); 

        const rightEstate = new ScreenEstate(50, 0, 50, 100);
        const rightAbs = rightEstate.toAbsolute(monitor);

        expect(rightAbs.x).toBe(503); 
        expect(rightAbs.width).toBe(493); 
        
        expect(rightAbs.x - (leftAbs.x + leftAbs.width)).toBe(6);
    });

    it('should throw on out of bounds', () => {
        expect(() => new ScreenEstate(-1, 0, 100, 100)).toThrow();
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

    it('should validate the default escalator layouts', () => {
        const escalator = createDefaultEscalator();
        for (let i = 1; i <= 3; i++) {
            const layout = escalator.getLayoutForCount(i);
            expect(layout).toBeDefined();
            expect(layout.size).toBe(i);
        }
    });
});
