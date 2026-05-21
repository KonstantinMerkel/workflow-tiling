import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WorkflowTilingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Gaps',
        });

        const enableGapsRow = new Adw.SwitchRow({
            title: 'Enable Gaps',
            subtitle: 'Global toggle for all gaps',
        });
        settings.bind('enable-gaps', enableGapsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enableGapsRow);

        const innerGapsRow = new Adw.SpinRow({
            title: 'Inner Gaps',
            subtitle: 'Gap size between tiled windows',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
            }),
        });
        settings.bind('inner-gaps', innerGapsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(innerGapsRow);

        const outerGapsRow = new Adw.SpinRow({
            title: 'Outer Gaps',
            subtitle: 'Gap size between windows and screen edges',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
            }),
        });
        settings.bind('outer-gaps', outerGapsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(outerGapsRow);

        page.add(group);
        window.add(page);
    }
}
