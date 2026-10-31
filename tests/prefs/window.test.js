import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetFakes, fakeWindow, mockSettingsStore, mockListeners, mockAdw, gnomeListeners } from '../helpers/prefs-fakes.js';
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

describe('Preferences window', () => {
    let prefs;
    let mockWindow;
    let addedPages;

    beforeEach(() => {
        resetFakes();
        prefs = new WorkflowTilingPreferences();
        ({ window: mockWindow, pages: addedPages } = fakeWindow());
    });

    it('should create and add expected pages to preferences window', () => {
        prefs.fillPreferencesWindow(mockWindow);

        expect(mockWindow.add).toHaveBeenCalled();
        const titles = addedPages.map(p => p.title);
        expect(titles).toContain('General');
        expect(titles).toContain('Keyboard Shortcuts');
        expect(titles).not.toContain('Monitors');
        expect(titles).toContain('Maximizing');
        expect(titles).toContain('Layouts');
    });

    it('disconnects every settings listener when the window closes', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const listeners = () => Object.values(mockListeners).flat().length;
        expect(listeners()).toBeGreaterThan(0);
        expect(mockWindow.connect).toHaveBeenCalledWith('close-request', expect.any(Function));

        mockWindow.close();

        expect(listeners()).toBe(0);
        expect(gnomeListeners.size).toBe(0);
    });

    it('should store the monitor change policy chosen on the General page', () => {
        mockSettingsStore['hotplug-policy'] = 'follow-primary';
        prefs.fillPreferencesWindow(mockWindow);
        const generalPage = addedPages.find(p => p.title === 'General');
        const monitorGroup = generalPage.groups.find(g => g.title === 'Monitor Change Policy');
        expect(monitorGroup.description).toContain('laptop + dock');
        const policyRow = monitorGroup.rows.find(r => r instanceof mockAdw.ComboRow);
        expect(policyRow.selected).toBe(1);
        expect(policyRow.subtitle).toContain('move to the new primary');

        policyRow.selected = 0;
        policyRow.emit('notify::selected');
        expect(mockSettingsStore['hotplug-policy']).toBe('restore-by-monitor');
        expect(policyRow.subtitle).toContain('return to their monitor');
    });

    it('should place Gaps, Monitor Change Policy and Debug groups in General page', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const generalPage = addedPages.find(p => p.title === 'General');

        expect(generalPage).toBeDefined();
        expect(generalPage.groups.map(g => g.title)).toEqual(['Gaps', 'Monitor Change Policy', 'Debug']);

        const debugGroup = generalPage.groups[2];
        const debugSwitch = debugGroup.rows.find(r => r.title === 'Debug Logging');
        expect(debugSwitch).toBeDefined();
        expect(debugSwitch.active).toBe(false);
    });

    it('should toggle JSON Layout Editor page dynamically when active notify fires', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const layoutsPage = addedPages.find(p => p.title === 'Layouts');
        const advancedGroup = layoutsPage.groups[0];
        const jsonToggle = advancedGroup.rows.find(r => r.title === 'Edit Base JSON Instead');

        expect(jsonToggle).toBeDefined();
        expect(addedPages.some(p => p.title === 'Base JSON')).toBe(false);

        // Activate toggle and emit notify
        jsonToggle.active = true;
        jsonToggle.emit('notify::active');

        expect(addedPages.some(p => p.title === 'Base JSON')).toBe(true);

        // Deactivate toggle and emit notify
        jsonToggle.active = false;
        jsonToggle.emit('notify::active');

        expect(addedPages.some(p => p.title === 'Base JSON')).toBe(false);
    });

    describe('Visibility Stress Tests', () => {
        beforeEach(() => {
            prefs.fillPreferencesWindow(mockWindow);
        });

        it('should toggle gaps visibility when enable-gaps setting is changed', () => {
            const generalPage = addedPages.find(p => p.title === 'General');
            const gapsGroup = generalPage.groups[0];
            const innerGapsRow = gapsGroup.rows.find(r => r.title.includes('Inner Gaps'));
            const outerGapsRow = gapsGroup.rows.find(r => r.title.includes('Outer Gaps'));

            expect(innerGapsRow.visible).toBe(true);
            expect(outerGapsRow.visible).toBe(true);

            // Disable gaps using setter on bound property
            const enableGapsRow = gapsGroup.rows.find(r => r.title === 'Enable Gaps');
            enableGapsRow.active = false;

            expect(innerGapsRow.visible).toBe(false);
            expect(outerGapsRow.visible).toBe(false);
        });

        it('should handle rapid toggling of JSON editor page', () => {
            const layoutsPage = addedPages.find(p => p.title === 'Layouts');
            const advancedGroup = layoutsPage.groups[0];
            const jsonToggle = advancedGroup.rows.find(r => r.title === 'Edit Base JSON Instead');

            for (let i = 0; i < 100; i++) {
                jsonToggle.active = !jsonToggle.active;
                jsonToggle.emit('notify::active');
            }

            // Since it was toggled 100 times starting from false, it ends at false (removed)
            expect(addedPages.some(p => p.title === 'Base JSON')).toBe(false);
        });
    });
});
