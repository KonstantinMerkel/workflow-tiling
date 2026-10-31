import St from 'gi://St';

/**
 * Drop-target overlay shown during a drag.
 */
export class StIndicator {
    constructor() {
        this._widget = new St.Widget({
            style: 'border: 2px solid -st-accent-color; border-radius: 8px;',
            visible: false,
        });
        this._background = new St.Widget({
            style: 'background-color: -st-accent-color; border-radius: 6px;',
            opacity: 76,
        });
        this._widget.add_child(this._background);
        global.window_group.add_child(this._widget);
    }

    show(frame) {
        this._widget.set_position(frame.x, frame.y);
        this._widget.set_size(frame.width, frame.height);
        this._background.set_size(frame.width, frame.height);
        this._widget.show();
    }

    hide() {
        this._widget.hide();
    }

    destroy() {
        this._widget.destroy();
        this._widget = null;
        this._background = null;
    }
}
