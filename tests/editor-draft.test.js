import { describe, it, expect } from 'vitest';
import {
    MIN_SLOT,
    toDraft,
    cutsOf,
    cutAt,
    cutRange,
    moveCut,
    sizeRange,
    resizeSlot,
    slotAt,
    splitSlot,
    splitLargest,
    slotColor,
} from '../prefs/draft.js';
import { LayoutParser } from '../lib/domain/layout/parser.js';

const single = [{ id: 0, x: 0, y: 0, w: 100, h: 100 }];
const halves = [
    { id: 0, x: 0, y: 0, w: 50, h: 100 },
    { id: 1, x: 50, y: 0, w: 50, h: 100 },
];

// Master left, two stacked slots right.
const masterStack = () => [
    { id: 0, x: 0, y: 0, w: 60, h: 100 },
    { id: 1, x: 60, y: 0, w: 40, h: 50 },
    { id: 2, x: 60, y: 50, w: 40, h: 50 },
];

describe('editor draft geometry', () => {
    it('rounds edges so shared edges stay shared', () => {
        const third = 100 / 3;
        const thirds = [0, 1, 2].map((i) => ({ id: i, x: i * third, y: 0, w: third, h: 100 }));
        const parse = (three) => LayoutParser.parse(JSON.stringify({ 1: single, 2: halves, 3: three }));
        const draft = toDraft(parse(thirds).getLayoutForCount(3).estates);
        expect(draft).toEqual([
            { id: 0, x: 0, y: 0, w: 33, h: 100 },
            { id: 1, x: 33, y: 0, w: 34, h: 100 },
            { id: 2, x: 67, y: 0, w: 33, h: 100 },
        ]);
        moveCut(draft, 'x', 67, 90);
        expect(() => parse(draft)).not.toThrow();
    });

    it('lists interior cuts per axis', () => {
        expect(cutsOf(masterStack(), 'x')).toEqual([60]);
        expect(cutsOf(masterStack(), 'y')).toEqual([50]);
    });

    it('finds the nearest cut within tolerance', () => {
        expect(cutAt(masterStack(), 'x', 58, 3)).toBe(60);
        expect(cutAt(masterStack(), 'x', 50, 3)).toBeNull();
    });

    it('limits a cut so adjacent slots keep the minimum size', () => {
        expect(cutRange(masterStack(), 'x', 60)).toEqual([MIN_SLOT, 100 - MIN_SLOT]);
        const slots = [
            { id: 0, x: 0, y: 0, w: 30, h: 100 },
            { id: 1, x: 30, y: 0, w: 40, h: 100 },
            { id: 2, x: 70, y: 0, w: 30, h: 100 },
        ];
        expect(cutRange(slots, 'x', 30)).toEqual([5, 65]);
        expect(cutRange(slots, 'x', 70)).toEqual([35, 95]);
    });

    it('moves every edge on a cut and clamps the target', () => {
        const slots = masterStack();
        expect(moveCut(slots, 'x', 60, 70.4)).toBe(70);
        expect(slots).toEqual([
            { id: 0, x: 0, y: 0, w: 70, h: 100 },
            { id: 1, x: 70, y: 0, w: 30, h: 50 },
            { id: 2, x: 70, y: 50, w: 30, h: 50 },
        ]);
        expect(moveCut(slots, 'x', 70, 99)).toBe(95);
        expect(slots[1]).toMatchObject({ x: 95, w: 5 });
    });

    it('sizes a slot through its far edge', () => {
        const slots = masterStack();
        expect(sizeRange(slots, 0, 'x')).toEqual([5, 95]);
        resizeSlot(slots, 0, 'x', 75);
        expect(slots[0].w).toBe(75);
        expect(slots[1]).toMatchObject({ x: 75, w: 25 });
    });

    it('sizes a slot touching the far border through its near edge', () => {
        const slots = masterStack();
        expect(sizeRange(slots, 1, 'x')).toEqual([5, 95]);
        resizeSlot(slots, 1, 'x', 30);
        expect(slots[1]).toMatchObject({ x: 70, w: 30 });
        expect(slots[0].w).toBe(70);
        resizeSlot(slots, 2, 'y', 20);
        expect(slots[1].h).toBe(80);
        expect(slots[2]).toMatchObject({ y: 80, h: 20 });
    });

    it('treats a slot spanning the whole axis as fixed', () => {
        const slots = masterStack();
        expect(sizeRange(slots, 0, 'y')).toEqual([100, 100]);
        resizeSlot(slots, 0, 'y', 40);
        expect(slots).toEqual(masterStack());
    });

    it('hit-tests slots by percent position', () => {
        expect(slotAt(masterStack(), 30, 30)).toBe(0);
        expect(slotAt(masterStack(), 80, 80)).toBe(2);
        expect(slotAt(masterStack(), 120, 80)).toBe(-1);
    });

    it('splits a slot and hands the far part the next id', () => {
        const base = masterStack();
        const split = splitSlot(base, 0, 'y', 39.7);
        expect(split).toEqual([
            { id: 0, x: 0, y: 0, w: 60, h: 40 },
            { id: 1, x: 60, y: 0, w: 40, h: 50 },
            { id: 2, x: 60, y: 50, w: 40, h: 50 },
            { id: 3, x: 0, y: 40, w: 60, h: 60 },
        ]);
        expect(base).toEqual(masterStack());
    });

    it('rejects splits leaving a part below the minimum', () => {
        expect(splitSlot(masterStack(), 1, 'x', 62)).toBeNull();
        expect(splitSlot(masterStack(), 1, 'x', 98)).toBeNull();
    });

    it('halves the largest slot along its longer side', () => {
        expect(splitLargest(masterStack())[0]).toEqual({ id: 0, x: 0, y: 0, w: 60, h: 50 });
        expect(splitLargest([{ id: 0, x: 0, y: 0, w: 100, h: 100 }])).toEqual([
            { id: 0, x: 0, y: 0, w: 50, h: 100 },
            { id: 1, x: 50, y: 0, w: 50, h: 100 },
        ]);
    });

    it('refuses to halve a slot below twice the minimum', () => {
        expect(splitLargest([{ id: 0, x: 0, y: 0, w: 9, h: 9 }])).toBeNull();
    });

    it('produces layouts the parser accepts', () => {
        let slots = [{ id: 0, x: 0, y: 0, w: 100, h: 100 }];
        const data = { 1: slots };
        for (let n = 2; n <= 6; n++) {
            slots = splitLargest(slots);
            moveCut(slots, 'x', cutsOf(slots, 'x')[0], 37);
            data[n] = slots;
        }
        expect(() => LayoutParser.parse(JSON.stringify(data))).not.toThrow();
    });

    it('gives each slot a clearly distinct colour', () => {
        const colors = Array.from({ length: 12 }, (_, i) => slotColor(i));
        for (const c of colors) {
            for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
            for (const v of c) expect(v).toBeLessThanOrEqual(1);
        }
        const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        for (let i = 0; i < colors.length; i++) {
            for (let j = i + 1; j < colors.length; j++) {
                expect(distance(colors[i], colors[j])).toBeGreaterThan(0.1);
            }
        }
    });
});
