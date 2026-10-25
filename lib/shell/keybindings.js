import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Direction } from '../domain/types.js';
import { Logger } from '../utils/logger.js';
import { ShadowManager } from './shadows.js';

const DIRECTIONS = [Direction.LEFT, Direction.RIGHT, Direction.UP, Direction.DOWN];

/** Native actions occupying the default move shortcuts; taken over instead of binding a duplicate. */
const NATIVE_MOVE_CONFLICTS = {
    [Direction.LEFT]: 'toggle-tiled-left',
    [Direction.RIGHT]: 'toggle-tiled-right',
};

/** Native window-state actions routed to Engine.toggleOverride. */
const NATIVE_OVERRIDES = {
    maximize: 'maximize',
    unmaximize: 'unmaximize',
    'toggle-maximized': 'maximize',
    'toggle-fullscreen': 'fullscreen',
};

/**
 * Binds the extension's shortcuts and takes over native handlers. Every action resolves the focused window to an
 * id and calls an Engine intent.
 */
export class KeybindingAdapter {
    /**
     * @param {object} deps
     * @param {Gio.Settings} deps.settings extension settings
     * @param {object} deps.engine Engine
     * @param {object} deps.windowPort MutterWindowPort
     */
    constructor({ settings, engine, windowPort }) {
        this._settings = settings;
        this._engine = engine;
        this._windowPort = windowPort;
        this._boundKeys = [];
        this._handledNatives = [];
        this._definitions = this._buildDefinitions();
        this._shadows = new ShadowManager(settings, [
            ...Object.keys(NATIVE_OVERRIDES),
            ...Object.values(NATIVE_MOVE_CONFLICTS),
        ]);
    }

    /** Shadows conflicting native shortcuts, then binds everything. */
    bindAll() {
        const shadowKeys = this._activeDefinitions()
            .filter(({ native }) => !native)
            .map(({ key }) => key);
        if (shadowKeys.length > 0) this._shadows.shadowShortcuts(shadowKeys);
        this._bind();
    }

    /** Removes bindings and handlers and restores shadowed native shortcuts (disable). */
    unbindAll() {
        this._unbind();
        this._shadows.restoreAll();
    }

    rebindAll() {
        this.unbindAll();
        this.bindAll();
    }

    /** Lock screen: removes bindings and handlers only; shadowed native shortcuts stay shadowed. */
    suspend() {
        this._unbind();
    }

    resume() {
        this._unbind();
        this._bind();
    }

    _bind() {
        for (const { key, native, action } of this._activeDefinitions()) {
            if (native) this._handleNative(native, action);
            else this._addKeybinding(key, action);
        }
        for (const [name, kind] of Object.entries(NATIVE_OVERRIDES)) {
            this._handleNative(name, (id) => this._engine.toggleOverride(id, kind));
        }
        Logger.debug(
            `Keybindings: bound [${this._boundKeys.join(', ')}], native handlers [${this._handledNatives.join(', ')}]`,
        );
    }

    _unbind() {
        if (this._boundKeys.length > 0 || this._handledNatives.length > 0) Logger.debug('Keybindings: unbound');
        for (const key of this._boundKeys) Main.wm.removeKeybinding(key);
        this._boundKeys = [];
        for (const name of this._handledNatives) Meta.keybindings_set_custom_handler(name, null);
        this._handledNatives = [];
    }

    _buildDefinitions() {
        const definitions = [];
        for (const dir of DIRECTIONS) {
            definitions.push({
                mode: 'keybindings-mode',
                key: `move-window-${dir}`,
                customKey: `custom-move-window-${dir}`,
                conflict: NATIVE_MOVE_CONFLICTS[dir] ?? null,
                action: (id) => this._engine.moveDirection(id, dir),
            });
            definitions.push({
                mode: 'focus-window-mode',
                key: `focus-window-${dir}`,
                customKey: `custom-focus-window-${dir}`,
                conflict: null,
                action: (id) => this._engine.focusDirection(id, dir),
            });
        }
        definitions.push(
            {
                key: 'shortcut-close-monitor',
                action: () =>
                    this._engine.closeMonitor(this._settings.get_boolean('close-monitor-include-minimized')),
            },
            { key: 'shortcut-close-workspace', action: () => this._engine.closeWorkspace() },
            { key: 'shortcut-switch-monitor', action: (id) => this._engine.switchMonitors(id) },
            { key: 'shortcut-unminimize-workspace', action: () => this._engine.unminimizeWorkspace() },
        );
        return definitions;
    }

    /** Resolves each definition for the current modes: disabled ones are dropped, custom ones use their key. */
    _activeDefinitions() {
        const active = [];
        for (const definition of this._definitions) {
            const mode = definition.mode ? this._settings.get_string(definition.mode) : 'default';
            if (mode === 'disabled') continue;
            if (mode === 'custom' && definition.customKey) {
                active.push({ key: definition.customKey, native: null, action: definition.action });
            } else {
                active.push({ key: definition.key, native: definition.conflict ?? null, action: definition.action });
            }
        }
        return active;
    }

    _addKeybinding(key, action) {
        try {
            Main.wm.addKeybinding(
                key,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                (_display, window) => {
                    Logger.debug(`Keybindings: ${key}`);
                    action(this._focusedId(window));
                },
            );
            this._boundKeys.push(key);
        } catch (e) {
            Logger.warn(`Failed to bind shortcut ${key}`, e);
        }
    }

    _handleNative(name, action) {
        try {
            Meta.keybindings_set_custom_handler(name, (_display, window) => {
                Logger.debug(`Keybindings: native ${name}`);
                action(this._focusedId(window));
            });
            this._handledNatives.push(name);
        } catch (e) {
            Logger.warn(`Failed to take over native shortcut ${name}`, e);
        }
    }

    _focusedId(window) {
        return this._windowPort.idOf(window ?? global.display.get_focus_window());
    }
}
