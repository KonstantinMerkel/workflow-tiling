import { Mode, isOverride } from '../../domain/types.js';
import { DragSession } from '../drag-session.js';
import { Logger, describeLocation, describeSlot } from '../../utils/logger.js';

/**
 * Grabs. During a move grab the Reconciler renders the drag's preview state (the live state plus the candidate
 * drop) and never commands the grabbed window. Any grab end re-applies the grabbed window's tile, so a tile moved
 * or resized by hand snaps back.
 */

/**
 * `grab`: { id, kind, endedOverride, leftMaximized }. `endedOverride` is the override a move grab ended;
 * `leftMaximized` records that Mutter unmaximized the window during the grab, i.e. it was really dragged.
 */
export function onGrabBegin(engine, id, kind) {
    engine.grab = { id, kind, endedOverride: null, leftMaximized: false };
    Logger.debug(`Engine: ${kind} grab of window ${id} begins`);
    if (kind !== 'move') return;
    const record = engine.state.record(id);
    if (!record || record.evacuated) return;
    if (isOverride(record.mode)) {
        Logger.debug(`Engine: drag of window ${id} ends its ${record.mode} override`);
        engine.grab.endedOverride = record.mode;
        engine.setMode(id, Mode.TILED);
    }

    engine.cancelDrag();
    engine.drag = new DragSession({
        id,
        state: engine.state,
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
    const grab = engine.grab;
    engine.grab = null;
    Logger.debug(`Engine: ${kind} grab of window ${id} ends`);

    if (kind === 'move' && engine.drag?.id === id) {
        const operation = engine.drag.target();
        Logger.debug(`Engine: drop of window ${id}: ${describeOperation(operation)}`);
        const touched = engine.drag.touched();
        engine.drag.destroy();
        engine.drag = null;
        engine.reconciler.resetSource();

        // A drop on the top screen edge makes Mutter maximise before the grab ends: the drop maximises the tile. A
        // maximized window that is still maximized without having left it was only clicked: it keeps its override.
        const maximized = engine.windowPort.facts(id)?.maximizedFully ?? false;
        if (maximized && grab?.endedOverride && !grab.leftMaximized) {
            Logger.debug(`Engine: window ${id} was clicked, not dragged; keeps its ${grab.endedOverride} override`);
            engine.setMode(id, grab.endedOverride);
        } else {
            if (operation?.kind === 'swap' && !maximized) engine.state.swap(id, operation.other);
            else if (operation?.kind === 'relocate') engine.relocateWindow(id, operation.location, operation.slot);
            if (maximized && engine.state.slotOf(id) !== -1) {
                Logger.debug(`Engine: window ${id} dropped on the top edge, maximized`);
                engine.setMode(id, Mode.MAXIMIZED);
                engine.comeForward(id, 'top-edge drop');
            }
        }
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
