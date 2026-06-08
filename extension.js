import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
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

        this._isActive = false;
        this._wasSuspended = false;

        try {
            this._wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
            let currentLayout = this._wmSettings.get_string('button-layout');
            if (currentLayout.includes('maximize')) {
                let newLayout = currentLayout.replace(/maximize,?/g, '').replace(/,maximize/g, '');
                this._wmSettings.set_string('button-layout', newLayout);
            }
        } catch (e) {
            Logger.warn('Failed to hide maximize button', e);
        }

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

        if (this._wmSettings) {
            try {
                let layout = this._wmSettings.get_string('button-layout');
                if (!layout.includes('maximize')) {
                    if (layout.includes('minimize,close')) {
                        layout = layout.replace('minimize,close', 'minimize,maximize,close');
                    } else if (layout.includes('close')) {
                        layout = layout.replace('close', 'maximize,close');
                    } else {
                        layout += ',maximize';
                    }
                    this._wmSettings.set_string('button-layout', layout);
                    Gio.Settings.sync();
                }
            } catch (e) {
                Logger.error('Failed to restore maximize button', e);
            }
            this._wmSettings = null;
        }
    }
}
