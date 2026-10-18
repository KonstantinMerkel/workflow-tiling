/**
 * Decides which windows are evacuated and restored when monitors come and go. Pure: reads the state, never
 * changes it.
 *
 * @param {object} view TilingStateView
 * @param {object} before Topology before the change
 * @param {object} after Topology after the change
 * @returns {{evacuate: Array<{id: number, edid: string|null, connector: string}>,
 *            restore: Array<{id: number, monitorId: string}>}}
 */
export function planHotplug(view, before, after) {
    const evacuate = [];
    const restore = [];

    for (const record of view.records()) {
        if (record.evacuated) {
            const monitor = findReturnedMonitor(record.evacuated, after);
            if (monitor) restore.push({ id: record.id, monitorId: monitor.id });
        } else if (!after.byId(record.location.monitor)) {
            const gone = before.byId(record.location.monitor);
            evacuate.push({ id: record.id, edid: gone?.edid ?? null, connector: record.location.monitor });
        }
    }
    return { evacuate, restore };
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
