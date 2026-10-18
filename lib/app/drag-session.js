import { ALL_WORKSPACES, locationKey, sameLocation } from '../domain/types.js';
import { makeView } from '../domain/tiling-state.js';
import { entrySlot } from '../domain/entry-slot.js';
import { Logger, describeLocation, describeSlot } from '../utils/logger.js';

/**
 * Pointer → candidate state. Builds a preview state that the Reconciler renders; issues no window commands.
 *
 * Operation: { kind: 'swap', other } on the origin location, or { kind: 'relocate', location, slot } elsewhere
 * (slot null: the window becomes FLOATING there).
 */
export class DragSession {
    /**
     * @param {object} deps
     * @param {number} deps.id grabbed window
     * @param {object} deps.baseline TilingState clone taken at grab begin
     * @param {object} deps.escalator LayoutEscalator
     * @param {{inner:number, outer:number}} deps.gaps
     * @param {object} deps.indicator StIndicator
     * @param {object} deps.displayPort MutterDisplayPort (work areas)
     * @param {number} deps.activeWorkspace workspace token
     */
    constructor({ id, baseline, escalator, gaps, indicator, displayPort, activeWorkspace }) {
        this.id = id;
        this._baseline = baseline;
        this._preview = baseline;
        this._escalator = escalator;
        this._gaps = gaps;
        this._indicator = indicator;
        this._displayPort = displayPort;
        this._workspace = activeWorkspace;

        const record = baseline.record(id);
        this._origin = record.location;
        this._originSlot = baseline.slotOf(id);
        this._operation = null;
        this._touched = new Map([[locationKey(this._origin), this._origin]]);
        this._hover = null;
    }

    /** Live view of the current preview state. */
    previewView() {
        return makeView(() => this._preview);
    }

    /**
     * @param {{x:number, y:number}} point pointer in pixels
     * @param {object} topology Topology
     * @returns {Array} locations whose preview may have changed
     */
    update(point, topology) {
        const monitor = topology.byId(topology.monitorAt(point) ?? this._origin.monitor);
        if (!monitor) return [];

        const workspace = this._origin.workspace === ALL_WORKSPACES ? this._workspace : this._origin.workspace;
        const target = topology.locationFor(workspace, monitor.id);
        const workArea = this._displayPort.workArea(target.workspace, monitor.index);
        const pct = {
            x: ((point.x - workArea.x) / workArea.width) * 100,
            y: ((point.y - workArea.y) / workArea.height) * 100,
        };

        const previous = this._hover;
        this._hover = target;
        this._touched.set(locationKey(target), target);
        const operation = this._candidate(target, pct);
        if (!sameOperation(operation, this._operation)) {
            Logger.debug(`DragSession: window ${this.id} target ${describeOperation(operation)}`);
        }
        this._operation = operation;
        this._preview = this._apply(this._operation);
        this._showIndicator(target, workArea);

        const changed = [this._origin, target];
        if (previous && !sameLocation(previous, target)) changed.push(previous);
        return changed;
    }

    /** @returns {object|null} the operation to apply to the live state on drop */
    target() {
        return this._operation;
    }

    touched() {
        return [...this._touched.values()];
    }

    destroy() {
        this._indicator.hide();
    }

    _candidate(target, pct) {
        if (sameLocation(target, this._origin)) {
            if (this._originSlot === -1) return null;
            const ids = this._baseline.slotsAt(target);
            const hovered = this._escalator.getLayoutForCount(ids.length)?.slotAt(pct) ?? -1;
            if (hovered === -1 || hovered === this._originSlot || ids[hovered] === undefined) return null;
            return { kind: 'swap', other: ids[hovered] };
        }

        const count = this._baseline.slotsAt(target).length;
        const hovered = this._escalator.getLayoutForCount(count + 1)?.slotAt(pct) ?? -1;
        const slot = entrySlot(this._baseline.view(), this._escalator, target, {
            preferred: hovered === -1 ? null : hovered,
        });
        return { kind: 'relocate', location: target, slot };
    }

    _apply(operation) {
        if (!operation) return this._baseline;
        const preview = this._baseline.clone();
        if (operation.kind === 'swap') preview.swap(this.id, operation.other);
        else preview.relocate(this.id, operation.location, operation.slot);
        return preview;
    }

    _showIndicator(target, workArea) {
        const ids = this._preview.slotsAt(target);
        const slot = ids.indexOf(this.id);
        const estate = slot === -1 ? null : this._escalator.getLayoutForCount(ids.length)?.getEstate(slot);
        if (estate) this._indicator.show(estate.toAbsolute(workArea, this._gaps));
        else this._indicator.hide();
    }
}

function sameOperation(a, b) {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'swap') return a.other === b.other;
    return a.slot === b.slot && sameLocation(a.location, b.location);
}

function describeOperation(operation) {
    if (!operation) return 'none';
    if (operation.kind === 'swap') return `swap with ${operation.other}`;
    return `${describeLocation(operation.location)} ${describeSlot(operation.slot)}`;
}
