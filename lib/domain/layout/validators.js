const EPSILON = 0.01;

export class LayoutValidator {
    /**
     * Validates the estates of one layout: ids 0…n-1, no overlap, full coverage.
     * @param {Array} estates ScreenEstates
     * @throws {Error} describing the first violation
     */
    static validate(estates) {
        const count = estates.length;

        const ids = new Set(estates.map((e) => e.id));
        if (ids.size !== count) {
            throw new Error(`must have unique ids from 0 to ${count - 1}`);
        }
        for (let i = 0; i < count; i++) {
            if (!ids.has(i)) throw new Error(`is missing id ${i}`);
        }

        const overlap = estates.some((a, i) => estates.slice(i + 1).some((b) => LayoutValidator._intersects(a, b)));
        if (overlap) throw new Error('overlap detected between estates');

        const area = estates.reduce((sum, e) => sum + e.pct_w * e.pct_h, 0);
        if (Math.abs(area - 10000) > 0.1) {
            throw new Error(`total area is ${area}, expected 10000 (must have no gaps)`);
        }
    }

    static _intersects(a, b) {
        return !(
            b.pct_x >= a.pct_x + a.pct_w - EPSILON ||
            b.pct_x + b.pct_w <= a.pct_x + EPSILON ||
            b.pct_y >= a.pct_y + a.pct_h - EPSILON ||
            b.pct_y + b.pct_h <= a.pct_y + EPSILON
        );
    }
}

export class LayoutEscalatorValidator {
    /**
     * Validates that layouts exist for 1…max windows and that layout n has n estates.
     * @param {Map<number, {size: number}>} layouts
     * @throws {Error} describing the first violation
     */
    static validate(layouts) {
        const counts = [...layouts.keys()].sort((a, b) => a - b);
        if (counts.length === 0) return;
        if (counts[0] !== 1) throw new Error('Layout sequence must start with 1 window');

        const max = counts[counts.length - 1];
        for (let i = 1; i <= max; i++) {
            const layout = layouts.get(i);
            if (!layout) throw new Error(`Layout sequence is missing layout for ${i} window(s)`);
            if (layout.size !== i) {
                throw new Error(`Layout for ${i} window(s) contains ${layout.size} estates, expected ${i}`);
            }
        }
    }
}
