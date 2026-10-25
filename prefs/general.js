import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { Logger } from '../lib/utils/logger.js';
import { pageListener } from './rows.js';

/** Preferences page for gaps and debugging. */
export function buildGeneralPage(settings) {
    const page = new Adw.PreferencesPage({ title: 'General', icon_name: 'preferences-system-symbolic' });
    const listen = pageListener(page, settings);

    // --- Gaps Group ---
    const gapsGroup = new Adw.PreferencesGroup({ title: 'Gaps' });
    const enableGapsRow = new Adw.SwitchRow({ title: 'Enable Gaps', subtitle: 'Global toggle for all gaps' });
    settings.bind('enable-gaps', enableGapsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    gapsGroup.add(enableGapsRow);
    const innerGapsRow = new Adw.SpinRow({
        title: '  ↳ Inner Gaps',
        subtitle: '      Gap size between tiled windows',
        adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
    });
    settings.bind('inner-gaps', innerGapsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    gapsGroup.add(innerGapsRow);
    const outerGapsRow = new Adw.SpinRow({
        title: '  ↳ Outer Gaps',
        subtitle: '      Gap size between windows and screen edges',
        adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1 }),
    });
    settings.bind('outer-gaps', outerGapsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    gapsGroup.add(outerGapsRow);

    const updateGapsVisibility = () => {
        const enabled = settings.get_boolean('enable-gaps');
        innerGapsRow.visible = enabled;
        outerGapsRow.visible = enabled;
    };
    listen('changed::enable-gaps', updateGapsVisibility);
    updateGapsVisibility();

    page.add(gapsGroup);

    // --- Debug Group ---
    const debugGroup = new Adw.PreferencesGroup({ title: 'Debug' });
    const debugLoggingRow = new Adw.SwitchRow({
        title: 'Debug Logging',
        subtitle: 'Enable verbose debug messages in system log',
    });
    settings.bind('debug-logging', debugLoggingRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    debugGroup.add(debugLoggingRow);

    const saveBugLogsRow = new Adw.ActionRow({
        title: 'Save Bug Logs',
        subtitle: 'Export all session logs to ~/Downloads for bug reports',
        activatable: true,
    });
    const saveBugLogsIcon = new Gtk.Image({
        icon_name: 'document-save-symbolic',
        valign: Gtk.Align.CENTER,
    });
    saveBugLogsRow.add_suffix(saveBugLogsIcon);
    saveBugLogsRow.connect('activated', () => {
        saveBugLogs(saveBugLogsRow.get_root());
    });
    debugGroup.add(saveBugLogsRow);
    page.add(debugGroup);

    return page;
}

function saveBugLogs(parentWindow) {
getGnomeShellSessionStart((sinceArg) => {
    try {
        const now = GLib.DateTime.new_now_local();
        const timestamp = now.format('%Y-%m-%d_%H-%M-%S');
        const filename = `workflow-tiling-bug-${timestamp}.log`;
        const downloadsDir =
            GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ||
            GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
        const filepath = GLib.build_filenamev([downloadsDir, filename]);

        const args = ['journalctl', '--user', '--no-pager', '-g', 'WorkflowTiling'];
        if (sinceArg) args.push('--since', sinceArg);
        else args.push('-b');

        const proc = Gio.Subprocess.new(
            args,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );

        proc.communicate_utf8_async(null, null, (source, result) => {
            try {
                const [, stdout] = source.communicate_utf8_finish(result);

                if (!stdout || stdout.trim() === '' || stdout.trim() === '-- No entries --') {
                    showDialog(
                        parentWindow,
                        'No Logs Found',
                        'No WorkflowTiling log entries found in the current session.',
                    );
                    return;
                }

                const file = Gio.File.new_for_path(filepath);
                file.replace_contents_async(
                    new TextEncoder().encode(stdout),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null,
                    (fileSource, fileResult) => {
                        try {
                            fileSource.replace_contents_finish(fileResult);
                            const msg =
                                `Logs saved to ${filepath}.\n\n` +
                                `To open a bug report on GitHub, please attach this file.`;
                            showDialog(parentWindow, 'Bug Logs Saved', msg);
                        } catch (e) {
                            showDialog(
                                parentWindow,
                                'Error',
                                `Failed to write logs to disk: ${e.message}`,
                            );
                        }
                    },
                );
            } catch (e) {
                showDialog(parentWindow, 'Error', `Failed to save logs: ${e.message}`);
            }
        });
    } catch (e) {
        showDialog(parentWindow, 'Error', `Failed to launch log capture: ${e.message}`);
    }
});
}

/**
 * Resolves the start time of the running gnome-shell process asynchronously.
 * Calls callback with a string suitable for journalctl --since,
 * or null if resolution fails (caller falls back to -b).
 */
function getGnomeShellSessionStart(callback) {
try {
    const proc = Gio.Subprocess.new(
        ['ps', '-o', 'lstart=', '-C', 'gnome-shell'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    proc.communicate_utf8_async(null, null, (source, result) => {
        try {
            const [, stdout] = source.communicate_utf8_finish(result);
            const lstart = stdout?.split('\n')[0]?.trim();
            if (!lstart) {
                callback(null);
                return;
            }

            const epoch = Date.parse(lstart) / 1000;
            if (isNaN(epoch)) {
                callback(null);
                return;
            }

            const dt = GLib.DateTime.new_from_unix_local(epoch);
            callback(dt.format('%Y-%m-%d %H:%M:%S'));
        } catch (e) {
            Logger.warn('Failed to resolve gnome-shell session start', e);
            callback(null);
        }
    });
} catch (e) {
    Logger.warn('Failed to start ps command', e);
    callback(null);
}
}

function showDialog(parentWindow, heading, body) {
const dialog = new Adw.AlertDialog({ heading, body });
dialog.add_response('ok', 'OK');
dialog.present(parentWindow);
}
