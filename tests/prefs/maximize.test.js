import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetFakes, fakeWindow, mockSettingsStore, mockSettings } from '../helpers/prefs-fakes.js';
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

    describe('Maximizing page', () => {
        let page;
        beforeEach(() => {
            prefs.fillPreferencesWindow(mockWindow);
            page = addedPages.find(p => p.title === 'Maximizing');
        });
        const group = (title) => page.groups.find(g => g.title === title);

        it('explains the shortcuts and what maximizing supports in an info box', () => {
            const box = page.groups[0].rows[0];
            expect(box.css_classes).toEqual(['boxed-list', 'workflow-tiling-info']);
            const row = box.children[0];
            expect(row.prefix.icon_name).toBe('help-about-symbolic');
            expect(row.title).toContain('shortcuts always work');
            expect(row.title).toContain('not maximizing to one half');
        });

        it('shows only the list of the active mode', () => {
            expect(group('Allowed Apps').visible).toBe(true);
            expect(group('Blocked Apps').visible).toBe(false);
            const modeRow = group('Apps Maximizing Themselves').rows[0];
            modeRow.selected = 2;
            modeRow.emit('notify::selected');
            expect(mockSettingsStore['self-maximize-mode']).toBe('all-except-listed');
            expect(group('Allowed Apps').visible).toBe(false);
            expect(group('Blocked Apps').visible).toBe(true);
            modeRow.selected = 0;
            modeRow.emit('notify::selected');
            expect(group('Blocked Apps').visible).toBe(false);
        });

        it('lists entries with installed app names and removes them', () => {
            const allowed = group('Allowed Apps');
            expect(allowed.rows.map(r => [r.title, r.subtitle])).toEqual([['Firefox', 'firefox']]);
            allowed.rows[0].suffixes[0].emit('clicked');
            expect(mockSettingsStore['self-maximize-allow-list']).toEqual([]);
            expect(allowed.rows).toEqual([]);
        });

        it('disconnects its settings listeners when the window closes', () => {
            const allowed = group('Allowed Apps');
            mockWindow.close();
            mockSettings.set_strv('self-maximize-allow-list', ['firefox', 'org.gnome.epiphany']);
            expect(allowed.rows).toHaveLength(1);
        });

        it('stores the focus policy', () => {
            const focusRow = group('When Another Window Comes Forward').rows[0];
            expect(focusRow.selected).toBe(1);
            focusRow.selected = 2;
            focusRow.emit('notify::selected');
            expect(mockSettingsStore['maximize-focus-policy']).toBe('pass-on');
            expect(focusRow.subtitle).toContain('maximized instead');
        });
    });
});
