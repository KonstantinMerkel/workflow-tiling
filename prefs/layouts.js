import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { LayoutPreviewPage } from './preview.js';
import { LayoutEditorPage } from './editor.js';

/**
 * Adds the visual layout editor page, and the JSON editor page while its advanced toggle is on.
 * @param {Adw.PreferencesWindow} window
 * @param {Gio.Settings} settings
 */
export function addLayoutPages(window, settings) {
    // --- Custom Layouts (JSON debug) Page ---
    const layoutPage = new LayoutEditorPage(settings);
    // Do not add to window yet.

    // --- Visual Layout Editor Page ---
    const previewPage = new LayoutPreviewPage(settings);
    window.add(previewPage);

    // --- Advanced JSON Toggle ---
    const advancedGroup = new Adw.PreferencesGroup();
    const jsonToggle = new Adw.SwitchRow({
        title: 'Edit Base JSON Instead',
        subtitle: 'Only if you know what you are doing. This will not save you from bad decisions',
    });

    settings.bind('show-advanced-json', jsonToggle, 'active', Gio.SettingsBindFlags.DEFAULT);

    let jsonPageAdded = false;

    const updateLayoutVisibility = () => {
        if (jsonToggle.active && !jsonPageAdded) {
            window.add(layoutPage);
            jsonPageAdded = true;
        } else if (!jsonToggle.active && jsonPageAdded) {
            window.remove(layoutPage);
            jsonPageAdded = false;
        }
    };

    jsonToggle.connect('notify::active', updateLayoutVisibility);

    // Initial state application
    updateLayoutVisibility();

    advancedGroup.add(jsonToggle);
    previewPage.add(advancedGroup);
}
