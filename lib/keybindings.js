import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Logger } from './logger.js';

const NATIVE_CONFLICTS = {
    'move-window-left': 'toggle-tiled-left',
    'move-window-right': 'toggle-tiled-right',
    'move-window-up': 'maximize',
    'move-window-down': 'unmaximize'
};

export class KeybindingManager {
    constructor(controller) {
        this.controller = controller;
        this.settings = controller.settings ? controller.settings.settings : null;
        this._boundKeys = [];
        this._activeConflicts = [];
        this._definitions = this._buildDefinitions();
    }

    _buildDefinitions() {
        const defs = [];

        // Move Directions
        ['left', 'right', 'up', 'down'].forEach(dir => {
            defs.push({
                defaultKey: `move-window-${dir}`,
                customKey: `custom-move-window-${dir}`,
                modeSetting: 'keybindings-mode',
                action: (c, win) => c.moveWindowDirection(win, dir),
                conflict: NATIVE_CONFLICTS[`move-window-${dir}`] || null
            });
        });

        // Focus Directions
        ['left', 'right', 'up', 'down'].forEach(dir => {
            defs.push({
                defaultKey: `focus-window-${dir}`,
                customKey: `custom-focus-window-${dir}`,
                modeSetting: 'focus-window-mode',
                action: (c, win) => c.focusWindowDirection(win, dir),
                conflict: null
            });
        });

        // Batch Utilities
        const utilities = {
            'shortcut-close-monitor': (c) => c.closeMonitorWindows(global.display.get_current_monitor(), c.settings.settings.get_boolean('close-monitor-include-minimized')),
            'shortcut-close-workspace': (c) => c.closeWorkspaceWindows(global.workspace_manager.get_active_workspace()),
            'shortcut-switch-monitor': (c) => c.switchMonitors(global.display.get_current_monitor()),
            'shortcut-port-monitor-left': (c) => c.portMonitorToWorkspace(global.display.get_current_monitor(), 'left'),
            'shortcut-port-monitor-right': (c) => c.portMonitorToWorkspace(global.display.get_current_monitor(), 'right'),
            'shortcut-unminimize-workspace': (c) => c.unminimizeWorkspace(global.workspace_manager.get_active_workspace())
        };

        for (const [key, action] of Object.entries(utilities)) {
            defs.push({
                defaultKey: key,
                action: (c) => action(c),
                conflict: null
            });
        }

        return defs;
    }

    bindAll() {
        if (!this.settings) return;

        const conflictsToHijack = [];

        for (const def of this._definitions) {
            const { active, keyToBind, isCustom } = this._resolveBinding(def);
            if (!active) continue;

            if (!isCustom && def.conflict) {
                conflictsToHijack.push(def.conflict);
            }

            this._bindExtensionShortcut(def, keyToBind);
        }

        conflictsToHijack.forEach(conflictKey => this._hijackNativeShortcut(conflictKey));
    }

    _resolveBinding(def) {
        let keyToBind = def.defaultKey;
        let active = true;
        let isCustom = false;

        if (def.modeSetting) {
            const mode = this.settings.get_string(def.modeSetting);
            if (mode === 'disabled') active = false;
            if (mode === 'custom' && def.customKey) {
                keyToBind = def.customKey;
                isCustom = true;
            }
        }

        return { active, keyToBind, isCustom };
    }

    _bindExtensionShortcut(def, keyToBind) {
        try {
            Main.wm.addKeybinding(
                keyToBind,
                this.settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                (display, window, binding) => {
                    const focusWindow = window || global.display.get_focus_window();
                    def.action(this.controller, focusWindow);
                }
            );

            this._boundKeys.push(keyToBind);
        } catch (e) {
            Logger.warn(`Failed to bind shortcut ${keyToBind}`, e);
        }
    }

    _hijackNativeShortcut(conflictKey) {
        try {
            Meta.keybindings_set_custom_handler(conflictKey, (display, window, binding) => {
                const focusWindow = window || global.display.get_focus_window();
                const def = this._definitions.find(d => d.conflict === conflictKey);
                if (def) def.action(this.controller, focusWindow);
            });
            
            if (!this._activeConflicts.includes(conflictKey)) {
                this._activeConflicts.push(conflictKey);
            }
        } catch (e) {
            Logger.warn(`Failed to set custom handler for ${conflictKey}`, e);
        }
    }

    unbindAll() {
        // Clean up your extension's keybinding out of runtime
        for (const key of this._boundKeys) {
            try {
                Main.wm.removeKeybinding(key);
            } catch (e) {
                Logger.warn(`Failed to unbind shortcut ${key}`, e);
            }
        }
        this._boundKeys = [];

        // Restore GNOME's native C handling immediately by passing null
        for (const conflictKey of this._activeConflicts) {
            try {
                Meta.keybindings_set_custom_handler(conflictKey, null);
            } catch (e) {
                Logger.warn(`Failed to restore native handler for ${conflictKey}`, e);
            }
        }
        this._activeConflicts = [];
    }

    rebindAll() {
        this.unbindAll();
        this.bindAll();
    }
}
