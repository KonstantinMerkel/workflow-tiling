import { Logger } from '../utils/logger.js';
import { LayoutParser } from '../domain/layout/parser.js';

const CONFIG_KEYS = ['enable-gaps', 'inner-gaps', 'outer-gaps', 'custom-layouts', 'debug-logging'];

export const KEYBINDING_KEYS = [
    'keybindings-mode',
    'move-window-left',
    'move-window-right',
    'move-window-up',
    'move-window-down',
    'custom-move-window-left',
    'custom-move-window-right',
    'custom-move-window-up',
    'custom-move-window-down',
    'focus-window-mode',
    'focus-window-left',
    'focus-window-right',
    'focus-window-up',
    'focus-window-down',
    'custom-focus-window-left',
    'custom-focus-window-right',
    'custom-focus-window-up',
    'custom-focus-window-down',
    'shortcut-close-monitor',
    'shortcut-close-workspace',
    'shortcut-switch-monitor',
    'shortcut-unminimize-workspace',
];

/**
 * Builds plain Config snapshots ({ gaps, escalator, debug }) from GSettings. Keeps the last valid snapshot when the
 * layout JSON becomes invalid. The escalator object is reused while the layout JSON text is unchanged, so its
 * identity tells whether the layouts changed.
 */
export class GSettingsConfigSource {
    /** @param {Gio.Settings} settings owned by the extension */
    constructor(settings) {
        this._settings = settings;
        this._config = null;
        this._error = null;
        this._layoutsText = null;
        this._escalator = null;
        this._onConfigChanged = null;
        this._onConfigInvalid = null;
        this._onKeybindingsChanged = null;

        this._load();
        this._signalIds = [
            ...CONFIG_KEYS.map((key) => settings.connect(`changed::${key}`, () => this._reload())),
            ...KEYBINDING_KEYS.map((key) => settings.connect(`changed::${key}`, () => this._onKeybindingsChanged?.())),
        ];
    }

    /** @returns {object|null} last valid Config */
    current() {
        return this._config;
    }

    isValid() {
        return this._error === null;
    }

    /** @returns {string|null} why the layout JSON is invalid */
    get error() {
        return this._error;
    }

    onConfigChanged(callback) {
        this._onConfigChanged = callback;
    }

    onConfigInvalid(callback) {
        this._onConfigInvalid = callback;
    }

    onKeybindingsChanged(callback) {
        this._onKeybindingsChanged = callback;
    }

    destroy() {
        this._signalIds.forEach((id) => this._settings.disconnect(id));
        this._signalIds = [];
        this._onConfigChanged = this._onConfigInvalid = this._onKeybindingsChanged = null;
    }

    _reload() {
        this._load();
        if (this.isValid()) this._onConfigChanged?.(this._config);
        else this._onConfigInvalid?.(this._error);
    }

    _load() {
        const settings = this._settings;
        Logger.DEBUG = settings.get_boolean('debug-logging');
        const enabled = settings.get_boolean('enable-gaps');
        const gaps = {
            inner: enabled ? settings.get_int('inner-gaps') : 0,
            outer: enabled ? settings.get_int('outer-gaps') : 0,
        };

        try {
            const escalator = this._escalatorFor(settings.get_string('custom-layouts'));
            this._config = Object.freeze({ gaps: Object.freeze(gaps), escalator, debug: Logger.DEBUG });
            this._error = null;
            Logger.debug(
                `ConfigSource: config loaded; gaps ${gaps.inner}/${gaps.outer}, max ${escalator.getMaxCount()} windows`,
            );
        } catch (e) {
            this._error = e.message;
            Logger.debug(`ConfigSource: layout JSON invalid: ${e.message}`);
        }
    }

    /** Parses the layout JSON unless it equals the text the current escalator was built from. */
    _escalatorFor(text) {
        if (this._escalator && text === this._layoutsText) return this._escalator;
        const escalator = LayoutParser.parse(text);
        if (!escalator) throw new Error('Layout JSON is empty');
        this._escalator = escalator;
        this._layoutsText = text;
        return escalator;
    }
}
