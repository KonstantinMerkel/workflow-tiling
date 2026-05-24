

/**
 * ScreenEstate: Immutable data object holding percentages (0-100).
 */
export class ScreenEstate {

    constructor(pct_x, pct_y, pct_w, pct_h) {
        this.EPSILON = 0.01
        if (pct_x < 0 || pct_y < 0 || (pct_x + pct_w) > (100 + this.EPSILON) || (pct_y + pct_h) > (100 + this.EPSILON)) {
            throw new Error(`ScreenEstate out of bounds: x=${pct_x}, y=${pct_y}, w=${pct_w}, h=${pct_h}`);
        }
        this.pct_x = pct_x;
        this.pct_y = pct_y;
        this.pct_w = pct_w;
        this.pct_h = pct_h;
        Object.freeze(this); // Lock the state
    }

    /**
     * Calculates absolute pixels with gap support.
     */
    toAbsolute(monitorRect, gaps = { inner: 6, outer: 4 }) {
        const base = {
            x: monitorRect.x + (monitorRect.width * (this.pct_x / 100)),
            y: monitorRect.y + (monitorRect.height * (this.pct_y / 100)),
            w: monitorRect.width * (this.pct_w / 100),
            h: monitorRect.height * (this.pct_h / 100)
        };

        const innerHalf = gaps.inner / 2;
        const outer = gaps.outer;

        const gapMargins = {
            left:   this.pct_x <= this.EPSILON ? outer : innerHalf,
            right:  (this.pct_x + this.pct_w) >= (100 - this.EPSILON) ? outer : innerHalf,
            top:    this.pct_y <= this.EPSILON ? outer : innerHalf,
            bottom: (this.pct_y + this.pct_h) >= (100 - this.EPSILON) ? outer : innerHalf
        };

        return {
            x: Math.round(base.x + gapMargins.left),
            y: Math.round(base.y + gapMargins.top),
            width: Math.round(base.w - gapMargins.left - gapMargins.right),
            height: Math.round(base.h - gapMargins.top - gapMargins.bottom)
        };
    }
}

export class Layout {
    constructor(estates = []) {
        this._validate(estates);
        this.estates = Object.freeze([...estates]);
        Object.freeze(this);
    }

    _validate(estates) {
        const hasOverlap = estates.some((e1, i) => 
            estates.slice(i + 1).some(e2 => this._intersects(e1, e2))
        );
        if (hasOverlap) throw new Error('Overlap detected between estates');
    }

    _intersects(e1, e2) {
        const eps = 0.01;
        return !(
            e2.pct_x >= e1.pct_x + e1.pct_w - eps ||
            e2.pct_x + e2.pct_w <= e1.pct_x + eps ||
            e2.pct_y >= e1.pct_y + e1.pct_h - eps ||
            e2.pct_y + e2.pct_h <= e1.pct_y + eps
        );
    }

    getEstate(index) {
        return this.estates[index] || null;
    }

    get size() {
        return this.estates.length;
    }
}

export class LayoutEscalator {
    constructor(layoutsMap = new Map()) {
        this._layouts = new Map(layoutsMap);
        Object.freeze(this);
    }

    getLayoutForCount(windowCount) {
        return this._layouts.get(windowCount) || null;
    }
}

export function createDefaultEscalator() {
    const layouts = new Map([
        [1, new Layout([new ScreenEstate(0, 0, 100, 100)])],
        [2, new Layout([
            new ScreenEstate(0, 0, 50, 100),
            new ScreenEstate(50, 0, 50, 100)
        ])],
        [3, new Layout([
            new ScreenEstate(0, 0, 50, 100),
            new ScreenEstate(50, 0, 50, 50),
            new ScreenEstate(50, 50, 50, 50)
        ])]
    ]);
    return new LayoutEscalator(layouts);
}
