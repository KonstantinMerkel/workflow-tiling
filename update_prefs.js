const fs = require('fs');

let content = fs.readFileSync('prefs.js', 'utf8');

const drawSlotsSrc = `function _leDrawSlots(cr, width, height, slots, accent, hoverX = -1, hoverY = -1, hoverSlotIdx = -1) {
    const { r, g, b } = accent;
    // Background
    cr.setSourceRGB(0.10, 0.10, 0.13);
    cr.rectangle(0, 0, width, height);
    cr.fill();
    // Border
    cr.setSourceRGB(0.28, 0.28, 0.32);
    cr.setLineWidth(1);
    cr.rectangle(0.5, 0.5, width - 1, height - 1);
    cr.stroke();

    slots.forEach((s, i) => {
        const sx = width * s.x / 100;
        const sy = height * s.y / 100;
        const sw = width * s.w / 100;
        const sh = height * s.h / 100;

        const bright = (hoverX >= 0 && i === hoverSlotIdx) ? 0.75 : 0.45;
        
        // Slot background (faint)
        cr.setSourceRGBA(r * bright, g * bright, b * bright, 0.3);
        cr.rectangle(sx, sy, sw, sh);
        cr.fill();

        // Slot border
        cr.setSourceRGBA(r * 0.4, g * 0.4, b * 0.4, 0.8);
        cr.setLineWidth(1);
        cr.rectangle(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
        cr.stroke();

        // Inner window (dashed)
        const d_gapLeft = s.x <= 0.01 ? 6 : 3;
        const d_gapRight = (s.x + s.w) >= 99.99 ? 6 : 3;
        const d_gapTop = s.y <= 0.01 ? 6 : 3;
        const d_gapBot = (s.y + s.h) >= 99.99 ? 6 : 3;
        
        const wx = Math.round(sx + d_gapLeft);
        const wy = Math.round(sy + d_gapTop);
        const ww = Math.round(sw - d_gapLeft - d_gapRight);
        const wh = Math.round(sh - d_gapTop - d_gapBot);

        if (ww > 0 && wh > 0) {
            cr.setSourceRGBA(r * bright, g * bright, b * bright, 0.7);
            cr.rectangle(wx, wy, ww, wh);
            cr.fill();
            cr.setSourceRGB(r, g, b);
            cr.setLineWidth(1.5);
            cr.setDash([4, 4], 0);
            cr.rectangle(wx + 0.5, wy + 0.5, ww - 1, wh - 1);
            cr.stroke();
            cr.setDash([], 0);
        }
    });

    // Crosshair hover indicator (only when no cut applied yet)
    if (hoverX >= 0 && hoverSlotIdx >= 0) {
        const s = slots[hoverSlotIdx];
        // Horizontal guide line (left-click = horizontal split)
        cr.setSourceRGBA(r, g, b, 0.7);
        cr.setLineWidth(1.5);
        cr.setDash([5, 3], 0);
        const slotLeft = width * s.x / 100;
        const slotRight = width * (s.x + s.w) / 100;
        cr.moveTo(slotLeft, hoverY);
        cr.lineTo(slotRight, hoverY);
        cr.stroke();
        // Vertical guide line (right-click = vertical split)
        cr.setSourceRGBA(r * 0.6, g * 0.6, b * 0.6, 0.7);
        const slotTop = height * s.y / 100;
        const slotBot = height * (s.y + s.h) / 100;
        cr.moveTo(hoverX, slotTop);
        cr.lineTo(hoverX, slotBot);
        cr.stroke();
        cr.setDash([], 0);
    }
}`;

const dragEditorSrc = `function _leDragEditorDialog(prefWindow, prevSlots, onApply, settings) {
    const accent = _leGetAccentColor();
    const dims = _leCardDims(600); // larger canvas for precise edits

    let currentSlots = [...prevSlots];
    let cutApplied = false;
    let hoverX = -1, hoverY = -1, hoverSlotIdx = -1;
    let isVerticalCut = false;
    let splitSlotIdx = -1;

    const dialog = new Adw.Dialog({ title: 'Split a Slot', content_width: dims.w + 80, content_height: dims.h + 200 });
    const toolbar = new Adw.ToolbarView();
    dialog.set_child(toolbar);
    toolbar.add_top_bar(new Adw.HeaderBar());

    const outer = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_start: 20, margin_end: 20,
        margin_top: 12, margin_bottom: 20,
    });
    toolbar.set_content(outer);

    const hint = new Gtk.Label({
        label: '⬍ Double-left: horizontal split   ⬌ Double-right: vertical split',
        css_classes: ['dim-label', 'caption'],
        halign: Gtk.Align.CENTER,
    });
    outer.append(hint);

    // Use Fixed overlay for entries
    const fixed = new Gtk.Fixed();
    fixed.set_size_request(dims.w, dims.h);
    fixed.set_halign(Gtk.Align.CENTER);
    outer.append(fixed);

    const canvas = new Gtk.DrawingArea();
    canvas.set_content_width(dims.w);
    canvas.set_content_height(dims.h);
    canvas.set_cursor(Gdk.Cursor.new_from_name('crosshair', null));
    canvas.set_draw_func((_w, cr, w, h) => {
        const hy = cutApplied ? -1 : hoverY;
        const hx = cutApplied ? -1 : hoverX;
        const hi = cutApplied ? -1 : hoverSlotIdx;
        _leDrawSlots(cr, w, h, currentSlots, accent, hx, hy, hi);
    });
    fixed.put(canvas, 0, 0);

    const status = new Gtk.Label({
        label: 'Hover over a slot and double-click to split it.',
        halign: Gtk.Align.CENTER,
        css_classes: ['dim-label'],
    });
    outer.append(status);

    const btnRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, halign: Gtk.Align.END });
    const cancelBtn = new Gtk.Button({ label: 'Cancel' });
    cancelBtn.connect('clicked', () => dialog.close());
    const resetBtn = new Gtk.Button({ label: 'Reset', visible: false });
    const applyBtn = new Gtk.Button({ label: 'Apply', css_classes: ['suggested-action'], sensitive: false });
    btnRow.append(cancelBtn);
    btnRow.append(resetBtn);
    btnRow.append(applyBtn);
    outer.append(btnRow);

    // Overlay updates
    function updateOverlays() {
        let child = fixed.get_first_child();
        while (child) {
            let next = child.get_next_sibling();
            if (child !== canvas) fixed.remove(child);
            child = next;
        }

        const gaps = {
            inner: settings ? settings.get_int('inner-gaps') : 6,
            outer: settings ? settings.get_int('outer-gaps') : 4
        };

        let realW = 1920, realH = 1080;
        try {
            const display = Gdk.Display.get_default();
            const mon = display.get_monitors().get_item(0) || display.get_primary_monitor();
            if (mon) {
                const geo = mon.get_geometry();
                if (geo.width > 0) { realW = geo.width; realH = geo.height; }
            }
        } catch(e) {}

        currentSlots.forEach((s, idx) => {
            const slotLeft = s.x <= 0.01 ? gaps.outer : gaps.inner / 2;
            const slotRight = (s.x + s.w) >= 99.99 ? gaps.outer : gaps.inner / 2;
            const slotTop = s.y <= 0.01 ? gaps.outer : gaps.inner / 2;
            const slotBot = (s.y + s.h) >= 99.99 ? gaps.outer : gaps.inner / 2;
            
            const innerPxW = Math.round((realW * s.w / 100) - slotLeft - slotRight);
            const innerPxH = Math.round((realH * s.h / 100) - slotTop - slotBot);
            
            const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 2 });
            const entryW = new Gtk.Entry({ text: innerPxW.toString(), width_chars: 4, css_classes: ['flat', 'numeric'] });
            const entryH = new Gtk.Entry({ text: innerPxH.toString(), width_chars: 4, css_classes: ['flat', 'numeric'] });
            const lbl = new Gtk.Label({ text: 'x', css_classes: ['dim-label'] });
            
            entryW.set_alignment(0.5);
            entryH.set_alignment(0.5);
            box.append(entryW);
            box.append(lbl);
            box.append(entryH);
            
            const isCutSlot = cutApplied && (idx === splitSlotIdx || idx === currentSlots.length - 1);
            entryW.set_sensitive(isCutSlot);
            entryH.set_sensitive(isCutSlot);
            
            if (isCutSlot) {
                box.add_css_class('linked');
            }

            const onEdit = () => {
                const nw = parseInt(entryW.get_text(), 10);
                const nh = parseInt(entryH.get_text(), 10);
                if (isNaN(nw) || isNaN(nh) || nw <= 0 || nh <= 0) {
                    updateOverlays();
                    return;
                }
                
                if (isVerticalCut) {
                    const targetSlotW = (nw + slotLeft + slotRight) / realW * 100;
                    let cutPct = idx === splitSlotIdx ? (s.x + targetSlotW) : ((s.x + s.w) - targetSlotW);
                    currentSlots = _leApplyCutAt(prevSlots, splitSlotIdx, isVerticalCut, cutPct);
                } else {
                    const targetSlotH = (nh + slotTop + slotBot) / realH * 100;
                    let cutPct = idx === splitSlotIdx ? (s.y + targetSlotH) : ((s.y + s.h) - targetSlotH);
                    currentSlots = _leApplyCutAt(prevSlots, splitSlotIdx, isVerticalCut, cutPct);
                }
                canvas.queue_draw();
                updateOverlays();
            };

            entryW.connect('activate', onEdit);
            entryH.connect('activate', onEdit);

            const centerCanvasX = dims.w * (s.x + s.w / 100); // FIX: this is w, need w/2
            const adjustedX = dims.w * (s.x + s.w / 2) / 100;
            const adjustedY = dims.h * (s.y + s.h / 2) / 100;
            fixed.put(box, adjustedX - 55, adjustedY - 17);
        });
    }

    // Helper: find slot index at canvas-pixel coords
    function slotAt(pixX, pixY, canvasW, canvasH) {
        const px = pixX / canvasW * 100;
        const py = pixY / canvasH * 100;
        for (let i = 0; i < currentSlots.length; i++) {
            const s = currentSlots[i];
            if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h)
                return i;
        }
        return -1;
    }

    // Motion hover
    const motion = new Gtk.EventControllerMotion();
    motion.connect('motion', (_ctrl, x, y) => {
        if (cutApplied) {
            const s1 = currentSlots[splitSlotIdx];
            const cw = canvas.get_width() || dims.w;
            const ch = canvas.get_height() || dims.h;
            let isNear = false;
            if (isVerticalCut) {
                const cutX = cw * (s1.x + s1.w) / 100;
                if (Math.abs(x - cutX) < 15) isNear = true;
            } else {
                const cutY = ch * (s1.y + s1.h) / 100;
                if (Math.abs(y - cutY) < 15) isNear = true;
            }
            canvas.set_cursor(Gdk.Cursor.new_from_name(isNear ? (isVerticalCut ? 'col-resize' : 'row-resize') : 'default', null));
            return;
        }
        hoverX = x;
        hoverY = y;
        hoverSlotIdx = slotAt(x, y, canvas.get_width() || dims.w, canvas.get_height() || dims.h);
        canvas.queue_draw();
    });
    motion.connect('leave', () => {
        if (!cutApplied) {
            hoverX = -1; hoverY = -1; hoverSlotIdx = -1;
            canvas.queue_draw();
        }
    });
    canvas.add_controller(motion);

    // Double Click handler
    const click = new Gtk.GestureClick();
    click.set_button(0); // any button
    click.connect('pressed', (gesture, nPress, x, y) => {
        if (nPress !== 2 || cutApplied) return;
        const cw = canvas.get_width() || dims.w;
        const ch = canvas.get_height() || dims.h;
        const idx = slotAt(x, y, cw, ch);
        if (idx < 0) return;

        const button = gesture.get_current_button();
        isVerticalCut = button === 3; // right-click → vertical divider
        splitSlotIdx = idx;
        const absPct = isVerticalCut ? (x / cw * 100) : (y / ch * 100);

        currentSlots = _leApplyCutAt(currentSlots, idx, isVerticalCut, absPct);
        cutApplied = true;
        hoverX = -1; hoverY = -1; hoverSlotIdx = -1;
        canvas.set_cursor(Gdk.Cursor.new_from_name('default', null));

        canvas.queue_draw();
        updateOverlays();
        status.set_label('Split applied. Drag the split line or type exact pixels (press Enter).');
        applyBtn.set_sensitive(true);
        resetBtn.set_visible(true);
    });
    canvas.add_controller(click);

    // Drag handle
    let draggingCut = false;
    const drag = new Gtk.GestureDrag();
    drag.connect('drag-begin', (gesture, startX, startY) => {
        if (!cutApplied) {
            gesture.set_state(Gtk.EventSequenceState.DENIED);
            return;
        }
        const s1 = currentSlots[splitSlotIdx];
        const cw = canvas.get_width() || dims.w;
        const ch = canvas.get_height() || dims.h;
        if (isVerticalCut) {
            const cutX = cw * (s1.x + s1.w) / 100;
            if (Math.abs(startX - cutX) < 15) {
                draggingCut = true;
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            } else {
                gesture.set_state(Gtk.EventSequenceState.DENIED);
            }
        } else {
            const cutY = ch * (s1.y + s1.h) / 100;
            if (Math.abs(startY - cutY) < 15) {
                draggingCut = true;
                gesture.set_state(Gtk.EventSequenceState.CLAIMED);
            } else {
                gesture.set_state(Gtk.EventSequenceState.DENIED);
            }
        }
    });
    drag.connect('drag-update', (gesture, offsetX, offsetY) => {
        if (!draggingCut) return;
        const cw = canvas.get_width() || dims.w;
        const ch = canvas.get_height() || dims.h;
        const startP = gesture.get_start_point();
        const startX = startP[1];
        const startY = startP[2];
        if (isVerticalCut) {
            const absPct = (startX + offsetX) / cw * 100;
            currentSlots = _leApplyCutAt(prevSlots, splitSlotIdx, true, absPct);
        } else {
            const absPct = (startY + offsetY) / ch * 100;
            currentSlots = _leApplyCutAt(prevSlots, splitSlotIdx, false, absPct);
        }
        canvas.queue_draw();
        updateOverlays();
    });
    drag.connect('drag-end', () => {
        draggingCut = false;
    });
    canvas.add_controller(drag);

    // Reset
    resetBtn.connect('clicked', () => {
        currentSlots = [...prevSlots];
        cutApplied = false;
        applyBtn.set_sensitive(false);
        resetBtn.set_visible(false);
        status.set_label('Hover over a slot and double-click to split it.');
        canvas.queue_draw();
        updateOverlays();
    });

    // Apply
    applyBtn.connect('clicked', () => {
        onApply(currentSlots);
        dialog.close();
    });

    dialog.present(prefWindow);
    updateOverlays(); // initial render
}`;

const startDraw = content.indexOf('function _leDrawSlots');
const endDraw = content.indexOf('function _leCard');
content = content.substring(0, startDraw) + drawSlotsSrc + '\n\n' + content.substring(endDraw);

const startDrag = content.indexOf('function _leDragEditorDialog');
const endDrag = content.indexOf('function _buildLayoutEditorPage');
content = content.substring(0, startDrag) + dragEditorSrc + '\n\n' + content.substring(endDrag);

// Also update the calls in _buildLayoutEditorPage to pass settings
content = content.replace(/_leDragEditorDialog\(prefWindow, escalator\[idx - 1\]\.slots, newSlots => \{/g, 
                          '_leDragEditorDialog(prefWindow, escalator[idx - 1].slots, newSlots => {');
content = content.replace(/_leDragEditorDialog\(prefWindow, escalator\[escalator\.length - 1\]\.slots, newSlots => \{/g, 
                          '_leDragEditorDialog(prefWindow, escalator[escalator.length - 1].slots, newSlots => {');

// I need to add `settings` to these calls:
content = content.replace(/_leDragEditorDialog\(prefWindow, escalator\[idx - 1\]\.slots, newSlots => \{/, 
                          '_leDragEditorDialog(prefWindow, escalator[idx - 1].slots, newSlots => {, settings'.replace(', settings', ''));
// actually let's just do a string replace on those specific lines:
content = content.replace('_leDragEditorDialog(prefWindow, escalator[idx - 1].slots, newSlots => {', '_leDragEditorDialog(prefWindow, escalator[idx - 1].slots, newSlots => {, settings'.replace(/, settings$/, ''));
// safer way:
content = content.replaceAll('_leDragEditorDialog(prefWindow, escalator[idx - 1].slots, newSlots => {', 
                             '_leDragEditorDialog(prefWindow, escalator[idx - 1].slots, newSlots => {, settings)'.replace(', settings)', ''));

fs.writeFileSync('prefs.js', content, 'utf8');
