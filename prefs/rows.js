import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

// Info boxes: GNOME's rounded boxed list, set apart by a translucent yellow border and tint
const INFO_CSS = `
.workflow-tiling-info {
    border: 1px solid color-mix(in srgb, var(--warning-color) 55%, transparent);
    background-color: color-mix(in srgb, var(--warning-bg-color) 10%, var(--card-bg-color));
}`;
let infoStyleLoaded = false;

/**
 * Connections to objects outside a preferences window (settings), all disconnected when the window closes. Its
 * widgets are freed only when the prefs process exits, so a `destroy` handler or `vfunc_dispose` override never runs
 * in time, and GJS blocks the override then.
 */
export class WindowConnections {
    constructor(window) {
        this._connections = [];
        window.connect('close-request', () => {
            this.disconnectAll();
            return false;
        });
    }

    /** @returns {*} the handler id, for `disconnect` or blocking it */
    connect(object, signal, callback) {
        const id = object.connect(signal, callback);
        this._connections.push({ object, id });
        return id;
    }

    disconnect(object, id) {
        this._connections = this._connections.filter((c) => c.object !== object || c.id !== id);
        object.disconnect(id);
    }

    disconnectAll() {
        this._connections.splice(0).forEach(({ object, id }) => object.disconnect(id));
    }

    /** @returns {(signal: string, callback: Function) => void} connects to `object` until the window closes */
    listener(object) {
        return (signal, callback) => this.connect(object, signal, callback);
    }
}

/** Rounded box with an info icon and `text`, to add to a group. */
export function infoBox(text) {
    if (!infoStyleLoaded) {
        const provider = new Gtk.CssProvider();
        provider.load_from_string(INFO_CSS);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
        infoStyleLoaded = true;
    }
    const row = new Adw.ActionRow({ title: text, activatable: false });
    // A circled i; Adwaita draws dialog-information-symbolic as a light bulb
    row.add_prefix(new Gtk.Image({ icon_name: 'help-about-symbolic' }));
    const box = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list', 'workflow-tiling-info'],
    });
    box.append(row);
    return box;
}

/**
 * Keeps the `selected` index of a combo row or drop-down and a string key holding one of `choices` in step: the key
 * picks the first selection, before anything listens, and a selection writes only a value that differs.
 * @returns {(value: string) => number} the index of a value; unknown values pick the first choice
 */
export function bindChoice(settings, key, widget, choices) {
    const indexOf = (value) => Math.max(0, choices.findIndex((c) => c.value === value));
    widget.selected = indexOf(settings.get_string(key));
    widget.connect('notify::selected', () => {
        const { value } = choices[widget.selected] ?? choices[0];
        if (value !== settings.get_string(key)) settings.set_string(key, value);
    });
    return indexOf;
}

/** Combo row storing one of `choices` in a string key; the subtitle explains the current choice. */
export function choiceRow(settings, key, title, choices) {
    const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(choices.map((c) => c.label)) });
    bindChoice(settings, key, row, choices);
    row.subtitle = choices[row.selected].subtitle;
    row.connect('notify::selected', () => (row.subtitle = (choices[row.selected] ?? choices[0]).subtitle));
    return row;
}
