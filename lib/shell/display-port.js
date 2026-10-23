import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { ALL_WORKSPACES } from '../domain/types.js';
import { Topology } from '../domain/topology.js';
import { Logger } from '../utils/logger.js';

/**
 * Monitors, workspaces, work areas and frame callbacks.
 *
 * Workspace tokens: each Meta.Workspace gets a number on first sight. The map is strong — GJS keeps a wrapper alive
 * only while it carries JS state or a signal, so a WeakMap could lose tokens — and is pruned by syncWorkspaces().
 */
export class MutterDisplayPort {
    constructor() {
        this._monitorManager = global.backend.get_monitor_manager();
        this._tokens = new Map(); // Meta.Workspace -> number
        this._nextToken = 1;
    }

    /** @returns {Topology} fresh snapshot */
    topology() {
        const primaryIndex = global.display.get_primary_monitor();
        const monitors = this._monitorManager.get_logical_monitors().map((logical) => {
            const monitor = logical.get_monitors()[0];
            const index = logical.get_number();
            const connector = monitor.get_connector();
            return {
                id: connector,
                edid: edidId(monitor, connector),
                index,
                geometry: rectOf(global.display.get_monitor_geometry(index)),
                primary: index === primaryIndex,
            };
        });
        return new Topology(monitors, this.workspacesOnlyOnPrimary());
    }

    workspacesOnlyOnPrimary() {
        return Meta.prefs_get_workspaces_only_on_primary();
    }

    /** @returns {{x:number, y:number, width:number, height:number}} */
    workArea(workspaceKey, monitorIndex) {
        const workspace =
            workspaceKey === ALL_WORKSPACES
                ? global.workspace_manager.get_active_workspace()
                : (this.workspace(workspaceKey) ?? global.workspace_manager.get_active_workspace());
        return rectOf(workspace.get_work_area_for_monitor(monitorIndex));
    }

    /** @returns {{x:number, y:number}} pointer in pixels */
    pointer() {
        const [x, y] = global.get_pointer();
        return { x, y };
    }

    activeWorkspace() {
        return this.workspaceKey(global.workspace_manager.get_active_workspace());
    }

    /** @returns {string|null} connector of the monitor holding the pointer */
    currentMonitorId() {
        const index = global.display.get_current_monitor();
        return this.topology().byIndex(index)?.id ?? null;
    }

    workspaceKey(workspace) {
        if (!workspace) return null;
        let token = this._tokens.get(workspace);
        if (token === undefined) {
            token = this._nextToken++;
            this._tokens.set(workspace, token);
            Logger.debug(`DisplayPort: workspace ${workspace.index()} gets token ${token}`);
        }
        return token;
    }

    /** @returns {Meta.Workspace|null} */
    workspace(key) {
        for (const [workspace, token] of this._tokens) if (token === key) return workspace;
        return null;
    }

    /**
     * workspace-removed carries only an index, so known tokens are compared with the live workspace list.
     * @returns {number[]} tokens whose workspace no longer exists
     */
    syncWorkspaces() {
        const live = new Set();
        for (let i = 0; i < global.workspace_manager.get_n_workspaces(); i++) {
            live.add(global.workspace_manager.get_workspace_by_index(i));
        }
        const removed = [];
        for (const [workspace, token] of this._tokens) {
            if (!live.has(workspace)) {
                Logger.debug(`DisplayPort: workspace token ${token} removed`);
                this._tokens.delete(workspace);
                removed.push(token);
            }
        }
        return removed;
    }

    /** @returns {number} later id */
    beforeRedraw(callback) {
        return global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    cancelLater(id) {
        global.compositor.get_laters().remove(id);
    }

    destroy() {
        this._tokens.clear();
    }
}

/** Mutter's own logical monitor id scheme (`generate_id`): EDID when complete, connector otherwise. */
function edidId(monitor, connector) {
    const vendor = monitor.get_vendor();
    const product = monitor.get_product();
    const serial = monitor.get_serial();
    const known = (value) => value && value !== 'unknown';
    if (known(vendor) && known(product) && known(serial)) return `EDID:${vendor}:${product}:${serial}`;
    return `CONNECTOR:${connector}`;
}

function rectOf(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
