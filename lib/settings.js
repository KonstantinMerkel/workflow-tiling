import { TilingConfig } from './layout.js';

export class SettingsManager {
    constructor(extension, onSettingsChanged = null) {
        this.settings = extension ? extension.getSettings() : null;
        this._changedIds = [];
        this.onSettingsChanged = onSettingsChanged;

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
            TilingConfig.GAPS.INNER = this.settings.get_int('inner-gaps');
            TilingConfig.GAPS.OUTER = this.settings.get_int('outer-gaps');
        } else {
            TilingConfig.GAPS.INNER = 0;
            TilingConfig.GAPS.OUTER = 0;
        }
    }

    destroy() {
        if (this.settings) {
            this._changedIds.forEach(id => this.settings.disconnect(id));
            this._changedIds = [];
        }
        this.settings = null;
    }
}
