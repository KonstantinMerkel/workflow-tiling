import Adw from 'gi://Adw';
import { choiceRow } from './rows.js';

const HOTPLUG_POLICIES = [
    {
        value: 'restore-by-monitor',
        label: 'Windows stay with their monitor',
        subtitle: 'Windows of a disconnected monitor are minimized and return when it is reconnected',
    },
    {
        value: 'follow-primary',
        label: 'Windows follow the primary monitor',
        subtitle:
            'The primary monitor\'s windows move to the new primary; its own windows are minimized ' +
            'until it is secondary again',
    },
];

/** Preferences page for docking behaviour; only relevant for setups whose monitors change. */
export function buildMonitorsPage(settings) {
    const page = new Adw.PreferencesPage({ title: 'Monitors', icon_name: 'video-display-symbolic' });
    const group = new Adw.PreferencesGroup({
        title: 'When Monitors Change',
        description: 'Applies when docking, undocking or changing the primary display',
    });
    group.add(choiceRow(settings, 'hotplug-policy', 'Window Placement', HOTPLUG_POLICIES));
    page.add(group);
    return page;
}
