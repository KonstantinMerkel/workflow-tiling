import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

/** Combo row storing one of `choices` in a string key; the subtitle explains the current choice. */
export function choiceRow(settings, key, title, choices) {
    const row = new Adw.ComboRow({ title, model: Gtk.StringList.new(choices.map((c) => c.label)) });
    row.selected = Math.max(0, choices.findIndex((c) => c.value === settings.get_string(key)));
    row.subtitle = choices[row.selected].subtitle;
    row.connect('notify::selected', () => {
        const choice = choices[row.selected] ?? choices[0];
        row.subtitle = choice.subtitle;
        settings.set_string(key, choice.value);
    });
    return row;
}
