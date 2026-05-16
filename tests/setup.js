import { vi } from 'vitest';

// Mock GNOME's 'gi://' imports which don't exist in Node environment
vi.mock('gi://GLib', () => ({
    default: {
        idle_add: vi.fn((priority, callback) => {
            callback(); // Execute immediately in tests
            return 1;
        }),
        timeout_add: vi.fn((priority, interval, callback) => {
            callback(); // Execute immediately in tests
            return 1;
        }),
        SOURCE_REMOVE: false,
        PRIORITY_DEFAULT: 0,
        PRIORITY_DEFAULT_IDLE: 0
    }
}));

vi.mock('gi://Meta', () => ({
    default: {
        MaximizeFlags: {
            BOTH: 3,
            NONE: 0
        },
        WindowType: {
            NORMAL: 0,
            TERMINAL: 1,
            UTILITY: 2
        }
    }
}));
