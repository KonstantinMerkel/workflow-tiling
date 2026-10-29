import { Logger } from '../utils/logger.js';
import { LayoutParser } from '../domain/layout/parser.js';

const CONFIG_KEYS = [
    'enable-gaps',
    'inner-gaps',
    'outer-gaps',
    'custom-layouts',
    'debug-logging',
    'self-maximize-mode',
    'self-maximize-allow-list',
    'self-maximize-block-list',
    'maximize-focus-policy',
    'hotplug-policy',
];

/**
 * Builds plain Config snapshots ({ gaps, escalator, selfMaximize, focusPolicy, hotplugPolicy }) from
 * GSettings. Keeps the last valid snapshot when the layout JSON becomes invalid. The escalator object is reused while
 * the layout JSON text is unchanged, so its identity tells whether the layouts changed.
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

        this._load();
        this._signalIds = CONFIG_KEYS.map((key) => settings.connect(`changed::${key}`, () => this._reload()));
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

    destroy() {
        this._signalIds.forEach((id) => this._settings.disconnect(id));
        this._signalIds = [];
        this._onConfigChanged = this._onConfigInvalid = null;
    }

    _reload() {
        this._load();
        // eslint-disable-next-line no-restricted-syntax -- listener is unset before wiring and after destroy
        if (this.isValid()) this._onConfigChanged?.(this._config);
        // eslint-disable-next-line no-restricted-syntax -- listener is unset before wiring and after destroy
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

        const selfMaximize = Object.freeze({
            mode: settings.get_string('self-maximize-mode'),
            allowList: Object.freeze(settings.get_strv('self-maximize-allow-list')),
            blockList: Object.freeze(settings.get_strv('self-maximize-block-list')),
        });
        const focusPolicy = settings.get_string('maximize-focus-policy');
        const hotplugPolicy = settings.get_string('hotplug-policy');

        try {
            const escalator = this._escalatorFor(settings.get_string('custom-layouts'));
            this._config = Object.freeze({
                gaps: Object.freeze(gaps),
                escalator,
                selfMaximize,
                focusPolicy,
                hotplugPolicy,
            });
            this._error = null;
            Logger.debug(
                `ConfigSource: config loaded; gaps ${gaps.inner}/${gaps.outer}, ` +
                    `max ${escalator.getMaxCount()} windows, self-maximize ${selfMaximize.mode}, ` +
                    `focus ${focusPolicy}, monitor changes ${hotplugPolicy}`,
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
