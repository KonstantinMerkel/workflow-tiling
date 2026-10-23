/**
 * Shared value types of the tiling domain.
 *
 * WindowId     number  (Meta.Window.get_id())
 * MonitorId    string  connector name of the monitor's first physical output
 * WorkspaceKey number  token assigned by MutterDisplayPort, or ALL_WORKSPACES
 */

export const Mode = Object.freeze({
    TILED: 'tiled',
    MAXIMIZED: 'maximized',
    FULLSCREEN: 'fullscreen',
    FLOATING: 'floating',
});

export const Direction = Object.freeze({
    LEFT: 'left',
    RIGHT: 'right',
    UP: 'up',
    DOWN: 'down',
});

const OPPOSITE = Object.freeze({
    [Direction.LEFT]: Direction.RIGHT,
    [Direction.RIGHT]: Direction.LEFT,
    [Direction.UP]: Direction.DOWN,
    [Direction.DOWN]: Direction.UP,
});

/**
 * @param {string} dir a Direction value
 * @returns {string} the opposite Direction value
 */
export function opposite(dir) {
    return OPPOSITE[dir];
}

/** Workspace key of windows that are on all workspaces because of `workspaces-only-on-primary`. */
export const ALL_WORKSPACES = 'all';

/**
 * @param {number|string} workspace WorkspaceKey
 * @param {string} monitor MonitorId
 * @returns {{workspace: number|string, monitor: string}} frozen Location value
 */
export function location(workspace, monitor) {
    return Object.freeze({ workspace, monitor });
}

/**
 * Map / Set key of a location. Map and Set compare objects by identity, so locations are always keyed by string.
 * @param {{workspace: number|string, monitor: string}} loc
 * @returns {string}
 */
export function locationKey(loc) {
    return `${loc.workspace}|${loc.monitor}`;
}

/**
 * @param {{workspace: number|string, monitor: string}} a
 * @param {{workspace: number|string, monitor: string}} b
 * @returns {boolean}
 */
export function sameLocation(a, b) {
    return a.workspace === b.workspace && a.monitor === b.monitor;
}

/**
 * A window holds a slot if and only if its mode is TILED, MAXIMIZED or FULLSCREEN.
 * @param {string} mode
 * @returns {boolean}
 */
export function holdsSlot(mode) {
    return mode !== Mode.FLOATING;
}

/** @returns {boolean} whether the mode is a maximise or fullscreen override of a slot */
export function isOverride(mode) {
    return mode === Mode.MAXIMIZED || mode === Mode.FULLSCREEN;
}

/**
 * @param {{x:number, y:number, width:number, height:number}|null} a
 * @param {{x:number, y:number, width:number, height:number}|null} b
 * @returns {boolean}
 */
export function sameFrame(a, b) {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
