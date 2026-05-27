

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
        return currLayout.estates;
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

            const parsedArray = arr.map(e => {
                if (e.id === undefined) {
                    throw new Error(`Layout for count ${count} has estate without an id`);
                }
                const idVal = parseInt(e.id, 10);
                if (isNaN(idVal) || idVal < 1) {
                    throw new Error(`Layout for count ${count} has invalid id ${e.id}`);
                }
                return {
                    estate: new ScreenEstate(e.x, e.y, e.w, e.h),
                    slot: idVal - 1
                };
            });

            // Validate uniqueness and completeness of ids
            const idSet = new Set(parsedArray.map(item => item.slot + 1));
            if (idSet.size !== count) {
                throw new Error(`Layout for count ${count} must have unique ids from 1 to ${count}`);
            }
            for (let i = 1; i <= count; i++) {
                if (!idSet.has(i)) {
                    throw new Error(`Layout for count ${count} is missing id ${i}`);
                }
            }

            parsedArray.sort((a, b) => a.slot - b.slot);
            const estates = parsedArray.map(item => item.estate);
            const layout = new Layout(estates);
            
            LayoutValidator.validateCoverage(layout);
            
            layouts.set(count, layout);
        }

        if (layouts.size === 0) return null;
        return new LayoutEscalator(layouts);
    }
}
