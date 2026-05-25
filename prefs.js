import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ShortcutRow = GObject.registerClass(
class ShortcutRow extends Adw.ActionRow {
    _init(settings, keyName, title) {
        super._init({ title });
        this.settings = settings;
        this.keyName = keyName;

        this.shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled',
            accelerator: this._getAccelerator(),
            valign: Gtk.Align.CENTER,
        });
        
        this.add_suffix(this.shortcutLabel);
        this.activatable = true;
        
        this.connect('activated', () => this._recordShortcut());
        
        this.settings.connect(`changed::${this.keyName}`, () => {
            this.shortcutLabel.accelerator = this._getAccelerator();
        });
    }

    _getAccelerator() {
        const strv = this.settings.get_strv(this.keyName);
        return strv.length > 0 ? strv[0] : '';
    }

    _recordShortcut() {
        const window = this.get_root();
        const dialog = new Adw.AlertDialog({
            heading: 'Set Shortcut',
            body: 'Press the new shortcut combination...',
        });
        dialog.add_response('cancel', 'Cancel');
        
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (ctrl, keyval, keycode, state) => {
            const modifiers = state & Gtk.accelerator_get_default_mod_mask();
            
            // Ignore if only modifiers are pressed
            const isModifier = (keyval >= Gdk.KEY_Shift_L && keyval <= Gdk.KEY_Hyper_R) ||
                               (keyval >= Gdk.KEY_Alt_L && keyval <= Gdk.KEY_Alt_R) ||
                               (keyval >= Gdk.KEY_Meta_L && keyval <= Gdk.KEY_Meta_R) ||
                               (keyval >= Gdk.KEY_Super_L && keyval <= Gdk.KEY_Super_R) ||
                               (keyval >= Gdk.KEY_Control_L && keyval <= Gdk.KEY_Control_R);
            if (isModifier) return Gdk.EVENT_PROPAGATE;

            const accel = Gtk.accelerator_name(keyval, modifiers);
            
            if (accel) {
                this.settings.set_strv(this.keyName, [accel]);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            return Gdk.EVENT_PROPAGATE;
        });

        dialog.add_controller(controller);
        dialog.present(window);
    }
});

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
            description: 'Choose Default for rigid <Super>+Arrows or Custom.'
        });

        const modeRow = new Adw.ComboRow({
            title: 'Mode',
            model: Gtk.StringList.new(['Default (<Super> + Arrows)', 'Custom']),
        });

        const currentMode = settings.get_string('keybindings-mode');
        modeRow.selected = currentMode === 'custom' ? 1 : 0;

        modeRow.connect('notify::selected', () => {
            const isCustom = modeRow.selected === 1;
            settings.set_string('keybindings-mode', isCustom ? 'custom' : 'default');
        });

        keysGroup.add(modeRow);

        const customKeysGroup = new Adw.PreferencesGroup({
            title: 'Custom Keybindings',
        });

        const leftRow = new ShortcutRow(settings, 'custom-move-window-left', 'Move Window Left');
        const rightRow = new ShortcutRow(settings, 'custom-move-window-right', 'Move Window Right');
        const upRow = new ShortcutRow(settings, 'custom-move-window-up', 'Move Window Up');
        const downRow = new ShortcutRow(settings, 'custom-move-window-down', 'Move Window Down');

        customKeysGroup.add(leftRow);
        customKeysGroup.add(rightRow);
        customKeysGroup.add(upRow);
        customKeysGroup.add(downRow);

        // Toggle visibility based on mode
        const updateVisibility = () => {
            const isCustom = settings.get_string('keybindings-mode') === 'custom';
            customKeysGroup.visible = isCustom;
        };
        settings.connect('changed::keybindings-mode', updateVisibility);
        updateVisibility();

        page.add(keysGroup);
        page.add(customKeysGroup);

        window.add(page);
    }
}
