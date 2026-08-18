import { vi } from 'vitest';

// Mock GNOME's 'gi://' imports which don't exist in Node environment
vi.mock('gi://GLib', () => {
    let _idleCounter = 0;
    let _timeoutCounter = 0;
    return {
        default: {
            idle_add: vi.fn((priority, callback) => {
                const id = ++_idleCounter;
                callback();
                return id;
            }),
            timeout_add: vi.fn((priority, interval, callback) => {
                const id = ++_timeoutCounter;
                callback();
                return id;
            }),
            source_remove: vi.fn(),
            SOURCE_REMOVE: false,
            PRIORITY_DEFAULT: 0,
            PRIORITY_DEFAULT_IDLE: 0
        }
    };
});

vi.mock('gi://St', () => ({
    default: {
        Widget: class {
            constructor() {}
            set_position() {}
            set_size() {}
            show() {}
            hide() {}
            destroy() {}
            add_child() {}
            remove_child() {}
        }
    }
}));

vi.mock('gi://Clutter', () => ({
    default: {}
}));

vi.mock('gi://Gio', () => ({
    default: {
        Settings: class {
            constructor() {}
            get_string() { return 'yellow'; }
        },
        SettingsSchemaSource: {
            get_default: vi.fn(() => ({
                lookup: vi.fn((id, recursive) => null)
            }))
        }
    }
}));

const mockMonitorManager = {
    get_monitors: vi.fn(() => [
        { get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' },
        { get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }
    ]),
    get_logical_monitors: vi.fn(() => [
        { get_monitors: () => [{ get_stable_id: () => 'monitor-0', get_connector: () => 'DP-1' }] },
        { get_monitors: () => [{ get_stable_id: () => 'monitor-1', get_connector: () => 'HDMI-1' }] }
    ]),
    get_primary_monitor: vi.fn(() => 0),
    connect: vi.fn(() => 1),
    disconnect: vi.fn(),
    handler_is_connected: vi.fn(() => true)
};

// Mock global object
global.backend = {
    get_monitor_manager: () => mockMonitorManager
};
global.display = {
    get_primary_monitor: () => mockMonitorManager.get_primary_monitor(),
    get_current_monitor: vi.fn(() => 0),
    get_focus_window: vi.fn(() => null),
    list_all_windows: vi.fn(() => []),
    get_n_monitors: vi.fn(() => 2),
    get_monitor_geometry: vi.fn((index) => mockMonitorManager.get_logical_monitors()[index]?.rect || { x: 0, y: 0, width: 1920, height: 1080 }),
    connect: vi.fn(),
    disconnect: vi.fn()
};
global.workspace_manager = {
    get_active_workspace: vi.fn(() => ({
        list_windows: vi.fn(() => [])
    }))
};
let _laterCounter = 0;
global.compositor = {
    get_laters: vi.fn(() => ({
        add: vi.fn((type, callback) => {
            const id = ++_laterCounter;
            callback();
            return id;
        }),
        remove: vi.fn()
    }))
};
global.get_pointer = vi.fn(() => [0, 0, 0]);
global.window_group = {
    add_child: vi.fn()
};

vi.mock('gi://Meta', () => ({
    default: {
        LaterType: {
            BEFORE_REDRAW: 1
        },
        MaximizeFlags: {
            BOTH: 3,
            NONE: 0
        },
        WindowType: {
            NORMAL: 0,
            TERMINAL: 1,
            UTILITY: 2
        },
        Backend: {
            get_monitor_manager: vi.fn(() => mockMonitorManager)
        },
        get_backend: vi.fn(() => ({
            get_monitor_manager: () => mockMonitorManager
        }))
    }
}));

vi.mock('gi://Shell', () => ({
    default: {}
}));

vi.mock('resource:///org/gnome/shell/ui/main.js', () => ({
    wm: {
        addKeybinding: vi.fn(),
        removeKeybinding: vi.fn()
    },
    layoutManager: {
        uiGroup: {
            add_child: vi.fn(),
            remove_child: vi.fn()
        }
    }
}));
