import { Mode } from '../../types.js';

/**
 * Mode after a maximise, unmaximise or fullscreen request for a slot-holding window. Maximise and fullscreen toggle
 * between TILED and their override; unmaximise only ends a maximise override.
 * @param {string} mode current mode
 * @param {'maximize'|'unmaximize'|'fullscreen'} kind
 * @returns {string}
 */
export function toggledMode(mode, kind) {
    if (kind === 'unmaximize') return mode === Mode.MAXIMIZED ? Mode.TILED : mode;
    const target = kind === 'fullscreen' ? Mode.FULLSCREEN : Mode.MAXIMIZED;
    return mode === target ? Mode.TILED : target;
}
