import { describe, it, expect, vi, beforeEach } from 'vitest';
import Gtk from 'gi://Gtk';

const { mockSettingsStore, mockListeners, mockSettings, BaseMockWidget, mockAdw, gnomeKeys, gnomeListeners } = vi.hoisted(() => {
    const mockSettingsStore = {
        'enable-gaps': true,
        'inner-gaps': 6,
        'outer-gaps': 4,
        'focus-window-mode': 'none',
        'keybindings-mode': 'none',
        'shortcut-close-monitor': [],
        'close-monitor-include-minimized': false,
        'shortcut-close-workspace': [],
        'shortcut-switch-monitor': [],
        'shortcut-unminimize-workspace': [],
        'debug-logging': false,
        'custom-layouts': '{}',
        'self-maximize-mode': 'allow-listed',
        'self-maximize-allow-list': ['firefox'],
        'self-maximize-block-list': ['libreoffice'],
        'maximize-focus-policy': 'unmaximize',
        'hide-maximize-button': false,
        'hotplug-policy': 'restore-by-monitor'
    };

    const mockListeners = {};

    const mockSettings = {
        schema_id: 'org.gnome.shell.extensions.workflow-tiling',
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
        bind: (key, object, property) => {
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
            return { signal, callback };
        },
        disconnect: ({ signal, callback }) => {
            mockListeners[signal] = (mockListeners[signal] ?? []).filter((cb) => cb !== callback);
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
        remove(row) {
            this.rows = this.rows.filter((r) => r !== row);
        }
        set_header_suffix(widget) {
            this.headerSuffix = widget;
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
        ExpanderRow: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.rows = [];
                this.suffixes = [];
            }
            add_row(row) {
                this.rows.push(row);
            }
            add_suffix(widget) {
                this.suffixes.push(widget);
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
            add_prefix(widget) {
                this.prefix = widget;
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

    // GNOME's shortcuts for the conflict check: key -> accelerators, all in one mocked schema
    const gnomeKeys = new Map();
    const gnomeListeners = new Map(); // id -> 'changed' callback of a GNOME settings object

    return { mockSettingsStore, mockListeners, mockSettings, BaseMockWidget, mockAdw, gnomeKeys, gnomeListeners };
});

vi.mock('gi://Gio', () => ({
    default: {
        Settings: class Settings {
            static lastId = 0; // never reused, so a new handler cannot replace a live one

            constructor({ schema_id: schemaId } = {}) {
                if (schemaId !== 'org.gnome.desktop.wm.keybindings') return mockSettings;
                this.schema_id = schemaId;
            }
            get_strv(key) {
                return gnomeKeys.get(key) ?? [];
            }
            connect(signal, callback) {
                const id = ++Settings.lastId;
                if (signal === 'changed') gnomeListeners.set(id, callback);
                return id;
            }
            disconnect(id) {
                gnomeListeners.delete(id);
            }
        },
        SettingsSchemaSource: {
            get_default: () => ({
                lookup: (id) =>
                    id === 'org.gnome.desktop.wm.keybindings'
                        ? {
                              list_keys: () => [...gnomeKeys.keys()],
                              get_key: (key) => ({
                                  get_value_type: () => ({ dup_string: () => 'as' }),
                                  get_summary: () => `GNOME ${key}`,
                              }),
                          }
                        : null,
            }),
        },
        SettingsBindFlags: {
            DEFAULT: 0
        },
        AppInfo: {
            get_all: () => [
                { get_id: () => 'firefox.desktop', get_display_name: () => 'Firefox', get_icon: () => null, should_show: () => true },
            ],
        },
    }
}));

vi.mock('gi://Adw', () => ({
    default: mockAdw
}));

vi.mock('gi://Gtk', () => ({
    default: {
        Adjustment: class {},
        ListBox: class extends BaseMockWidget {
            append(child) {
                (this.children ??= []).push(child);
            }
        },
        SelectionMode: { NONE: 0 },
        CssProvider: class {
            load_from_string(css) {
                this.css = css;
            }
        },
        StyleContext: { add_provider_for_display() {} },
        STYLE_PROVIDER_PRIORITY_APPLICATION: 600,
        Button: class extends BaseMockWidget {},
        DropDown: class extends BaseMockWidget {
            _init(params) {
                super._init(params);
                this.selected = 0;
            }
        },
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
            add_css_class() {}
        },
        Image: class {
            constructor(params) {
                Object.assign(this, params);
            }
            add_css_class() {}
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
            return 0x1c00000d; // Shift | Control | Alt | Super | Hyper | Meta
        },
        // Modifier keys alone are invalid; everything else is accepted, like printable keys in GTK
        accelerator_valid(keyval) {
            return !(keyval >= 0xffe1 && keyval <= 0xffee);
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
        ModifierType: { SHIFT_MASK: 1 },
        Display: { get_default: () => ({}) },
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

vi.mock('../prefs/preview.js', () => ({
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

vi.mock('../prefs/editor.js', () => ({
    LayoutEditorPage: class extends BaseMockWidget {
        _init(settings) {
            this.settings = settings;
            this.title = 'Base JSON';
        }
    }
}));

// Import WorkflowTilingPreferences (relative to tests/ dir)
import WorkflowTilingPreferences from '../prefs.js';
import { Logger } from '../lib/utils/logger.js';

describe('WorkflowTilingPreferences', () => {
    let prefs;
    let mockWindow;
    let addedPages;

    beforeEach(() => {
        // Reset settings
        mockSettingsStore['enable-gaps'] = true;
        mockSettingsStore['inner-gaps'] = 6;
        mockSettingsStore['outer-gaps'] = 4;
        mockSettingsStore['self-maximize-mode'] = 'allow-listed';
        mockSettingsStore['self-maximize-allow-list'] = ['firefox'];
        mockSettingsStore['self-maximize-block-list'] = ['libreoffice'];
        mockSettingsStore['maximize-focus-policy'] = 'unmaximize';
        mockSettingsStore['hotplug-policy'] = 'restore-by-monitor';
        mockSettingsStore['shortcut-close-monitor'] = [];
        mockSettingsStore['close-monitor-include-minimized'] = false;
        mockSettingsStore['focus-window-mode'] = 'none';
        mockSettingsStore['keybindings-mode'] = 'none';
        for (const dir of ['left', 'right', 'up', 'down']) {
            for (const key of ['move-window', 'focus-window', 'custom-move-window', 'custom-focus-window']) {
                mockSettingsStore[`${key}-${dir}`] = [];
            }
        }
        gnomeKeys.clear();
        gnomeListeners.clear();

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
        expect(titles).not.toContain('Monitors');
        expect(titles).toContain('Maximizing');
        expect(titles).toContain('Layouts');
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

        it('disconnects its settings listeners when the page is destroyed', () => {
            const allowed = group('Allowed Apps');
            page.emit('destroy');
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

    it('disconnects the General and Keyboard Shortcuts listeners when their pages are destroyed', () => {
        prefs.fillPreferencesWindow(mockWindow);
        const listeners = (key) => (mockListeners[`changed::${key}`] ?? []).length;
        // a ShortcutRow keeps its own listener on its key; it is released in vfunc_dispose
        const closeMonitorListeners = listeners('shortcut-close-monitor');

        addedPages.find(p => p.title === 'General').emit('destroy');
        addedPages.find(p => p.title === 'Keyboard Shortcuts').emit('destroy');

        expect(listeners('enable-gaps')).toBe(0);
        expect(listeners('focus-window-mode')).toBe(0);
        expect(listeners('keybindings-mode')).toBe(0);
        expect(listeners('shortcut-close-monitor')).toBe(closeMonitorListeners - 1);
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
        expect(policyRow.subtitle).toContain('return when it is reconnected');
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

        it('re-reads GNOME shortcuts when GNOME settings change, and stops when the page is gone', () => {
            gnomeKeys.set('switch-to-workspace-left', ['<Super><Alt>Left']);
            mockSettingsStore['custom-move-window-left'] = ['<Alt><Super>Left'];
            custom();
            open();
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(true);

            gnomeKeys.set('switch-to-workspace-left', ['<Control><Alt>Left']); // freed in GNOME Settings
            [...gnomeListeners.values()].forEach((cb) => cb(null, 'switch-to-workspace-left'));
            expect(rowOf('custom-move-window-left').warningIcon.visible).toBe(false);
            expect(gnomeListeners.size).toBe(1); // not rebuilt for an ordinary key

            page.emit('destroy');
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

