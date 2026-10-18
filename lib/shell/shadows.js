import Gio from 'gi://Gio';
import { Logger } from '../utils/logger.js';

const NATIVE_SCHEMAS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.shell.keybindings',
];

const MODIFIERS = {
    primary: 'Control',
    ctrl: 'Control',
    control: 'Control',
    ctl: 'Control',
    shift: 'Shift',
    shft: 'Shift',
    alt: 'Alt',
    mod1: 'Alt',
    super: 'Super',
    mod4: 'Super',
    meta: 'Meta',
    hyper: 'Hyper',
    mod2: 'Mod2',
    mod3: 'Mod3',
    mod5: 'Mod5',
    release: 'Release',
};

/**
 * Temporarily removes native GNOME shortcuts that collide with the extension's shortcuts. The original values are
 * written to the `shadowed-keybindings` key before anything is changed, so a Shell crash never loses them.
 */
export class ShadowManager {
    /**
     * @param {Gio.Settings} settings extension settings
     * @param {string[]} protectedKeys native keys taken over by custom handlers; never shadowed
     */
    constructor(settings, protectedKeys = []) {
        this._settings = settings;
        this._protected = new Set(protectedKeys);
        this._nativeSchemas = [];

        const source = Gio.SettingsSchemaSource.get_default();
        for (const id of NATIVE_SCHEMAS) {
            if (source.lookup(id, true)) this._nativeSchemas.push(new Gio.Settings({ schema_id: id }));
        }
    }

    /** Normalizes modifier order and aliases so `<Super><Alt>x` equals `<Alt><Super>x`. */
    _normalize(accelerator) {
        if (typeof accelerator !== 'string') return '';
        const trimmed = accelerator.trim();
        if (!trimmed) return '';

        const modifiers = new Set();
        for (const match of trimmed.match(/<[^>]+>/g) ?? []) {
            const name = match.slice(1, -1).trim().toLowerCase();
            modifiers.add(MODIFIERS[name] ?? name.charAt(0).toUpperCase() + name.slice(1));
        }
        const key = trimmed.replace(/<[^>]+>/g, '').trim();
        if (!key && modifiers.size === 0) return '';

        const prefix = [...modifiers]
            .sort((a, b) => a.localeCompare(b))
            .map((m) => `<${m}>`)
            .join('');
        return `${prefix}${key}`;
    }

    /** @param {string[]} extensionKeys keys of the extension schema whose accelerators are about to be bound */
    shadowShortcuts(extensionKeys) {
        this.restoreAll();

        const targets = new Set();
        for (const key of extensionKeys) {
            for (const accelerator of this._settings.get_strv(key)) {
                const normalized = this._normalize(accelerator);
                if (normalized) targets.add(normalized);
            }
        }
        if (targets.size === 0) return;

        const state = this._readState();
        for (const native of this._nativeSchemas) {
            for (const key of native.list_keys()) {
                if (this._protected.has(key)) continue;
                try {
                    if (native.get_value(key).get_type_string() !== 'as') continue;
                    const accelerators = native.get_strv(key);
                    const remaining = accelerators.filter((a) => !targets.has(this._normalize(a)));
                    if (remaining.length === accelerators.length) continue;

                    state[native.schema_id] ??= {};
                    state[native.schema_id][key] ??= accelerators;
                    this._settings.set_string('shadowed-keybindings', JSON.stringify(state));
                    native.set_strv(key, remaining);
                    Logger.debug(`ShadowManager: shadowed ${native.schema_id}.${key}`);
                } catch {
                    // keys that cannot be read as string arrays are skipped
                }
            }
        }
    }

    /**
     * Writes every backed-up native key back, protected keys included (protection only prevents shadowing). Backups
     * that cannot be restored, including those of schemas not installed, stay in the backup.
     */
    restoreAll() {
        const state = this._readState();
        if (Object.keys(state).length === 0) return;

        const remaining = {};
        for (const [schemaId, keys] of Object.entries(state)) {
            if (!this._nativeSchemas.some((native) => native.schema_id === schemaId)) remaining[schemaId] = keys;
        }
        for (const native of this._nativeSchemas) {
            for (const [key, accelerators] of Object.entries(state[native.schema_id] ?? {})) {
                try {
                    native.set_strv(key, accelerators);
                    Logger.debug(`ShadowManager: restored ${native.schema_id}.${key}`);
                } catch (e) {
                    Logger.warn(`ShadowManager: failed to restore ${native.schema_id}.${key}`, e);
                    remaining[native.schema_id] ??= {};
                    remaining[native.schema_id][key] = accelerators;
                }
            }
        }
        this._settings.set_string('shadowed-keybindings', JSON.stringify(remaining));
    }

    _readState() {
        try {
            return JSON.parse(this._settings.get_string('shadowed-keybindings') || '{}');
        } catch (e) {
            Logger.warn('ShadowManager: failed to parse shadowed-keybindings', e);
            return {};
        }
    }
}
