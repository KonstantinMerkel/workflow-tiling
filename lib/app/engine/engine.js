import { ALL_WORKSPACES, Mode, location } from '../../domain/types.js';
import { TilingState } from '../../domain/tiling-state.js';
import { entrySlot } from '../../domain/entry-slot.js';
import { modesWhenForward } from '../../domain/policies/override/focus.js';
import { allowsSelfMaximize, selfChosenMode } from '../../domain/policies/override/self-maximize.js';
import { Reconciler } from '../reconciler.js';
import { Logger, describeLocation, describeSlot } from '../../utils/logger.js';
import * as windowEvents from './window-events.js';
import * as topologyEvents from './topology-events.js';
import * as intents from './intents.js';
import * as dragEvents from './drag-events.js';

/**
 * Single entry point of the application layer and the only writer of TilingState.
 *
 * Event methods (`on…`) report what already happened in Mutter and cannot be refused. Intent methods (verbs) are
 * user requests and may be refused. Handler groups live in the sibling modules as functions over this context.
 */
export class Engine {
    /**
     * @param {object} deps
     * @param {object} deps.windowPort MutterWindowPort
     * @param {object} deps.displayPort MutterDisplayPort
     * @param {object} deps.indicator StIndicator
     * @param {object} deps.config Config snapshot
     */
    constructor({ windowPort, displayPort, indicator, config }) {
        this.windowPort = windowPort;
        this.displayPort = displayPort;
        this.indicator = indicator;
        this.config = config;

        this.state = new TilingState();
        this.view = this.state.view();
        this.topology = displayPort.topology();
        this.activeWorkspace = displayPort.activeWorkspace();
        this.reconciler = new Reconciler({
            view: this.view,
            windowPort,
            displayPort,
            getConfig: () => this.config,
        });

        this.drag = null;
        this.grab = null; // { id, kind } while a grab is active
        this.topologyChanging = false;

        Logger.debug(
            `Engine: created; monitors [${this.topology.monitors.map((m) => m.id).join(', ')}], ` +
                `active workspace ${this.activeWorkspace}, max ${this.escalator.getMaxCount()} windows per monitor`,
        );
    }

    // --- events ---------------------------------------------------------------------------------------------

    onWindowAppeared(facts) {
        windowEvents.onWindowAppeared(this, facts);
    }

    onWindowGone(id) {
        windowEvents.onWindowGone(this, id);
    }

    onWindowMoved(facts) {
        windowEvents.onWindowMoved(this, facts);
    }

    onMinimizedChanged(facts) {
        windowEvents.onMinimizedChanged(this, facts);
    }

    onModeChanged(facts) {
        windowEvents.onModeChanged(this, facts);
    }

    onFrameChanged(id, sizeChanged) {
        windowEvents.onFrameChanged(this, id, sizeChanged);
    }

    onFocusChanged(id) {
        windowEvents.onFocusChanged(this, id);
    }

    onTopologyChanging() {
        topologyEvents.onTopologyChanging(this);
    }

    onTopologyChanged() {
        topologyEvents.onTopologyChanged(this);
    }

    onWorkAreasChanged() {
        topologyEvents.onWorkAreasChanged(this);
    }

    onActiveWorkspaceChanged() {
        topologyEvents.onActiveWorkspaceChanged(this);
    }

    onWorkspaceRemoved(workspace) {
        topologyEvents.onWorkspaceRemoved(this, workspace);
    }

    onWorkspaceModeChanged() {
        topologyEvents.onWorkspaceModeChanged(this);
    }

    onGrabBegin(id, kind) {
        dragEvents.onGrabBegin(this, id, kind);
    }

    onPointerMoved(point) {
        dragEvents.onPointerMoved(this, point);
    }

    onGrabEnd(id, kind) {
        dragEvents.onGrabEnd(this, id, kind);
    }

    // --- intents --------------------------------------------------------------------------------------------

    moveDirection(id, dir) {
        intents.moveDirection(this, id, dir);
    }

    focusDirection(id, dir) {
        intents.focusDirection(this, id, dir);
    }

    toggleOverride(id, kind) {
        intents.toggleOverride(this, id, kind);
    }

    switchMonitors(id) {
        intents.switchMonitors(this, id);
    }

    closeMonitor(includeMinimized) {
        intents.closeMonitor(this, includeMinimized);
    }

    closeWorkspace() {
        intents.closeWorkspace(this);
    }

    unminimizeWorkspace() {
        intents.unminimizeWorkspace(this);
    }

    // --- lifecycle and configuration ------------------------------------------------------------------------

    /** Frame of a window about to be mapped (initial configure), or null. */
    initialFrame(id) {
        return this.reconciler.desiredFrame(id);
    }

    /**
     * Compares with the previous config: a different escalator re-evaluates every location against the new
     * maximum. State is never rebuilt.
     */
    applyConfig(config) {
        const previous = this.config;
        this.config = config;
        const escalatorChanged = previous.escalator !== config.escalator;
        Logger.debug(
            `Engine: config applied; gaps ${config.gaps.inner}/${config.gaps.outer}, ` +
                `escalator ${escalatorChanged ? `changed (max ${config.escalator.getMaxCount()})` : 'unchanged'}`,
        );
        if (escalatorChanged) {
            for (const loc of this.view.locations()) {
                this.demote(loc);
                this.promote(loc);
            }
        }
        this.reconciler.markAllDirty();
    }

    /**
     * Aligns state with the live windows. On an empty state this is the initial hydration; after a suspension it
     * catches up with everything that happened meanwhile.
     * @param {Array} allFacts WindowFacts of every registered window
     */
    resync(allFacts) {
        this.reconciler.resume();
        this.topology = this.displayPort.topology();
        this.activeWorkspace = this.displayPort.activeWorkspace();
        Logger.debug(`Engine: resync with ${allFacts.length} windows, ${this.view.records().length} records`);

        const byId = new Map(allFacts.map((facts) => [facts.id, facts]));
        for (const record of this.view.records()) {
            const facts = byId.get(record.id);
            const gone = !facts || !facts.tilable || (facts.minimized && !record.evacuated);
            if (gone) {
                Logger.debug(`Engine: resync drops window ${record.id} (gone, untilable or minimized)`);
                this.removeWindow(record.id);
            }
        }

        const placeable = allFacts.filter((f) => f.tilable && !f.minimized).sort((a, b) => a.sequence - b.sequence);
        for (const facts of placeable) {
            if (this.state.has(facts.id)) windowEvents.onWindowMoved(this, facts);
            else this.arrive(facts, false);
        }
        this.reconciler.markAllDirty();
    }

    /** Extension suspended (invalid layout JSON): no frame callbacks, no drag; state is kept. */
    suspend() {
        Logger.debug('Engine: suspended; state kept');
        this.cancelDrag();
        this.reconciler.pause();
    }

    destroy() {
        Logger.debug('Engine: destroyed');
        this.cancelDrag();
        this.reconciler.clear();
    }

    // --- shared helpers for the handler modules ------------------------------------------------------------

    get escalator() {
        return this.config.escalator;
    }

    /** Workspace token to use when a location's windows move onto a workspace-bound monitor. */
    workspaceFor(loc) {
        return loc.workspace === ALL_WORKSPACES ? this.activeWorkspace : loc.workspace;
    }

    markDirty(...locations) {
        for (const loc of locations) if (loc) this.reconciler.markDirty(loc);
    }

    /**
     * Places a window that is not tracked yet; FLOATING when its location is full. An app allowed to maximise itself
     * keeps the maximised or fullscreen state it opened with.
     */
    arrive(facts, clearOverrides) {
        if (facts.workspace === null || facts.monitor === null) {
            Logger.debug(`Engine: window ${facts.id} not placed, no workspace or monitor yet`);
            return;
        }
        const loc = location(facts.workspace, facts.monitor);
        const slot = entrySlot(this.view, this.escalator, loc);
        const chosen = selfChosenMode(facts);
        const keepsChosen = slot !== null && chosen !== Mode.TILED && this.allowsSelfMaximize(facts.id);
        const mode = slot === null ? Mode.FLOATING : keepsChosen ? chosen : Mode.TILED;
        this.state.place(facts.id, facts.sequence, loc, mode, slot);
        Logger.debug(
            `Engine: window ${facts.id} arrives at ${describeLocation(loc)} → ${describeSlot(slot)}` +
                (keepsChosen ? `, keeps its ${chosen} state` : ''),
        );
        if (clearOverrides && slot !== null) this.comeForward(facts.id, 'arrival');
        this.markDirty(loc);
    }

    /** Applies the focus policy for a window coming forward in its layout. */
    comeForward(id, cause) {
        for (const change of modesWhenForward(this.view, id, this.config.focusPolicy)) {
            Logger.debug(`Engine: ${cause} of window ${id} sets window ${change.id} ${change.mode}`);
            this.setMode(change.id, change.mode);
        }
    }

    /** Changes a window's intended mode and lets the Reconciler re-apply it. */
    setMode(id, mode) {
        const record = this.state.record(id);
        if (!record || record.mode === mode) return;
        this.state.setMode(id, mode);
        this.reconciler.invalidate(id);
        this.markDirty(record.location);
    }

    /** @returns {boolean} whether the window's app may maximise or fullscreen it itself */
    allowsSelfMaximize(id) {
        const app = this.windowPort.appOf(id);
        return app !== null && allowsSelfMaximize(this.config.selfMaximize, app);
    }

    removeWindow(id) {
        const record = this.state.remove(id);
        this.reconciler.forget(id);
        if (!record) return;
        Logger.debug(`Engine: window ${id} removed from ${record.evacuated ? 'evacuation' : describeLocation(record.location)}`);
        if (record.evacuated) return;
        this.promote(record.location);
        this.markDirty(record.location);
    }

    /** Moves a window to another location; a null slot makes it FLOATING there. */
    relocateWindow(id, to, slot) {
        const record = this.state.record(id);
        if (!record) return;
        const from = record.location;
        Logger.debug(
            `Engine: window ${id} ${describeLocation(from)} → ${describeLocation(to)} ` +
                `${describeSlot(slot)}`,
        );
        this.state.relocate(id, to, slot);
        this.reconciler.invalidate(id);
        this.promote(from);
        this.markDirty(from, to);
    }

    /** Oldest floating windows take free slots. */
    promote(loc) {
        const max = this.escalator.getMaxCount();
        while (this.state.slotsAt(loc).length < max) {
            const next = this.state.floatingAt(loc)[0];
            if (!next) break;
            Logger.debug(`Engine: floating window ${next.id} promoted at ${describeLocation(loc)}`);
            this.state.setMode(next.id, Mode.TILED);
        }
    }

    /** Slots beyond the maximum (the tail of the list) become FLOATING. */
    demote(loc) {
        const max = this.escalator.getMaxCount();
        let ids = this.state.slotsAt(loc);
        while (ids.length > max) {
            Logger.debug(`Engine: window ${ids[ids.length - 1]} demoted to FLOATING at ${describeLocation(loc)}`);
            this.state.setMode(ids[ids.length - 1], Mode.FLOATING);
            ids = this.state.slotsAt(loc);
        }
    }

    cancelDrag() {
        if (!this.drag) return;
        Logger.debug(`Engine: drag of window ${this.drag.id} cancelled`);
        const touched = this.drag.touched();
        this.drag.destroy();
        this.drag = null;
        this.reconciler.resetSource();
        this.markDirty(...touched);
    }
}
