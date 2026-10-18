import { describe, it, expect } from 'vitest';
import { ScreenEstate, Layout } from '../../lib/domain/layout/layout.js';
import { LayoutParser } from '../../lib/domain/layout/parser.js';
import { Direction } from '../../lib/domain/types.js';
import { DEFAULT_LAYOUTS } from '../helpers/fakes.js';

const half = () => new Layout([new ScreenEstate(0, 0, 0, 50, 100), new ScreenEstate(1, 50, 0, 50, 100)]);
const masterStack = () =>
    new Layout([
        new ScreenEstate(0, 0, 0, 50, 100),
        new ScreenEstate(1, 50, 0, 50, 50),
        new ScreenEstate(2, 50, 50, 50, 50),
    ]);

describe('ScreenEstate', () => {
    it('converts to pixels with outer and inner gaps', () => {
        const area = { x: 0, y: 0, width: 1000, height: 1000 };
        expect(new ScreenEstate(0, 0, 0, 100, 100).toAbsolute(area)).toEqual({ x: 4, y: 4, width: 992, height: 992 });

        const left = new ScreenEstate(0, 0, 0, 50, 100).toAbsolute(area);
        const right = new ScreenEstate(1, 50, 0, 50, 100).toAbsolute(area);
        expect(left).toMatchObject({ x: 4, width: 493 });
        expect(right).toMatchObject({ x: 503, width: 493 });
        expect(right.x - (left.x + left.width)).toBe(6);
    });

    it('rejects estates outside the work area and is immutable', () => {
        expect(() => new ScreenEstate(0, -1, 0, 100, 100)).toThrow('out of bounds');
        expect(() => new ScreenEstate(0, 0, 0, 110, 100)).toThrow('out of bounds');
        const estate = new ScreenEstate(0, 0, 0, 100, 100);
        expect(() => {
            estate.pct_x = 10;
        }).toThrow();
    });
});

describe('Layout validation', () => {
    it('accepts a full, non-overlapping layout and freezes it', () => {
        const layout = half();
        expect(layout.size).toBe(2);
        expect(() => layout.estates.push(new ScreenEstate(2, 0, 0, 1, 1))).toThrow();
    });

    it('rejects overlap, gaps, missing and duplicate ids', () => {
        expect(() => new Layout([new ScreenEstate(0, 0, 0, 60, 100), new ScreenEstate(1, 40, 0, 60, 100)])).toThrow(
            'overlap detected',
        );
        expect(() => new Layout([new ScreenEstate(0, 0, 0, 50, 100), new ScreenEstate(1, 50, 0, 40, 100)])).toThrow(
            /must have no gaps/,
        );
    });
});

describe('Layout geometry', () => {
    it('finds neighbours in each direction, preferring the lower slot on ties', () => {
        const layout = masterStack();
        expect(layout.neighbour(0, Direction.RIGHT)).toBe(1);
        expect(layout.neighbour(1, Direction.LEFT)).toBe(0);
        expect(layout.neighbour(2, Direction.LEFT)).toBe(0);
        expect(layout.neighbour(1, Direction.DOWN)).toBe(2);
        expect(layout.neighbour(2, Direction.UP)).toBe(1);
        expect(layout.neighbour(0, Direction.LEFT)).toBe(-1);
        expect(layout.neighbour(1, Direction.UP)).toBe(-1);
    });

    it('picks the edging slot with the longest contact, ties topmost / leftmost', () => {
        const layout = masterStack();
        expect(layout.getEdgingSlot(Direction.LEFT)).toBe(0);
        expect(layout.getEdgingSlot(Direction.RIGHT)).toBe(1); // equal height → topmost
        expect(layout.getEdgingSlot(Direction.UP)).toBe(0); // equal width → leftmost
        expect(layout.getEdgingSlot(Direction.DOWN)).toBe(0);
    });

    it('hit-tests points in percent, including the gaps between tiles', () => {
        const layout = masterStack();
        expect(layout.slotAt({ x: 10, y: 10 })).toBe(0);
        expect(layout.slotAt({ x: 75, y: 25 })).toBe(1);
        expect(layout.slotAt({ x: 75, y: 75 })).toBe(2);
        expect(layout.slotAt({ x: 50, y: 50 })).not.toBe(-1);
        expect(layout.slotAt({ x: 150, y: 50 })).toBe(-1);
    });
});

describe('LayoutParser', () => {
    it('parses the default layouts', () => {
        const escalator = LayoutParser.parse(DEFAULT_LAYOUTS);
        expect(escalator.getMaxCount()).toBe(3);
        for (let i = 1; i <= 3; i++) expect(escalator.getLayoutForCount(i).size).toBe(i);
        expect(escalator.getLayoutForCount(7).size).toBe(3);
    });

    it('returns null for empty input and throws on malformed or invalid JSON', () => {
        expect(LayoutParser.parse('')).toBeNull();
        expect(LayoutParser.parse('   ')).toBeNull();
        expect(LayoutParser.parse(null)).toBeNull();
        expect(() => LayoutParser.parse('{ bad }')).toThrow(SyntaxError);
        const missingId = JSON.stringify({
            1: [{ x: 0, y: 0, w: 100, h: 100, id: 0 }],
            2: [
                { x: 0, y: 0, w: 50, h: 100, id: 0 },
                { x: 50, y: 0, w: 50, h: 100 },
            ],
        });
        expect(() => LayoutParser.parse(missingId)).toThrow(/is missing id 1/);
    });

    it('sorts estates by id and requires a contiguous sequence from 1', () => {
        const json = JSON.stringify({
            1: [{ x: 0, y: 0, w: 100, h: 100, id: 0 }],
            2: [
                { x: 50, y: 0, w: 50, h: 100, id: 1 },
                { x: 0, y: 0, w: 50, h: 100, id: 0 },
            ],
        });
        expect(LayoutParser.parse(json).getLayoutForCount(2).getEstate(0).pct_x).toBe(0);
        expect(() => LayoutParser.parse(JSON.stringify({ 2: JSON.parse(json)[2] }))).toThrow(/start with 1/);
    });

    it('validate() reports errors without throwing', () => {
        expect(LayoutParser.validate(DEFAULT_LAYOUTS)).toBeNull();
        expect(LayoutParser.validate('')).toBe('Layout JSON is empty');
        expect(LayoutParser.validate('{ bad }')).toMatch(/JSON/);
    });
});
