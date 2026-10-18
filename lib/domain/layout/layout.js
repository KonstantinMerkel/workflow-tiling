import { Direction } from '../types.js';
import { LayoutValidator, LayoutEscalatorValidator } from './validators.js';

const EPSILON = 0.01;

/**
 * Immutable rectangle of a layout in percent of the work area.
 */
export class ScreenEstate {
    /**
     * @param {number} id slot this estate belongs to
     * @param {number} pct_x left edge in percent
     * @param {number} pct_y top edge in percent
     * @param {number} pct_w width in percent
     * @param {number} pct_h height in percent
     */
    constructor(id, pct_x, pct_y, pct_w, pct_h) {
        if (pct_x < 0 || pct_y < 0 || pct_x + pct_w > 100 + EPSILON || pct_y + pct_h > 100 + EPSILON) {
            throw new Error(`ScreenEstate out of bounds: x=${pct_x}, y=${pct_y}, w=${pct_w}, h=${pct_h}`);
        }
        this.id = id;
        this.pct_x = pct_x;
        this.pct_y = pct_y;
        this.pct_w = pct_w;
        this.pct_h = pct_h;
        Object.freeze(this);
    }

    /**
     * Converts the estate into a pixel frame inside the work area. Edges touching the work area border get the
     * outer gap, inner edges half the inner gap.
     * @param {{x:number, y:number, width:number, height:number}} workArea
     * @param {{inner:number, outer:number}} gaps
     * @returns {{x:number, y:number, width:number, height:number}}
     */
    toAbsolute(workArea, gaps = { inner: 6, outer: 4 }) {
        const x = workArea.x + workArea.width * (this.pct_x / 100);
        const y = workArea.y + workArea.height * (this.pct_y / 100);
        const w = workArea.width * (this.pct_w / 100);
        const h = workArea.height * (this.pct_h / 100);

        const half = gaps.inner / 2;
        const left = this.pct_x <= EPSILON ? gaps.outer : half;
        const right = this.pct_x + this.pct_w >= 100 - EPSILON ? gaps.outer : half;
        const top = this.pct_y <= EPSILON ? gaps.outer : half;
        const bottom = this.pct_y + this.pct_h >= 100 - EPSILON ? gaps.outer : half;

        return {
            x: Math.round(x + left),
            y: Math.round(y + top),
            width: Math.round(w - left - right),
            height: Math.round(h - top - bottom),
        };
    }

    /** @returns {boolean} whether the estate touches the given edge of the work area */
    touches(edge) {
        switch (edge) {
            case Direction.LEFT: return this.pct_x <= EPSILON;
            case Direction.RIGHT: return this.pct_x + this.pct_w >= 100 - EPSILON;
            case Direction.UP: return this.pct_y <= EPSILON;
            case Direction.DOWN: return this.pct_y + this.pct_h >= 100 - EPSILON;
            default: return false;
        }
    }
}

/**
 * Immutable set of estates for a fixed number of windows. Estate i belongs to slot i.
 */
export class Layout {
    /**
     * @param {ScreenEstate[]} estates sorted by id
     * @throws {Error} on invalid estates
     */
    constructor(estates = []) {
        LayoutValidator.validate(estates);
        this.estates = Object.freeze([...estates]);
        Object.freeze(this);
    }

    get size() {
        return this.estates.length;
    }

    /** @returns {ScreenEstate|null} */
    getEstate(slot) {
        return this.estates[slot] ?? null;
    }

    /**
     * Slot entered when crossing into this layout through `edge`: among the estates touching that edge, the one
     * with the longest contact; ties go to the topmost estate on left / right edges and to the leftmost on
     * top / bottom edges.
     * @param {string} edge Direction naming the edge
     * @returns {number} slot or -1
     */
    getEdgingSlot(edge) {
        const vertical = edge === Direction.LEFT || edge === Direction.RIGHT;
        const candidates = this.estates.filter((e) => e.touches(edge));
        if (candidates.length === 0) return -1;

        candidates.sort((a, b) => {
            const contact = vertical ? b.pct_h - a.pct_h : b.pct_w - a.pct_w;
            if (Math.abs(contact) > EPSILON) return contact;
            return vertical ? a.pct_y - b.pct_y : a.pct_x - b.pct_x;
        });
        return candidates[0].id;
    }

    /**
     * Nearest slot in `dir` that overlaps the given slot on the orthogonal axis; ties go to the lower slot.
     * @param {number} slot
     * @param {string} dir Direction
     * @returns {number} slot or -1
     */
    neighbour(slot, dir) {
        const source = this.getEstate(slot);
        if (!source) return -1;

        let best = -1;
        let bestDistance = Infinity;
        for (const candidate of this.estates) {
            if (candidate.id === slot || !Layout._isInDirection(source, candidate, dir)) continue;
            const distance = Layout._distance(source, candidate, dir);
            if (distance < bestDistance - EPSILON) {
                best = candidate.id;
                bestDistance = distance;
            }
        }
        return best;
    }

    /**
     * Slot under a point given in percent of the work area. Estates tile the whole area, so every point inside it
     * belongs to a slot.
     * @param {{x:number, y:number}} pct
     * @returns {number} slot or -1 outside the area
     */
    slotAt(pct) {
        const hit = this.estates.find(
            (e) =>
                pct.x >= e.pct_x - EPSILON &&
                pct.x <= e.pct_x + e.pct_w + EPSILON &&
                pct.y >= e.pct_y - EPSILON &&
                pct.y <= e.pct_y + e.pct_h + EPSILON,
        );
        return hit ? hit.id : -1;
    }

    static _isInDirection(source, candidate, dir) {
        if (dir === Direction.LEFT || dir === Direction.RIGHT) {
            const overlap =
                Math.max(candidate.pct_y, source.pct_y) <
                Math.min(candidate.pct_y + candidate.pct_h, source.pct_y + source.pct_h) - EPSILON;
            if (!overlap) return false;
            return dir === Direction.LEFT
                ? candidate.pct_x + candidate.pct_w <= source.pct_x + EPSILON
                : candidate.pct_x >= source.pct_x + source.pct_w - EPSILON;
        }
        const overlap =
            Math.max(candidate.pct_x, source.pct_x) <
            Math.min(candidate.pct_x + candidate.pct_w, source.pct_x + source.pct_w) - EPSILON;
        if (!overlap) return false;
        return dir === Direction.UP
            ? candidate.pct_y + candidate.pct_h <= source.pct_y + EPSILON
            : candidate.pct_y >= source.pct_y + source.pct_h - EPSILON;
    }

    static _distance(source, candidate, dir) {
        switch (dir) {
            case Direction.LEFT: return source.pct_x - (candidate.pct_x + candidate.pct_w);
            case Direction.RIGHT: return candidate.pct_x - (source.pct_x + source.pct_w);
            case Direction.UP: return source.pct_y - (candidate.pct_y + candidate.pct_h);
            default: return candidate.pct_y - (source.pct_y + source.pct_h);
        }
    }
}

/**
 * Immutable map from window count to layout. Counts above the maximum use the largest layout.
 */
export class LayoutEscalator {
    /**
     * @param {Map<number, Layout>} layouts
     * @throws {Error} on an invalid sequence
     */
    constructor(layouts = new Map()) {
        LayoutEscalatorValidator.validate(layouts);
        this._layouts = new Map(layouts);
        this._maxCount = Math.max(0, ...this._layouts.keys());
        Object.freeze(this);
    }

    /** @returns {Layout|null} */
    getLayoutForCount(count) {
        return this._layouts.get(Math.min(count, this._maxCount)) ?? null;
    }

    getMaxCount() {
        return this._maxCount;
    }
}
