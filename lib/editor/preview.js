import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import { LayoutParser } from '../layout.js';

export const LayoutPreviewPage = GObject.registerClass(
class LayoutPreviewPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({ title: 'Preview', icon_name: 'view-grid-symbolic' });
        this.settings = settings;

        const previewGroup = new Adw.PreferencesGroup({ title: 'Escalator Layout Previews' });
        this.add(previewGroup);

        const previewContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12
        });
        previewGroup.add(previewContainer);

        this._changedId = this.settings.connect('changed::custom-layouts', () => this.rebuild(previewContainer));
        this.rebuild(previewContainer);
    }

    rebuild(previewContainer) {
        // Remove existing widgets from the safe Gtk.Box container
        let child = previewContainer.get_first_child();
        while (child) {
            previewContainer.remove(child);
            child = previewContainer.get_first_child();
        }

        const customJson = this.settings.get_string('custom-layouts');
        let escalator = null;
        try {
            escalator = LayoutParser.parse(customJson);
        } catch (e) {
            const errorLabel = new Gtk.Label({
                label: `Invalid Layout JSON:\n${e.message}`,
                css_classes: ['error', 'title-4'],
                margin_start: 24,
                margin_end: 24,
                margin_top: 24,
                margin_bottom: 24,
                justify: Gtk.Justification.CENTER
            });
            previewContainer.append(errorLabel);
            return;
        }

        if (!escalator) {
            const emptyLabel = new Gtk.Label({
                label: 'No layouts configured.',
                margin_start: 24,
                margin_top: 24
            });
            previewContainer.append(emptyLabel);
            return;
        }

        const counts = Array.from(escalator._layouts.keys()).sort((a, b) => a - b);
        const flowBox = new Gtk.FlowBox({
            max_children_per_line: 3,
            min_children_per_line: 1,
            column_spacing: 18,
            row_spacing: 18,
            selection_mode: Gtk.SelectionMode.NONE,
            margin_start: 12,
            margin_end: 12,
            margin_top: 12,
            margin_bottom: 12
        });
        previewContainer.append(flowBox);

        for (const count of counts) {
            const layout = escalator.getLayoutForCount(count);
            if (!layout) continue;

            const itemBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_start: 12,
                margin_end: 12,
                margin_top: 12,
                margin_bottom: 12,
                css_classes: ['card']
            });

            const label = new Gtk.Label({
                label: `Layout for ${count} Window${count > 1 ? 's' : ''}`,
                css_classes: ['title-4'],
                halign: Gtk.Align.CENTER,
                margin_top: 8
            });
            itemBox.append(label);

            const drawingArea = new Gtk.DrawingArea({
                width_request: 240,
                height_request: 150,
                margin_bottom: 8,
                margin_start: 8,
                margin_end: 8
            });

            drawingArea.set_draw_func((area, cr, w, h) => {
                // Get primary monitor aspect ratio
                let aspect = 16 / 10;
                const display = Gdk.Display.get_default();
                const monitors = display ? display.get_monitors() : null;
                if (monitors && monitors.get_n_items() > 0) {
                    const primaryMonitor = monitors.get_item(0);
                    const rect = primaryMonitor.get_geometry();
                    if (rect && rect.width > 0 && rect.height > 0) {
                        aspect = rect.width / rect.height;
                    }
                }

                // Fit aspect ratio inside the drawing area width `w` and height `h`
                const outerMargin = 8.0;
                const availableW = w - 2 * outerMargin;
                const availableH = h - 2 * outerMargin;

                let drawW = availableW;
                let drawH = availableW / aspect;

                if (drawH > availableH) {
                    drawH = availableH;
                    drawW = availableH * aspect;
                }

                // Center the drawn monitor area inside the drawing area
                const monitorX = outerMargin + (availableW - drawW) / 2;
                const monitorY = outerMargin + (availableH - drawH) / 2;

                // Monitor area (dark container background)
                cr.setSourceRGBA(0.12, 0.12, 0.14, 1.0);
                cr.rectangle(monitorX, monitorY, drawW, drawH);
                cr.fill();

                // Monitor border
                cr.setSourceRGBA(0.25, 0.25, 0.28, 1.0);
                cr.setLineWidth(2.0);
                cr.rectangle(monitorX, monitorY, drawW, drawH);
                cr.stroke();

                // Resolve system accent color from GTK style context
                let accentR = 0.14, accentG = 0.48, accentB = 0.85; // Fallback vibrant blue
                try {
                    const styleCtx = area.get_style_context();
                    let [success, color] = styleCtx.lookup_color('accent_bg_color');
                    if (!success) {
                        [success, color] = styleCtx.lookup_color('accent_color');
                    }
                    if (!success) {
                        [success, color] = styleCtx.lookup_color('theme_selected_bg_color');
                    }
                    if (success && color) {
                        accentR = color.red;
                        accentG = color.green;
                        accentB = color.blue;
                    }
                } catch (e) {}

                // Estates rendering
                const gap = 4.0;
                layout.estates.forEach((estate, idx) => {
                    const margin = 8.0;
                    const innerW = drawW - 2 * margin;
                    const innerH = drawH - 2 * margin;

                    const ex = monitorX + margin + innerW * (estate.pct_x / 100) + gap / 2;
                    const ey = monitorY + margin + innerH * (estate.pct_y / 100) + gap / 2;
                    const ew = innerW * (estate.pct_w / 100) - gap;
                    const eh = innerH * (estate.pct_h / 100) - gap;

                    if (ew <= 0 || eh <= 0) return;

                    // Categorical palette starting with resolved system accent color
                    const colors = [
                        { r: accentR, g: accentG, b: accentB }, // Dynamic System Accent Color
                        { r: 0.08, g: 0.63, b: 0.52 },           // Emerald Teal
                        { r: 0.52, g: 0.34, b: 0.82 },           // Rich Purple
                        { r: 0.86, g: 0.38, b: 0.18 },           // Warm Coral
                        { r: 0.72, g: 0.68, b: 0.08 }            // Gold/Amber
                    ];
                    const c = colors[idx % colors.length];

                    // Rounded estate shape
                    const radius = 4.0;
                    cr.newSubPath();
                    cr.arc(ex + radius, ey + radius, radius, Math.PI, 1.5 * Math.PI);
                    cr.arc(ex + ew - radius, ey + radius, radius, 1.5 * Math.PI, 2 * Math.PI);
                    cr.arc(ex + ew - radius, ey + eh - radius, radius, 0, 0.5 * Math.PI);
                    cr.arc(ex + radius, ey + eh - radius, radius, 0.5 * Math.PI, Math.PI);
                    cr.closePath();

                    cr.setSourceRGBA(c.r, c.g, c.b, 0.75);
                    cr.fillPreserve();

                    cr.setSourceRGBA(c.r + 0.1, c.g + 0.1, c.b + 0.1, 1.0);
                    cr.setLineWidth(1.5);
                    cr.stroke();

                    // Centered slot ID text label
                    cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
                    cr.selectFontFace("Sans", 0, 0);
                    cr.setFontSize(14.0);
                    
                    const text = `${idx + 1}`;
                    const extents = cr.textExtents(text);
                    const tx = ex + (ew / 2) - (extents.width / 2) - extents.x_bearing;
                    const ty = ey + (eh / 2) - (extents.height / 2) - extents.y_bearing;
                    
                    cr.moveTo(tx, ty);
                    cr.showText(text);
                });
            });

            itemBox.append(drawingArea);
            flowBox.append(itemBox);
        }
    }
});
