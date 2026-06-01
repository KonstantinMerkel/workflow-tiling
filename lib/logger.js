export const Logger = {
    DEBUG: true, // Toggle for deep debugging

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
    }
};
