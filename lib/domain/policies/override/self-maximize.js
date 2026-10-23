import { Mode } from '../../types.js';

/** Which apps may maximise or fullscreen their windows themselves (title bar, F11, starting maximised). */
export const SelfMaximizeMode = Object.freeze({
    NEVER: 'never',
    ALLOW_LISTED: 'allow-listed',
    ALL_EXCEPT_LISTED: 'all-except-listed',
});

/**
 * Normalised list entry for an app id: lower case, without the `.desktop` suffix.
 * @param {string} id desktop file id, Wayland app id or WM class
 */
export function appEntry(id) {
    return id.trim().toLowerCase().replace(/\.desktop$/, '');
}

/**
 * An entry matches an app id or WM class that equals it or continues it after `.` or `-`, so `libreoffice` covers
 * `libreoffice-writer` and `org.libreoffice.LibreOffice` covers `org.libreoffice.LibreOffice.writer`.
 * @param {string[]} entries
 * @param {{appId: string|null, wmClass: string|null}} app
 */
export function matchesApp(entries, app) {
    const names = [app.appId, app.wmClass].filter(Boolean).map(appEntry);
    return entries.map(appEntry).some((entry) =>
        names.some((name) => name === entry || name.startsWith(`${entry}.`) || name.startsWith(`${entry}-`)),
    );
}

/**
 * @param {{mode: string, allowList: string[], blockList: string[]}} rules
 * @param {{appId: string|null, wmClass: string|null}} app
 */
export function allowsSelfMaximize(rules, app) {
    switch (rules.mode) {
        case SelfMaximizeMode.ALLOW_LISTED:
            return matchesApp(rules.allowList, app);
        case SelfMaximizeMode.ALL_EXCEPT_LISTED:
            return !matchesApp(rules.blockList, app);
        default:
            return false;
    }
}

/**
 * Mode a window put itself into. Only a maximisation in both directions counts; half-tiling stays TILED.
 * @param {{fullscreen: boolean, maximizedFully: boolean}} facts
 */
export function selfChosenMode(facts) {
    if (facts.fullscreen) return Mode.FULLSCREEN;
    return facts.maximizedFully ? Mode.MAXIMIZED : Mode.TILED;
}

/** @returns {string[]} the list with `id` added as an entry, unless an equal entry is already in it */
export function withEntry(entries, id) {
    const entry = appEntry(id);
    if (!entry || entries.some((e) => appEntry(e) === entry)) return [...entries];
    return [...entries, entry];
}
