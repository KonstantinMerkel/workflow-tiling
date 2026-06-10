import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import { Logger } from './logger.js';

export class ShadowManager {
    constructor(extensionSettings) {
        this.extensionSettings = extensionSettings;
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
        if (!shortcut) return '';
        try {
            const [valid, keyval, mods] = Gtk.accelerator_parse(shortcut);
            if (valid) {
                return Gtk.accelerator_name(keyval, mods);
            }
        } catch (e) {
            // Ignore parse errors, fallback to raw string
        }
        return shortcut;
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

        for (const settings of this._nativeSchemas) {
            const schemaId = settings.schema_id;
            if (state[schemaId]) {
                for (const [key, originalAccels] of Object.entries(state[schemaId])) {
                    try {
                        settings.set_strv(key, originalAccels);
                        Logger.debug(`ShadowManager: Restored native shortcut ${schemaId}.${key} -> [${originalAccels.join(', ')}]`);
                    } catch (e) {
                        Logger.warn(`ShadowManager: Failed to restore ${schemaId}.${key}`, e);
                    }
                }
            }
        }

        // Clear the state
        this.extensionSettings.set_string('shadowed-keybindings', '{}');
    }
}
