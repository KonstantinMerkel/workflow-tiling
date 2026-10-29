import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { buildGeneralPage } from './prefs/general.js';
import { buildShortcutsPage } from './prefs/shortcuts.js';
import { buildMaximizePage } from './prefs/maximize.js';
import { addLayoutPages } from './prefs/layouts.js';

/** Composes the preferences window; every page lives in its own module in prefs/. */
export default class WorkflowTilingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.workflow-tiling');

        window.add(buildGeneralPage(settings));
        window.add(buildShortcutsPage(settings));
        window.add(buildMaximizePage(settings));
        addLayoutPages(window, settings);
    }
}
