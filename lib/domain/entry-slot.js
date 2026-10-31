/**
 * Where a window entering a location goes. The capacity rule exists only here.
 *
 * @param {object} view TilingStateView
 * @param {object} escalator LayoutEscalator
 * @param {object} loc target Location
 * @param {object} [options]
 * @param {string|null} [options.edge] Direction naming the edge the window enters through
 * @param {number|null} [options.preferred] slot the caller already knows (hovered slot, remembered slot)
 * @returns {number|null} slot, or null when the location already holds the escalator's maximum
 */
export function entrySlot(view, escalator, loc, { edge = null, preferred = null } = {}) {
    const count = view.slotsAt(loc).length;
    if (count >= escalator.getMaxCount()) return null;

    if (preferred !== null && preferred !== undefined) return Math.max(0, Math.min(preferred, count));

    if (edge !== null) {
        const slot = escalator.getLayoutForCount(count + 1)?.getEdgingSlot(edge) ?? -1;
        if (slot !== -1) return Math.min(slot, count);
    }
    return count;
}
