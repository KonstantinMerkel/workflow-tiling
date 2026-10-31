import Gdk from 'gi://Gdk';
import { slotColor } from './draft.js';

// Drawing of a layout draft on a Cairo context, and mapping pointer positions back to percent.

const PAD = 8; // monitor bezel and its distance to the widget border, in px
const GAP = 4; // gap between drawn slots, in px

function monitorAspect() {
    const monitors = Gdk.Display.get_default()?.get_monitors();
    const rect = monitors?.get_n_items() > 0 ? monitors.get_item(0).get_geometry() : null;
    return rect?.width > 0 && rect?.height > 0 ? rect.width / rect.height : 16 / 10;
}

// Draws a monitor holding `slots` centred in a width×height area and returns the pixel frame
// {x, y, w, h} that maps 0..100 percent, for hit-testing pointer positions against the drawing.
export function drawLayout(cr, width, height, slots, highlight = -1) {
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

// Dashed line where slot `s` would be split at `pos` percent along `axis`.
export function drawCut(cr, frame, s, axis, pos) {
    const at = Math.round(pos);
    const [x1, y1, x2, y2] = axis === 'x' ? [at, s.y, at, s.y + s.h] : [s.x, at, s.x + s.w, at];
    cr.setSourceRGBA(1, 1, 1, 0.8);
    cr.setLineWidth(2);
    cr.setDash([6, 4], 0);
    cr.moveTo(frame.x + (frame.w * x1) / 100, frame.y + (frame.h * y1) / 100);
    cr.lineTo(frame.x + (frame.w * x2) / 100, frame.y + (frame.h * y2) / 100);
    cr.stroke();
}

export function toPercent(frame, px, py) {
    return { x: ((px - frame.x) / frame.w) * 100, y: ((py - frame.y) / frame.h) * 100 };
}
