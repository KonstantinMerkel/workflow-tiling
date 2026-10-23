export const Logger = {
    DEBUG: false, // Toggle for deep debugging

    info(msg) {
        console.log(`WorkflowTiling: ${msg}`);
    },

    warn(msg, err = null) {
        console.warn(`WorkflowTiling: [WARN] ${msg}`);
        if (err) {
            console.warn(`WorkflowTiling: [WARN-TRACE] ${err.stack || err.message || err}`);
        }
    },

    error(msg, err = null) {
        console.error(`WorkflowTiling: [ERROR] ${msg}`);
        if (err) {
            console.error(`WorkflowTiling: [ERROR-TRACE] ${err.stack || err.message || err}`);
        }
    },

    debug(msg) {
        if (this.DEBUG) {
            console.log(`WorkflowTiling: [DEBUG] ${msg}`);
        }
    },
};

/** @returns {string} `x,y widthxheight` for log lines */
export function describeFrame(frame) {
    return frame ? `${frame.x},${frame.y} ${frame.width}x${frame.height}` : 'none';
}

/** @returns {string} `workspace|monitor` for log lines */
export function describeLocation(loc) {
    return loc ? `${loc.workspace}|${loc.monitor}` : 'none';
}

/** @returns {string} `slot n`, or `FLOATING` for a null slot */
export function describeSlot(slot) {
    return slot === null ? 'FLOATING' : `slot ${slot}`;
}
