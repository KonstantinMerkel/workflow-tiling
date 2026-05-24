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

        const keysGroup = new Adw.PreferencesGroup({
            title: 'Keybindings',
            description: 'You can customize these shortcuts in dconf-editor under org.gnome.shell.extensions.workflow-tiling or via GNOME Settings if supported.'
        });

        const leftRow = new Adw.ActionRow({ title: 'Move Window Left', subtitle: settings.get_strv('move-window-left').join(', ') || 'Disabled' });
        const rightRow = new Adw.ActionRow({ title: 'Move Window Right', subtitle: settings.get_strv('move-window-right').join(', ') || 'Disabled' });
        const upRow = new Adw.ActionRow({ title: 'Move Window Up', subtitle: settings.get_strv('move-window-up').join(', ') || 'Disabled' });
        const downRow = new Adw.ActionRow({ title: 'Move Window Down', subtitle: settings.get_strv('move-window-down').join(', ') || 'Disabled' });
        
        keysGroup.add(leftRow);
        keysGroup.add(rightRow);
        keysGroup.add(upRow);
        keysGroup.add(downRow);

        page.add(keysGroup);

        window.add(page);
    }
}
