import { getEdgingSlotForEstates } from './utils/geometry.js';
import { LayoutValidator, LayoutEscalatorValidator } from './utils/layout-validators.js';
import { Logger } from './utils/logger.js';

/**
 * ScreenEstate: Immutable data object 
 * representing a quadar of space on a monitor to which a window can be tiled
 * 
 * @param id 0-based id field (json); traker for screenEstate continuity on (de-)escalation
 * @param pct_h height occupied in percent
 * @param pct_w width occupied in percent
 * @param pct_x from x cooridnate in percent
 * @param pct_y from y cooridnate in percent
 */
export class ScreenEstate {

    constructor(id, pct_x, pct_y, pct_w, pct_h) {
        this.id = id;
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
     * @param monitorRect coordinates of the whole monitor in GNOME unified grid
     * @param gaps object defining the inner and outer gaps to be factored in
     * @returns the occupied space in absolute pixels
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
 * Defines the layout for a fixed number of windows
 * @param {List[ScreenEstate]} estates Congruent collection of ScreenEstates
 * @throws invalid layout may throw an error
 */
export class Layout {
    constructor(estates = []) {
        LayoutValidator.validate(estates);
        this.estates = Object.freeze([...estates]);
        Object.freeze(this);
    }

    // Invariant: estates[i].id === i for all i. This holds because the parser
    // sorts estates by id before constructing the Layout.
    getEstate(id) {
        const estate = this.estates[id] || null;
        if (estate && estate.id !== id) {
            Logger.error(`Layout invariant violated: estates[${id}].id is ${estate.id}`);
        }
        return estate;
    }

    get size() {
        return this.estates.length;
    }

    // wraps geometry
    getEdgingSlot(direction) {
        return getEdgingSlotForEstates(this.estates, direction);
    }
}


/**
 * Responsible for coordinating layout for variable number of windows
 * @param {Map} layoutsMap maps number of windows to appropriate layout
 * @throws invalid escalator will throw an error 
 */
export class LayoutEscalator {
    constructor(layoutsMap = new Map()) {
        LayoutEscalatorValidator.validate(layoutsMap);
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

    getMaxCount() {
        return this._maxCount;
    }
}
