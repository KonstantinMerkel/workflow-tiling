import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { slotAt, splitSlot, splitLargest } from './draft.js';
import { drawCut, drawLayout, toPercent } from './layout-canvas.js';

// Lets the user pick a slot of the `base` draft and a position to split it at.
// onSplit receives the resulting draft for one more window.
export function openSplitDialog(base, parent, onSplit) {
    const baseCount = base.length;
    const dialog = new Adw.Window({
        title: `Split Layout for ${baseCount + 1} Windows`,
        modal: true,
        transient_for: parent,
        default_width: 500,
        default_height: 500,
    });
    const accept = (slots) => {
        if (!slots) return;
        onSplit(slots);
        dialog.close();
    };

    const headerBar = new Adw.HeaderBar();
    const stop = new Gtk.Button({ label: 'Stop', valign: Gtk.Align.CENTER });
    stop.connect('clicked', () => dialog.close());
    const halved = splitLargest(base);
    const largest = new Gtk.Button({
        label: 'Split Largest',
        tooltip_text: halved
            ? 'Halve the largest slot and continue editing'
            : 'The largest slot is too small to halve',
        sensitive: halved !== null,
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });
    largest.connect('clicked', () => accept(halved));
    headerBar.pack_start(stop);
    headerBar.pack_end(largest);

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_start: 18,
        margin_end: 18,
        margin_top: 12,
        margin_bottom: 18,
    });
    content.append(
        new Gtk.Label({
            label:
                'Select split direction and click inside any slot ' +
                `of the ${baseCount}-window layout to split it. The split can be adjusted afterwards.`,
            css_classes: ['title-4'],
            justify: Gtk.Justification.CENTER,
            wrap: true,
        }),
    );

    let axis = 'x';
    let hover = null; // pointer position in percent
    let frame = null;
    const canvas = new Gtk.DrawingArea({
        width_request: 320,
        height_request: 200,
        hexpand: true,
        vexpand: true,
    });

    const directions = new Gtk.Box({ halign: Gtk.Align.CENTER, css_classes: ['linked'] });
    const vertical = new Gtk.ToggleButton({ label: 'Vertical Split', active: true });
    const horizontal = new Gtk.ToggleButton({ label: 'Horizontal Split', group: vertical });
    vertical.connect('toggled', () => {
        axis = vertical.active ? 'x' : 'y';
        canvas.queue_draw();
    });
    directions.append(vertical);
    directions.append(horizontal);
    content.append(directions);
    content.append(canvas);

    canvas.set_draw_func((_area, cr, w, h) => {
        const k = hover ? slotAt(base, hover.x, hover.y) : -1;
        frame = drawLayout(cr, w, h, base, k);
        if (k >= 0 && splitSlot(base, k, axis, hover[axis])) drawCut(cr, frame, base[k], axis, hover[axis]);
        cr.$dispose();
    });

    const motion = new Gtk.EventControllerMotion();
    motion.connect('motion', (_c, x, y) => {
        hover = frame ? toPercent(frame, x, y) : null;
        canvas.queue_draw();
    });
    motion.connect('leave', () => {
        hover = null;
        canvas.queue_draw();
    });
    canvas.add_controller(motion);

    const click = new Gtk.GestureClick();
    click.connect('pressed', (_g, _n, x, y) => {
        if (!frame) return;
        const p = toPercent(frame, x, y);
        const k = slotAt(base, p.x, p.y);
        if (k >= 0) accept(splitSlot(base, k, axis, p[axis]));
    });
    canvas.add_controller(click);

    const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    root.append(headerBar);
    root.append(content);
    dialog.set_content(root);
    dialog.present();
}
