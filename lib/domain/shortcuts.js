import { DIRECTIONS } from './types.js';

/** Mode of a group of move or focus shortcuts; any other value names a preset. */
export const ShortcutMode = Object.freeze({
    NONE: 'none', // binds nothing (the default)
    CUSTOM: 'custom', // binds the user's own keys
});

const arrows = (mods) => ({ left: `${mods}Left`, right: `${mods}Right`, up: `${mods}Up`, down: `${mods}Down` });
const vim = (mods) => ({ left: `${mods}h`, right: `${mods}l`, up: `${mods}k`, down: `${mods}j` });

/** Fixed key sets either mode can choose instead of the user's own keys; the schema lists them as `<choices>`. */
export const SHORTCUT_PRESETS = Object.freeze({
    'ctrl-shift-hjkl': { label: 'Ctrl + Shift + H/J/K/L', keys: vim('<Control><Shift>') },
    'ctrl-super-hjkl': { label: 'Ctrl + Super + H/J/K/L', keys: vim('<Control><Super>') }, // unused by GNOME
    'super-arrows': { label: 'Super + Arrows', keys: arrows('<Super>') },
    'super-shift-arrows': { label: 'Super + Shift + Arrows', keys: arrows('<Shift><Super>') },
});

/**
 * The move and focus shortcuts, one group per mode key. `<prefix>-<dir>` holds the keys that are bound, written from
 * the mode; `custom-<prefix>-<dir>` holds the user's own keys, used in Custom and kept while a preset is chosen.
 */
export const DIRECTIONAL_SHORTCUTS = Object.freeze([
    {
        action: 'focus',
        modeKey: 'focus-window-mode',
        prefix: 'focus-window',
    },
    {
        action: 'move',
        modeKey: 'keybindings-mode',
        prefix: 'move-window',
    },
]);

/** @returns {string} the settings key bound for `dir` */
export const boundKey = (group, dir) => `${group.prefix}-${dir}`;

/** @returns {string} the settings key with the user's own key for `dir` */
export const customKey = (group, dir) => `custom-${group.prefix}-${dir}`;

/**
 * Keys a group binds in `mode`: none, a preset's fixed keys or the user's own keys. Unknown modes bind nothing.
 * @param {(dir: string) => string[]} ownKeys the user's keys for a direction
 * @returns {Object<string, string[]>} keys by direction
 */
export function keysForMode(mode, ownKeys) {
    const preset = SHORTCUT_PRESETS[mode];
    const keysFor = (dir) => {
        if (preset) return [preset.keys[dir]];
        return mode === ShortcutMode.CUSTOM ? ownKeys(dir) : [];
    };
    return Object.fromEntries(DIRECTIONS.map((dir) => [dir, keysFor(dir)]));
}
