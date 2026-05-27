

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

/**
 * Layout class. Groups screen estates.
 */
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

/**
 * Escalator class. Maps window count to layout.
 */
export class LayoutEscalator {
    constructor(layoutsMap = new Map()) {
        this._layouts = new Map(layoutsMap);
        this._maxCount = Math.max(...Array.from(this._layouts.keys()), 0);
        Object.freeze(this);
    }

    getLayoutForCount(windowCount) {
        if (windowCount > this._maxCount) {
            return this._layouts.get(this._maxCount) || null;
        }
        return this._layouts.get(windowCount) || null;
    }
}



export class LayoutValidator {
    static validateCoverage(layout) {
        let area = 0;
        layout.estates.forEach(e => {
            area += (e.pct_w * e.pct_h);
        });
        if (Math.abs(area - 10000) > 0.1) {
            throw new Error(`Total area is ${area}, expected 10000. Layout must have no gaps.`);
        }
    }

    static validateAndAlignOneCutAway(prevLayout, currLayout) {
        if (!prevLayout) return currLayout.estates;

        const isSame = (e1, e2) => Math.abs(e1.pct_x - e2.pct_x) < 0.1 && 
                                   Math.abs(e1.pct_y - e2.pct_y) < 0.1 && 
                                   Math.abs(e1.pct_w - e2.pct_w) < 0.1 && 
                                   Math.abs(e1.pct_h - e2.pct_h) < 0.1;

        // Find the estates in prevLayout that are not exactly in currLayout
        const missingFromCurr = prevLayout.estates.filter(p => !currLayout.estates.some(c => isSame(c, p)));
        
        // Find the estates in currLayout that are not exactly in prevLayout
        const newInCurr = currLayout.estates.filter(c => !prevLayout.estates.some(p => isSame(p, c)));

        if (missingFromCurr.length !== 1) {
            throw new Error(`Expected exactly 1 replaced estate, found ${missingFromCurr.length}`);
        }
        if (newInCurr.length !== 2) {
            throw new Error(`Expected exactly 2 new estates, found ${newInCurr.length}`);
        }

        const replaced = missingFromCurr[0];
        const replacedIndex = prevLayout.estates.findIndex(p => p === replaced);
        
        const e1 = newInCurr[0];
        const e2 = newInCurr[1];

        // Ensure e1 and e2 form replaced exactly
        const combinedArea = (e1.pct_w * e1.pct_h) + (e2.pct_w * e2.pct_h);
        const replacedArea = replaced.pct_w * replaced.pct_h;
        if (Math.abs(combinedArea - replacedArea) > 0.1) {
            throw new Error('New estates area does not match replaced estate area');
        }

        const minX = Math.min(e1.pct_x, e2.pct_x);
        const minY = Math.min(e1.pct_y, e2.pct_y);
        const maxX = Math.max(e1.pct_x + e1.pct_w, e2.pct_x + e2.pct_w);
        const maxY = Math.max(e1.pct_y + e1.pct_h, e2.pct_y + e2.pct_h);

        if (Math.abs(minX - replaced.pct_x) > 0.1 || 
            Math.abs(minY - replaced.pct_y) > 0.1 || 
            Math.abs(maxX - (replaced.pct_x + replaced.pct_w)) > 0.1 || 
            Math.abs(maxY - (replaced.pct_y + replaced.pct_h)) > 0.1) {
            throw new Error('New estates bounding box does not match replaced estate exactly');
        }

        const alignedEstates = [...prevLayout.estates];
        const sortedNew = [e1, e2].sort((a, b) => {
            if (Math.abs(a.pct_y - b.pct_y) > 0.1) return a.pct_y - b.pct_y;
            return a.pct_x - b.pct_x;
        });
        alignedEstates[replacedIndex] = sortedNew[0];
        alignedEstates.push(sortedNew[1]);

        return alignedEstates;
    }
}

export class LayoutParser {
    static parse(jsonString) {
        if (!jsonString || jsonString.trim() === '') {
            return null; // return default indicator
        }
        let data;
        try {
            data = JSON.parse(jsonString);
        } catch (e) {
            throw new Error(`Invalid JSON syntax: ${e.message}`);
        }

        const layouts = new Map();
        let prevLayout = null;
        
        // Sort keys to ensure sequential validation
        const keys = Object.keys(data).map(k => parseInt(k, 10)).sort((a, b) => a - b);
        
        for (const count of keys) {
            const arr = data[count];
            if (!Array.isArray(arr)) {
                throw new Error(`Layout for count ${count} must be an array`);
            }
            if (arr.length !== count) {
                throw new Error(`Layout for count ${count} contains ${arr.length} estates`);
            }

            const estates = arr.map(e => new ScreenEstate(e.x, e.y, e.w, e.h));
            const layout = new Layout(estates);
            
            LayoutValidator.validateCoverage(layout);
            const alignedEstates = LayoutValidator.validateAndAlignOneCutAway(prevLayout, layout);
            const alignedLayout = new Layout(alignedEstates);
            
            layouts.set(count, alignedLayout);
            prevLayout = alignedLayout;
        }

        if (layouts.size === 0) return null;
        return new LayoutEscalator(layouts);
    }
}
