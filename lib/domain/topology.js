import { ALL_WORKSPACES, Direction, location } from './types.js';

/**
 * Immutable snapshot of all connected monitors.
 *
 * MonitorInfo: { id: connector, edid: Mutter's logical monitor id string, index: logical monitor number,
 *                geometry: {x, y, width, height}, primary: bool }
 */
export class Topology {
    /**
     * @param {Array} monitors MonitorInfo values
     * @param {boolean} workspacesOnlyOnPrimary value of org.gnome.mutter workspaces-only-on-primary
     */
    constructor(monitors = [], workspacesOnlyOnPrimary = false) {
        this.monitors = Object.freeze(monitors.map((m) => Object.freeze({ ...m })));
        this.workspacesOnlyOnPrimary = workspacesOnlyOnPrimary;
        Object.freeze(this);
    }

    byId(id) {
        return this.monitors.find((m) => m.id === id) ?? null;
    }

    byIndex(index) {
        return this.monitors.find((m) => m.index === index) ?? null;
    }

    get primary() {
        return this.monitors.find((m) => m.primary) ?? this.monitors[0] ?? null;
    }

    /** @returns {string|null} id of the monitor containing the point (pixels) */
    monitorAt(point) {
        const hit = this.monitors.find(
            ({ geometry: g }) =>
                point.x >= g.x && point.x < g.x + g.width && point.y >= g.y && point.y < g.y + g.height,
        );
        return hit ? hit.id : null;
    }

    /**
     * Nearest monitor in `dir` that overlaps the source monitor on the orthogonal axis.
     * @returns {string|null}
     */
    inDirection(id, dir) {
        const source = this.byId(id);
        if (!source) return null;
        const s = source.geometry;
        const tolerance = 1;
        const horizontal = dir === Direction.LEFT || dir === Direction.RIGHT;

        const candidates = [];
        for (const monitor of this.monitors) {
            if (monitor.id === id) continue;
            const c = monitor.geometry;
            let inDirection;
            let distance;
            switch (dir) {
                case Direction.LEFT:
                    inDirection = c.x + c.width <= s.x + tolerance;
                    distance = s.x - (c.x + c.width);
                    break;
                case Direction.RIGHT:
                    inDirection = c.x >= s.x + s.width - tolerance;
                    distance = c.x - (s.x + s.width);
                    break;
                case Direction.UP:
                    inDirection = c.y + c.height <= s.y + tolerance;
                    distance = s.y - (c.y + c.height);
                    break;
                default:
                    inDirection = c.y >= s.y + s.height - tolerance;
                    distance = c.y - (s.y + s.height);
            }
            if (!inDirection) continue;

            const overlap = horizontal
                ? Math.min(c.y + c.height, s.y + s.height) - Math.max(c.y, s.y)
                : Math.min(c.x + c.width, s.x + s.width) - Math.max(c.x, s.x);
            if (overlap > 0) candidates.push({ monitor, distance, overlap });
        }
        if (candidates.length === 0) return null;

        candidates.sort(
            (a, b) => a.distance - b.distance || b.overlap - a.overlap || a.monitor.index - b.monitor.index,
        );
        return candidates[0].monitor.id;
    }

    /**
     * Edge of the target monitor a window enters through when moving from `fromId` to `toId`.
     * @returns {string|null} Direction naming the edge
     */
    edgeBetween(fromId, toId) {
        const from = this.byId(fromId);
        const to = this.byId(toId);
        if (!from || !to) return null;
        const dx = to.geometry.x - from.geometry.x;
        const dy = to.geometry.y - from.geometry.y;
        if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? Direction.LEFT : Direction.RIGHT;
        return dy > 0 ? Direction.UP : Direction.DOWN;
    }

    /** @returns {boolean} whether workspaces apply to windows on this monitor */
    isWorkspaceBound(monitorId) {
        if (!this.workspacesOnlyOnPrimary) return true;
        const monitor = this.byId(monitorId);
        return monitor ? monitor.primary : true;
    }

    /**
     * Single place deciding which workspace key applies on a monitor.
     * @param {number} workspace token of the workspace in question (normally the active one)
     * @param {string} monitorId
     */
    locationFor(workspace, monitorId) {
        return location(this.isWorkspaceBound(monitorId) ? workspace : ALL_WORKSPACES, monitorId);
    }
}
