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
    _init(settings, keyName, title, origin = '') {
        super._init({ title });
        this.settings = settings;
        this.keyName = keyName;
        this._onChangeCallback = null;

        if (origin === 'System') {
            const badgeBox = new Gtk.Box({ orientation: 0, spacing: 4, valign: 3 }); // 0: HORIZONTAL, 3: CENTER
            const icon = new Gtk.Image({ icon_name: 'preferences-system-symbolic' });
            icon.add_css_class('dim-label');
            const lbl = new Gtk.Label({ label: origin, css_classes: ['dim-label', 'caption'] });
            badgeBox.append(icon);
            badgeBox.append(lbl);
            badgeBox.margin_end = 12;
            this.add_suffix(badgeBox);
        }

        this.warningIcon = new Gtk.Image({
            icon_name: 'dialog-warning-symbolic',
            valign: Gtk.Align.CENTER,
            visible: false
        });
        this.warningIcon.add_css_class('warning');
        this.add_suffix(this.warningIcon);

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
            if (this._onChangeCallback) this._onChangeCallback();
        });
    }

    setWarning(isWarning, tooltip = '') {
        this.warningIcon.visible = isWarning;
        this.warningIcon.tooltip_text = tooltip;
    }

    setOnChange(cb) {
        this._onChangeCallback = cb;
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
        const shortcutsPage = new Adw.PreferencesPage({ title: 'Keyboard Shortcuts', icon_name: 'input-keyboard-symbolic' });
        
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

        const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });
        const allRows = [];
        const updateConflicts = () => {
            const accelMap = {};
            const addAccel = (accel, source) => {
                if (!accel) return;
                if (!accelMap[accel]) accelMap[accel] = [];
                accelMap[accel].push(source);
            };

            for (const row of allRows) {
                if (!row.visible && row.keyName && row.keyName.startsWith('custom-')) {
                    continue;
                }
                const accel = row._getAccelerator();
                if (accel === 'disabled') continue;
                addAccel(accel, row);
            }

            const focusMode = settings.get_string('focus-window-mode');
            if (focusMode === 'default') {
                ['focus-window-left', 'focus-window-right', 'focus-window-up', 'focus-window-down'].forEach(k => {
                    const val = settings.get_strv(k);
                    if (val.length > 0) addAccel(val[0], 'focus-default');
                });
            }

            const swapMode = settings.get_string('keybindings-mode');
            if (swapMode === 'default') {
                ['move-window-left', 'move-window-right', 'move-window-up', 'move-window-down'].forEach(k => {
                    const val = settings.get_strv(k);
                    if (val.length > 0) addAccel(val[0], 'swap-default');
                });
            }

            for (const row of allRows) {
                if (!row.visible) {
                    row.setWarning(false);
                    continue;
                }
                const accel = row._getAccelerator();
                if (accel && accel !== 'disabled' && accelMap[accel] && accelMap[accel].length > 1) {
                    row.setWarning(true, 'Shortcut conflicts with another active shortcut');
                } else {
                    row.setWarning(false);
                }
            }
        };

        const createRow = (st, id, label, origin = '') => {
            const row = new ShortcutRow(st, id, label, origin);
            row.setOnChange(updateConflicts);
            allRows.push(row);
            return row;
        };

        // --- Focus & Position Group ---
        const focusPositionGroup = new Adw.PreferencesGroup({ title: 'Window Focus & Position' });
        
        const focusModeRow = new Adw.ComboRow({ 
            title: 'Focus Mode', 
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
        focusPositionGroup.add(focusModeRow);

        const focusRows = [
            { id: 'custom-focus-window-left', label: '  ↳ Focus Window Left' },
            { id: 'custom-focus-window-right', label: '  ↳ Focus Window Right' },
            { id: 'custom-focus-window-up', label: '  ↳ Focus Window Up' },
            { id: 'custom-focus-window-down', label: '  ↳ Focus Window Down' }
        ].map(s => {
            const row = createRow(settings, s.id, s.label);
            focusPositionGroup.add(row);
            return row;
        });

        const updateFocusVisibility = () => {
            const mode = settings.get_string('focus-window-mode');
            focusModeRow.subtitle = mode === 'default' ? 'Default: <Ctrl> + <Shift> + <Vim (h,j,k,l)>' : '';
            const showCustom = mode === 'custom';
            focusRows.forEach(r => r.visible = showCustom);
        };
        settings.connect('changed::focus-window-mode', () => { updateFocusVisibility(); updateConflicts(); });
        updateFocusVisibility();

        const modeRow = new Adw.ComboRow({ 
            title: 'Swap Mode', 
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
        focusPositionGroup.add(modeRow);

        const moveRows = [
            { id: 'custom-move-window-left', label: '  ↳ Swap Window Left' },
            { id: 'custom-move-window-right', label: '  ↳ Swap Window Right' },
            { id: 'custom-move-window-up', label: '  ↳ Swap Window Up' },
            { id: 'custom-move-window-down', label: '  ↳ Swap Window Down' }
        ].map(s => {
            const row = createRow(settings, s.id, s.label);
            focusPositionGroup.add(row);
            return row;
        });

        const updateVisibility = () => {
            const mode = settings.get_string('keybindings-mode');
            modeRow.subtitle = mode === 'default' ? 'Default: <Super> + <Arrow_Keys>' : '';
            const showCustom = mode === 'custom';
            moveRows.forEach(r => r.visible = showCustom);
        };
        settings.connect('changed::keybindings-mode', () => { updateVisibility(); updateConflicts(); });
        updateVisibility();

        shortcutsPage.add(new Adw.PreferencesGroup());
        shortcutsPage.add(focusPositionGroup);

        // --- Window State ---
        const stateGroup = new Adw.PreferencesGroup({ title: 'Window State' });
        [
            { id: 'close', label: 'Close Window', origin: 'System', st: wmSettings },
            { id: 'minimize', label: 'Minimize Window', origin: 'System', st: wmSettings },
            { id: 'maximize', label: 'Un-/ Maximise Window', origin: '', st: wmSettings },
            { id: 'toggle-fullscreen', label: 'Toggle Fullscreen', origin: '', st: wmSettings }
        ].forEach(s => stateGroup.add(createRow(s.st, s.id, s.label, s.origin)));
        shortcutsPage.add(stateGroup);

        // --- Workspace Operations ---
        const wsOpsGroup = new Adw.PreferencesGroup({ title: 'Workspace Operations' });
        wsOpsGroup.add(createRow(settings, 'shortcut-close-workspace', 'Close Workspace Windows'));
        wsOpsGroup.add(createRow(settings, 'shortcut-unminimize-workspace', 'Unminimize Workspace'));
        shortcutsPage.add(wsOpsGroup);

        // --- Workspace Switching ---
        const wsSwitchGroup = new Adw.PreferencesGroup({ title: 'Workspace Switching' });
        wsSwitchGroup.add(createRow(wmSettings, 'switch-to-workspace-left', 'Switch to Workspace Left', 'System'));
        wsSwitchGroup.add(createRow(wmSettings, 'switch-to-workspace-right', 'Switch to Workspace Right', 'System'));
        
        const wsSwitchModeRow = new Adw.ComboRow({ 
            title: 'Numbered Workspaces', 
            subtitle: '',
            model: Gtk.StringList.new(['System Default', 'Edit', 'Disabled']) 
        });
        const wsSwitchModeStr = settings.get_string('workspace-switch-mode');
        wsSwitchModeRow.selected = wsSwitchModeStr === 'custom' ? 1 : (wsSwitchModeStr === 'disabled' ? 2 : 0);
        
        const wsSwitchKeys = [];
        for (let i = 1; i <= 4; i++) wsSwitchKeys.push(`switch-to-workspace-${i}`);

        wsSwitchModeRow.connect('notify::selected', () => {
            let mode = 'default';
            if (wsSwitchModeRow.selected === 1) mode = 'custom';
            if (wsSwitchModeRow.selected === 2) mode = 'disabled';
            settings.set_string('workspace-switch-mode', mode);

            if (mode === 'default') {
                wsSwitchKeys.forEach(k => wmSettings.reset(k));
            } else if (mode === 'disabled') {
                wsSwitchKeys.forEach(k => wmSettings.set_strv(k, ['disabled']));
            }
        });
        wsSwitchGroup.add(wsSwitchModeRow);

        const wsSwitchRows = [];
        for (let i = 1; i <= 4; i++) {
            wsSwitchRows.push(createRow(wmSettings, `switch-to-workspace-${i}`, `  ↳ Switch to Workspace ${i}`, 'System'));
        }
        wsSwitchRows.forEach(r => wsSwitchGroup.add(r));
        shortcutsPage.add(wsSwitchGroup);

        const updateWsSwitchVisibility = () => {
            const mode = settings.get_string('workspace-switch-mode');
            wsSwitchModeRow.subtitle = mode === 'default' ? 'System default keybindings' : '';
            const showCustom = mode === 'custom';
            wsSwitchRows.forEach(r => r.visible = showCustom);
            updateConflicts();
        };
        settings.connect('changed::workspace-switch-mode', updateWsSwitchVisibility);
        updateWsSwitchVisibility();

        // --- Moving to Workspace ---
        const wsMoveGroup = new Adw.PreferencesGroup({ title: 'Moving to Workspace' });
        wsMoveGroup.add(createRow(wmSettings, 'move-to-workspace-left', 'Move Window to Workspace Left', 'System'));
        wsMoveGroup.add(createRow(wmSettings, 'move-to-workspace-right', 'Move Window to Workspace Right', 'System'));

        const wsMoveModeRow = new Adw.ComboRow({ 
            title: 'Numbered Workspaces', 
            subtitle: '',
            model: Gtk.StringList.new(['System Default', 'Edit', 'Disabled']) 
        });
        const wsMoveModeStr = settings.get_string('workspace-move-mode');
        wsMoveModeRow.selected = wsMoveModeStr === 'custom' ? 1 : (wsMoveModeStr === 'disabled' ? 2 : 0);

        const wsMoveKeys = [];
        for (let i = 1; i <= 4; i++) wsMoveKeys.push(`move-to-workspace-${i}`);

        wsMoveModeRow.connect('notify::selected', () => {
            let mode = 'default';
            if (wsMoveModeRow.selected === 1) mode = 'custom';
            if (wsMoveModeRow.selected === 2) mode = 'disabled';
            settings.set_string('workspace-move-mode', mode);

            if (mode === 'default') {
                wsMoveKeys.forEach(k => wmSettings.reset(k));
            } else if (mode === 'disabled') {
                wsMoveKeys.forEach(k => wmSettings.set_strv(k, ['disabled']));
            }
        });
        wsMoveGroup.add(wsMoveModeRow);

        const wsMoveRows = [];
        for (let i = 1; i <= 4; i++) {
            wsMoveRows.push(createRow(wmSettings, `move-to-workspace-${i}`, `  ↳ Move Window to Workspace ${i}`, 'System'));
        }
        wsMoveRows.forEach(r => wsMoveGroup.add(r));
        shortcutsPage.add(wsMoveGroup);

        const updateWsMoveVisibility = () => {
            const mode = settings.get_string('workspace-move-mode');
            wsMoveModeRow.subtitle = mode === 'default' ? 'System default keybindings' : '';
            const showCustom = mode === 'custom';
            wsMoveRows.forEach(r => r.visible = showCustom);
            updateConflicts();
        };
        settings.connect('changed::workspace-move-mode', updateWsMoveVisibility);
        updateWsMoveVisibility();

        // --- Monitor Actions ---
        const monitorGroup = new Adw.PreferencesGroup({ title: 'Monitor Actions' });
        const closeMonitorRow = createRow(settings, 'shortcut-close-monitor', 'Close Monitor Windows');
        monitorGroup.add(closeMonitorRow);

        const closeMinRow = new Adw.SwitchRow({ title: '  ↳ Include Minimized', subtitle: '      Also close minimized windows on monitor' });
        settings.bind('close-monitor-include-minimized', closeMinRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        const updateCloseMinRowVisibility = () => {
            const strv = settings.get_strv('shortcut-close-monitor');
            closeMinRow.visible = strv.length > 0 && strv[0] !== '';
        };
        settings.connect('changed::shortcut-close-monitor', updateCloseMinRowVisibility);
        updateCloseMinRowVisibility();
        monitorGroup.add(closeMinRow);

        [
            { id: 'shortcut-switch-monitor', label: 'Switch Monitors', origin: '', st: settings },
            { id: 'shortcut-port-monitor-left', label: 'Port Monitor to Left Workspace', origin: '', st: settings },
            { id: 'shortcut-port-monitor-right', label: 'Port Monitor to Right Workspace', origin: '', st: settings }
        ].forEach(s => monitorGroup.add(createRow(s.st, s.id, s.label, s.origin)));

        shortcutsPage.add(monitorGroup);
        
        // Initial conflicts check
        updateConflicts();

        window.add(page);
        window.add(shortcutsPage);

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
