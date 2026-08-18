

/**
 * SettingsManager class. Reads extension settings.
 */
export class SettingsManager {
    constructor(extension, onSettingsChanged = null) {
        this.settings = extension ? extension.getSettings() : null;
        this._changedIds = [];
        this.onSettingsChanged = onSettingsChanged;
        this.onKeybindingsChanged = null;

        this._gaps = { inner: 6, outer: 4 };
        this._customLayouts = '';
        this._monitorTransitionBehavior = 'escalate';

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
            this._changedIds.push(this.settings.connect('changed::custom-layouts', () => {
                this._load();
                if (this.onSettingsChanged) this.onSettingsChanged();
            }));
            this._changedIds.push(this.settings.connect('changed::monitor-transition-behavior', () => {
                this._load();
                if (this.onSettingsChanged) this.onSettingsChanged();
            }));
            const kbKeys = [
                'keybindings-mode', 
                'move-window-left', 'move-window-right', 'move-window-up', 'move-window-down',
                'custom-move-window-left', 'custom-move-window-right', 'custom-move-window-up', 'custom-move-window-down',
                'focus-window-mode',
                'focus-window-left', 'focus-window-right', 'focus-window-up', 'focus-window-down',
                'custom-focus-window-left', 'custom-focus-window-right', 'custom-focus-window-up', 'custom-focus-window-down',
                'shortcut-close-monitor',
                'shortcut-close-workspace',
                'shortcut-switch-monitor',
                'shortcut-port-monitor-left',
                'shortcut-port-monitor-right',
                'shortcut-unminimize-workspace'
            ];
            kbKeys.forEach(key => {
                this._changedIds.push(this.settings.connect(`changed::${key}`, () => {
                    if (this.onKeybindingsChanged) this.onKeybindingsChanged();
                }));
            });
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
        this._customLayouts = this.settings.get_string('custom-layouts');
        this._monitorTransitionBehavior = this.settings.get_string('monitor-transition-behavior') || 'escalate';
    }

    getGaps() {
        return this._gaps;
    }

    getCustomLayouts() {
        return this._customLayouts;
    }

    getMonitorTransitionBehavior() {
        return this._monitorTransitionBehavior;
    }

    destroy() {
        if (this.settings) {
            this._changedIds.forEach(id => this.settings.disconnect(id));
            this._changedIds = [];
        }
        this.settings = null;
    }
}
