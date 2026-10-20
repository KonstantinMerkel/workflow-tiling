// Geometry of the layout editor. A draft is an array of slots {id, x, y, w, h} in integer percent,
// sorted by id. A "cut" is an interior line (0 < c < 100) on which slot edges meet; moving a cut
// moves every slot edge lying on it, so a draft never develops gaps or overlaps.

export const MIN_SLOT = 5;

// Extent key belonging to each position key.
export const SPAN = { x: 'w', y: 'h' };

// Converts a Layout's estates (sorted by id). Edges are rounded rather than sizes, so slots that
// share an edge still share it after rounding.
export function toDraft(estates) {
    return estates.map((e) => {
        const x = Math.round(e.pct_x);
        const y = Math.round(e.pct_y);
        return { id: e.id, x, y, w: Math.round(e.pct_x + e.pct_w) - x, h: Math.round(e.pct_y + e.pct_h) - y };
    });
}

export function cutsOf(slots, axis) {
    const cuts = new Set(slots.flatMap((s) => [s[axis], s[axis] + s[SPAN[axis]]]));
    return [...cuts].filter((c) => c > 0 && c < 100).sort((a, b) => a - b);
}

// Nearest cut within `tolerance` percent of `pos`, or null.
export function cutAt(slots, axis, pos, tolerance) {
    let best = null;
    for (const c of cutsOf(slots, axis)) {
        if (Math.abs(c - pos) <= tolerance && (best === null || Math.abs(c - pos) < Math.abs(best - pos))) best = c;
    }
    return best;
}

// Positions a cut may take while every slot it bounds keeps at least MIN_SLOT.
export function cutRange(slots, axis, cut) {
    const span = SPAN[axis];
    let lo = MIN_SLOT;
    let hi = 100 - MIN_SLOT;
    for (const s of slots) {
        if (s[axis] + s[span] === cut) lo = Math.max(lo, s[axis] + MIN_SLOT);
        if (s[axis] === cut) hi = Math.min(hi, s[axis] + s[span] - MIN_SLOT);
    }
    return [lo, hi];
}

// Moves the cut towards `to` (rounded, clamped to its range) and returns where it landed.
export function moveCut(slots, axis, cut, to) {
    const span = SPAN[axis];
    const [lo, hi] = cutRange(slots, axis, cut);
    const target = Math.round(Math.min(hi, Math.max(lo, to)));
    for (const s of slots) {
        if (s[axis] === cut) {
            s[span] -= target - cut;
            s[axis] = target;
        } else if (s[axis] + s[span] === cut) {
            s[span] = target - s[axis];
        }
    }
    return target;
}

// A slot is sized through its far edge, or through its near edge when it touches the far border.
// Returns the allowed size range; [100, 100] means the slot spans the whole axis.
export function sizeRange(slots, k, axis) {
    const s = slots[k];
    const end = s[axis] + s[SPAN[axis]];
    if (end < 100) {
        const [lo, hi] = cutRange(slots, axis, end);
        return [lo - s[axis], hi - s[axis]];
    }
    if (s[axis] > 0) {
        const [lo, hi] = cutRange(slots, axis, s[axis]);
        return [100 - hi, 100 - lo];
    }
    return [100, 100];
}

export function resizeSlot(slots, k, axis, size) {
    const s = slots[k];
    const end = s[axis] + s[SPAN[axis]];
    if (end < 100) moveCut(slots, axis, end, s[axis] + size);
    else if (s[axis] > 0) moveCut(slots, axis, s[axis], 100 - size);
}

export function slotAt(slots, px, py) {
    return slots.findIndex((s) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h);
}

// Splits slot k at `at` along `axis`. The slot keeps the near part and a slot with the next free id
// takes the far part. Returns a fresh draft, or null when a part would be smaller than MIN_SLOT.
export function splitSlot(slots, k, axis, at) {
    const span = SPAN[axis];
    const s = slots[k];
    const cut = Math.round(at);
    if (cut < s[axis] + MIN_SLOT || cut > s[axis] + s[span] - MIN_SLOT) return null;
    const near = { ...s, [span]: cut - s[axis] };
    const far = { ...s, id: slots.length, [axis]: cut, [span]: s[axis] + s[span] - cut };
    return [...slots.map((o, i) => (i === k ? near : { ...o })), far];
}

// Halves the largest slot along its longer side.
export function splitLargest(slots) {
    let k = 0;
    slots.forEach((s, i) => {
        if (s.w * s.h > slots[k].w * slots[k].h) k = i;
    });
    const s = slots[k];
    const axis = s.w >= s.h ? 'x' : 'y';
    return splitSlot(slots, k, axis, s[axis] + s[SPAN[axis]] / 2);
}

// Colour per slot id as [r, g, b] in 0..1. Hues advance by the golden angle, so every id differs
// strongly from its neighbours in sequence and no two of the first dozens collide.
export function slotColor(id) {
    const h = ((id * 137.508) % 360) / 60;
    const s = 0.65;
    const l = 0.5;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = [
        [c, x, 0],
        [x, c, 0],
        [0, c, x],
        [0, x, c],
        [x, 0, c],
        [c, 0, x],
    ][Math.floor(h)];
    return [r + m, g + m, b + m];
}
