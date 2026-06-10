import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { TilingController } from './lib/controller.js';
import { SignalListener } from './lib/signals.js';
import { SettingsManager } from './lib/settings.js';
import { Logger } from './lib/logger.js';
import { KeybindingManager } from './lib/keybindings.js';

/**
 * Main extension class. Manages controller and signals.
 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { LayoutParser } from './lib/layout.js';

export default class WorkflowTilingExtension extends Extension {
    enable() {
        Logger.info(`Enabling ${this.metadata.name}`);
        this._settings = new SettingsManager(this);
        this._controller = new TilingController(this._settings);
        this._signals = new SignalListener(this._controller);
        this._keybindings = new KeybindingManager(this._controller);
        
        this._isActive = false;
        this._wasSuspended = false;

        this._settings.onSettingsChanged = () => {
            if (this._applyCustomLayouts()) {
                this._controller.hydrate();
            }
        };

        this._settings.onKeybindingsChanged = () => {
            if (this._isActive) this._keybindings.rebindAll();
        }

        this._applyCustomLayouts();
    }

    _applyCustomLayouts() {
        if (!this._settings || !this._controller) return false;
        const customJson = this._settings.getCustomLayouts();
        let escalator = null;

        try {
            escalator = LayoutParser.parse(customJson);
            if (!escalator) throw new Error("Parsed layout is empty.");
        } catch (e) {
            Logger.error(`Invalid custom layouts JSON: ${e.message}`);
            Main.notifyError('Workflow Tiling', `Invalid layouts JSON. Suspending extension.\n${e.message}`);
            if (this._isActive) {
                this._signals.unbind();
                this._keybindings.unbindAll();
                this._controller.clear();
                this._isActive = false;
                this._wasSuspended = true;
            }
            return false;
        }

        this._controller.setEscalator(escalator);

        if (!this._isActive) {
            this._signals.bind();
            this._keybindings.bindAll();
            this._isActive = true;
            if (this._wasSuspended) {
                Main.notify('Workflow Tiling', 'Valid layout provided. Extension resumed.');
                this._wasSuspended = false;
            }
        }
        return true;
    }

    disable() {
        Logger.info(`Disabling ${this.metadata.name}`);
        if (this._isActive) {
            this._signals.unbind();
            this._keybindings.unbindAll();
        }
        if (this._settings) this._settings.destroy();
        if (this._controller) this._controller.clear();
        this._signals = null;
        this._keybindings = null;
        this._settings = null;
        this._controller = null;
        this._isActive = false;
        this._wasSuspended = false;
    }
}
