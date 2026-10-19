import { Mode, location, sameLocation } from '../../domain/types.js';
import { entrySlot } from '../../domain/entry-slot.js';
import { Logger, describeLocation } from '../../utils/logger.js';

/**
 * Window lifecycle events. Echoes of the Reconciler's own commands match state (state is changed before commands
 * are issued, and Mutter emits monitor / workspace signals only when the value changes), so they are no-ops.
 */

export function onWindowAppeared(engine, facts) {
    if (!facts || engine.state.has(facts.id)) return;
    if (!facts.tilable || facts.minimized) {
        Logger.debug(`Engine: window ${facts.id} appeared, not tiled (${facts.minimized ? 'minimized' : 'untilable'})`);
        return;
    }
    engine.arrive(facts, true);
}

export function onWindowGone(engine, id) {
    Logger.debug(`Engine: window ${id} gone`);
    if (engine.drag?.id === id) engine.cancelDrag();
    engine.removeWindow(id);
}

/**
 * Monitor, workspace, sticky and tilability changes. The first signal of a cascade carries complete facts; the
 * rest match state.
 */
export function onWindowMoved(engine, facts) {
    if (!facts || !acceptsMove(engine, facts)) return;
    const record = engine.state.record(facts.id);
    if (record) moveRecord(engine, record, facts);
    else if (facts.tilable && !facts.minimized) engine.arrive(facts, true);
}

/** Moves are ignored during a topology change and for the dragged window. */
function acceptsMove(engine, facts) {
    if (engine.topologyChanging) {
        Logger.debug(`Engine: move of window ${facts.id} ignored during topology change`);
        return false;
    }
    if (engine.topology.workspacesOnlyOnPrimary !== engine.displayPort.workspacesOnlyOnPrimary()) {
        Logger.debug('Engine: workspaces-only-on-primary changed (detected on a window event)');
        engine.onWorkspaceModeChanged();
    }
    return engine.drag?.id !== facts.id;
}

function moveRecord(engine, record, facts) {
    if (record.evacuated) return;
    if (!facts.tilable) {
        Logger.debug(`Engine: window ${facts.id} became untilable`);
        engine.removeWindow(facts.id);
        return;
    }
    const to = targetLocation(record, facts);
    if (!to) return;
    Logger.debug(`Engine: external move of window ${facts.id} to ${describeLocation(to)}`);

    const monitorChanged = to.monitor !== record.location.monitor;
    const edge = monitorChanged ? engine.topology.edgeBetween(record.location.monitor, to.monitor) : null;
    const slot = entrySlot(engine.view, engine.escalator, to, { edge });
    engine.relocateWindow(facts.id, to, slot);
}

/** @returns {object|null} location the window moved to, or null when it stays (minimized, unplaced or an echo) */
function targetLocation(record, facts) {
    if (facts.minimized || facts.workspace === null || facts.monitor === null) return null;
    const to = location(facts.workspace, facts.monitor);
    if (sameLocation(to, record.location)) {
        Logger.debug(`Engine: window ${facts.id} at ${describeLocation(to)} matches state (echo or no change)`);
        return null;
    }
    return to;
}

/**
 * A user minimize frees the slot (no record); an unminimize is an arrival. Echoes need no bookkeeping: the
 * Reconciler minimizes only evacuated records and unminimizes only restored ones.
 */
export function onMinimizedChanged(engine, facts) {
    if (!facts) return;
    const record = engine.state.record(facts.id);

    if (record?.evacuated) {
        if (!facts.minimized) {
            Logger.debug(`Engine: evacuated window ${facts.id} unminimized by the user, adopted where it is`);
            engine.state.remove(facts.id); // the user takes the window back where it is
            engine.arrive(facts, true);
        }
        return;
    }
    if (record && facts.minimized) {
        Logger.debug(`Engine: window ${facts.id} minimized, slot freed`);
        engine.removeWindow(facts.id);
        return;
    }
    if (!record && !facts.minimized && facts.tilable) {
        Logger.debug(`Engine: window ${facts.id} unminimized, arrives again`);
        engine.arrive(facts, true);
    }
}

/** External maximise / fullscreen is always reverted: the Reconciler restores the intended mode. */
export function onModeChanged(engine, facts) {
    const record = facts && engine.state.record(facts.id);
    if (!record || record.evacuated || record.mode === Mode.FLOATING) return;
    Logger.debug(
        `Engine: mode of window ${facts.id} changed (maximized ${facts.maximized}, fullscreen ${facts.fullscreen}), ` +
            `intended ${record.mode}`,
    );
    engine.markDirty(record.location);
}

/**
 * Marks dirty unless the change answers a request; frame signals fire before Mutter updates the window's monitor.
 */
export function onFrameChanged(engine, id, sizeChanged) {
    if (engine.grab?.id === id) return;
    const record = engine.state.record(id);
    if (!record || record.evacuated) return;
    if (engine.reconciler.noteFrameChanged(id, sizeChanged)) return;
    engine.markDirty(record.location);
}
