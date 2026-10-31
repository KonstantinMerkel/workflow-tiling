import { describe, it, expect, vi, beforeEach } from 'vitest';
import Gtk from 'gi://Gtk';
import { Logger } from '../../lib/utils/logger.js';
import { resetFakes, fakeWindow, mockSettingsStore, mockSettings, mockAdw } from '../helpers/prefs-fakes.js';
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

    describe('ShortcutRow & Key Recording', () => {
        let shortcutsPage;
        let swapGroup;
        let testRow;

        beforeEach(() => {
            prefs.fillPreferencesWindow(mockWindow);
            shortcutsPage = addedPages.find(p => p.title === 'Keyboard Shortcuts');
            swapGroup = shortcutsPage.groups.find(g => g.title === 'Window Focus &amp; Position');
            testRow = swapGroup.rows.flatMap((r) => r.rows).find((r) => r.keyName === 'custom-move-window-left');
        });

        it('should initialize ShortcutRow with accelerator from settings', () => {
            mockSettingsStore['custom-move-window-left'] = ['<Super>Left'];
            const row = new testRow.constructor(mockSettings, 'custom-move-window-left', 'Test Title');
            expect(row._getAccelerator()).toBe('<Super>Left');
        });

        it('should handle empty accelerator settings', () => {
            mockSettingsStore['custom-move-window-left'] = [];
            const row = new testRow.constructor(mockSettings, 'custom-move-window-left', 'Test Title');
            expect(row._getAccelerator()).toBe('');
        });

        it('should present shortcut dialog and handle key presses', () => {
            testRow.emit('activated');

            const dialog = mockAdw.lastAlertDialog;
            expect(dialog).toBeDefined();
            expect(dialog.presented).toBe(true);
            expect(dialog.window).toBeDefined();

            expect(dialog.controllers).toHaveLength(1);
            const controller = dialog.controllers[0];
            expect(controller.signal).toBe('key-pressed');

            // Test modifier key press: Shift_L (0xffe1), modifiers = 0
            const propagateResult = controller.callback(controller, 0xffe1, 0, 0);
            expect(propagateResult).toBe(false); // Gdk.EVENT_PROPAGATE is false
            expect(mockSettingsStore['custom-move-window-left']).toEqual([]);

            // Test valid accelerator press: e.g. keyval = 65 ('a'), modifiers = 4 (Control)
            const stopResult = controller.callback(controller, 65, 0, 4);
            expect(stopResult).toBe(true); // Gdk.EVENT_STOP is true
            expect(mockSettingsStore['custom-move-window-left']).toEqual(['mock-accel']);
            expect(dialog.closed).toBe(true);
        });

        it('should ignore keys without Ctrl, Alt or Super', () => {
            mockSettingsStore['custom-move-window-left'] = ['<Super>h'];
            testRow.emit('activated');
            const dialog = mockAdw.lastAlertDialog;
            const controller = dialog.controllers[0];

            expect(controller.callback(controller, 113, 0, 0)).toBe(false); // plain q
            expect(controller.callback(controller, 113, 0, 1)).toBe(false); // Shift+q
            expect(mockSettingsStore['custom-move-window-left']).toEqual(['<Super>h']);
            expect(dialog.closed).toBeUndefined();
        });

        it('should ignore accelerators GTK rejects', () => {
            mockSettingsStore['custom-move-window-left'] = ['<Super>h'];
            testRow.emit('activated');
            const dialog = mockAdw.lastAlertDialog;
            const controller = dialog.controllers[0];
            vi.spyOn(Gtk, 'accelerator_valid').mockReturnValueOnce(false);

            expect(controller.callback(controller, 0xff09, 0, 4)).toBe(false); // e.g. Ctrl+Tab
            expect(mockSettingsStore['custom-move-window-left']).toEqual(['<Super>h']);
            expect(dialog.closed).toBeUndefined();
        });

        it('should clear shortcut when Backspace is pressed without modifiers', () => {
            mockSettingsStore['custom-move-window-left'] = ['some-shortcut'];
            testRow.emit('activated');

            const dialog = mockAdw.lastAlertDialog;
            const controller = dialog.controllers[0];

            // Backspace keyval = 8, modifiers = 0
            const result = controller.callback(controller, 8, 0, 0);
            expect(result).toBe(true); // Gdk.EVENT_STOP
            expect(mockSettingsStore['custom-move-window-left']).toEqual([]);
            expect(dialog.closed).toBe(true);
        });

        it('should propagate key event when accelerator is falsy', () => {
            testRow.emit('activated');

            const dialog = mockAdw.lastAlertDialog;
            const controller = dialog.controllers[0];

            // Spy on Gtk.accelerator_name to return empty string
            vi.spyOn(Gtk, 'accelerator_name').mockReturnValueOnce('');

            // Key press with keyval = 65, modifiers = 4
            const result = controller.callback(controller, 65, 0, 4);
            expect(result).toBe(false); // Gdk.EVENT_PROPAGATE is false
            expect(dialog.closed).toBeUndefined(); // Should not close
        });

        it('should handle a missing surface without throwing', () => {
            vi.spyOn(testRow, 'get_root').mockReturnValue({
                get_surface() { return null; }
            });

            expect(() => testRow.emit('activated')).not.toThrow();
            expect(mockAdw.lastAlertDialog.presented).toBe(true);
        });

        it('should handle surface inhibit/restore throwing errors without crashing', () => {
            const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
            vi.spyOn(testRow, 'get_root').mockReturnValue({
                get_surface() {
                    return {
                        inhibit_system_shortcuts() { throw new Error('Inhibit failed'); },
                        restore_system_shortcuts() { throw new Error('Restore failed'); }
                    };
                }
            });

            expect(() => testRow.emit('activated')).not.toThrow();
            const dialog = mockAdw.lastAlertDialog;
            
            // Trigger cleanup by emitting response on dialog
            expect(() => dialog.connect).toBeDefined();
            
            // Re-simulate a response event trigger
            dialog.emit('response');
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('Inhibit failed'));
        });
    });
});
