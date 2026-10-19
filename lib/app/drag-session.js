import { ALL_WORKSPACES, locationKey, sameLocation } from '../domain/types.js';
import { makeView } from '../domain/tiling-state.js';
import { entrySlot } from '../domain/entry-slot.js';
import { Logger, describeLocation, describeSlot } from '../utils/logger.js';

/**
 * Pointer → candidate state. Builds a preview state that the Reconciler renders; issues no window commands.
 *
 * The preview is the live state with the candidate operation applied. It is derived on read and rebuilt only when
 * the pointer moved or the live state changed (its version), so windows opening or closing during the drag show up
 * in the preview, and the operation handed out on drop is checked against the live state.
 *
 * Operation: { kind: 'swap', other } on the origin location, or { kind: 'relocate', location, slot } elsewhere
 * (slot null: the window becomes FLOATING there).
 */
export class DragSession {
    /**
     * @param {object} deps
     * @param {number} deps.id grabbed window
     * @param {object} deps.state live TilingState, read and cloned only
     * @param {object} deps.escalator LayoutEscalator
     * @param {{inner:number, outer:number}} deps.gaps
     * @param {object} deps.indicator StIndicator
     * @param {object} deps.displayPort MutterDisplayPort (work areas)
     * @param {number} deps.activeWorkspace workspace token
     */
    constructor({ id, state, escalator, gaps, indicator, displayPort, activeWorkspace }) {
        this.id = id;
        this._state = state;
        this._escalator = escalator;
        this._gaps = gaps;
        this._indicator = indicator;
        this._displayPort = displayPort;
        this._workspace = activeWorkspace;

        this._origin = state.record(id).location;
        this._touched = new Map([[locationKey(this._origin), this._origin]]);
        this._hover = null; // { target, workArea, pct }
        this._seenVersion = null; // live version the preview was built from; null forces a rebuild
        this._operation = null;
        this._preview = state;
    }

    /** Live view of the current preview state. */
    previewView() {
        return makeView(() => this._current());
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

        const previous = this._hover?.target;
        this._hover = { target, workArea, pct };
        this._touched.set(locationKey(target), target);
        // Pointer moves within the same target change nothing to render.
        const unchanged =
            previous &&
            sameLocation(previous, target) &&
            this._seenVersion === this._state.version &&
            sameOperation(this._candidate(target, pct), this._operation);
        if (unchanged) return [];
        this._seenVersion = null;
        this._current();

        const changed = [this._origin, target];
        if (previous && !sameLocation(previous, target)) changed.push(previous);
        return changed;
    }

    /** @returns {object|null} the operation to apply to the live state on drop, checked against the live state */
    target() {
        this._current();
        return this._operation;
    }

    touched() {
        return [...this._touched.values()];
    }

    destroy() {
        this._indicator.hide();
    }

    /** Rebuilds operation, preview and indicator when the pointer moved or the live state changed. */
    _current() {
        if (this._seenVersion === this._state.version) return this._preview;
        this._seenVersion = this._state.version;

        const operation = this._hover ? this._candidate(this._hover.target, this._hover.pct) : null;
        if (!sameOperation(operation, this._operation)) {
            Logger.debug(`DragSession: window ${this.id} target ${describeOperation(operation)}`);
        }
        this._operation = operation;
        this._preview = this._apply(operation);
        if (this._hover) this._showIndicator(this._hover.target, this._hover.workArea);
        return this._preview;
    }

    _candidate(target, pct) {
        const state = this._state;
        if (sameLocation(target, this._origin)) {
            const originSlot = state.slotOf(this.id);
            if (originSlot === -1) return null;
            const ids = state.slotsAt(target);
            const hovered = this._escalator.getLayoutForCount(ids.length)?.slotAt(pct) ?? -1;
            if (hovered === -1 || hovered === originSlot || ids[hovered] === undefined) return null;
            return { kind: 'swap', other: ids[hovered] };
        }

        const count = state.slotsAt(target).length;
        const hovered = this._escalator.getLayoutForCount(count + 1)?.slotAt(pct) ?? -1;
        const slot = entrySlot(state.view(), this._escalator, target, {
            preferred: hovered === -1 ? null : hovered,
        });
        return { kind: 'relocate', location: target, slot };
    }

    _apply(operation) {
        if (!operation) return this._state;
        const preview = this._state.clone();
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
