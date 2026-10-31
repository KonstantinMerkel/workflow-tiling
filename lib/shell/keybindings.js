import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DIRECTIONAL_SHORTCUTS, boundKey, customKey } from '../domain/shortcuts.js';
import { DIRECTIONS } from '../domain/types.js';
import { Logger } from '../utils/logger.js';
import { applyShortcutModes, findConflicts, normalizeAccelerator } from '../utils/shortcuts.js';
import { gnomeShortcuts } from '../gio/gnome-shortcuts.js';

/** Native window-state actions routed to Engine.toggleOverride; they keep GNOME's keys. */
const NATIVE_OVERRIDES = {
    maximize: 'maximize',
    unmaximize: 'unmaximize',
    'toggle-maximized': 'maximize',
    'toggle-fullscreen': 'fullscreen',
};

/**
 * Binds the extension's shortcuts and takes over the native window-state handlers. Every action resolves the
 * focused window to an id and calls an Engine intent. Mutter re-reads a bound key itself when its setting changes, so
 * a mode is applied by writing the keys it binds (empty for None); nothing is ever rebound.
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
        this._active = false;
        this._checkedKeys = null;

        applyShortcutModes(settings);
        // The bound keys are watched too: written from outside (gsettings reset, dconf load), they are set back to
        // their mode's keys. Applying writes only what differs, so its own writes end here.
        const sources = [
            ...DIRECTIONAL_SHORTCUTS.flatMap((group) => [
                group.modeKey,
                ...DIRECTIONS.map((dir) => customKey(group, dir)),
            ]),
            ...this._definitions.map(({ key }) => key),
        ];
        this._modeSignals = sources.map((key) =>
            settings.connect(`changed::${key}`, () => {
                applyShortcutModes(settings);
                if (this._active) this._warnAboutConflicts();
            }),
        );
    }

    /** Binds every shortcut and native handler; binding again replaces the earlier bindings. */
    bind() {
        this.unbind();
        this._active = true;
        for (const { key, action } of this._definitions) this._addKeybinding(key, action);
        for (const [name, kind] of Object.entries(NATIVE_OVERRIDES)) {
            this._handleNative(name, (id) => this._engine.toggleOverride(id, kind));
        }
        Logger.debug(
            `Keybindings: bound [${this._boundKeys.join(', ')}], native handlers [${this._handledNatives.join(', ')}]`,
        );
        this._warnAboutConflicts();
    }

    /** Removes bindings and handlers; GNOME's own handlers take over again (lock screen, suspended, disable). */
    unbind() {
        this._active = false;
        if (this._boundKeys.length > 0 || this._handledNatives.length > 0) Logger.debug('Keybindings: unbound');
        for (const key of this._boundKeys) Main.wm.removeKeybinding(key);
        this._boundKeys = [];
        for (const name of this._handledNatives) Meta.keybindings_set_custom_handler(name, null);
        this._handledNatives = [];
    }

    destroy() {
        this.unbind();
        this._modeSignals.forEach((id) => this._settings.disconnect(id));
        this._modeSignals = [];
    }

    /**
     * A key bound twice works for only one of its actions, chosen by Mutter. Conflicts are allowed (prefs warn about
     * them), but the log names them: with GNOME's shortcuts and among the extension's own. Checked only when the
     * keys changed, and never at the cost of the bindings.
     */
    _warnAboutConflicts() {
        try {
            const own = this._boundKeys.flatMap((key) =>
                this._settings
                    .get_strv(key)
                    .map(normalizeAccelerator)
                    .filter(Boolean)
                    .map((accel) => ({ accel, id: key, label: key })),
            );
            const checked = JSON.stringify(own);
            if (checked === this._checkedKeys) return;
            this._checkedKeys = checked;
            if (own.length === 0) return;

            const entries = [...own, ...gnomeShortcuts()];
            for (const [key, others] of findConflicts(entries, this._boundKeys)) {
                if (others.length === 0) continue;
                const accels = own.filter((o) => o.id === key).map((o) => o.accel);
                Logger.warn(`Shortcut ${key} (${accels.join(', ')}) is also used by ${others.join(', ')}`);
            }
        } catch (e) {
            Logger.warn('Failed to check shortcuts for conflicts', e);
        }
    }

    _buildDefinitions() {
        const definitions = [];
        const intents = {
            move: (id, dir) => this._engine.moveDirection(id, dir),
            focus: (id, dir) => this._engine.focusDirection(id, dir),
        };
        for (const group of DIRECTIONAL_SHORTCUTS) {
            for (const dir of DIRECTIONS) {
                definitions.push({ key: boundKey(group, dir), action: (id) => intents[group.action](id, dir) });
            }
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

    _addKeybinding(key, action) {
        try {
            const bound = Main.wm.addKeybinding(
                key,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                (_display, window) => {
                    Logger.debug(`Keybindings: ${key}`);
                    action(this._focusedId(window));
                },
            );
            // Mutter refuses a name that is already registered (another extension); never unbind that one later
            if (bound === Meta.KeyBindingAction.NONE) {
                Logger.warn(`Failed to bind shortcut ${key}: the name is already registered`);
                return;
            }
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
