import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Logger } from './logger.js';

/**
 * SignalListener: Manages GNOME Shell event connections.
 */
export const TILABLE_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.TERMINAL,
    Meta.WindowType.UTILITY
];

export class SignalListener {
    constructor(controller) {
        this.controller = controller;
        this._signals = [];
        this._keybindings = [];
    }

    bind() {
        const connect = (obj, name, cb) => {
            if (!obj) return;
            const id = obj.connect(name, cb);
            this._signals.push({ obj, id });
        };

        // Listen for window-created signals.
        connect(global.display, 'window-created', (display, window) => {
            this._addWindow(window);
        });

        // Monitor window movement.
        connect(global.display, 'window-entered-monitor', (display, monitorIndex, window) => {
            this._addWindow(window);
        });

        connect(global.display, 'window-left-monitor', (display, monitorIndex, window) => {
            // Re-tile the monitor the window left
            this.controller.tilingRequest(window);
        });

        // Monitor Hotplugging.
        try {
            const manager = global.backend.get_monitor_manager();
            connect(manager, 'monitors-changed', () => {
                this.controller.handleMonitorsChanged();
            });
        } catch (e) {
            Logger.error('Failed to connect monitors-changed', e);
        }

        // Handle window drag-to-swap
        connect(global.display, 'grab-op-begin', (display, window, op) => {
            if (window && (op === Meta.GrabOp.MOVING || op === Meta.GrabOp.KEYBOARD_MOVING)) {
                this.controller.startDragTracking(window);
            }
        });

        connect(global.display, 'grab-op-end', (display, window, op) => {
            if (window && (op === Meta.GrabOp.MOVING || op === Meta.GrabOp.KEYBOARD_MOVING)) {
                this.controller.endDragTracking(window);
            }
        });

        // Listen for screen unlock to re-hydrate state
        connect(Main.sessionMode, 'updated', () => {
            if (!Main.sessionMode.isLocked) {
                Logger.info('Session unlocked, triggering hydration');
                this.controller.hydrate();
            }
        });

        this._bindKeybindings();

        // Tile tracked windows.
        global.display.list_all_windows().forEach(window => {
            this._addWindow(window);
        });
    }

    _bindKeybindings() {
        const settings = this.controller.settings ? this.controller.settings.settings : null;
        if (!settings) return;

        const isMoveCustom = settings.get_string('keybindings-mode') === 'custom';
        const isMoveDisabled = settings.get_string('keybindings-mode') === 'disabled';

        const bindDirection = (defaultName, customName, direction) => {
            if (isMoveDisabled) return;
            const keyToBind = isMoveCustom ? customName : defaultName;
            Main.wm.addKeybinding(
                keyToBind,
                settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                (display, window, binding) => {
                    const focusWindow = window || global.display.get_focus_window();
                    Logger.info(`Keybinding triggered: ${keyToBind}, direction: ${direction}, window: ${focusWindow ? focusWindow.get_title() : 'none'}`);
                    if (focusWindow) {
                        this.controller.moveWindowDirection(focusWindow, direction);
                    }
                }
            );
            this._keybindings.push(keyToBind);
        };

        bindDirection('move-window-left', 'custom-move-window-left', 'left');
        bindDirection('move-window-right', 'custom-move-window-right', 'right');
        bindDirection('move-window-up', 'custom-move-window-up', 'up');
        bindDirection('move-window-down', 'custom-move-window-down', 'down');

        const isFocusCustom = settings.get_string('focus-window-mode') === 'custom';
        const isFocusDisabled = settings.get_string('focus-window-mode') === 'disabled';

        const bindFocusDirection = (defaultName, customName, direction) => {
            if (isFocusDisabled) return;
            const keyToBind = isFocusCustom ? customName : defaultName;
            Main.wm.addKeybinding(
                keyToBind,
                settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                (display, window, binding) => {
                    const focusWindow = window || global.display.get_focus_window();
                    Logger.info(`Focus keybinding triggered: ${keyToBind}, direction: ${direction}, window: ${focusWindow ? focusWindow.get_title() : 'none'}`);
                    if (focusWindow) {
                        this.controller.focusWindowDirection(focusWindow, direction);
                    }
                }
            );
            this._keybindings.push(keyToBind);
        };

        bindFocusDirection('focus-window-left', 'custom-focus-window-left', 'left');
        bindFocusDirection('focus-window-right', 'custom-focus-window-right', 'right');
        bindFocusDirection('focus-window-up', 'custom-focus-window-up', 'up');
        bindFocusDirection('focus-window-down', 'custom-focus-window-down', 'down');

        const bindBatch = (settingName, callback) => {
            Main.wm.addKeybinding(
                settingName,
                settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                callback
            );
            this._keybindings.push(settingName);
        };

        bindBatch('shortcut-close-monitor', () => {
            const monitorIndex = global.display.get_current_monitor();
            const includeMin = settings.get_boolean('close-monitor-include-minimized');
            this.controller.closeMonitorWindows(monitorIndex, includeMin);
        });

        bindBatch('shortcut-close-workspace', () => {
            const workspace = global.workspace_manager.get_active_workspace();
            this.controller.closeWorkspaceWindows(workspace);
        });

        bindBatch('shortcut-switch-monitor', () => {
            const monitorIndex = global.display.get_current_monitor();
            this.controller.switchMonitors(monitorIndex);
        });

        bindBatch('shortcut-port-monitor-left', () => {
            const monitorIndex = global.display.get_current_monitor();
            this.controller.portMonitorToWorkspace(monitorIndex, 'left');
        });

        bindBatch('shortcut-port-monitor-right', () => {
            const monitorIndex = global.display.get_current_monitor();
            this.controller.portMonitorToWorkspace(monitorIndex, 'right');
        });

        bindBatch('shortcut-unminimize-workspace', () => {
            const workspace = global.workspace_manager.get_active_workspace();
            this.controller.unminimizeWorkspace(workspace);
        });
    }

    _addWindow(window) {
        if (this._shouldTile(window)) {
            this.controller.tilingRequest(window);
        }
    }

    rebindKeybindings() {
        this._unbindKeybindings();
        this._bindKeybindings();
    }

    unbind() {
        this._signals.forEach(({ obj, id }) => {
            try {
                if (obj && obj.handler_is_connected(id)) {
                    obj.disconnect(id);
                }
            } catch (e) {
                Logger.warn('Failed to unbind signal for object', e);
            }
        });
        this._signals = [];

        this._unbindKeybindings();
    }

    _unbindKeybindings() {
        this._keybindings.forEach(name => {
            try {
                Main.wm.removeKeybinding(name);
            } catch (e) {
                Logger.warn(`Failed to unbind keybinding ${name}`, e);
            }
        });
        this._keybindings = [];
    }

    _shouldTile(window) {
        if (!window) return false;

        const type = window.get_window_type();
        const skipTaskbar = window.is_skip_taskbar ? window.is_skip_taskbar() : false;
        
        return TILABLE_WINDOW_TYPES.includes(type) && !skipTaskbar;
    }
}
