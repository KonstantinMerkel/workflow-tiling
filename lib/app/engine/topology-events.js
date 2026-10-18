import { ALL_WORKSPACES, location } from '../../domain/types.js';
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

    const plan = planHotplug(engine.view, before, after);
    Logger.debug(
        `Engine: monitors changed [${monitorList(before)}] → [${monitorList(after)}]; ` +
            `evacuate [${plan.evacuate.map((e) => e.id).join(', ')}], ` +
            `restore [${plan.restore.map((r) => r.id).join(', ')}]`,
    );
    const slots = new Map(plan.evacuate.map(({ id }) => [id, engine.state.slotOf(id)]));
    for (const { id, edid, connector } of plan.evacuate) {
        Logger.debug(`Engine: window ${id} evacuated from ${connector} (${edid}), slot ${slots.get(id)}`);
        engine.state.evacuate(id, edid, connector, slots.get(id));
        engine.reconciler.invalidate(id);
    }
    const restoredAt = new Map();
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
        restoredAt.set(describeLocation(loc), loc);
    }
    for (const loc of restoredAt.values()) engine.promote(loc);

    engine.reconciler.markAllDirty();
    engine.reconciler.afterNextFlush(() => {
        engine.topologyChanging = false;
        Logger.debug('Engine: topology change settled; window and work-area events processed again');
    });
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
 * workspaces-only-on-primary toggled: secondary-monitor locations are re-keyed. Turned off, ('all', secondary)
 * becomes (active, secondary) keeping its order — where Mutter puts those windows. Turned on, every
 * (token, secondary) list merges into ('all', secondary) by sequence and overflow becomes FLOATING. Idempotent.
 */
export function onWorkspaceModeChanged(engine) {
    const enabled = engine.displayPort.workspacesOnlyOnPrimary();
    if (enabled === engine.topology.workspacesOnlyOnPrimary) return;
    Logger.debug(`Engine: workspaces-only-on-primary ${enabled ? 'on' : 'off'}; re-keying secondary monitors`);
    engine.topology = engine.displayPort.topology();

    for (const monitor of engine.topology.monitors) {
        if (monitor.primary) continue;
        const all = location(ALL_WORKSPACES, monitor.id);
        if (enabled) {
            const bound = engine.view
                .locations()
                .filter((loc) => loc.monitor === monitor.id && loc.workspace !== ALL_WORKSPACES);
            engine.state.merge(bound, all);
            engine.demote(all);
        } else {
            engine.state.rekey(all, location(engine.activeWorkspace, monitor.id));
        }
    }
    engine.reconciler.markAllDirty();
}
