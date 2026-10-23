/** How windows react when monitors come and go. */
export const HotplugPolicy = Object.freeze({
    /** Windows stay with their monitor: they are evacuated when it vanishes and return when it is back. */
    RESTORE_BY_MONITOR: 'restore-by-monitor',
    /**
     * The primary monitor's windows follow the primary role to whichever monitor holds it. The new primary's own
     * windows are evacuated like those of a vanished monitor and return once it is no longer primary.
     */
    FOLLOW_PRIMARY: 'follow-primary',
});

/**
 * Decides which windows are evacuated, restored and moved when monitors change. Pure: reads the state, never
 * changes it.
 *
 * @param {object} view TilingStateView
 * @param {object} before Topology before the change
 * @param {object} after Topology after the change
 * @param {string} policy HotplugPolicy
 * @returns {{evacuate: Array<{id: number, edid: string|null, connector: string}>,
 *            restore: Array<{id: number, monitorId: string}>,
 *            move: {from: string, to: string}|null}} `move` renames every location of the old primary to the new
 *   primary, keeping slot order
 */
export function planHotplug(view, before, after, policy = HotplugPolicy.RESTORE_BY_MONITOR) {
    const evacuate = [];
    const restore = [];
    const move = primaryMove(before, after, policy);
    // Under FOLLOW_PRIMARY the primary only holds primary windows, so nothing returns to it.
    const holdsOnlyPrimaryWindows = (monitorId) =>
        policy === HotplugPolicy.FOLLOW_PRIMARY && monitorId === after.primary?.id;

    for (const record of view.records()) {
        const monitorId = record.location.monitor;
        if (record.evacuated) {
            const monitor = findReturnedMonitor(record.evacuated, after);
            if (monitor && !holdsOnlyPrimaryWindows(monitor.id)) restore.push({ id: record.id, monitorId: monitor.id });
        } else if (move && monitorId === move.from) {
            continue;
        } else if (move && monitorId === move.to) {
            const own = before.byId(monitorId) ?? after.byId(monitorId);
            evacuate.push({ id: record.id, edid: own?.edid ?? null, connector: monitorId });
        } else if (!after.byId(monitorId)) {
            const gone = before.byId(monitorId);
            evacuate.push({ id: record.id, edid: gone?.edid ?? null, connector: monitorId });
        }
    }
    return { evacuate, restore, move };
}

/** @returns {{from: string, to: string}|null} the primary role changing monitor under FOLLOW_PRIMARY */
function primaryMove(before, after, policy) {
    if (policy !== HotplugPolicy.FOLLOW_PRIMARY) return null;
    const from = before.primary?.id;
    const to = after.primary?.id;
    return from && to && from !== to ? { from, to } : null;
}

/**
 * The evacuated window's monitor counts as returned when exactly one connected monitor carries its EDID id. With
 * several (identical twins) the connector decides among them; without a usable EDID the connector alone decides.
 * A monitor with a different EDID never matches.
 */
function findReturnedMonitor(evacuated, topology) {
    const hasEdid = evacuated.edid && !evacuated.edid.startsWith('CONNECTOR:');
    if (!hasEdid) return topology.byId(evacuated.connector);

    const matches = topology.monitors.filter((m) => m.edid === evacuated.edid);
    if (matches.length === 1) return matches[0];
    return matches.find((m) => m.id === evacuated.connector) ?? null;
}
