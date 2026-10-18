import { Mode } from '../../domain/types.js';
import { DragSession } from '../drag-session.js';
import { Logger, describeLocation, describeSlot } from '../../utils/logger.js';

/**
 * Grabs. During a move grab the Reconciler renders the drag's preview state and never commands the grabbed
 * window. Any grab end re-applies the grabbed window's tile, so a tile moved or resized by hand snaps back.
 */

export function onGrabBegin(engine, id, kind) {
    engine.grab = { id, kind };
    Logger.debug(`Engine: ${kind} grab of window ${id} begins`);
    if (kind !== 'move') return;
    const record = engine.state.record(id);
    if (!record || record.evacuated) return;
    if (record.mode === Mode.MAXIMIZED || record.mode === Mode.FULLSCREEN) {
        Logger.debug(`Engine: drag of window ${id} ends its ${record.mode} override`);
        engine.state.setMode(id, Mode.TILED);
        engine.reconciler.invalidate(id);
    }

    engine.cancelDrag();
    engine.drag = new DragSession({
        id,
        baseline: engine.state.clone(),
        escalator: engine.escalator,
        gaps: engine.config.gaps,
        indicator: engine.indicator,
        displayPort: engine.displayPort,
        activeWorkspace: engine.activeWorkspace,
    });
    engine.reconciler.setSource(engine.drag.previewView(), id);
}

export function onPointerMoved(engine, point) {
    if (!engine.drag) return;
    engine.markDirty(...engine.drag.update(point, engine.topology));
}

export function onGrabEnd(engine, id, kind) {
    engine.grab = null;
    Logger.debug(`Engine: ${kind} grab of window ${id} ends`);

    if (kind === 'move' && engine.drag?.id === id) {
        const operation = engine.drag.target();
        Logger.debug(`Engine: drop of window ${id}: ${describeOperation(operation)}`);
        const touched = engine.drag.touched();
        engine.drag.destroy();
        engine.drag = null;
        engine.reconciler.resetSource();

        if (operation?.kind === 'swap') engine.state.swap(id, operation.other);
        else if (operation?.kind === 'relocate') engine.relocateWindow(id, operation.location, operation.slot);
        engine.markDirty(...touched);
    }

    const record = engine.state.record(id);
    if (!record || record.evacuated || record.mode !== Mode.TILED) return;
    engine.reconciler.invalidate(id);
    engine.markDirty(record.location);
}

function describeOperation(operation) {
    if (!operation) return 'no target, back to its tile';
    if (operation.kind === 'swap') return `swap with ${operation.other}`;
    return `relocate to ${describeLocation(operation.location)} ${describeSlot(operation.slot)}`;
}
