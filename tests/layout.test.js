import { describe, it, expect } from 'vitest';
import { ScreenEstate, Layout, LayoutParser, LayoutValidator } from '../lib/layout.js';

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
        const defaultJson = '{"1":[{"x":0,"y":0,"w":100,"h":100,"id":1}],"2":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":100,"id":2}],"3":[{"x":0,"y":0,"w":50,"h":100,"id":1},{"x":50,"y":0,"w":50,"h":50,"id":2},{"x":50,"y":50,"w":50,"h":50,"id":3}]}';
        const escalator = LayoutParser.parse(defaultJson);
        for (let i = 1; i <= 3; i++) {
            const layout = escalator.getLayoutForCount(i);
            expect(layout).toBeDefined();
            expect(layout.size).toBe(i);
        }
    });
});

describe('LayoutValidator', () => {
    describe('validateCoverage', () => {
        it('should pass for exact 10000 area', () => {
            const layout = new Layout([
                new ScreenEstate(0, 0, 100, 100)
            ]);
            expect(() => LayoutValidator.validateCoverage(layout)).not.toThrow();
        });

        it('should throw if area is less than 10000', () => {
            const layout = new Layout([
                new ScreenEstate(0, 0, 50, 100),
                new ScreenEstate(50, 0, 40, 100)
            ]);
            expect(() => LayoutValidator.validateCoverage(layout)).toThrow(/expected 10000/);
        });
    });

    describe('Arbitrary Transitions', () => {
        it('should allow arbitrary transitions like 50/50 split to 33/33/33 split', () => {
            const json = JSON.stringify({
                "1": [ { "x": 0, "y": 0, "w": 100, "h": 100, "id": 1 } ],
                "2": [ { "x": 0, "y": 0, "w": 50, "h": 100, "id": 1 }, { "x": 50, "y": 0, "w": 50, "h": 100, "id": 2 } ],
                "3": [ { "x": 0, "y": 0, "w": 33.33, "h": 100, "id": 1 }, { "x": 33.33, "y": 0, "w": 33.33, "h": 100, "id": 2 }, { "x": 66.66, "y": 0, "w": 33.34, "h": 100, "id": 3 } ]
            });
            const escalator = LayoutParser.parse(json);
            expect(escalator).not.toBeNull();
            
            const l3 = escalator.getLayoutForCount(3);
            expect(l3.size).toBe(3);
            expect(l3.getEstate(0).pct_w).toBeCloseTo(33.33);
            expect(l3.getEstate(1).pct_w).toBeCloseTo(33.33);
            expect(l3.getEstate(2).pct_w).toBeCloseTo(33.34);
        });
    });
});

describe('LayoutParser', () => {
    it('should return null for empty string', () => {
        expect(LayoutParser.parse('')).toBeNull();
        expect(LayoutParser.parse('   ')).toBeNull();
        expect(LayoutParser.parse(null)).toBeNull();
    });

    it('should throw on invalid JSON syntax', () => {
        expect(() => LayoutParser.parse('{ bad }')).toThrow(/Invalid JSON syntax/);
    });

    it('should parse valid json and return escalator', () => {
        const json = JSON.stringify({
            "1": [ { "x": 0, "y": 0, "w": 100, "h": 100, "id": 1 } ],
            "2": [ { "x": 0, "y": 0, "w": 50, "h": 100, "id": 1 }, { "x": 50, "y": 0, "w": 50, "h": 100, "id": 2 } ]
        });
        const escalator = LayoutParser.parse(json);
        expect(escalator).not.toBeNull();
        
        const l1 = escalator.getLayoutForCount(1);
        expect(l1.size).toBe(1);
        const l2 = escalator.getLayoutForCount(2);
        expect(l2.size).toBe(2);
    });

    it('should sort estates by id property', () => {
        const json = JSON.stringify({
            "3": [
                { "x": 33.33, "y": 0, "w": 33.33, "h": 100, "id": 3 },
                { "x": 66.66, "y": 0, "w": 33.34, "h": 100, "id": 2 },
                { "x": 0, "y": 0, "w": 33.33, "h": 100, "id": 1 }
            ]
        });
        const escalator = LayoutParser.parse(json);
        const l3 = escalator.getLayoutForCount(3);
        expect(l3.getEstate(0).pct_x).toBe(0);
        expect(l3.getEstate(1).pct_x).toBe(66.66);
        expect(l3.getEstate(2).pct_x).toBe(33.33);
    });

    it('should throw if any estate is missing an id', () => {
        const json = JSON.stringify({
            "2": [
                { "x": 0, "y": 0, "w": 50, "h": 100, "id": 1 },
                { "x": 50, "y": 0, "w": 50, "h": 100 }
            ]
        });
        expect(() => LayoutParser.parse(json)).toThrow(/has estate without an id/);
    });

    it('should throw if duplicate ids are present', () => {
        const json = JSON.stringify({
            "2": [
                { "x": 0, "y": 0, "w": 50, "h": 100, "id": 1 },
                { "x": 50, "y": 0, "w": 50, "h": 100, "id": 1 }
            ]
        });
        expect(() => LayoutParser.parse(json)).toThrow(/must have unique ids/);
    });

    it('should throw if id is out of bounds', () => {
        const json = JSON.stringify({
            "2": [
                { "x": 0, "y": 0, "w": 50, "h": 100, "id": 1 },
                { "x": 50, "y": 0, "w": 50, "h": 100, "id": 3 }
            ]
        });
        expect(() => LayoutParser.parse(json)).toThrow(/is missing id 2/);
    });
});
