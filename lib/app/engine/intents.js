import { ALL_WORKSPACES, Mode, opposite } from '../../domain/types.js';
import { entrySlot } from '../../domain/entry-slot.js';
import { toggledMode } from '../../domain/policies/override.js';
import { Logger, describeLocation } from '../../utils/logger.js';

/**
 * User requests. Moving a window onto a full monitor makes it FLOATING there.
 */

/**
 * Swap with the neighbouring tile, or enter the neighbouring monitor through its facing edge. Floating windows have
 * no neighbouring tile and move straight to the neighbouring monitor.
 */
export function moveDirection(engine, id, dir) {
    const record = id === null ? null : engine.state.record(id);
    if (!record || record.evacuated) {
        Logger.debug(`Engine: move ${dir} of window ${id} ignored (untracked or evacuated)`);
        return;
    }

    const loc = record.location;
    const ids = engine.state.slotsAt(loc);
    const slot = engine.state.slotOf(id);
    const neighbour = slot === -1 ? -1 : (engine.escalator.getLayoutForCount(ids.length)?.neighbour(slot, dir) ?? -1);
    if (neighbour !== -1 && ids[neighbour] !== undefined) {
        Logger.debug(`Engine: move ${dir}: window ${id} swaps with ${ids[neighbour]}`);
        engine.state.swap(id, ids[neighbour]);
        engine.markDirty(loc);
        return;
    }

    const monitorId = engine.topology.inDirection(loc.monitor, dir);
    if (!monitorId) {
        Logger.debug(`Engine: move ${dir} of window ${id}: no neighbour and no monitor in that direction`);
        return;
    }
    const to = engine.topology.locationFor(engine.workspaceFor(loc), monitorId);
    const entry = entrySlot(engine.view, engine.escalator, to, { edge: opposite(dir) });
    if (entry === null) Logger.debug(`Engine: move ${dir} of window ${id}: ${describeLocation(to)} is full`);
    engine.relocateWindow(id, to, entry);
}

/** Same targets as moveDirection: neighbouring tile, else the edging slot of the neighbouring monitor. */
export function focusDirection(engine, id, dir) {
    const record = id === null ? null : engine.state.record(id);
    if (!record || record.evacuated) return;

    const loc = record.location;
    const slot = engine.state.slotOf(id);
    if (slot !== -1) {
        const ids = engine.state.slotsAt(loc);
        const neighbour = engine.escalator.getLayoutForCount(ids.length)?.neighbour(slot, dir) ?? -1;
        if (neighbour !== -1 && ids[neighbour] !== undefined) {
            Logger.debug(`Engine: focus ${dir} from window ${id} → ${ids[neighbour]}`);
            engine.windowPort.activate(ids[neighbour]);
            return;
        }
    }

    const monitorId = engine.topology.inDirection(loc.monitor, dir);
    if (!monitorId) return;
    const targetIds = engine.state.slotsAt(engine.topology.locationFor(engine.workspaceFor(loc), monitorId));
    const target = engine.escalator.getLayoutForCount(targetIds.length)?.getEdgingSlot(opposite(dir)) ?? -1;
    if (target !== -1 && targetIds[target] !== undefined) {
        Logger.debug(`Engine: focus ${dir} from window ${id} → ${targetIds[target]} on ${monitorId}`);
        engine.windowPort.activate(targetIds[target]);
    }
}

/** Maximise / fullscreen toggle. Windows without a slot keep Mutter's native behaviour. */
export function toggleOverride(engine, id, kind) {
    if (id === null) return;
    const record = engine.state.record(id);
    if (!record || record.evacuated || record.mode === Mode.FLOATING) {
        Logger.debug(`Engine: ${kind} toggle of window ${id} uses Mutter's native toggle (no slot)`);
        engine.windowPort.toggleNative(id, kind);
        return;
    }
    const mode = toggledMode(record.mode, kind);
    Logger.debug(`Engine: ${kind} toggle of window ${id}: ${record.mode} → ${mode}`);
    engine.state.setMode(id, mode);
    engine.reconciler.invalidate(id);
    engine.markDirty(record.location);
}

/** Exchanges the content of the given window's monitor (or the current one) with the next monitor. */
export function switchMonitors(engine, id) {
    const monitors = [...engine.topology.monitors].sort((a, b) => a.index - b.index);
    if (monitors.length < 2) return;

    const record = id === null ? null : engine.state.record(id);
    const sourceId = record && !record.evacuated ? record.location.monitor : engine.displayPort.currentMonitorId();
    const sourceIndex = monitors.findIndex((m) => m.id === sourceId);
    if (sourceIndex === -1) return;
    const targetId = monitors[(sourceIndex + 1) % monitors.length].id;

    const a = engine.topology.locationFor(engine.activeWorkspace, sourceId);
    const b = engine.topology.locationFor(engine.activeWorkspace, targetId);
    Logger.debug(`Engine: switch monitors ${describeLocation(a)} ⇄ ${describeLocation(b)}`);
    engine.state.swapMonitors(a, b);
    engine.markDirty(a, b);
}

/** Closes the tilable windows of the active workspace on the current monitor. */
export function closeMonitor(engine, includeMinimized) {
    const monitorId = engine.displayPort.currentMonitorId();
    Logger.debug(`Engine: close windows on ${monitorId} (include minimized: ${includeMinimized})`);
    for (const facts of engine.windowPort.all()) {
        if (!facts.tilable || facts.monitor !== monitorId) continue;
        if (facts.workspace !== engine.activeWorkspace && facts.workspace !== ALL_WORKSPACES) continue;
        if (facts.minimized && !includeMinimized) continue;
        engine.windowPort.close(facts.id);
    }
}

/** Closes the tilable windows bound to the active workspace (windows on all workspaces stay). */
export function closeWorkspace(engine) {
    Logger.debug(`Engine: close windows of workspace ${engine.activeWorkspace}`);
    for (const facts of engine.windowPort.all()) {
        if (facts.tilable && facts.workspace === engine.activeWorkspace) engine.windowPort.close(facts.id);
    }
}

/**
 * Unminimizes the tilable windows of the active workspace (minimized windows have no record, so facts are
 * enumerated), then activates slot 0 of the current monitor.
 */
export function unminimizeWorkspace(engine) {
    Logger.debug(`Engine: unminimize workspace ${engine.activeWorkspace}`);
    for (const facts of engine.windowPort.all()) {
        if (!facts.tilable || !facts.minimized) continue;
        if (facts.workspace !== engine.activeWorkspace && facts.workspace !== ALL_WORKSPACES) continue;
        engine.windowPort.unminimize(facts.id);
    }
    const monitorId = engine.displayPort.currentMonitorId();
    if (!monitorId) return;
    const first = engine.state.slotsAt(engine.topology.locationFor(engine.activeWorkspace, monitorId))[0];
    if (first !== undefined) engine.windowPort.activate(first);
}
