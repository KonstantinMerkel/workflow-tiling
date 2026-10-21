import { ALL_WORKSPACES, Mode, locationKey, sameFrame } from '../domain/types.js';
import { selfChosenMode } from '../domain/policies/override/self-maximize.js';
import { Logger, describeFrame, describeLocation } from '../utils/logger.js';

/**
 * The only issuer of placement commands. Runs at most once per frame and only when something is dirty; compares
 * the intended state with Mutter's facts and issues only commands whose facts differ.
 *
 * Frame rule per window (PendingEntry):
 * - the desired frame is the tile, its size clamped to the window's size limits, so no request asks for a size
 *   Mutter would refuse;
 * - a request stores `requestedFrame` and is `resolving`; a request that changes the size also awaits an answer;
 * - it resolves at the next size-changed or at the next flush, whichever comes first; the frame at resolution is
 *   `settledFrame`, partial outcomes included;
 * - the first size-changed after a request is the client's answer, also when it arrives after the flush resolved
 *   the request: it becomes `settledFrame` instead of counting as a change by others;
 * - setFrame is issued when the desired frame differs from the requested one, or when nothing is resolving and the
 *   actual frame differs from the settled one; actual = settled ≠ desired is a client constraint and left alone;
 * - a client constrains only the size: a request that settles at another position (an unmaximize racing the
 *   request in Mutter) is issued once more; `repositioned` keeps that to one repeat per requested frame.
 */
export class Reconciler {
    /**
     * @param {object} deps
     * @param {object} deps.view live TilingStateView
     * @param {object} deps.windowPort MutterWindowPort
     * @param {object} deps.displayPort MutterDisplayPort
     * @param {() => object} deps.getConfig current Config
     */
    constructor({ view, windowPort, displayPort, getConfig }) {
        this._liveView = view;
        this._source = view;
        this._excluded = null;
        this._windowPort = windowPort;
        this._displayPort = displayPort;
        this._getConfig = getConfig;

        this._dirty = new Map(); // locationKey -> Location
        this._evacuatedDirty = false;
        this._pending = new Map(); // WindowId -> PendingEntry
        this._afterFlush = [];
        this._laterId = 0;
        this._flushCount = 0;
        this._paused = false;
        this._commandingMode = null; // window id while its mode command runs
    }

    markDirty(loc) {
        this._dirty.set(locationKey(loc), loc);
        this._schedule();
    }

    markAllDirty() {
        for (const loc of this._liveView.locations()) this._dirty.set(locationKey(loc), loc);
        for (const loc of this._source.locations()) this._dirty.set(locationKey(loc), loc);
        this._evacuatedDirty = true;
        this._schedule();
    }

    /** Reconciles against another view (the drag preview) and never commands `excludedId`. */
    setSource(view, excludedId) {
        Logger.debug(`Reconciler: rendering the drag preview, window ${excludedId} excluded`);
        this._source = view;
        this._excluded = excludedId;
    }

    resetSource() {
        Logger.debug('Reconciler: rendering the live state');
        this._source = this._liveView;
        this._excluded = null;
    }

    /** Runs `callback` once at the end of the next flush. */
    afterNextFlush(callback) {
        this._afterFlush.push(callback);
        this._schedule();
    }

    /** Forgets requested and settled frames, so the tile is re-applied on the next pass. */
    invalidate(id) {
        const entry = this._pending.get(id);
        if (!entry) return;
        entry.requestedFrame = null;
        entry.settledFrame = null;
        entry.resolving = false;
        entry.awaitingAnswer = false;
    }

    /** @returns {boolean} whether a mode command for the window is running; its notifications are echoes */
    isCommandingMode(id) {
        return this._commandingMode === id;
    }

    forget(id) {
        this._pending.delete(id);
    }

    /**
     * Settles a request when the client's size change arrives, also after the follow-up pass resolved it.
     * @returns {boolean} whether the change was the answer to a request at the requested position; such an answer
     *   needs no pass, since the actual frame then equals the settled one
     */
    noteFrameChanged(id, sizeChanged) {
        const entry = this._pending.get(id);
        if (!entry || !sizeChanged || !(entry.resolving || entry.awaitingAnswer)) return false;
        const facts = this._windowPort.facts(id);
        if (!facts) return false;
        Logger.debug(
            `Reconciler: window ${id} settled at ${describeFrame(facts.frame)} on size-changed ` +
                `(requested ${describeFrame(entry.requestedFrame)}${entry.resolving ? '' : ', late answer'})`,
        );
        entry.awaitingAnswer = false;
        this._settle(entry, facts.frame);
        return samePosition(facts.frame, entry.requestedFrame);
    }

    /**
     * Frame for a window that is about to be mapped (initial configure). Records it as a resolving request.
     * @returns {{x:number, y:number, width:number, height:number}|null}
     */
    desiredFrame(id) {
        const record = this._source.record(id);
        if (!record || record.evacuated || record.mode !== Mode.TILED) return null;
        const monitor = this._displayPort.topology().byId(record.location.monitor);
        if (!monitor) return null;
        const facts = this._windowPort.facts(id);
        const tile = this._frameFor(this._source, id, record.location, monitor);
        const frame = tile && facts ? clampToLimits(tile, facts.sizeLimits) : tile;
        if (frame) this._request(this._entry(id), frame, facts?.frame);
        Logger.debug(`Reconciler: initial frame of window ${id}: ${describeFrame(frame)}`);
        return frame;
    }

    /** Cancels the pending later without dropping bookkeeping (extension suspended). */
    pause() {
        Logger.debug('Reconciler: paused');
        this._paused = true;
        this._cancelLater();
    }

    resume() {
        if (this._paused) Logger.debug('Reconciler: resumed');
        this._paused = false;
        if (this._dirty.size > 0 || this._evacuatedDirty || this._afterFlush.length > 0) this._schedule();
    }

    clear() {
        this._cancelLater();
        this._dirty.clear();
        this._pending.clear();
        this._afterFlush = [];
        this._evacuatedDirty = false;
    }

    flush() {
        this._laterId = 0;
        this._flushCount++;

        const dirty = [...this._dirty.values()];
        this._dirty.clear();
        const evacuatedDirty = this._evacuatedDirty;
        this._evacuatedDirty = false;

        Logger.debug(
            `Reconciler: flush #${this._flushCount}: [${dirty.map(describeLocation).join(', ')}]` +
                `${evacuatedDirty ? ' + evacuated windows' : ''}`,
        );
        const topology = this._displayPort.topology();
        for (const loc of dirty) {
            this._guard(`location ${describeLocation(loc)}`, () => this._reconcileLocation(loc, topology));
        }
        if (evacuatedDirty) this._guard('evacuated windows', () => this._reconcileEvacuated());

        const callbacks = this._afterFlush;
        this._afterFlush = [];
        callbacks.forEach((callback) => this._guard('after-flush callback', callback));
    }

    _reconcileLocation(loc, topology) {
        const monitor = topology.byId(loc.monitor);
        if (!monitor) {
            Logger.debug(`Reconciler: ${describeLocation(loc)} skipped, monitor not connected`);
            return;
        }
        const view = this._source;

        view.slotsAt(loc).forEach((id) => {
            if (id === this._excluded) return;
            const record = view.record(id);
            const facts = this._windowPort.facts(id);
            if (!record || !facts) return;

            this._place(id, facts, loc, monitor);
            this._applyMode(id, facts, record.mode);
            if (record.mode !== Mode.TILED) return;

            const frame = this._frameFor(view, id, loc, monitor);
            if (frame) this._applyFrame(id, facts, clampToLimits(frame, facts.sizeLimits), loc);
        });

        for (const record of view.floatingAt(loc)) {
            if (record.id === this._excluded) continue;
            const facts = this._windowPort.facts(record.id);
            if (facts) this._place(record.id, facts, loc, monitor);
        }
    }

    _reconcileEvacuated() {
        for (const record of this._source.evacuated()) {
            const facts = this._windowPort.facts(record.id);
            if (facts && !facts.minimized) {
                Logger.debug(`Reconciler: minimize evacuated window ${record.id}`);
                this._windowPort.minimize(record.id);
            }
        }
    }

    /** Monitor, workspace and minimized state. Each change makes Mutter pick a frame, so it invalidates. */
    _place(id, facts, loc, monitor) {
        if (facts.monitor !== loc.monitor) {
            Logger.debug(`Reconciler: move window ${id} ${facts.monitor} → ${loc.monitor} (index ${monitor.index})`);
            this.invalidate(id);
            this._windowPort.moveToMonitor(id, monitor.index);
        }
        const workspaceBound = loc.workspace !== ALL_WORKSPACES && facts.workspace !== ALL_WORKSPACES;
        if (workspaceBound && facts.workspace !== loc.workspace) {
            Logger.debug(`Reconciler: window ${id} workspace ${facts.workspace} → ${loc.workspace}`);
            this.invalidate(id);
            this._windowPort.changeWorkspace(id, loc.workspace);
        }
        if (facts.minimized) {
            Logger.debug(`Reconciler: unminimize window ${id}`);
            this.invalidate(id);
            this._windowPort.unminimize(id);
        }
    }

    _applyMode(id, facts, mode) {
        if (mode === Mode.FLOATING) return;
        // Only a maximisation in both directions is MAXIMIZED; half-tiling matches no mode and is always corrected.
        const halfTiled = !facts.fullscreen && facts.maximized && !facts.maximizedFully;
        const actual = selfChosenMode(facts);
        if (actual === mode && !halfTiled) return;
        Logger.debug(`Reconciler: window ${id} mode ${actual} → ${mode}`);
        this.invalidate(id);
        this._commandingMode = id;
        try {
            this._windowPort.setMode(id, mode);
        } finally {
            this._commandingMode = null;
        }
    }

    _applyFrame(id, facts, desired, loc) {
        const entry = this._entry(id);
        const mapped = facts.frame.width > 0 && facts.frame.height > 0;
        if (entry.resolving && entry.resolveBy <= this._flushCount && mapped) {
            Logger.debug(`Reconciler: window ${id} settled at ${describeFrame(facts.frame)} on the follow-up pass`);
            // Already at the requested size: the answer is in, any later size change comes from others.
            if (sameSize(facts.frame, entry.requestedFrame)) entry.awaitingAnswer = false;
            this._settle(entry, facts.frame);
        }

        const layoutChanged = !sameFrame(desired, entry.requestedFrame);
        const settled = !entry.resolving && entry.settledFrame;
        const movedByOthers = settled && !sameFrame(facts.frame, entry.settledFrame);
        const misplaced =
            settled && !entry.awaitingAnswer && !entry.repositioned && !samePosition(facts.frame, entry.requestedFrame);
        if (!layoutChanged && !movedByOthers && !misplaced) return;

        let reason = `(settled at another position: actual ${describeFrame(facts.frame)}, once more)`;
        if (layoutChanged) reason = `(layout: requested ${describeFrame(entry.requestedFrame)})`;
        else if (movedByOthers) {
            reason =
                `(moved by others: actual ${describeFrame(facts.frame)}, ` +
                `settled ${describeFrame(entry.settledFrame)})`;
        }
        Logger.debug(`Reconciler: setFrame window ${id} → ${describeFrame(desired)} ${reason}`);

        if (!layoutChanged && !movedByOthers) entry.repositioned = true;
        this._request(entry, desired, facts.frame);
        this._windowPort.setFrame(id, desired);
        this.markDirty(loc); // follow-up pass resolves requests that produce no size-changed
    }

    _frameFor(view, id, loc, monitor) {
        const ids = view.slotsAt(loc);
        const { escalator, gaps } = this._getConfig();
        const estate = escalator.getLayoutForCount(ids.length)?.getEstate(ids.indexOf(id));
        if (!estate) return null;
        return estate.toAbsolute(this._displayPort.workArea(loc.workspace, monitor.index), gaps);
    }

    _entry(id) {
        let entry = this._pending.get(id);
        if (!entry) {
            entry = {
                requestedFrame: null,
                settledFrame: null,
                resolving: false,
                resolveBy: 0,
                awaitingAnswer: false,
                repositioned: false,
            };
            this._pending.set(id, entry);
        }
        return entry;
    }

    /** A request that keeps the current size gets no size-changed, so only a size change awaits an answer. */
    _request(entry, frame, current) {
        if (!sameFrame(frame, entry.requestedFrame)) entry.repositioned = false;
        entry.requestedFrame = frame;
        entry.resolving = true;
        entry.resolveBy = this._flushCount + 1;
        entry.awaitingAnswer = !current || !sameSize(frame, current);
    }

    _settle(entry, frame) {
        entry.settledFrame = frame;
        entry.resolving = false;
    }

    /** Logs an exception with context instead of aborting the rest of the pass. */
    _guard(context, fn) {
        try {
            fn();
        } catch (e) {
            Logger.error(`Reconciler: failed on ${context}`, e);
        }
    }

    _schedule() {
        if (this._laterId || this._paused) return;
        this._laterId = this._displayPort.beforeRedraw(() => this.flush());
    }

    _cancelLater() {
        if (!this._laterId) return;
        this._displayPort.cancelLater(this._laterId);
        this._laterId = 0;
    }
}

function sameSize(a, b) {
    return a.width === b.width && a.height === b.height;
}

function samePosition(a, b) {
    return a.x === b.x && a.y === b.y;
}

/** Clamps the size of a frame to `{min, max}` size limits (null: unknown); the position is kept. */
export function clampToLimits(frame, limits) {
    const clamp = (value, min, max) => Math.max(min ?? 0, Math.min(max ?? Infinity, value));
    const width = clamp(frame.width, limits?.min?.width, limits?.max?.width);
    const height = clamp(frame.height, limits?.min?.height, limits?.max?.height);
    return width === frame.width && height === frame.height ? frame : { ...frame, width, height };
}
