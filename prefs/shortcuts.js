import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { Logger } from '../lib/utils/logger.js';
import {
    DIRECTIONAL_SHORTCUTS,
    SHORTCUT_PRESETS,
    ShortcutMode,
    boundKey,
    customKey,
} from '../lib/domain/shortcuts.js';
import { DIRECTIONS } from '../lib/domain/types.js';
import { findConflicts, hasDirectionalShortcuts, normalizeAccelerator } from '../lib/utils/shortcuts.js';
import { gnomeShortcutSettings, gnomeShortcuts } from '../lib/gio/gnome-shortcuts.js';
import { bindChoice, infoBox } from './rows.js';

const ShortcutRowMixin = {
    _recordShortcut() {
        const window = this.get_root();
        const dialog = new Adw.AlertDialog({
            heading: 'Set Shortcut',
            body: 'Press the new shortcut combination...\nPress Backspace to clear.',
        });
        dialog.add_response('cancel', 'Cancel');

        let surface = window?.get_surface() ?? null;
        if (surface) {
            try {
                surface.inhibit_system_shortcuts(null);
            } catch (e) {
                Logger.warn(`Prefs: failed to inhibit system shortcuts: ${e.message}`);
            }
        }

        const cleanup = () => {
            if (surface) {
                try {
                    surface.restore_system_shortcuts();
                } catch {
                    // Surface might already be destroyed or shortcuts already restored
                }
            }
            surface = null;
        };

        dialog.connect('response', cleanup);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_ctrl, keyval, _keycode, state) => {
            const modifiers = state & Gtk.accelerator_get_default_mod_mask();

            if (keyval === Gdk.KEY_BackSpace && modifiers === 0) {
                this.settings.set_strv(this.keyName, []);
                cleanup();
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // A global shortcut needs Ctrl, Alt or Super: plain or Shift-only keys would swallow typing
            const hasModifier = (modifiers & ~Gdk.ModifierType.SHIFT_MASK) !== 0;
            if (!hasModifier || !Gtk.accelerator_valid(keyval, modifiers)) return Gdk.EVENT_PROPAGATE;

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
    },
};

const ShortcutRow = GObject.registerClass(
    class PrefShortcutRow extends Adw.ActionRow {
        /** @param {() => string[]} [keys] the keys shown instead of the setting's, for display-only rows */
        _init(settings, keyName, title, origin = '', keys = null) {
            super._init({ title });
            this.settings = settings;
            this.keyName = keyName;
            this._keys = keys ?? (() => this.settings.get_strv(this.keyName));

            if (origin) {
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
                visible: false,
            });
            this.warningIcon.add_css_class('warning');
            this.add_suffix(this.warningIcon);

            this.shortcutLabel = new Gtk.ShortcutLabel({
                disabled_text: 'Not set',
                accelerator: this._getAccelerator(),
                valign: Gtk.Align.CENTER,
            });

            this.add_suffix(this.shortcutLabel);
            this.activatable = true;
            this.connect('activated', () => this._recordShortcut());
        }

        setWarning(isWarning, tooltip = '') {
            this.warningIcon.visible = isWarning;
            this.warningIcon.tooltip_text = tooltip;
        }

        _getAccelerator() {
            return this._keys()[0] ?? '';
        }

        /** Shows the keys again; the page calls it when they change */
        refresh() {
            this.shortcutLabel.accelerator = this._getAccelerator();
        }

        /** @returns {string} `schema/key`, the same id the conflict check uses for GNOME's keys */
        get id() {
            return `${this.settings.schema_id}/${this.keyName}`;
        }

        /**
         * @returns {string[]} every key of the row's setting, normalized; it shows only the first, but all are bound
         * (GNOME's Unmaximize is `<Super>Down` and `<Alt>F5`)
         */
        accelerators() {
            return this._keys().map(normalizeAccelerator).filter(Boolean);
        }
    },
);
Object.assign(ShortcutRow.prototype, ShortcutRowMixin);

const DIRECTION_LABELS = DIRECTIONS.map((dir) => ({ dir, label: dir[0].toUpperCase() + dir.slice(1) }));

/** Texts of each group of DIRECTIONAL_SHORTCUTS, by its action. */
const MODE_TEXTS = {
    focus: { title: 'Focus Mode', what: 'focusing windows', row: 'Focus Window' },
    move: { title: 'Swap Mode', what: 'swapping windows', row: 'Swap Window' },
};

const modeChoices = (what) => [
    { value: ShortcutMode.NONE, label: 'None', subtitle: `No shortcuts for ${what}` },
    ...Object.entries(SHORTCUT_PRESETS).map(([value, { label }]) => ({
        value,
        label,
        subtitle: 'Fixed keys, expand to see them',
    })),
    { value: ShortcutMode.CUSTOM, label: 'Custom', subtitle: 'Your own keys, click one to set it' },
];

/**
 * One row per mode: its drop-down picks the mode, and it folds out the keys the mode binds. Choosing Custom opens it
 * to edit the own keys, a preset keeps its fixed keys folded, None has none. A warning icon tells when one of the keys
 * is also used elsewhere, folded or not.
 * @returns {{row: Adw.ExpanderRow, update: Function, setWarning: Function}} `update` follows the mode setting
 */
function modeRow(settings, modeKey, title, choices) {
    const row = new Adw.ExpanderRow({ title });
    const warningIcon = new Gtk.Image({
        icon_name: 'dialog-warning-symbolic',
        valign: Gtk.Align.CENTER,
        visible: false,
    });
    warningIcon.add_css_class('warning');
    const dropDown = new Gtk.DropDown({
        model: Gtk.StringList.new(choices.map((c) => c.label)),
        valign: Gtk.Align.CENTER,
    });
    // An expander row packs suffixes from the end, so the icon lands left of the drop-down as on the key rows
    row.add_suffix(dropDown);
    row.add_suffix(warningIcon);
    Object.assign(row, { warningIcon, dropDown }); // for the tests

    const indexOf = bindChoice(settings, modeKey, dropDown, choices);
    let shownMode = null;
    const update = () => {
        const mode = settings.get_string(modeKey);
        if (mode === shownMode) return;
        shownMode = mode;
        if (dropDown.selected !== indexOf(mode)) dropDown.selected = indexOf(mode);
        row.subtitle = choices[indexOf(mode)].subtitle;
        row.enable_expansion = mode === ShortcutMode.CUSTOM || mode in SHORTCUT_PRESETS;
        row.expanded = mode === ShortcutMode.CUSTOM;
    };
    const setWarning = (isWarning, tooltip = '') => {
        warningIcon.visible = isWarning;
        warningIcon.tooltip_text = tooltip;
    };
    return { row, update, setWarning };
}

/** Preferences page for the tiling shortcuts and the window-state shortcuts they share with GNOME. */
export function buildShortcutsPage(settings, connections) {
    const shortcutsPage = new Adw.PreferencesPage({
        title: 'Keyboard Shortcuts',
        icon_name: 'input-keyboard-symbolic',
    });
    const listen = connections.listener(settings);

    const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });
    const allRows = [];
    const modeRows = []; // { mode, rows } per mode

    const hint = infoBox('Moving and focusing windows has no shortcuts yet. Choose a mode below.');

    // GNOME's shortcuts, read once and again whenever GNOME's settings change while the page is open
    let gnome = null;
    let watched = [];
    const watchGnome = () => {
        watched.forEach(({ st, id }) => connections.disconnect(st, id));
        watched = gnomeShortcutSettings().map((st) => ({
            st,
            id: connections.connect(st, 'changed', (_settings, key) => {
                gnome = null;
                if (key === 'custom-keybindings') watchGnome(); // custom shortcuts added or removed
                updateConflicts();
            }),
        }));
    };

    // A key is in conflict when anything else, ours or GNOME's, uses it; shortcuts inside apps are not known here
    const updateConflicts = () => {
        gnome ??= gnomeShortcuts(watched.map(({ st }) => st));
        const rowIds = new Set(allRows.map((row) => row.id));
        // A row editing one of GNOME's keys stands for it with all its entries, so the key is named once
        const entries = gnome.filter((e) => !rowIds.has(e.id));
        // Rows hidden by their mode are not bound, so they conflict with nothing
        const active = allRows.filter((row) => row.visible !== false);
        for (const row of active) {
            for (const accel of row.accelerators()) entries.push({ accel, id: row.id, label: row.title });
        }
        const conflicts = findConflicts(entries, active.map((row) => row.id));
        for (const row of allRows) {
            const others = conflicts.get(row.id) ?? [];
            row.setWarning(others.length > 0, `Also used by: ${others.join(', ')}`);
        }
        // A folded mode hides its rows' warnings, so the mode's own row repeats them
        for (const { mode, rows } of modeRows) {
            const warned = rows.filter((row) => row.visible !== false && row.warningIcon.visible);
            mode.setWarning(
                warned.length > 0,
                warned.map((row) => `${row.title} – ${row.warningIcon.tooltip_text}`).join('\n'),
            );
        }
        hint.visible = !hasDirectionalShortcuts(settings);
    };

    const createRow = (st, id, label, origin = '', keys = null) => {
        const row = new ShortcutRow(st, id, label, origin, keys);
        // Rows showing other keys than their setting's are refreshed with their mode instead
        if (!keys) {
            connections.connect(st, `changed::${id}`, () => {
                row.refresh();
                updateConflicts();
            });
        }
        allRows.push(row);
        return row;
    };

    const infoGroup = new Adw.PreferencesGroup({
        description:
            'Click a shortcut to set it; Backspace in the dialog clears it. A warning marks a key that GNOME or ' +
            'another shortcut here already uses. Shortcuts inside apps are not checked.',
    });
    infoGroup.add(hint);
    shortcutsPage.add(infoGroup);

    // --- Focus & Position Group: one row per mode, folding out the keys it binds ---
    const focusPositionGroup = new Adw.PreferencesGroup({ title: 'Window Focus &amp; Position' });
    for (const group of DIRECTIONAL_SHORTCUTS) {
        const texts = MODE_TEXTS[group.action];
        const mode = modeRow(settings, group.modeKey, texts.title, modeChoices(texts.what));
        focusPositionGroup.add(mode.row);
        // A preset's rows show its fixed keys; the Shell writes them into the bound keys
        const presetKeys = (dir) => () => [SHORTCUT_PRESETS[settings.get_string(group.modeKey)]?.keys[dir] ?? ''];
        const rowsFor = (keyOf, keys = () => null) =>
            DIRECTION_LABELS.map(({ dir, label }) => {
                const row = createRow(settings, keyOf(group, dir), `${texts.row} ${label}`, '', keys(dir));
                mode.row.add_row(row);
                return row;
            });
        const presetRows = rowsFor(boundKey, presetKeys);
        const ownRows = rowsFor(customKey);
        presetRows.forEach((row) => (row.activatable = false));
        modeRows.push({ mode, rows: [...presetRows, ...ownRows] });
        // Rows the mode does not bind are hidden; the conflict check counts only visible rows
        const update = () => {
            const current = settings.get_string(group.modeKey);
            mode.update();
            presetRows.forEach((row) => {
                row.visible = current in SHORTCUT_PRESETS;
                row.refresh();
            });
            ownRows.forEach((row) => (row.visible = current === ShortcutMode.CUSTOM));
        };
        // Own keys report their changes through their rows
        listen(`changed::${group.modeKey}`, () => {
            update();
            updateConflicts();
        });
        update();
    }
    shortcutsPage.add(focusPositionGroup);

    // --- Window State ---
    const stateGroup = new Adw.PreferencesGroup({ title: 'Window State' });
    [
        { id: 'close', label: 'Close Window' },
        { id: 'minimize', label: 'Minimize Window' },
        { id: 'maximize', label: 'Un-/ Maximise Window' },
        { id: 'toggle-fullscreen', label: 'Toggle Fullscreen' },
    ].forEach((s) => stateGroup.add(createRow(wmSettings, s.id, s.label, 'System Synced'))); // GNOME's own keys
    shortcutsPage.add(stateGroup);

    // --- Workspace Operations ---
    const wsOpsGroup = new Adw.PreferencesGroup({ title: 'Workspace Operations' });
    wsOpsGroup.add(createRow(settings, 'shortcut-close-workspace', 'Close Workspace Windows'));
    wsOpsGroup.add(createRow(settings, 'shortcut-unminimize-workspace', 'Unminimize Workspace'));
    shortcutsPage.add(wsOpsGroup);

    // --- Monitor Actions ---
    const monitorGroup = new Adw.PreferencesGroup({ title: 'Monitor Actions' });
    const closeMonitorRow = createRow(settings, 'shortcut-close-monitor', 'Close Monitor Windows');
    monitorGroup.add(closeMonitorRow);

    const closeMinRow = new Adw.SwitchRow({
        title: '  ↳ Include Minimized',
        subtitle: '      Also close minimized windows on monitor',
    });
    settings.bind('close-monitor-include-minimized', closeMinRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    const updateCloseMinRowVisibility = () => {
        const strv = settings.get_strv('shortcut-close-monitor');
        closeMinRow.visible = strv.length > 0 && strv[0] !== '';
    };
    listen('changed::shortcut-close-monitor', updateCloseMinRowVisibility);
    updateCloseMinRowVisibility();
    monitorGroup.add(closeMinRow);

    monitorGroup.add(createRow(settings, 'shortcut-switch-monitor', 'Switch Monitors'));

    shortcutsPage.add(monitorGroup);

    // Initial conflicts check
    watchGnome();
    updateConflicts();

    return shortcutsPage;
}
