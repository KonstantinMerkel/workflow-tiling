import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { TilingController } from './lib/controller.js';
import { SignalListener } from './lib/signals.js';
import { SettingsManager } from './lib/settings.js';
import { Logger } from './lib/logger.js';

/**
 * Main extension class. Manages controller and signals.
 */
export default class WorkflowTilingExtension extends Extension {
    enable() {
        Logger.info(`Enabling ${this.metadata.name}`);
        this._settings = new SettingsManager(this);
        this._controller = new TilingController(this._settings);
        this._settings.onSettingsChanged = () => this._controller.retileAll();
        this._signals = new SignalListener(this._controller);
        this._settings.onKeybindingsChanged = () => this._signals.rebindKeybindings();
        this._signals.bind();
    }

    disable() {
        Logger.info(`Disabling ${this.metadata.name}`);
        this._signals.unbind();
        this._settings.destroy();
        this._controller.clear();
        this._signals = null;
        this._settings = null;
        this._controller = null;
    }
}
