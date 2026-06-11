import { describe, it, expect, vi, beforeEach } from 'vitest';
import Gtk from 'gi://Gtk';

const { mockSettingsStore, mockListeners, mockSettings, BaseMockWidget, mockAdw } = vi.hoisted(() => {
    const mockSettingsStore = {
        'enable-gaps': true,
        'inner-gaps': 6,
        'outer-gaps': 4,
        'keybindings-mode': 'default',
        'focus-window-mode': 'default',
        'shortcut-close-monitor': [],
        'close-monitor-include-minimized': false,
        'shortcut-close-workspace': [],
        'shortcut-switch-monitor': [],
        'shortcut-port-monitor-left': [],
        'shortcut-port-monitor-right': [],
        'shortcut-unminimize-workspace': [],
        'custom-layouts': '{}'
    };

    const mockListeners = {};

    const mockSettings = {
        get_boolean: (key) => mockSettingsStore[key] ?? false,
        get_string: (key) => mockSettingsStore[key] ?? '',
        set_string: (key, val) => {
            mockSettingsStore[key] = val;
            if (mockListeners[`changed::${key}`]) {
                mockListeners[`changed::${key}`].forEach(cb => cb());
            }
        },
        get_strv: (key) => mockSettingsStore[key] || [],
        set_strv: (key, val) => {
            mockSettingsStore[key] = val;
            if (mockListeners[`changed::${key}`]) {
                mockListeners[`changed::${key}`].forEach(cb => cb());
            }
        },
        bind: (key, object, property, flags) => {
            Object.defineProperty(object, property, {
                get: () => mockSettingsStore[key],
                set: (val) => {
                    mockSettingsStore[key] = val;
                    if (mockListeners[`changed::${key}`]) {
                        mockListeners[`changed::${key}`].forEach(cb => cb());
                    }
                },
                configurable: true
            });
        },
        connect: (signal, callback) => {
            if (!mockListeners[signal]) {
                mockListeners[signal] = [];
            }
            mockListeners[signal].push(callback);
            return signal;
        }
    };

    class BaseMockWidget {
        constructor(...args) {
            this._listeners = {};
            if (typeof this._init === 'function') {
                this._init(...args);
            }
        }
        _init(params) {
            Object.assign(this, params);
        }
        connect(signal, callback) {
            if (!this._listeners[signal]) {
                this._listeners[signal] = [];
            }
            this._listeners[signal].push(callback);
            return signal;
        }
        emit(signal) {
            if (this._listeners[signal]) {
                this._listeners[signal].forEach(cb => cb());
            }
        }
        get_root() {
            return {
                get_surface() {
                    return {
                        inhibit_system_shortcuts() {},
                        restore_system_shortcuts() {}
                    };
                },
                present() {}
            };
        }
    }

    class MockPreferencesPage extends BaseMockWidget {
        _init(params) {
            super._init(params);
            this.groups = [];
        }
        add(group) {
            this.groups.push(group);
        }
    }

    class MockPreferencesGroup extends BaseMockWidget {
        _init(params) {
            super._init(params);
            this.rows = [];
        }
        add(row) {
            this.rows.push(row);
        }
    }

    const mockAdw = {
        PreferencesPage: MockPreferencesPage,
        PreferencesGroup: MockPreferencesGroup,
        SwitchRow: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.active = false;
            }
        },
        SpinRow: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.value = 0;
            }
        },
        ComboRow: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.selected = 0;
            }
        },
        ActionRow: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.suffixes = [];
            }
            add_suffix(widget) {
                this.suffixes.push(widget);
            }
        },
        AlertDialog: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.responses = [];
                this.controllers = [];
                mockAdw.lastAlertDialog = this;
            }
            add_response(id, label) {
                this.responses.push({ id, label });
            }
            add_controller(controller) {
                this.controllers.push(controller);
            }
            present(window) {
                this.presented = true;
                this.window = window;
            }
            close() {
                this.closed = true;
            }
        }
    };

    return { mockSettingsStore, mockListeners, mockSettings, BaseMockWidget, mockAdw };
});

vi.mock('gi://Gio', () => ({
    default: {
        Settings: class {
            constructor() {
                return mockSettings;
            }
        },
        SettingsBindFlags: {
            DEFAULT: 0
        }
    }
}));

vi.mock('gi://Adw', () => ({
    default: mockAdw
}));

vi.mock('gi://Gtk', () => ({
    default: {
        Adjustment: class {},
        Align: {
            CENTER: 0,
            START: 1,
            END: 2
        },
        ShortcutLabel: class {
            constructor(params) {
                Object.assign(this, params);
            }
        },
        Label: class {
            constructor(params) {
                Object.assign(this, params);
            }
            add_css_class(cls) {}
        },
        Image: class {
            constructor(params) {
                Object.assign(this, params);
            }
            add_css_class(cls) {}
        },
        Box: class {
            constructor(params) {
                Object.assign(this, params);
            }
            append() {}
        },
        StringList: {
            new(strings) {
                return { strings };
            }
        },
        EventControllerKey: class {
            connect(signal, callback) {
                this.signal = signal;
                this.callback = callback;
            }
        },
        accelerator_get_default_mod_mask() {
            return 0;
        },
        accelerator_name() {
            return 'mock-accel';
        }
    }
}));

vi.mock('gi://Gdk', () => ({
    default: {
        KEY_BackSpace: 8,
        KEY_Shift_L: 0xffe1,
        KEY_Hyper_R: 0xffed,
        KEY_Alt_L: 0xffe9,
        KEY_Alt_R: 0xffea,
        KEY_Meta_L: 0xffe7,
        KEY_Meta_R: 0xffe8,
        KEY_Super_L: 0xffeb,
        KEY_Super_R: 0xffec,
        KEY_Control_L: 0xffe3,
        KEY_Control_R: 0xffe4,
        EVENT_STOP: true,
        EVENT_PROPAGATE: false
    }
}));

vi.mock('gi://GObject', () => ({
    default: {
        registerClass: (meta, cls) => {
            const actualClass = cls || meta;
            const wrapperClass = class extends actualClass {
                constructor(...args) {
                    super(...args);
                    if (typeof this._init === 'function') {
                        this._init(...args);
                    }
                }
            };
            return wrapperClass;
        }
    }
}));

vi.mock('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js', () => ({
    ExtensionPreferences: class {
        getSettings() {
            return mockSettings;
        }
    }
}));

vi.mock('../lib/editor/preview.js', () => ({
    LayoutPreviewPage: class extends BaseMockWidget {
        _init(settings) {
            this.settings = settings;
            this.title = 'Layouts';
            this.groups = [];
        }
        add(group) {
            this.groups.push(group);
        }
    }
}));

vi.mock('../lib/editor/editor.js', () => ({
    LayoutEditorPage: class extends BaseMockWidget {
        _init(settings) {
            this.settings = settings;
            this.title = 'Base JSON';
        }
    }
}));

// Import WorkflowTilingPreferences (relative to tests/ dir)
import WorkflowTilingPreferences from '../prefs.js';

describe('WorkflowTilingPreferences', () => {
    let prefs;
    let mockWindow;
    let addedPages;

    beforeEach(() => {
        // Reset settings
        mockSettingsStore['enable-gaps'] = true;
        mockSettingsStore['inner-gaps'] = 6;
        mockSettingsStore['outer-gaps'] = 4;
        mockSettingsStore['keybindings-mode'] = 'default';
        mockSettingsStore['focus-window-mode'] = 'default';
        mockSettingsStore['shortcut-close-monitor'] = [];
        mockSettingsStore['close-monitor-include-minimized'] = false;

        Object.keys(mockListeners).forEach(k => delete mockListeners[k]);

        prefs = new WorkflowTilingPreferences();
        addedPages = [];
        mockWindow = {
            add: vi.fn((page) => {
                addedPages.push(page);
            }),
            remove: vi.fn((page) => {
                const idx = addedPages.indexOf(page);
                if (idx > -1) addedPages.splice(idx, 1);
            })
        };
    });

    it('should create and add expected pages to preferences window', () => {
        prefs.fillPreferencesWindow(mockWindow);

        expect(mockWindow.add).toHaveBeenCalled();
        const titles = addedPages.map(p => p.title);
        expect(titles).toContain('General');
        expect(titles).toContain('Keyboard Shortcuts');
        expect(titles).toContain('Layouts');
    });

    it('should place only Gaps group in General page', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const generalPage = addedPages.find(p => p.title === 'General');

        expect(generalPage).toBeDefined();
        expect(generalPage.groups).toHaveLength(1);
        expect(generalPage.groups[0].title).toBe('Gaps');
    });

    it('should place correct shortcut groups in Keyboard Shortcuts page', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const shortcutsPage = addedPages.find(p => p.title === 'Keyboard Shortcuts');

        expect(shortcutsPage).toBeDefined();
        expect(shortcutsPage.groups).toHaveLength(7);
        expect(shortcutsPage.groups[1].title).toBe('Window Focus & Position');
        expect(shortcutsPage.groups[2].title).toBe('Window State');
        expect(shortcutsPage.groups[3].title).toBe('Workspace Operations');
        expect(shortcutsPage.groups[4].title).toBe('Workspace Switching');
        expect(shortcutsPage.groups[5].title).toBe('Moving to Workspace');
        expect(shortcutsPage.groups[6].title).toBe('Monitor Actions');
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

    describe('ShortcutRow & Key Recording', () => {
        let shortcutsPage;
        let swapGroup;
        let testRow;

        beforeEach(() => {
            prefs.fillPreferencesWindow(mockWindow);
            shortcutsPage = addedPages.find(p => p.title === 'Keyboard Shortcuts');
            swapGroup = shortcutsPage.groups.find(g => g.title === 'Window Focus & Position');
            testRow = swapGroup.rows.find(r => r.keyName === 'custom-move-window-left');
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

        it('should handle missing surface or inhibit method without throwing', () => {
            vi.spyOn(testRow, 'get_root').mockReturnValue({
                get_surface() { return null; }
            });

            expect(() => testRow.emit('activated')).not.toThrow();
            expect(mockAdw.lastAlertDialog.presented).toBe(true);
        });

        it('should handle surface inhibit/restore throwing errors without crashing', () => {
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
        });
    });

    describe('Mode Switching and Visibility Stress Tests', () => {
        let shortcutsPage;
        let swapGroup;
        let testRow;

        beforeEach(() => {
            prefs.fillPreferencesWindow(mockWindow);
            shortcutsPage = addedPages.find(p => p.title === 'Keyboard Shortcuts');
            swapGroup = shortcutsPage.groups.find(g => g.title === 'Window Focus & Position');
            testRow = swapGroup.rows.find(r => r.keyName === 'custom-move-window-left');
        });

        it('should update keybinding row visibilities when mode changes', () => {
            const modeRow = swapGroup.rows.find(r => r instanceof mockAdw.ComboRow && r.title === 'Swap Mode');
            const moveRows = swapGroup.rows.filter(r => r.keyName && r.keyName.startsWith('custom-move-window')); // ShortcutRows

            // Initial: default mode. Move rows should be hidden
            expect(moveRows.every(r => r.visible === false)).toBe(true);
            expect(modeRow.subtitle).toContain('Default:');

            // Switch to custom (notify selected = 1)
            modeRow.selected = 1;
            modeRow.emit('notify::selected');
            expect(mockSettingsStore['keybindings-mode']).toBe('custom');
            expect(moveRows.every(r => r.visible === true)).toBe(true);
            expect(modeRow.subtitle).toBe('');

            // Switch to disabled (notify selected = 2)
            modeRow.selected = 2;
            modeRow.emit('notify::selected');
            expect(mockSettingsStore['keybindings-mode']).toBe('disabled');
            expect(moveRows.every(r => r.visible === false)).toBe(true);
            expect(modeRow.subtitle).toBe('');
        });

        it('should handle external settings modifications for keybindings mode visibility', () => {
            const moveRows = swapGroup.rows.filter(r => r.keyName && r.keyName.startsWith('custom-move-window'));

            // Set via settings directly
            mockSettings.set_string('keybindings-mode', 'custom');
            expect(moveRows.every(r => r.visible === true)).toBe(true);

            mockSettings.set_string('keybindings-mode', 'disabled');
            expect(moveRows.every(r => r.visible === false)).toBe(true);
        });

        it('should handle invalid keybindings mode values gracefully', () => {
            const moveRows = swapGroup.rows.filter(r => r.keyName && r.keyName.startsWith('custom-move-window'));

            // Set to invalid value
            mockSettings.set_string('keybindings-mode', 'invalid-mode-value');
            
            // Should hide custom rows and not crash
            expect(moveRows.every(r => r.visible === false)).toBe(true);
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

