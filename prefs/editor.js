import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import { LayoutParser } from '../lib/domain/layout/parser.js';

export const LayoutEditorPage = GObject.registerClass(
    class EditorPage extends Adw.PreferencesPage {
        _init(settings, connections) {
            super._init({ title: 'JSON', icon_name: 'text-x-generic-symbolic' });
            this.settings = settings;

            const layoutGroup = new Adw.PreferencesGroup({ title: 'Custom JSON Layouts' });
            this.add(layoutGroup);

            const textView = new Gtk.TextView({
                wrap_mode: Gtk.WrapMode.WORD_CHAR,
                monospace: true,
                vexpand: true,
                hexpand: true,
                margin_start: 12,
                margin_end: 12,
                margin_top: 12,
                margin_bottom: 12,
            });

            const jsonBuf = textView.get_buffer();
            jsonBuf.set_text(this.settings.get_string('custom-layouts') || '', -1);

            connections.connect(settings, 'changed::custom-layouts', () => {
                const cur = this.settings.get_string('custom-layouts') || '';
                const displayed = jsonBuf.get_text(jsonBuf.get_start_iter(), jsonBuf.get_end_iter(), false);
                if (cur !== displayed) {
                    jsonBuf.set_text(cur, -1);
                }
            });

            const scrolledWindow = new Gtk.ScrolledWindow({
                min_content_height: 400,
                vexpand: true,
                child: textView,
                margin_bottom: 12,
            });
            layoutGroup.add(scrolledWindow);

            const errorLabel = new Gtk.Label({
                css_classes: ['error'],
                wrap: true,
                xalign: 0,
                visible: false,
                margin_bottom: 6,
            });
            layoutGroup.add(errorLabel);

            const saveButton = new Gtk.Button({
                label: 'Save Layouts',
                css_classes: ['suggested-action'],
                halign: Gtk.Align.END,
            });
            saveButton.connect('clicked', () => {
                const text = jsonBuf.get_text(jsonBuf.get_start_iter(), jsonBuf.get_end_iter(), false);
                const error = LayoutParser.validate(text);
                errorLabel.label = error ?? '';
                errorLabel.visible = error !== null;
                if (error === null) this.settings.set_string('custom-layouts', text);
            });
            layoutGroup.add(saveButton);
        }
    },
);
