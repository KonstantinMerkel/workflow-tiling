import { DIRECTIONAL_SHORTCUTS, boundKey, customKey, keysForMode } from '../domain/shortcuts.js';

/** Modifier spellings GTK and Mutter accept, by the name used for comparing. */
const MODIFIERS = {
    control: 'Control',
    primary: 'Control',
    ctrl: 'Control',
    ctl: 'Control',
    shift: 'Shift',
    shft: 'Shift',
    alt: 'Alt',
    mod1: 'Alt',
    super: 'Super',
    mod4: 'Super',
    hyper: 'Hyper',
    meta: 'Meta',
};

/** GNOME schemas whose string-list keys hold shortcuts. */
export const GNOME_SHORTCUT_SCHEMAS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];
export const MEDIA_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
export const CUSTOM_KEYBINDING = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';

/**
 * One spelling per key combination, so `<Primary><Shift>h`, `<Shift><Control>H` and `<shift><ctrl>h` compare equal.
 * Works on the text alone, so key names only Mutter knows (`Above_Tab`) are kept.
 * @returns {string|null} null for an empty or disabled entry
 */
export function normalizeAccelerator(accel) {
    const match = /^((?:<[^>]+>)*)([\s\S]*)$/.exec(accel?.trim() ?? '');
    const key = match[2].toLowerCase();
    if (!key || (key === 'disabled' && !match[1])) return null;
    const mods = (match[1].match(/<([^>]+)>/g) ?? []).map((m) => {
        const name = m.slice(1, -1).toLowerCase();
        return MODIFIERS[name] ?? name;
    });
    return `${[...new Set(mods)].sort().map((m) => `<${m}>`).join('')}${key}`;
}

/** @returns {boolean} whether a shortcut key holds at least one usable accelerator */
export function isShortcutSet(accels) {
    return accels.some((accel) => normalizeAccelerator(accel) !== null);
}

/** @returns {Object<string, string[]>} the keys a group binds in its current mode, by direction */
function modeKeys(settings, group) {
    return keysForMode(settings.get_string(group.modeKey), (dir) => settings.get_strv(customKey(group, dir)));
}

/**
 * Writes the keys each mode binds into the bound keys, only where they differ. Only the Shell calls it: on enable and
 * on every change of a mode, own or bound key, so a mode set from anywhere takes effect.
 * @param {{get_string: Function, get_strv: Function, set_strv: Function}} settings extension settings
 */
export function applyShortcutModes(settings) {
    for (const group of DIRECTIONAL_SHORTCUTS) {
        for (const [dir, keys] of Object.entries(modeKeys(settings, group))) {
            const key = boundKey(group, dir);
            const stored = settings.get_strv(key);
            if (stored.length !== keys.length || stored.some((k, i) => k !== keys[i])) settings.set_strv(key, keys);
        }
    }
}

/**
 * @param {{get_string: Function, get_strv: Function}} settings extension settings
 * @returns {boolean} whether a move or focus shortcut is in use: a mode other than None that has a key
 */
export function hasDirectionalShortcuts(settings) {
    return DIRECTIONAL_SHORTCUTS.some((group) => Object.values(modeKeys(settings, group)).some(isShortcutSet));
}

/**
 * Turns shortcut sources read from GNOME (lib/gio/gnome-shortcuts.js) into comparable entries.
 * @param {{id: string, label: string, accels: string[]}[]} sources
 * @returns {{accel: string, id: string, label: string}[]} accel normalized
 */
export function shortcutEntries(sources) {
    return sources.flatMap(({ id, label, accels }) =>
        accels.map(normalizeAccelerator).filter(Boolean).map((accel) => ({ accel, id, label })),
    );
}

/**
 * A key bound twice works for only one of its actions, so each checked id is in conflict with every other entry that
 * uses one of its keys. Both the prefs and the Shell check this way.
 * @param {{accel: string, id: string, label: string}[]} entries every bound key, ours and GNOME's; an id can have more
 * @param {string[]} ids the ids to check
 * @returns {Map<string, string[]>} for each checked id, the labels of the others sharing a key with it
 */
export function findConflicts(entries, ids) {
    return new Map(
        ids.map((id) => {
            const accels = new Set(entries.filter((e) => e.id === id).map((e) => e.accel));
            const others = entries.filter((e) => e.id !== id && accels.has(e.accel)).map((e) => e.label);
            return [id, [...new Set(others)]];
        }),
    );
}
