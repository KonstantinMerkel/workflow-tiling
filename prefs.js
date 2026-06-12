import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { LayoutPreviewPage } from './lib/editor/preview.js';
import { LayoutEditorPage } from './lib/editor/editor.js';


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

// Layout editor page outsourced to lib/editor/
export default class WorkflowTilingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' });
        
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

        // --- Monitor Transition Group ---
        const transitionGroup = new Adw.PreferencesGroup({ title: 'Monitor Transition' });
        const transitionRow = new Adw.SwitchRow({ 
            title: 'Swap Windows', 
            subtitle: 'Swap windows across monitors instead of escalating/de-escalating' 
        });
        transitionRow.active = settings.get_string('monitor-transition-behavior') === 'swap';
        transitionRow.connect('notify::active', () => {
            settings.set_string('monitor-transition-behavior', transitionRow.active ? 'swap' : 'escalate');
        });
        settings.connect('changed::monitor-transition-behavior', () => {
            const active = settings.get_string('monitor-transition-behavior') === 'swap';
            if (transitionRow.active !== active) {
                transitionRow.active = active;
            }
        });
        transitionGroup.add(transitionRow);
        page.add(transitionGroup);


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

        const moveRows = [
            { id: 'custom-move-window-left', label: '  ↳ Move Window Left' },
            { id: 'custom-move-window-right', label: '  ↳ Move Window Right' },
            { id: 'custom-move-window-up', label: '  ↳ Move Window Up' },
            { id: 'custom-move-window-down', label: '  ↳ Move Window Down' }
        ].map(s => {
            const row = new ShortcutRow(settings, s.id, s.label);
            keysGroup.add(row);
            return row;
        });

        const updateVisibility = () => {
            const mode = settings.get_string('keybindings-mode');
            modeRow.subtitle = mode === 'default' ? 'Default: <Super> + <Arrow_Keys>' : '';
            const showCustom = mode === 'custom';
            moveRows.forEach(r => r.visible = showCustom);
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

        const focusRows = [
            { id: 'custom-focus-window-left', label: '  ↳ Focus Window Left' },
            { id: 'custom-focus-window-right', label: '  ↳ Focus Window Right' },
            { id: 'custom-focus-window-up', label: '  ↳ Focus Window Up' },
            { id: 'custom-focus-window-down', label: '  ↳ Focus Window Down' }
        ].map(s => {
            const row = new ShortcutRow(settings, s.id, s.label);
            focusGroup.add(row);
            return row;
        });

        const updateFocusVisibility = () => {
            const mode = settings.get_string('focus-window-mode');
            focusModeRow.subtitle = mode === 'default' ? 'Default: <Ctrl> + <Shift> + <Vim (h,j,k,l)>' : '';
            const showCustom = mode === 'custom';
            focusRows.forEach(r => r.visible = showCustom);
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

        [
            { id: 'shortcut-close-workspace', label: 'Close Workspace Windows' },
            { id: 'shortcut-switch-monitor', label: 'Switch Monitors' },
            { id: 'shortcut-port-monitor-left', label: 'Port Monitor to Left Workspace' },
            { id: 'shortcut-port-monitor-right', label: 'Port Monitor to Right Workspace' },
            { id: 'shortcut-unminimize-workspace', label: 'Unminimize Workspace' }
        ].forEach(s => batchKeysGroup.add(new ShortcutRow(settings, s.id, s.label)));

        page.add(batchKeysGroup);

        window.add(page);

        // --- Custom Layouts (JSON debug) Page ---
        const layoutPage = new LayoutEditorPage(settings);
        // Do not add to window yet.

        // --- Visual Layout Editor Page ---
        const previewPage = new LayoutPreviewPage(settings);
        window.add(previewPage);

        // --- Advanced JSON Toggle ---
        const advancedGroup = new Adw.PreferencesGroup();
        const jsonToggle = new Adw.SwitchRow({ 
            title: 'Edit Base JSON Instead',
            subtitle: 'Only if you know what you are doing. This will not save you from bad decisions'
        });
        
        let jsonPageAdded = false;
        jsonToggle.connect('notify::active', () => {
            if (jsonToggle.active && !jsonPageAdded) {
                window.add(layoutPage);
                jsonPageAdded = true;
            } else if (!jsonToggle.active && jsonPageAdded) {
                window.remove(layoutPage);
                jsonPageAdded = false;
            }
        });
        advancedGroup.add(jsonToggle);
        previewPage.add(advancedGroup);
    }
}
