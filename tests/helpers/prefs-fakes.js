import { vi } from 'vitest';

// Fakes of the GI modules and settings the preferences use. Each prefs test file mocks the modules with these:
// vi.mock('gi://Gtk', () => import('../helpers/prefs-fakes.js').then((f) => f.gtkModule)), and so on.

export const mockSettingsStore = {
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

export const mockListeners = {};

export const mockSettings = {
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

export class BaseMockWidget {
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

export class MockPreferencesPage extends BaseMockWidget {
    _init(params) {
        super._init(params);
        this.groups = [];
    }
    add(group) {
        this.groups.push(group);
    }
}

export class MockPreferencesGroup extends BaseMockWidget {
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

export const mockAdw = {
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
export const gnomeKeys = new Map();
export const gnomeListeners = new Map(); // id -> 'changed' callback of a GNOME settings object


export const gioModule = {
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
};

export const adwModule = {
    default: mockAdw
};

export const gtkModule = {
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
};

export const gdkModule = {
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
};

export const gobjectModule = {
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
};

export const extensionPrefsModule = {
    ExtensionPreferences: class {
        getSettings() {
            return mockSettings;
        }
    }
};

export const previewModule = {
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
};

export const editorModule = {
    LayoutEditorPage: class extends BaseMockWidget {
        _init(settings) {
            this.settings = settings;
            this.title = 'Base JSON';
        }
    }
};

/** Settings back to their defaults, no listeners, no GNOME shortcuts. */
export function resetFakes() {
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

}

/** A preferences window that records its pages; `close()` runs its close-request handlers. */
export function fakeWindow() {
    const pages = [];
    const closeHandlers = [];
    const window = {
        connect: vi.fn((signal, callback) => {
            if (signal === 'close-request') closeHandlers.push(callback);
        }),
        close: () => closeHandlers.forEach((cb) => cb()),
        add: vi.fn((page) => {
            pages.push(page);
        }),
        remove: vi.fn((page) => {
            const idx = pages.indexOf(page);
            if (idx > -1) pages.splice(idx, 1);
        }),
    };
    return { window, pages };
}
