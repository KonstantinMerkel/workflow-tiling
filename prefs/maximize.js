import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { appEntry, withEntry } from '../lib/domain/policies/override/self-maximize.js';
import { choiceRow, infoBox } from './rows.js';

const SELF_MAXIMIZE_MODES = [
    { value: 'never', label: 'Never', subtitle: 'Tiled windows maximize only through the shortcuts' },
    { value: 'allow-listed', label: 'Only listed apps', subtitle: 'Apps in the list below may maximize themselves' },
    {
        value: 'all-except-listed',
        label: 'All except listed apps',
        subtitle: 'Every app except those listed below',
    },
];

const FOCUS_POLICIES = [
    { value: 'keep', label: 'Keep maximized', subtitle: 'The other window is shown in front of it' },
    { value: 'unmaximize', label: 'Unmaximize', subtitle: 'The layout becomes visible again' },
    { value: 'pass-on', label: 'Pass on', subtitle: 'The other window is maximized instead' },
];

/** Installed apps by list entry, for display names in the lists and the picker. */
function installedApps() {
    return Gio.AppInfo.get_all()
        .filter((app) => app.should_show() && app.get_id())
        .map((app) => ({ entry: appEntry(app.get_id()), name: app.get_display_name(), icon: app.get_icon() }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Group listing the entries of a string-list key, each with a remove button, plus an add button. */
function appListGroup(settings, key, title, apps, listen) {
    const group = new Adw.PreferencesGroup({ title });
    const addButton = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        tooltip_text: 'Add App',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    addButton.connect('clicked', () =>
        pickApp(group.get_root(), apps(), (entry) => settings.set_strv(key, withEntry(settings.get_strv(key), entry))),
    );
    group.set_header_suffix(addButton);

    let rows = [];
    const render = () => {
        rows.forEach((row) => group.remove(row));
        const names = new Map(apps().map((app) => [app.entry, app.name]));
        rows = settings.get_strv(key).map((entry) => {
            const row = new Adw.ActionRow({ title: names.get(appEntry(entry)) ?? entry, subtitle: entry });
            const removeButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: 'Remove',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            removeButton.connect('clicked', () =>
                settings.set_strv(key, settings.get_strv(key).filter((e) => e !== entry)),
            );
            row.add_suffix(removeButton);
            group.add(row);
            return row;
        });
    };
    listen(`changed::${key}`, render);
    render();
    return group;
}

/** Dialog choosing an installed app. */
function pickApp(parent, apps, onPicked) {
    const dialog = new Adw.Dialog({ title: 'Add App', content_width: 420, content_height: 560 });
    const pick = (entry) => {
        onPicked(entry);
        dialog.close();
    };

    const search = new Gtk.SearchEntry({ placeholder_text: 'Search installed apps' });
    const appList = new Gtk.ListBox({ css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE });
    for (const app of apps) {
        const row = new Adw.ActionRow({ title: app.name, subtitle: app.entry, activatable: true });
        if (app.icon) row.add_prefix(Gtk.Image.new_from_gicon(app.icon));
        row.connect('activated', () => pick(app.entry));
        row._searchText = `${app.name} ${app.entry}`.toLowerCase();
        appList.append(row);
    }
    appList.set_filter_func((row) => row._searchText.includes(search.text.toLowerCase()));
    search.connect('search-changed', () => appList.invalidate_filter());

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });
    content.append(search);
    content.append(new Gtk.ScrolledWindow({ child: appList, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER }));

    const view = new Adw.ToolbarView({ content });
    view.add_top_bar(new Adw.HeaderBar());
    dialog.child = view;
    dialog.present(parent);
}

/** Preferences page for maximize and fullscreen behaviour of tiled windows. */
export function buildMaximizePage(settings, connections) {
    const page = new Adw.PreferencesPage({ title: 'Maximizing', icon_name: 'view-fullscreen-symbolic' });
    const listen = connections.listener(settings);
    let cachedApps = null;
    const apps = () => (cachedApps ??= installedApps());

    const infoGroup = new Adw.PreferencesGroup();
    infoGroup.add(
        infoBox(
            'The maximize and fullscreen shortcuts always work. Only full maximizing and fullscreen are supported, ' +
                'not maximizing to one half of the screen.',
        ),
    );
    page.add(infoGroup);

    const selfGroup = new Adw.PreferencesGroup({
        title: 'Apps Maximizing Themselves',
        description: 'Title bar, F11 or opening maximized.',
    });
    selfGroup.add(choiceRow(settings, 'self-maximize-mode', 'Allowed Apps', SELF_MAXIMIZE_MODES));
    page.add(selfGroup);

    const allowGroup = appListGroup(settings, 'self-maximize-allow-list', 'Allowed Apps', apps, listen);
    const blockGroup = appListGroup(settings, 'self-maximize-block-list', 'Blocked Apps', apps, listen);
    page.add(allowGroup);
    page.add(blockGroup);
    const updateLists = () => {
        const mode = settings.get_string('self-maximize-mode');
        allowGroup.visible = mode === 'allow-listed';
        blockGroup.visible = mode === 'all-except-listed';
    };
    listen('changed::self-maximize-mode', updateLists);
    updateLists();

    const focusGroup = new Adw.PreferencesGroup({ title: 'When Another Window Comes Forward' });
    focusGroup.add(choiceRow(settings, 'maximize-focus-policy', 'Maximized Window', FOCUS_POLICIES));
    page.add(focusGroup);

    const buttonGroup = new Adw.PreferencesGroup({ title: 'Title Bar' });
    const hideRow = new Adw.SwitchRow({
        title: 'Hide Maximize Button',
        subtitle: 'Applies to all apps while the extension is enabled',
    });
    settings.bind('hide-maximize-button', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    buttonGroup.add(hideRow);
    page.add(buttonGroup);

    return page;
}
