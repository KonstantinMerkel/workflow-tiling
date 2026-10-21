import Gio from 'gi://Gio';
import { Logger } from '../utils/logger.js';

/** `button-layout` without the maximize button, e.g. `appmenu:minimize,maximize,close` → `appmenu:minimize,close`. */
export function withoutMaximize(layout) {
    return layout
        .split(':')
        .map((side) =>
            side
                .split(',')
                .filter((button) => button.trim() !== 'maximize')
                .join(','),
        )
        .join(':');
}

const hasMaximize = (layout) => withoutMaximize(layout) !== layout;

/**
 * Hides the maximize button of all title bars through GNOME's global `button-layout` while `hide-maximize-button`
 * is on. The original layout is written to `saved-button-layout` before it is changed and restored on disable, so a
 * Shell crash never loses it: the next enable restores it if hiding was turned off meanwhile. A layout someone else
 * sets while the button is hidden becomes the one to restore.
 */
export class MaximizeButtonHider {
    /**
     * @param {Gio.Settings} settings extension settings
     * @param {Gio.Settings} [wmSettings] org.gnome.desktop.wm.preferences
     */
    constructor(settings, wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' })) {
        this._settings = settings;
        this._wm = wmSettings;
        this._written = null; // the layout this hider wrote last, until its change notification (the echo) arrives
        this._signals = [];
    }

    /** Connects before the first write, so the echo of that write is recognised. */
    enable() {
        this._signals = [
            [this._settings, this._settings.connect('changed::hide-maximize-button', () => this._apply())],
            [this._wm, this._wm.connect('changed::button-layout', () => this._onLayoutChanged())],
        ];
        this._apply();
    }

    disable() {
        for (const [object, id] of this._signals) object.disconnect(id);
        this._signals = [];
        this._show();
    }

    _apply() {
        if (this._settings.get_boolean('hide-maximize-button')) this._hide();
        else this._show();
    }

    _onLayoutChanged() {
        const layout = this._wm.get_string('button-layout');
        if (layout === this._written) {
            this._written = null; // the echo of this hider's own write
            return;
        }
        if (!this._settings.get_boolean('hide-maximize-button')) return;
        Logger.debug(`MaximizeButtonHider: button layout set to ${layout} while hidden; restored on disable`);
        this._settings.set_string('saved-button-layout', layout);
        if (hasMaximize(layout)) this._write(withoutMaximize(layout));
    }

    _hide() {
        const layout = this._wm.get_string('button-layout');
        if (!hasMaximize(layout)) return;
        Logger.debug(`MaximizeButtonHider: hiding the maximize button (${layout})`);
        this._settings.set_string('saved-button-layout', layout);
        this._write(withoutMaximize(layout));
    }

    _show() {
        const saved = this._settings.get_string('saved-button-layout');
        if (!saved) return;
        Logger.debug(`MaximizeButtonHider: restoring the button layout ${saved}`);
        this._settings.set_string('saved-button-layout', '');
        this._write(saved);
    }

    _write(layout) {
        this._written = layout;
        this._wm.set_string('button-layout', layout);
    }
}
