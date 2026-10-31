import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildGeneralPage } from './prefs/general.js';
import { buildShortcutsPage } from './prefs/shortcuts.js';
import { buildMaximizePage } from './prefs/maximize.js';
import { addLayoutPages } from './prefs/layouts.js';
import { WindowConnections } from './prefs/rows.js';

/** Composes the preferences window; every page lives in its own module in prefs/. */
export default class WorkflowTilingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.workflow-tiling');
        const connections = new WindowConnections(window);

        window.add(buildGeneralPage(settings, connections));
        window.add(buildShortcutsPage(settings, connections));
        window.add(buildMaximizePage(settings, connections));
        addLayoutPages(window, settings, connections);
    }
}
