

/**
 * SettingsManager class. Reads extension settings.
 */
export class SettingsManager {
    constructor(extension, onSettingsChanged = null) {
        this.settings = extension ? extension.getSettings() : null;
        this._changedIds = [];
        this.onSettingsChanged = onSettingsChanged;

        this._gaps = { inner: 6, outer: 4 };

        if (this.settings) {
            this._load();
            this._changedIds.push(this.settings.connect('changed::inner-gaps', () => {
                this._load();
                if (this.onSettingsChanged) this.onSettingsChanged();
            }));
            this._changedIds.push(this.settings.connect('changed::outer-gaps', () => {
                this._load();
                if (this.onSettingsChanged) this.onSettingsChanged();
            }));
            this._changedIds.push(this.settings.connect('changed::enable-gaps', () => {
                this._load();
                if (this.onSettingsChanged) this.onSettingsChanged();
            }));
        }
    }

    _load() {
        const enabled = this.settings.get_boolean('enable-gaps');
        if (enabled) {
            this._gaps.inner = this.settings.get_int('inner-gaps');
            this._gaps.outer = this.settings.get_int('outer-gaps');
        } else {
            this._gaps.inner = 0;
            this._gaps.outer = 0;
        }
    }

    getGaps() {
        return this._gaps;
    }

    destroy() {
        if (this.settings) {
            this._changedIds.forEach(id => this.settings.disconnect(id));
            this._changedIds = [];
        }
        this.settings = null;
    }
}
