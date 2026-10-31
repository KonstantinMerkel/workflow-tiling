import Gio from 'gi://Gio';
import { CUSTOM_KEYBINDING, GNOME_SHORTCUT_SCHEMAS, MEDIA_KEYS, shortcutEntries } from '../utils/shortcuts.js';

/**
 * Every shortcut GNOME binds, including the user's custom shortcuts; schemas that are not installed are skipped.
 * Read by the Shell (conflict log) and the prefs (conflict warnings).
 * @param {Gio.Settings[]} [settingsList] from gnomeShortcutSettings(); the prefs pass the ones they watch
 * @returns {{accel: string, id: string, label: string}[]} accel normalized, id `schema/key`
 */
export function gnomeShortcuts(settingsList = gnomeShortcutSettings()) {
    const source = Gio.SettingsSchemaSource.get_default();
    const sources = settingsList.flatMap((settings) => {
        const schemaId = settings.schema_id;
        if (schemaId === CUSTOM_KEYBINDING) {
            const label = `${settings.get_string('name')} (GNOME custom)`;
            return [{ id: `${CUSTOM_KEYBINDING}${settings.path}`, label, accels: [settings.get_string('binding')] }];
        }
        const schema = source.lookup(schemaId, true);
        return schema
            .list_keys()
            .filter((key) => key !== 'custom-keybindings')
            .map((key) => ({ key, schemaKey: schema.get_key(key) }))
            .filter(({ schemaKey }) => schemaKey.get_value_type().dup_string() === 'as')
            .map(({ key, schemaKey }) => ({
                id: `${schemaId}/${key}`,
                label: `${schemaKey.get_summary() || key} (GNOME)`,
                accels: settings.get_strv(key),
            }));
    });
    return shortcutEntries(sources);
}

/**
 * The settings holding GNOME's shortcuts, installed schemas only. The media-keys settings come first: their
 * `custom-keybindings` key lists the custom shortcuts, so a change there needs new watchers.
 * @returns {Gio.Settings[]}
 */
export function gnomeShortcutSettings() {
    const source = Gio.SettingsSchemaSource.get_default();
    const installed = [MEDIA_KEYS, ...GNOME_SHORTCUT_SCHEMAS.filter((id) => id !== MEDIA_KEYS)].filter((id) =>
        source.lookup(id, true),
    );
    const settings = installed.map((id) => new Gio.Settings({ schema_id: id }));
    if (!installed.includes(MEDIA_KEYS) || !source.lookup(CUSTOM_KEYBINDING, true)) return settings;
    const paths = settings[0].get_strv('custom-keybindings');
    return [...settings, ...paths.map((path) => new Gio.Settings({ schema_id: CUSTOM_KEYBINDING, path }))];
}
