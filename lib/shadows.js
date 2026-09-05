import Gio from 'gi://Gio';
import { Logger } from './utils/logger.js';

const MOD_MAP = {
    'primary': 'Control',
    'ctrl': 'Control',
    'control': 'Control',
    'ctl': 'Control',
    'shift': 'Shift',
    'shft': 'Shift',
    'alt': 'Alt',
    'mod1': 'Alt',
    'super': 'Super',
    'mod4': 'Super',
    'meta': 'Meta',
    'hyper': 'Hyper',
    'mod2': 'Mod2',
    'mod3': 'Mod3',
    'mod5': 'Mod5',
    'release': 'Release'
};

export class ShadowManager {
    constructor(extensionSettings, protectedKeys = []) {
        this.extensionSettings = extensionSettings;
        this._protectedNativeKeys = new Set(protectedKeys);
        this._nativeSchemas = [];

        const schemaIds = [
            'org.gnome.desktop.wm.keybindings',
            'org.gnome.mutter.keybindings',
            'org.gnome.mutter.wayland.keybindings',
            'org.gnome.shell.keybindings'
        ];

        const schemaSource = Gio.SettingsSchemaSource.get_default();
        for (const id of schemaIds) {
            const schema = schemaSource.lookup(id, true);
            if (schema) {
                this._nativeSchemas.push(new Gio.Settings({ schema_id: id }));
            }
        }
    }

    _normalize(shortcut) {
        if (!shortcut || typeof shortcut !== 'string') return '';
        const trimmed = shortcut.trim();
        if (!trimmed) return '';

        const modMatches = trimmed.match(/<[^>]+>/g) || [];
        const rawKey = trimmed.replace(/<[^>]+>/g, '').trim();
        if (!rawKey && modMatches.length === 0) return '';

        const parsedMods = new Set();
        for (const m of modMatches) {
            const clean = m.slice(1, -1).trim().toLowerCase();
            const mapped = MOD_MAP[clean] || (clean.charAt(0).toUpperCase() + clean.slice(1));
            parsedMods.add(mapped);
        }

        const sortedMods = Array.from(parsedMods).sort((a, b) => a.localeCompare(b));
        const modPrefix = sortedMods.map(m => `<${m}>`).join('');

        return `${modPrefix}${rawKey}`;
    }

    shadowShortcuts(extensionKeys) {
        // First restore everything to ensure a clean slate
        this.restoreAll();

        const stateJson = this.extensionSettings.get_string('shadowed-keybindings');
        let state = {};
        try {
            if (stateJson) state = JSON.parse(stateJson);
        } catch (e) {
            Logger.warn('ShadowManager: Failed to parse shadowed-keybindings JSON', e);
        }

        // Gather all target accelerators we want to bind
        const targetAccels = new Set();
        for (const extKey of extensionKeys) {
            const accels = this.extensionSettings.get_strv(extKey);
            for (const a of accels) {
                const norm = this._normalize(a);
                if (norm) targetAccels.add(norm);
            }
        }

        if (targetAccels.size === 0) return;

        // Scan native schemas
        for (const settings of this._nativeSchemas) {
            const schemaId = settings.schema_id;
            const keys = settings.list_keys();

            for (const key of keys) {
                if (this._protectedNativeKeys.has(key)) continue;
                try {
                    const value = settings.get_value(key);
                    if (value.get_type_string() !== 'as') continue;

                    const accels = settings.get_strv(key);
                    let changed = false;
                    const newAccels = [];

                    for (const accel of accels) {
                        const norm = this._normalize(accel);
                        if (targetAccels.has(norm)) {
                            changed = true;
                            Logger.debug(`ShadowManager: Conflicting native shortcut found: ${schemaId}.${key} -> ${accel}`);
                        } else {
                            newAccels.push(accel);
                        }
                    }

                    if (changed) {
                        // Save original in state
                        if (!state[schemaId]) state[schemaId] = {};
                        // Only save the very first time we modify this key, to not overwrite our backup with a partial array
                        if (!state[schemaId][key]) state[schemaId][key] = accels;

                        settings.set_strv(key, newAccels);
                        Logger.debug(`ShadowManager: Shadowed ${schemaId}.${key} -> remaining: [${newAccels.join(', ')}]`);
                    }
                } catch (e) {
                    // Ignore keys that fail to read or aren't string arrays
                }
            }
        }

        this.extensionSettings.set_string('shadowed-keybindings', JSON.stringify(state));
    }

    restoreAll() {
        const stateJson = this.extensionSettings.get_string('shadowed-keybindings');
        let state = {};
        try {
            if (stateJson) state = JSON.parse(stateJson);
        } catch (e) {
            return;
        }

        if (Object.keys(state).length === 0) return;

        const remaining = {};
        let hasRemaining = false;

        for (const settings of this._nativeSchemas) {
            const schemaId = settings.schema_id;
            if (!state[schemaId]) continue;

            for (const [key, originalAccels] of Object.entries(state[schemaId])) {
                if (this._protectedNativeKeys.has(key)) {
                    Logger.debug(`ShadowManager: Skipping protected key ${schemaId}.${key}`);
                    continue;
                }
                try {
                    settings.set_strv(key, originalAccels);
                    Logger.debug(`ShadowManager: Restored ${schemaId}.${key}`);
                } catch (e) {
                    Logger.warn(`ShadowManager: Failed to restore ${schemaId}.${key}`, e);
                    if (!remaining[schemaId]) remaining[schemaId] = {};
                    remaining[schemaId][key] = originalAccels;
                    hasRemaining = true;
                }
            }
        }

        this.extensionSettings.set_string(
            'shadowed-keybindings',
            hasRemaining ? JSON.stringify(remaining) : '{}'
        );
    }
}
