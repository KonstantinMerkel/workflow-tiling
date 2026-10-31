import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { LayoutParser } from '../lib/domain/layout/parser.js';
import { SPAN, toDraft, cutAt, moveCut, sizeRange, resizeSlot, slotColor } from './draft.js';
import { drawLayout, toPercent } from './layout-canvas.js';
import { openSplitDialog } from './split-dialog.js';

const GRAB = 8; // distance in px within which a cut can be grabbed

function arrow() {
    return new Gtk.Image({ icon_name: 'pan-down-symbolic', css_classes: ['dim-label'], icon_size: Gtk.IconSize.LARGE });
}

// Shows the escalator layouts as a vertical sequence of cards. One layout at a time can be edited
// as a draft: splits are picked by hand in a dialog, then refined by dragging cuts or by percentage.
export const LayoutPreviewPage = GObject.registerClass(
    class PreviewPage extends Adw.PreferencesPage {
        _init(settings, connections) {
            super._init({ title: 'Layout Editor', icon_name: 'view-grid-symbolic' });
            this.settings = settings;
            this._editing = null; // { count, slots } of the layout currently being edited

            const group = new Adw.PreferencesGroup({ title: 'Escalator Layout Previews' });
            this.add(group);
            this._list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
            group.add(this._list);

            this._changedId = connections.connect(settings, 'changed::custom-layouts', () => {
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
            canvas.set_draw_func((_area, cr, w, h) => {
                frame = drawLayout(cr, w, h, slots);
                cr.$dispose(); // GJS frees a context only on GC, which does not see Cairo's memory
            });
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

        // Opens the split dialog on the `baseCount` layout; nothing to split when it is missing or invalid.
        _openSplitDialog(baseCount, parent, onSplit) {
            let base;
            try {
                base = this._readLayouts().get(baseCount);
            } catch {
                return;
            }
            if (base) openSplitDialog(base, parent, onSplit);
        }
    },
);
