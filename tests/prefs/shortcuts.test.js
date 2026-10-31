import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetFakes, fakeWindow, mockSettingsStore, mockSettings, gnomeKeys, gnomeListeners } from '../helpers/prefs-fakes.js';
import WorkflowTilingPreferences from '../../prefs.js';

vi.mock('gi://Gio', () => import('../helpers/prefs-fakes.js').then((f) => f.gioModule));
vi.mock('gi://Adw', () => import('../helpers/prefs-fakes.js').then((f) => f.adwModule));
vi.mock('gi://Gtk', () => import('../helpers/prefs-fakes.js').then((f) => f.gtkModule));
vi.mock('gi://Gdk', () => import('../helpers/prefs-fakes.js').then((f) => f.gdkModule));
vi.mock('gi://GObject', () => import('../helpers/prefs-fakes.js').then((f) => f.gobjectModule));
vi.mock('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js', () =>
    import('../helpers/prefs-fakes.js').then((f) => f.extensionPrefsModule),
);
vi.mock('../../prefs/preview.js', () => import('../helpers/prefs-fakes.js').then((f) => f.previewModule));
vi.mock('../../prefs/editor.js', () => import('../helpers/prefs-fakes.js').then((f) => f.editorModule));

describe('Preferences', () => {
    let prefs;
    let mockWindow;
    let addedPages;

    beforeEach(() => {
        resetFakes();
        prefs = new WorkflowTilingPreferences();
        ({ window: mockWindow, pages: addedPages } = fakeWindow());
    });

    it('should place correct shortcut groups in Keyboard Shortcuts page', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const shortcutsPage = addedPages.find(p => p.title === 'Keyboard Shortcuts');

        expect(shortcutsPage).toBeDefined();
        expect(shortcutsPage.groups).toHaveLength(5);
        expect(shortcutsPage.groups[1].title).toBe('Window Focus &amp; Position');
        expect(shortcutsPage.groups[2].title).toBe('Window State');
        expect(shortcutsPage.groups[3].title).toBe('Workspace Operations');
        expect(shortcutsPage.groups[4].title).toBe('Monitor Actions');
        expect(shortcutsPage.groups.map(g => g.title)).not.toContain('Moving to Workspace');

        const monitorGroup = shortcutsPage.groups[4];
        const monitorKeys = monitorGroup.rows.map(r => r.keyName).filter(Boolean);
        expect(monitorKeys).toContain('shortcut-close-monitor');
        expect(monitorKeys).toContain('shortcut-switch-monitor');
    });

    describe('Keyboard Shortcuts page', () => {
        let page;
        const rowOf = (key) =>
            page.groups.flatMap((g) => g.rows).flatMap((r) => [r, ...(r.rows ?? [])]).find((r) => r.keyName === key);
        const hint = () => page.groups[0].rows[0];
        const modeRow = (title) => page.groups[1].rows.find((r) => r.title === title);
        const choose = (title, index) => {
            modeRow(title).dropDown.selected = index;
            modeRow(title).dropDown.emit('notify::selected');
        };
        const custom = () => {
            mockSettingsStore['focus-window-mode'] = 'custom';
            mockSettingsStore['keybindings-mode'] = 'custom';
        };
        const open = () => {
            prefs.fillPreferencesWindow(mockWindow);
            page = addedPages.find((p) => p.title === 'Keyboard Shortcuts');
        };

        it('shows one row per mode that picks it and folds out the keys it binds', () => {
            open();
            const dirs = ['left', 'right', 'up', 'down'];
            expect(page.groups[1].rows.map((r) => r.title)).toEqual(['Focus Mode', 'Swap Mode']);
            expect(modeRow('Swap Mode').rows.map((r) => r.keyName)).toEqual([
                ...dirs.map((d) => `move-window-${d}`),
                ...dirs.map((d) => `custom-move-window-${d}`),
            ]);
            expect(modeRow('Swap Mode').dropDown.selected).toBe(0);
            expect(modeRow('Swap Mode').enable_expansion).toBe(false); // None has no keys
            expect(rowOf('move-window-left').visible).toBe(false);
            expect(rowOf('custom-move-window-left').visible).toBe(false);

            choose('Swap Mode', 5);
            expect(mockSettingsStore['keybindings-mode']).toBe('custom');
            expect(modeRow('Swap Mode').expanded).toBe(true); // own keys, open to edit
            expect(rowOf('custom-move-window-left').visible).toBe(true);
            expect(rowOf('move-window-left').visible).toBe(false);
            expect(rowOf('custom-focus-window-left').visible).toBe(false);
        });

        it('offers every preset in both modes, folded, without losing own keys', () => {
            mockSettingsStore['custom-move-window-up'] = ['<Super>k'];
            open();
            const all = [
                'None',
                'Ctrl + Shift + H/J/K/L',
                'Ctrl + Super + H/J/K/L',
                'Super + Arrows',
                'Super + Shift + Arrows',
                'Custom',
            ];
            expect(modeRow('Focus Mode').dropDown.model.strings).toEqual(all);
            expect(modeRow('Swap Mode').dropDown.model.strings).toEqual(all);

            choose('Swap Mode', 3);
            expect(rowOf('move-window-up').shortcutLabel.accelerator).toBe('<Super>Up');
            expect(rowOf('move-window-up').accelerators()).toEqual(['<Super>up']);
            expect(mockSettingsStore['move-window-up'] ?? []).toEqual([]); // written by the Shell, not here
            expect(modeRow('Swap Mode').enable_expansion).toBe(true);
            expect(modeRow('Swap Mode').expanded).toBe(false); // folded until opened
            expect(rowOf('move-window-up').visible).toBe(true);
            expect(rowOf('move-window-up').activatable).toBe(false); // fixed keys
            expect(rowOf('custom-move-window-up').visible).toBe(false);
            expect(hint().visible).toBe(false);

            choose('Swap Mode', 5);
            expect(mockSettingsStore['custom-move-window-up']).toEqual(['<Super>k']);
        });

        it('writes a mode only when the selection changes it', () => {
            mockSettingsStore['keybindings-mode'] = 'super-arrows';
            open();
            const write = vi.spyOn(mockSettings, 'set_string');
            modeRow('Swap Mode').dropDown.emit('notify::selected'); // e.g. GTK notifying the first selection
            expect(write).not.toHaveBeenCalled();
            choose('Swap Mode', 0);
            expect(write).toHaveBeenCalledWith('keybindings-mode', 'none');
            write.mockRestore();
        });

        it('keeps a mode folded or open while only its keys change', () => {
            mockSettingsStore['keybindings-mode'] = 'custom';
            open();
            modeRow('Swap Mode').expanded = false; // folded by the user
            mockSettings.set_strv('custom-move-window-up', ['<Super>k']);
            expect(modeRow('Swap Mode').expanded).toBe(false);
            mockSettings.set_string('keybindings-mode', 'super-arrows'); // set from outside
            expect(modeRow('Swap Mode').dropDown.selected).toBe(3);
        });

        it("shows a preset's keys even when the bound keys are stale", () => {
            mockSettingsStore['focus-window-mode'] = 'ctrl-shift-hjkl'; // e.g. gsettings set while the extension was off
            mockSettingsStore['focus-window-left'] = ['<Super>Left'];
            open();
            expect(rowOf('focus-window-left').shortcutLabel.accelerator).toBe('<Control><Shift>h');
            expect(mockSettingsStore['focus-window-left']).toEqual(['<Super>Left']);
            expect(rowOf('focus-window-left').visible).toBe(true);
        });

        it('shows the info box until a mode binds a key', () => {
            open();
            expect(hint().visible).toBe(true);
            expect(hint().children[0].prefix.icon_name).toBe('help-about-symbolic');
            expect(page.groups[0].description).toContain('Shortcuts inside apps are not checked');

            mockSettings.set_strv('custom-focus-window-up', ['<Super><Control>Up']);
            expect(hint().visible).toBe(true); // still None
            mockSettings.set_string('focus-window-mode', 'custom');
            expect(hint().visible).toBe(false);
            mockSettings.set_strv('custom-focus-window-up', []);
            expect(hint().visible).toBe(true);
        });

        it("warns on a mode's row when one of its keys is used elsewhere, folded or not", () => {
            gnomeKeys.set('maximize', ['<Super>Up']);
            mockSettingsStore['keybindings-mode'] = 'super-arrows';
            open();
            expect(rowOf('move-window-up').warningIcon.visible).toBe(true);
            expect(modeRow('Swap Mode').warningIcon.visible).toBe(true);
            expect(modeRow('Swap Mode').warningIcon.tooltip_text).toBe(
                'Swap Window Up – Also used by: Un-/ Maximise Window',
            );
            expect(modeRow('Focus Mode').warningIcon.visible).toBe(false);

            choose('Swap Mode', 0);
            expect(modeRow('Swap Mode').warningIcon.visible).toBe(false);
        });

        it('ignores shortcuts hidden by their mode', () => {
            mockSettingsStore['custom-move-window-left'] = ['<Super>x'];
            mockSettingsStore['custom-focus-window-left'] = ['<Super>x'];
            mockSettingsStore['focus-window-mode'] = 'custom';
            open();
            expect(rowOf('custom-focus-window-left').warningIcon.visible).toBe(false);
            mockSettings.set_string('keybindings-mode', 'custom');
            expect(rowOf('custom-focus-window-left').warningIcon.tooltip_text).toBe('Also used by: Swap Window Left');
        });

        it('warns about any key of a row used twice, in any spelling', () => {
            custom();
            open();
            mockSettings.set_strv('custom-move-window-left', ['<Primary><Shift>H']);
            mockSettings.set_strv('custom-focus-window-left', ['<Shift><Control>h']);
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(true);
            expect(rowOf('custom-move-window-right').warningIcon.visible).toBe(false);

            mockSettings.set_strv('custom-focus-window-left', ['<Super>x', '<Shift><Control>h']); // not shown, but bound
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(true);
            mockSettings.set_strv('custom-focus-window-left', ['<Super>x']);
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(false);
        });

        it('re-reads GNOME shortcuts when GNOME settings change, and stops when the window closes', () => {
            gnomeKeys.set('switch-to-workspace-left', ['<Super><Alt>Left']);
            mockSettingsStore['custom-move-window-left'] = ['<Alt><Super>Left'];
            custom();
            open();
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(true);

            gnomeKeys.set('switch-to-workspace-left', ['<Control><Alt>Left']); // freed in GNOME Settings
            [...gnomeListeners.values()].forEach((cb) => cb(null, 'switch-to-workspace-left'));
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(false);
            expect(gnomeListeners.size).toBe(1); // not rebuilt for an ordinary key

            mockWindow.close();
            expect(gnomeListeners.size).toBe(0);
        });

        it("checks every key of a GNOME row, not only the one it shows", () => {
            gnomeKeys.set('maximize', ['<Super>Up', '<Alt>F10']);
            mockSettingsStore['custom-move-window-up'] = ['<Alt>F10'];
            custom();
            open();
            expect(rowOf('custom-move-window-up').warningIcon.tooltip_text).toBe('Also used by: Un-/ Maximise Window');
            expect(rowOf('maximize').warningIcon.tooltip_text).toBe('Also used by: Swap Window Up');
        });

        it('names a GNOME key edited on this page only once', () => {
            gnomeKeys.set('maximize', ['<Super>Up']);
            mockSettingsStore['custom-move-window-up'] = ['<Super>Up'];
            custom();
            open();
            expect(rowOf('custom-move-window-up').warningIcon.tooltip_text).toBe('Also used by: Un-/ Maximise Window');
        });

        it("warns about keys GNOME already uses, but not about a GNOME row's own key", () => {
            gnomeKeys.set('switch-to-workspace-left', ['<Super><Alt>Left']);
            gnomeKeys.set('maximize', ['<Super>Up']);
            mockSettingsStore['custom-move-window-left'] = ['<Alt><Super>Left'];
            custom();
            open();
            expect(rowOf('custom-move-window-left').warningIcon.tooltip_text).toBe(
                'Also used by: GNOME switch-to-workspace-left (GNOME)',
            );
            expect(rowOf('maximize').warningIcon.visible).toBe(false);
        });
    });
});
