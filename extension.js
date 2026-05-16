import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { TilingController } from './lib/controller.js';
import { SignalListener } from './lib/signals.js';

export default class WorkflowTilingExtension extends Extension {
    enable() {
        console.log(`Enabling ${this.metadata.name}`);
        this._controller = new TilingController();
        this._signals = new SignalListener(this._controller);
        this._signals.bind();
    }

    disable() {
        console.log(`Disabling ${this.metadata.name}`);
        this._signals.unbind();
        this._signals = null;
        this._controller = null;
    }
}
