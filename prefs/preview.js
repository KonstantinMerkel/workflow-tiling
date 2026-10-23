import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { LayoutParser } from '../lib/domain/layout/parser.js';
import {
    SPAN,
    toDraft,
    cutAt,
    moveCut,
    sizeRange,
    resizeSlot,
    slotAt,
    splitSlot,
    splitLargest,
    slotColor,
} from './draft.js';

const PAD = 8; // monitor bezel and its distance to the widget border, in px
const GAP = 4; // gap between drawn slots, in px
const GRAB = 8; // distance in px within which a cut can be grabbed

function monitorAspect() {
    const monitors = Gdk.Display.get_default()?.get_monitors();
    const rect = monitors?.get_n_items() > 0 ? monitors.get_item(0).get_geometry() : null;
    return rect?.width > 0 && rect?.height > 0 ? rect.width / rect.height : 16 / 10;
}

// Draws a monitor holding `slots` centred in a width×height area and returns the pixel frame
// {x, y, w, h} that maps 0..100 percent, for hit-testing pointer positions against the drawing.
function drawLayout(cr, width, height, slots, highlight = -1) {
    const aspect = monitorAspect();
    const mw = Math.min(width - 2 * PAD, (height - 2 * PAD) * aspect);
    const mh = mw / aspect;
    const mx = (width - mw) / 2;
    const my = (height - mh) / 2;
    cr.setSourceRGBA(0.12, 0.12, 0.14, 1);
    cr.rectangle(mx, my, mw, mh);
    cr.fillPreserve();
    cr.setSourceRGBA(0.25, 0.25, 0.28, 1);
    cr.setLineWidth(2);
    cr.stroke();

    const frame = { x: mx + PAD, y: my + PAD, w: mw - 2 * PAD, h: mh - 2 * PAD };
    slots.forEach((s, i) => {
        const x = frame.x + (frame.w * s.x) / 100 + GAP / 2;
        const y = frame.y + (frame.h * s.y) / 100 + GAP / 2;
        const w = (frame.w * s.w) / 100 - GAP;
        const h = (frame.h * s.h) / 100 - GAP;
        if (w <= 0 || h <= 0) return;

        const r = 4;
        cr.newSubPath();
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.arc(x + w - r, y + r, r, 1.5 * Math.PI, 2 * Math.PI);
        cr.arc(x + w - r, y + h - r, r, 0, 0.5 * Math.PI);
        cr.arc(x + r, y + h - r, r, 0.5 * Math.PI, Math.PI);
        cr.closePath();
        const [red, green, blue] = slotColor(s.id);
        cr.setSourceRGBA(red, green, blue, i === highlight ? 1 : 0.8);
        cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, i === highlight ? 0.9 : 0.3);
        cr.setLineWidth(i === highlight ? 2.5 : 1.5);
        cr.stroke();

        cr.setSourceRGBA(1, 1, 1, 1);
        cr.selectFontFace('Sans', 0, 0);
        for (const [text, size, dy] of [
            [`${s.id + 1}`, 14, -6],
            [`${s.w}%×${s.h}%`, 9, 10],
        ]) {
            cr.setFontSize(size);
            const ext = cr.textExtents(text);
            cr.moveTo(x + w / 2 - ext.width / 2 - ext.x_bearing, y + h / 2 - ext.height / 2 - ext.y_bearing + dy);
            cr.showText(text);
        }
    });
    return frame;
}

function toPercent(frame, px, py) {
    return { x: ((px - frame.x) / frame.w) * 100, y: ((py - frame.y) / frame.h) * 100 };
}

function arrow() {
    return new Gtk.Image({ icon_name: 'pan-down-symbolic', css_classes: ['dim-label'], icon_size: Gtk.IconSize.LARGE });
}

// Shows the escalator layouts as a vertical sequence of cards. One layout at a time can be edited
// as a draft: splits are picked by hand in a dialog, then refined by dragging cuts or by percentage.
export const LayoutPreviewPage = GObject.registerClass(
    class PreviewPage extends Adw.PreferencesPage {
        _init(settings) {
            super._init({ title: 'Layout Editor', icon_name: 'view-grid-symbolic' });
            this.settings = settings;
            this._editing = null; // { count, slots } of the layout currently being edited

            const group = new Adw.PreferencesGroup({ title: 'Escalator Layout Previews' });
            this.add(group);
            this._list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
            group.add(this._list);

            this._changedId = this.settings.connect('changed::custom-layouts', () => {
                if (!this._editing) this._rebuild();
            });
            this._rebuild();
        }

        // Validated layouts as Map<count, draft> for counts 1..max. Throws on invalid JSON.
        _readLayouts() {
            const escalator = LayoutParser.parse(this.settings.get_string('custom-layouts'));
            const layouts = new Map();
            for (let c = 1; c <= (escalator?.getMaxCount() ?? 0); c++) {
                layouts.set(c, toDraft(escalator.getLayoutForCount(c).estates));
            }
            return layouts;
        }

        // Rebuilds once itself, so the page's own change signal is blocked while writing.
        _store(mutate) {
            const data = JSON.parse(this.settings.get_string('custom-layouts')?.trim() || '{}');
            mutate(data);
            this.settings.block_signal_handler(this._changedId);
            this.settings.set_string('custom-layouts', JSON.stringify(data, null, 2));
            this.settings.unblock_signal_handler(this._changedId);
            this._rebuild();
        }

        _edit(count, slots) {
            this._editing = { count, slots };
            this._rebuild();
        }

        _rebuild() {
            for (let c = this._list.get_first_child(); c; c = this._list.get_first_child()) this._list.remove(c);

            let layouts;
            try {
                layouts = this._readLayouts();
            } catch (e) {
                this._list.append(
                    new Gtk.Label({
                        label: `Invalid Layout JSON:\n${e.message}`,
                        css_classes: ['error', 'title-4'],
                        justify: Gtk.Justification.CENTER,
                        margin_top: 24,
                        margin_bottom: 24,
                    }),
                );
                return;
            }
            // A draft whose layout is no longer stored (e.g. removed by a cascading delete) is dropped.
            if (this._editing && !layouts.has(this._editing.count)) this._editing = null;
            if (this._editing) layouts.set(this._editing.count, this._editing.slots);

            if (layouts.size === 0) {
                this._list.append(new Gtk.Label({ label: 'No layouts configured.', margin_top: 24 }));
                const addFirst = new Gtk.Button({
                    label: 'Add First Layout',
                    css_classes: ['suggested-action'],
                    halign: Gtk.Align.CENTER,
                    margin_bottom: 24,
                });
                addFirst.connect('clicked', () =>
                    this._store((data) => (data[1] = [{ id: 0, x: 0, y: 0, w: 100, h: 100 }])),
                );
                this._list.append(addFirst);
                return;
            }

            const counts = [...layouts.keys()];
            counts.forEach((count, i) => {
                if (i > 0) this._list.append(arrow());
                this._list.append(this._card(count, layouts.get(count), counts));
            });
            this._list.append(arrow());

            // While a draft is open, adding or editing another layout would discard it, so only the
            // draft's own Save / Cancel are offered.
            const max = counts[counts.length - 1];
            const add = new Gtk.Button({
                child: new Gtk.Image({ icon_name: 'list-add-symbolic', pixel_size: 24 }),
                tooltip_text: 'Add Layout',
                sensitive: !this._editing,
                css_classes: ['suggested-action', 'circular'],
                halign: Gtk.Align.CENTER,
                margin_bottom: 24,
                width_request: 48,
                height_request: 48,
            });
            add.connect('clicked', () =>
                this._openSplitDialog(max, add.get_root(), (slots) => {
                    this._editing = { count: max + 1, slots };
                    this._store((data) => (data[max + 1] = slots));
                }),
            );
            this._list.append(add);
        }

        _card(count, slots, counts) {
            const editing = this._editing?.count === count;
            const card = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_start: 12,
                margin_end: 12,
                halign: Gtk.Align.CENTER,
                css_classes: ['card'],
            });

            const header = new Gtk.Box({ spacing: 8, margin_top: 8, margin_end: 8, halign: Gtk.Align.END });
            if (!this._editing && count > 1) {
                const edit = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    tooltip_text: 'Edit layout',
                    css_classes: ['flat'],
                });
                edit.connect('clicked', () => this._edit(count, slots));
                const del = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Delete layout',
                    css_classes: ['flat', 'destructive-action'],
                });
                del.connect('clicked', () => this._delete(count, counts, del.get_root()));
                header.append(edit);
                header.append(del);
            }
            card.append(header);

            let frame = null;
            const canvas = new Gtk.DrawingArea({
                width_request: 240,
                height_request: 150,
                margin_start: 8,
                margin_end: 8,
                margin_bottom: 8,
            });
            canvas.set_draw_func((_area, cr, w, h) => (frame = drawLayout(cr, w, h, slots)));
            card.append(canvas);

            if (editing) card.append(this._editPanel(count, slots, canvas, () => frame));
            return card;
        }

        // Percentage spinners for each slot plus cut dragging on the card's canvas. Both edit
        // `slots` in place; sync() pushes the result back into every spinner and redraws.
        _editPanel(count, slots, canvas, frameOf) {
            const panel = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 4,
                margin_start: 12,
                margin_end: 12,
                margin_bottom: 12,
            });
            panel.append(new Gtk.Label({ label: '<b>Slot Percentages</b>', use_markup: true, xalign: 0 }));

            const spinners = [];
            let syncing = false;
            const sync = () => {
                syncing = true;
                for (const { spin, k, axis } of spinners) {
                    const [lo, hi] = sizeRange(slots, k, axis);
                    spin.set_range(lo, hi);
                    spin.set_value(slots[k][SPAN[axis]]);
                    spin.sensitive = lo < hi;
                }
                syncing = false;
                canvas.queue_draw();
            };

            slots.forEach((slot, k) => {
                const hex = slotColor(slot.id).map((v) => Math.round(v * 255).toString(16).padStart(2, '0'));
                const row = new Gtk.Box({ spacing: 8 });
                row.append(
                    new Gtk.Label({
                        label: `<span foreground="#${hex.join('')}">●</span> Slot ${slot.id + 1}:`,
                        use_markup: true,
                        width_request: 80,
                        xalign: 0,
                    }),
                );
                for (const [axis, name] of [
                    ['x', 'W:'],
                    ['y', 'H:'],
                ]) {
                    const spin = Gtk.SpinButton.new_with_range(0, 100, 1);
                    spin.numeric = true;
                    spin.connect('value-changed', () => {
                        if (syncing) return;
                        resizeSlot(slots, k, axis, spin.get_value());
                        sync();
                    });
                    spinners.push({ spin, k, axis });
                    row.append(new Gtk.Label({ label: name }));
                    row.append(spin);
                }
                panel.append(row);
            });
            sync();

            const grabbed = { x: null, y: null };
            const cutsUnder = (px, py) => {
                const f = frameOf();
                if (!f) return { x: null, y: null };
                const p = toPercent(f, px, py);
                const inside = p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
                return {
                    x: inside ? cutAt(slots, 'x', p.x, (GRAB / f.w) * 100) : null,
                    y: inside ? cutAt(slots, 'y', p.y, (GRAB / f.h) * 100) : null,
                };
            };
            const setCursor = ({ x, y }) => {
                const horizontal = y !== null ? 'all-scroll' : 'col-resize';
                const name = x !== null ? horizontal : y !== null ? 'row-resize' : 'default';
                canvas.set_cursor(Gdk.Cursor.new_from_name(name, null));
            };

            const motion = new Gtk.EventControllerMotion();
            motion.connect('motion', (_c, x, y) => {
                if (grabbed.x === null && grabbed.y === null) setCursor(cutsUnder(x, y));
            });
            motion.connect('leave', () => {
                if (grabbed.x === null && grabbed.y === null) setCursor(grabbed);
            });
            canvas.add_controller(motion);

            const drag = new Gtk.GestureDrag();
            drag.connect('drag-begin', (gesture, x, y) => {
                Object.assign(grabbed, cutsUnder(x, y));
                const hit = grabbed.x !== null || grabbed.y !== null;
                gesture.set_state(hit ? Gtk.EventSequenceState.CLAIMED : Gtk.EventSequenceState.DENIED);
            });
            drag.connect('drag-update', (gesture, dx, dy) => {
                const [, sx, sy] = gesture.get_start_point();
                const p = toPercent(frameOf(), sx + dx, sy + dy);
                for (const axis of ['x', 'y']) {
                    if (grabbed[axis] !== null) grabbed[axis] = moveCut(slots, axis, grabbed[axis], p[axis]);
                }
                sync();
            });
            drag.connect('drag-end', (gesture, dx, dy) => {
                const [, sx, sy] = gesture.get_start_point();
                grabbed.x = grabbed.y = null;
                setCursor(cutsUnder(sx + dx, sy + dy));
            });
            canvas.add_controller(drag);

            const buttons = new Gtk.Box({ spacing: 8, halign: Gtk.Align.END, margin_top: 12 });
            const redo = new Gtk.Button({ label: 'Redo Split', css_classes: ['destructive-action'] });
            redo.connect('clicked', () =>
                this._openSplitDialog(count - 1, redo.get_root(), (s) => this._edit(count, s)),
            );
            const cancel = new Gtk.Button({ label: 'Cancel' });
            cancel.connect('clicked', () => {
                this._editing = null;
                this._rebuild();
            });
            const save = new Gtk.Button({ label: 'Save', css_classes: ['suggested-action'] });
            save.connect('clicked', () => {
                this._editing = null;
                this._store((data) => (data[count] = slots));
            });
            buttons.append(redo);
            buttons.append(cancel);
            buttons.append(save);
            panel.append(buttons);
            return panel;
        }

        // Deleting the last layout is immediate. Deleting an earlier one cascades to all later
        // layouts so the sequence stays contiguous, which needs confirmation and offers a re-split.
        _delete(count, counts, parent) {
            const deleteFromCount = () =>
                this._store((data) => {
                    for (const k of Object.keys(data)) if (Number(k) >= count) delete data[k];
                });
            const later = counts.filter((c) => c > count);
            if (later.length === 0) {
                deleteFromCount();
                return;
            }

            const dialog = new Adw.AlertDialog({
                heading: 'Confirm Cascading Deletion',
                body:
                    `Deleting the layout for ${count} windows will also delete ` +
                    `all subsequent layouts (${later.join(', ')} windows) to maintain sequence.`,
            });
            dialog.add_response('cancel', 'Stop');
            dialog.add_response('redo', 'Redo Split Instead');
            dialog.set_response_appearance('redo', Adw.ResponseAppearance.SUGGESTED);
            dialog.add_response('delete', 'Do (Delete All Subsequent)');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_d, response) => {
                if (response === 'delete') deleteFromCount();
                if (response === 'redo') this._openSplitDialog(count - 1, parent, (s) => this._edit(count, s));
            });
            dialog.present(parent);
        }

        // Lets the user pick a slot of the `baseCount` layout and a position to split it at.
        // onSplit receives the resulting draft for baseCount + 1 windows.
        _openSplitDialog(baseCount, parent, onSplit) {
            let base;
            try {
                base = this._readLayouts().get(baseCount);
            } catch {
                return;
            }
            if (!base) return;

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
                if (k < 0 || !splitSlot(base, k, axis, hover[axis])) return;

                const s = base[k];
                const at = Math.round(hover[axis]);
                const [x1, y1, x2, y2] = axis === 'x' ? [at, s.y, at, s.y + s.h] : [s.x, at, s.x + s.w, at];
                cr.setSourceRGBA(1, 1, 1, 0.8);
                cr.setLineWidth(2);
                cr.setDash([6, 4], 0);
                cr.moveTo(frame.x + (frame.w * x1) / 100, frame.y + (frame.h * y1) / 100);
                cr.lineTo(frame.x + (frame.w * x2) / 100, frame.y + (frame.h * y2) / 100);
                cr.stroke();
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

        vfunc_dispose() {
            if (this._changedId) {
                this.settings.disconnect(this._changedId);
                this._changedId = null;
            }
            super.vfunc_dispose();
        }
    },
);
