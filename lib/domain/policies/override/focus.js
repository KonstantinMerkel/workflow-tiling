import { Mode, isOverride, sameLocation } from '../../types.js';

/** What happens to a maximised or fullscreen window when another window of its layout comes forward. */
export const FocusPolicy = Object.freeze({
    /** The override stays; the other window is shown in front of it. */
    KEEP: 'keep',
    /** The override ends and the layout is visible again. */
    UNMAXIMIZE: 'unmaximize',
    /** The window coming forward takes the override over. */
    PASS_ON: 'pass-on',
});

/**
 * Mode changes when a window comes forward in its layout: it gains focus, arrives in a slot, or is maximised or
 * fullscreened. Only slot-holding windows of the same location are affected. Unless the policy is KEEP, a layout
 * holds at most one override: one coming forward ends the others, a tiled window coming forward ends them
 * (UNMAXIMIZE) or takes the first one over (PASS_ON).
 * @param {object} view TilingStateView
 * @param {number} id the window coming forward
 * @param {string} policy FocusPolicy
 * @returns {Array<{id: number, mode: string}>}
 */
export function modesWhenForward(view, id, policy) {
    const record = view.record(id);
    if (!record || record.evacuated || view.slotOf(id) === -1 || policy === FocusPolicy.KEEP) return [];

    const overridden = view
        .slotsAt(record.location)
        .map((other) => view.record(other))
        .filter((other) => other && other.id !== id && sameLocation(other.location, record.location))
        .filter((other) => isOverride(other.mode));
    if (overridden.length === 0) return [];

    const changes = overridden.map((other) => ({ id: other.id, mode: Mode.TILED }));
    if (policy === FocusPolicy.PASS_ON && !isOverride(record.mode)) changes.push({ id, mode: overridden[0].mode });
    return changes;
}
