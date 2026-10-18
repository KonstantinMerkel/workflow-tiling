import { Mode, sameLocation } from '../types.js';

/**
 * Mode rules for maximise and fullscreen overrides. External maximise / fullscreen requests are always reverted, so
 * only user toggles and arrivals change modes. Kept as its own module because the maximisation rework extends these
 * rules.
 */

/**
 * Mode after the user toggles maximise or fullscreen on a slot-holding window.
 * @param {string} mode current mode
 * @param {'maximize'|'fullscreen'} kind
 * @returns {string}
 */
export function toggledMode(mode, kind) {
    const target = kind === 'fullscreen' ? Mode.FULLSCREEN : Mode.MAXIMIZED;
    return mode === target ? Mode.TILED : target;
}

/**
 * Windows that lose their override when another window arrives at the same workspace and monitor.
 * @param {object} view TilingStateView
 * @param {object} loc Location of the arriving window
 * @param {number} arrivingId
 * @returns {number[]} ids to switch back to TILED
 */
export function overridesClearedByArrival(view, loc, arrivingId) {
    return view
        .slotsAt(loc)
        .filter((id) => id !== arrivingId)
        .filter((id) => {
            const record = view.record(id);
            return record && sameLocation(record.location, loc) &&
                (record.mode === Mode.MAXIMIZED || record.mode === Mode.FULLSCREEN);
        });
}
