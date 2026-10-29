import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Logger } from './lib/utils/logger.js';
import { hasDirectionalShortcuts } from './lib/utils/shortcuts.js';
import { Engine } from './lib/app/engine/engine.js';
import { GSettingsConfigSource } from './lib/shell/config-source.js';
import { MutterDisplayPort } from './lib/shell/display-port.js';
import { MutterWindowPort } from './lib/shell/window-port.js';
import { ShellEvents } from './lib/shell/shell-events.js';
import { KeybindingAdapter } from './lib/shell/keybindings.js';
import { StIndicator } from './lib/shell/st-indicator.js';
import { MaximizeButtonHider } from './lib/shell/button-layout.js';

/**
 * Composition root: creates every Shell object and the Engine, and destroys them in reverse order.
 */
export default class WorkflowTilingExtension extends Extension {
    enable() {
        Logger.info(`Enabling ${this.metadata.name} ${this.metadata['version-name'] ?? ''} on GNOME Shell ${Config.PACKAGE_VERSION}`);
        this._settings = this.getSettings();
        this._configSource = new GSettingsConfigSource(this._settings);
        this._configSource.onConfigChanged((config) => this._onConfigChanged(config));
        this._configSource.onConfigInvalid((error) => this._suspend(error));
        this._buttonHider = new MaximizeButtonHider(this._settings);
        this._buttonHider.enable();

        this._displayPort = new MutterDisplayPort();
        this._windowPort = new MutterWindowPort(this._displayPort, Number(Config.PACKAGE_VERSION.split('.')[0]));
        this._indicator = new StIndicator();

        this._sessionModeId = Main.sessionMode.connect('updated', () => this._applySessionMode());

        if (this._configSource.isValid()) this._start();
        else this._suspend(this._configSource.error);
    }

    // The extension also runs in the `unlock-dialog` session mode: tiling state (slot order, overrides, evacuated
    // windows) must survive the lock screen and suspend, and monitor changes while locked (undocking with the lid
    // closed) must be handled. While locked only the keybindings are switched off. disable() cleans up
    // unconditionally.
    disable() {
        Logger.info(`Disabling ${this.metadata.name}`);
        if (this._sessionModeId) Main.sessionMode.disconnect(this._sessionModeId);
        this._sessionModeId = 0;

        this._firstRunHint?.destroy();
        this._keybindings?.destroy();
        this._events?.unbind();
        this._engine?.destroy();
        this._indicator?.destroy();
        this._windowPort?.destroy();
        this._displayPort?.destroy();
        this._configSource?.destroy();
        this._buttonHider?.disable();

        this._keybindings = null;
        this._events = null;
        this._engine = null;
        this._indicator = null;
        this._windowPort = null;
        this._displayPort = null;
        this._configSource = null;
        this._buttonHider = null;
        this._firstRunHint = null;
        this._settings = null;
        this._suspended = false;
    }

    _start() {
        this._engine = new Engine({
            windowPort: this._windowPort,
            displayPort: this._displayPort,
            indicator: this._indicator,
            config: this._configSource.current(),
        });
        this._events = new ShellEvents({
            windowPort: this._windowPort,
            displayPort: this._displayPort,
            engine: this._engine,
        });
        this._events.bind();
        this._engine.resync(this._windowPort.all());

        this._keybindings = new KeybindingAdapter({
            settings: this._settings,
            engine: this._engine,
            windowPort: this._windowPort,
        });
        this._suspended = false;
        this._applySessionMode();
    }

    _onConfigChanged(config) {
        if (!this._engine) {
            this._start();
            Logger.info('Valid layout JSON provided; tiling started');
            Main.notify('Workflow Tiling', 'Valid layout provided. Tiling resumed.');
        } else if (this._suspended) {
            this._resume(config);
        } else {
            this._engine.applyConfig(config);
        }
    }

    _suspend(error) {
        if (this._suspended) return;
        this._suspended = true;
        Logger.error(`Invalid custom layouts JSON: ${error}`);
        Main.notifyError('Workflow Tiling', `Invalid layouts JSON. Tiling suspended.\n${error}`);

        this._events?.unbind();
        this._keybindings?.unbind();
        this._engine?.suspend();
    }

    _resume(config) {
        this._suspended = false;
        this._engine.applyConfig(config);
        this._events.bind();
        this._engine.resync(this._windowPort.all());
        this._applySessionMode();
        Logger.info('Valid layout JSON provided; tiling resumed');
        Main.notify('Workflow Tiling', 'Valid layout provided. Tiling resumed.');
    }

    /** Keybindings are switched off while the screen is locked and while suspended. */
    _applySessionMode() {
        if (!this._keybindings) return;
        Logger.debug(`Extension: session mode ${Main.sessionMode.currentMode}, locked ${Main.sessionMode.isLocked}`);
        if (Main.sessionMode.isLocked || this._suspended) {
            this._keybindings.unbind();
            return;
        }
        this._keybindings.bind();
        this._showFirstRunHint();
    }

    /**
     * Once per install, while tiling runs unlocked: tells that moving and focusing windows has no shortcuts until a
     * mode other than None is chosen. Not shown when the user already uses one.
     */
    _showFirstRunHint() {
        if (this._settings.get_boolean('first-run-hint-shown')) return;
        // Set on the first check either way: choosing None later is a decision, not a first run
        this._settings.set_boolean('first-run-hint-shown', true);
        if (hasDirectionalShortcuts(this._settings)) return;

        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: 'Workflow Tiling',
            body: 'Moving and focusing windows has no keyboard shortcuts yet. Choose a mode in the settings.',
        });
        notification.addAction('Open Settings', () => this.openPreferences());
        // Kept so disable() can remove it: its action holds this extension
        notification.connect('destroy', () => (this._firstRunHint = null));
        this._firstRunHint = notification;
        source.addNotification(notification);
    }
}
