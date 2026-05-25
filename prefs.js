import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ShortcutRowMixin = {
    _recordShortcut() {
        const window = this.get_root();
        const dialog = new Adw.AlertDialog({
            heading: 'Set Shortcut',
            body: 'Press the new shortcut combination...\nPress Backspace to clear.',
        });
        dialog.add_response('cancel', 'Cancel');

        let surface = null;
        if (window && typeof window.get_surface === 'function') {
            surface = window.get_surface();
            if (surface && typeof surface.inhibit_system_shortcuts === 'function') {
                try {
                    surface.inhibit_system_shortcuts(null);
                } catch (e) {
                    console.error('Failed to inhibit system shortcuts:', e);
                }
            }
        }

        const cleanup = () => {
            if (surface && typeof surface.restore_system_shortcuts === 'function') {
                try {
                    surface.restore_system_shortcuts();
                } catch (e) {}
            }
            surface = null;
        };

        dialog.connect('response', cleanup);
        
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (ctrl, keyval, keycode, state) => {
            const modifiers = state & Gtk.accelerator_get_default_mod_mask();

            if (keyval === Gdk.KEY_BackSpace && modifiers === 0) {
                this.settings.set_strv(this.keyName, []);
                cleanup();
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            const isModifier = (keyval >= Gdk.KEY_Shift_L && keyval <= Gdk.KEY_Hyper_R) ||
                               (keyval >= Gdk.KEY_Alt_L && keyval <= Gdk.KEY_Alt_R) ||
                               (keyval >= Gdk.KEY_Meta_L && keyval <= Gdk.KEY_Meta_R) ||
                               (keyval >= Gdk.KEY_Super_L && keyval <= Gdk.KEY_Super_R) ||
                               (keyval >= Gdk.KEY_Control_L && keyval <= Gdk.KEY_Control_R);
            if (isModifier) return Gdk.EVENT_PROPAGATE;

            const accel = Gtk.accelerator_name(keyval, modifiers);
            if (accel) {
                this.settings.set_strv(this.keyName, [accel]);
                cleanup();
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            return Gdk.EVENT_PROPAGATE;
        });

        dialog.add_controller(controller);
        dialog.present(window);
    }
};

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
});
Object.assign(ShortcutRow.prototype, ShortcutRowMixin);

// ToggleableShortcutRow removed as requested
export default class WorkflowTilingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        
        // --- Gaps Group ---
        const gapsGroup = new Adw.PreferencesGroup({ title: 'Gaps' });
        const enableGapsRow = new Adw.SwitchRow({ title: 'Enable Gaps', subtitle: 'Global toggle for all gaps' });
        settings.bind('enable-gaps', enableGapsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        gapsGroup.add(enableGapsRow);
        const innerGapsRow = new Adw.SpinRow({ title: '  ↳ Inner Gaps', subtitle: '      Gap size between tiled windows', adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }) });
        settings.bind('inner-gaps', innerGapsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        gapsGroup.add(innerGapsRow);
        const outerGapsRow = new Adw.SpinRow({ title: '  ↳ Outer Gaps', subtitle: '      Gap size between windows and screen edges', adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }) });
        settings.bind('outer-gaps', outerGapsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        gapsGroup.add(outerGapsRow);

        const updateGapsVisibility = () => {
            const enabled = settings.get_boolean('enable-gaps');
            innerGapsRow.visible = enabled;
            outerGapsRow.visible = enabled;
        };
        settings.connect('changed::enable-gaps', updateGapsVisibility);
        updateGapsVisibility();

        page.add(gapsGroup);

        // --- Core Keybindings Group ---
        const keysGroup = new Adw.PreferencesGroup({ title: 'Keybindings' });
        const modeRow = new Adw.ComboRow({ 
            title: 'Mode', 
            subtitle: '',
            model: Gtk.StringList.new(['Default', 'Custom', 'Disabled']) 
        });
        const currentMode = settings.get_string('keybindings-mode');
        modeRow.selected = currentMode === 'custom' ? 1 : (currentMode === 'disabled' ? 2 : 0);
        modeRow.connect('notify::selected', () => {
            let mode = 'default';
            if (modeRow.selected === 1) mode = 'custom';
            if (modeRow.selected === 2) mode = 'disabled';
            settings.set_string('keybindings-mode', mode);
        });
        keysGroup.add(modeRow);

        const customMoveLeft = new ShortcutRow(settings, 'custom-move-window-left', '  ↳ Move Window Left');
        const customMoveRight = new ShortcutRow(settings, 'custom-move-window-right', '  ↳ Move Window Right');
        const customMoveUp = new ShortcutRow(settings, 'custom-move-window-up', '  ↳ Move Window Up');
        const customMoveDown = new ShortcutRow(settings, 'custom-move-window-down', '  ↳ Move Window Down');
        keysGroup.add(customMoveLeft);
        keysGroup.add(customMoveRight);
        keysGroup.add(customMoveUp);
        keysGroup.add(customMoveDown);

        const updateVisibility = () => {
            const mode = settings.get_string('keybindings-mode');
            modeRow.subtitle = mode === 'default' ? 'Default: <Super> + <Arrow_Keys>' : '';
            const showCustom = mode === 'custom';
            customMoveLeft.visible = showCustom;
            customMoveRight.visible = showCustom;
            customMoveUp.visible = showCustom;
            customMoveDown.visible = showCustom;
        };
        settings.connect('changed::keybindings-mode', updateVisibility);
        updateVisibility();

        page.add(keysGroup);

        // --- Focus Window Group ---
        const focusGroup = new Adw.PreferencesGroup({ title: 'Focus Keybindings' });
        
        const focusModeRow = new Adw.ComboRow({ 
            title: 'Mode', 
            subtitle: '',
            model: Gtk.StringList.new(['Default', 'Custom', 'Disabled']) 
        });
        const focusMode = settings.get_string('focus-window-mode');
        focusModeRow.selected = focusMode === 'custom' ? 1 : (focusMode === 'disabled' ? 2 : 0);
        focusModeRow.connect('notify::selected', () => {
            let mode = 'default';
            if (focusModeRow.selected === 1) mode = 'custom';
            if (focusModeRow.selected === 2) mode = 'disabled';
            settings.set_string('focus-window-mode', mode);
        });
        focusGroup.add(focusModeRow);

        const customFocusLeft = new ShortcutRow(settings, 'custom-focus-window-left', '  ↳ Focus Window Left');
        const customFocusRight = new ShortcutRow(settings, 'custom-focus-window-right', '  ↳ Focus Window Right');
        const customFocusUp = new ShortcutRow(settings, 'custom-focus-window-up', '  ↳ Focus Window Up');
        const customFocusDown = new ShortcutRow(settings, 'custom-focus-window-down', '  ↳ Focus Window Down');
        focusGroup.add(customFocusLeft);
        focusGroup.add(customFocusRight);
        focusGroup.add(customFocusUp);
        focusGroup.add(customFocusDown);

        const updateFocusVisibility = () => {
            const mode = settings.get_string('focus-window-mode');
            focusModeRow.subtitle = mode === 'default' ? 'Default: <Ctrl> + <Shift> + <Vim (h,j,k,l)>' : '';
            const showCustom = mode === 'custom';
            customFocusLeft.visible = showCustom;
            customFocusRight.visible = showCustom;
            customFocusUp.visible = showCustom;
            customFocusDown.visible = showCustom;
        };
        settings.connect('changed::focus-window-mode', updateFocusVisibility);
        updateFocusVisibility();

        page.add(focusGroup);

        // --- Additional Batch Shortcuts Group ---
        const batchKeysGroup = new Adw.PreferencesGroup({ title: 'Batch Operations' });

        const closeMonitorRow = new ShortcutRow(settings, 'shortcut-close-monitor', 'Close Monitor Windows');
        batchKeysGroup.add(closeMonitorRow);

        const closeMinRow = new Adw.SwitchRow({ title: '  ↳ Include Minimized', subtitle: '      Also close minimized windows on monitor' });
        settings.bind('close-monitor-include-minimized', closeMinRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        const updateCloseMinRowVisibility = () => {
            const strv = settings.get_strv('shortcut-close-monitor');
            closeMinRow.visible = strv.length > 0 && strv[0] !== '';
        };
        settings.connect('changed::shortcut-close-monitor', updateCloseMinRowVisibility);
        updateCloseMinRowVisibility();
        batchKeysGroup.add(closeMinRow);

        batchKeysGroup.add(new ShortcutRow(settings, 'shortcut-close-workspace', 'Close Workspace Windows'));
        batchKeysGroup.add(new ShortcutRow(settings, 'shortcut-switch-monitor', 'Switch Monitors'));
        batchKeysGroup.add(new ShortcutRow(settings, 'shortcut-port-monitor-left', 'Port Monitor to Left Workspace'));
        batchKeysGroup.add(new ShortcutRow(settings, 'shortcut-port-monitor-right', 'Port Monitor to Right Workspace'));
        batchKeysGroup.add(new ShortcutRow(settings, 'shortcut-unminimize-workspace', 'Unminimize Workspace'));

        page.add(batchKeysGroup);

        window.add(page);
    }
}
