import { ALL_WORKSPACES, location, locationKey } from '../../domain/types.js';
import { entrySlot } from '../../domain/entry-slot.js';
import { planHotplug } from '../../domain/policies/hotplug.js';
import { Logger, describeLocation, describeSlot } from '../../utils/logger.js';

const monitorList = (topology) => topology.monitors.map((m) => m.id).join(', ');

/**
 * Monitor, work-area and workspace events.
 *
 * Mutter emits monitors-changing, moves every window (monitors-changed-internal), emits monitors-changed, and then
 * runs queued move-resizes and the work-area recomputation in laters. Window-moved and work-area events are
 * consequences, so they are ignored from onTopologyChanging until the end of the first flush after
 * onTopologyChanged.
 */

export function onTopologyChanging(engine) {
    Logger.debug('Engine: monitors changing; window and work-area events suppressed');
    engine.topologyChanging = true;
}

export function onTopologyChanged(engine) {
    const before = engine.topology;
    const after = engine.displayPort.topology();
    engine.topology = after;
    engine.activeWorkspace = engine.displayPort.activeWorkspace();
    engine.topologyChanging = true;

    const plan = planHotplug(engine.view, before, after, engine.config.hotplugPolicy);
    Logger.debug(
        `Engine: monitors changed [${monitorList(before)}] → [${monitorList(after)}] ` +
            `(${engine.config.hotplugPolicy}); evacuate [${plan.evacuate.map((e) => e.id).join(', ')}], ` +
            `restore [${plan.restore.map((r) => r.id).join(', ')}]` +
            (plan.move ? `, primary windows ${plan.move.from} → ${plan.move.to}` : ''),
    );
    const slots = new Map(plan.evacuate.map(({ id }) => [id, engine.state.slotOf(id)]));
    for (const { id, edid, connector } of plan.evacuate) {
        Logger.debug(`Engine: window ${id} evacuated from ${connector} (${edid}), slot ${slots.get(id)}`);
        engine.state.evacuate(id, edid, connector, slots.get(id));
        engine.reconciler.invalidate(id);
    }
    const changed = new Map();
    const touch = (loc) => changed.set(locationKey(loc), loc);
    if (plan.move) movePrimaryWindows(engine, plan.move, touch);
    rekeyPrimaryChange(engine, before, after, touch);

    for (const { id, monitorId } of plan.restore) {
        const record = engine.state.record(id);
        const loc = after.locationFor(engine.workspaceFor(record.location), monitorId);
        const slot =
            record.evacuated.slot === null
                ? null
                : entrySlot(engine.view, engine.escalator, loc, { preferred: record.evacuated.slot });
        Logger.debug(
            `Engine: window ${id} restored to ${describeLocation(loc)} ${describeSlot(slot)}`,
        );
        engine.state.restore(id, loc, slot);
        engine.reconciler.invalidate(id);
        touch(loc);
    }
    for (const loc of changed.values()) {
        engine.demote(loc);
        engine.promote(loc);
    }

    engine.reconciler.markAllDirty();
    engine.reconciler.afterNextFlush(() => {
        engine.topologyChanging = false;
        Logger.debug('Engine: topology change settled; window and work-area events processed again');
    });
}

/** Renames every location of the old primary to the new primary; slot order and workspaces are kept. */
function movePrimaryWindows(engine, { from, to }, touch) {
    for (const loc of engine.view.locations().filter((l) => l.monitor === from)) {
        const target = engine.topology.locationFor(engine.workspaceFor(loc), to);
        const ids = [...engine.view.slotsAt(loc), ...engine.view.floatingAt(loc).map((r) => r.id)];
        Logger.debug(`Engine: primary windows [${ids.join(', ')}] ${describeLocation(loc)} → ${describeLocation(target)}`);
        engine.state.rekey(loc, target);
        ids.forEach((id) => engine.reconciler.invalidate(id));
        touch(target);
    }
}

/**
 * With workspaces-only-on-primary, a monitor's workspace key depends on whether it is primary. Monitors that gained
 * or lost the primary role are re-keyed like a toggle of the setting.
 */
function rekeyPrimaryChange(engine, before, after, touch) {
    if (!after.workspacesOnlyOnPrimary) return;
    for (const monitor of after.monitors) {
        const was = before.byId(monitor.id);
        if (!was || was.primary === monitor.primary) continue;
        Logger.debug(`Engine: ${monitor.id} ${monitor.primary ? 'became' : 'is no longer'} primary; re-keying`);
        touch(rekeyMonitor(engine, monitor.id, monitor.primary));
    }
}

/**
 * Re-keys one monitor's locations. Workspace-bound: ('all', monitor) becomes (active, monitor), keeping its order —
 * where Mutter puts those windows. Not bound: every (token, monitor) list merges into ('all', monitor) by sequence.
 * @returns {object} the resulting location of the monitor on the active workspace
 */
function rekeyMonitor(engine, monitorId, workspaceBound) {
    const all = location(ALL_WORKSPACES, monitorId);
    if (workspaceBound) {
        const active = location(engine.activeWorkspace, monitorId);
        engine.state.rekey(all, active);
        return active;
    }
    const bound = engine.view
        .locations()
        .filter((loc) => loc.monitor === monitorId && loc.workspace !== ALL_WORKSPACES);
    engine.state.merge(bound, all);
    return all;
}

export function onWorkAreasChanged(engine) {
    if (engine.topologyChanging) return;
    Logger.debug('Engine: work areas changed');
    engine.reconciler.markAllDirty();
}

/** `ALL_WORKSPACES` locations use the active workspace's work area. */
export function onActiveWorkspaceChanged(engine) {
    engine.activeWorkspace = engine.displayPort.activeWorkspace();
    Logger.debug(`Engine: active workspace ${engine.activeWorkspace}`);
    for (const loc of engine.view.locations()) {
        if (loc.workspace === ALL_WORKSPACES) engine.markDirty(loc);
    }
}

export function onWorkspaceRemoved(engine, workspace) {
    Logger.debug(`Engine: workspace ${workspace} removed`);
    engine.state.dropWorkspace(workspace);
}

/**
 * workspaces-only-on-primary toggled: secondary-monitor locations are re-keyed (see rekeyMonitor); turned on,
 * overflow becomes FLOATING. Idempotent.
 */
export function onWorkspaceModeChanged(engine) {
    const enabled = engine.displayPort.workspacesOnlyOnPrimary();
    if (enabled === engine.topology.workspacesOnlyOnPrimary) return;
    Logger.debug(`Engine: workspaces-only-on-primary ${enabled ? 'on' : 'off'}; re-keying secondary monitors`);
    engine.topology = engine.displayPort.topology();

    for (const monitor of engine.topology.monitors) {
        if (monitor.primary) continue;
        engine.demote(rekeyMonitor(engine, monitor.id, !enabled));
    }
    engine.reconciler.markAllDirty();
}
