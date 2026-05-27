import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import { LayoutParser } from '../layout.js';

// --- Math & Boundary Cut Logic Helpers ---

function getCuts(draftEstates) {
    const xSet = new Set();
    const ySet = new Set();
    draftEstates.forEach(e => {
        const x = Math.round(e.x);
        const xw = Math.round(e.x + e.w);
        const y = Math.round(e.y);
        const yh = Math.round(e.y + e.h);

        if (x > 0 && x < 100) xSet.add(x);
        if (xw > 0 && xw < 100) xSet.add(xw);
        if (y > 0 && y < 100) ySet.add(y);
        if (yh > 0 && yh < 100) ySet.add(yh);
    });
    return {
        x: Array.from(xSet).sort((a, b) => a - b),
        y: Array.from(ySet).sort((a, b) => a - b)
    };
}

function getXCutRange(draftEstates, xi) {
    let minVal = 5;
    let maxVal = 95;
    draftEstates.forEach(e => {
        const x = Math.round(e.x);
        const xw = Math.round(e.x + e.w);
        if (Math.abs(xw - xi) < 0.1) {
            minVal = Math.max(minVal, x + 5);
        }
        if (Math.abs(x - xi) < 0.1) {
            maxVal = Math.min(maxVal, x + e.w - 5);
        }
    });
    return [minVal, maxVal];
}

function getYCutRange(draftEstates, yi) {
    let minVal = 5;
    let maxVal = 95;
    draftEstates.forEach(e => {
        const y = Math.round(e.y);
        const yh = Math.round(e.y + e.h);
        if (Math.abs(yh - yi) < 0.1) {
            minVal = Math.max(minVal, y + 5);
        }
        if (Math.abs(y - yi) < 0.1) {
            maxVal = Math.min(maxVal, y + e.h - 5);
        }
    });
    return [minVal, maxVal];
}

function adjustXCut(draftEstates, xi, xNew) {
    draftEstates.forEach(e => {
        const x = Math.round(e.x);
        const xw = Math.round(e.x + e.w);
        if (Math.abs(x - xi) < 0.1) {
            e.x = xNew;
            e.w = Math.round(xw - xNew);
        } else if (Math.abs(xw - xi) < 0.1) {
            e.w = Math.round(xNew - e.x);
        }
    });
}

function adjustYCut(draftEstates, yi, yNew) {
    draftEstates.forEach(e => {
        const y = Math.round(e.y);
        const yh = Math.round(e.y + e.h);
        if (Math.abs(y - yi) < 0.1) {
            e.y = yNew;
            e.h = Math.round(yh - yNew);
        } else if (Math.abs(yh - yi) < 0.1) {
            e.h = Math.round(yNew - e.y);
        }
    });
}

function getSlotWidthRange(draftEstates, k) {
    const e = draftEstates[k];
    const x = Math.round(e.x);
    const xw = Math.round(e.x + e.w);
    if (xw < 100) {
        const [minCut, maxCut] = getXCutRange(draftEstates, xw);
        return [minCut - x, maxCut - x];
    } else if (x > 0) {
        const [minCut, maxCut] = getXCutRange(draftEstates, x);
        return [100 - maxCut, 100 - minCut];
    }
    return [100, 100];
}

function getSlotHeightRange(draftEstates, k) {
    const e = draftEstates[k];
    const y = Math.round(e.y);
    const yh = Math.round(e.y + e.h);
    if (yh < 100) {
        const [minCut, maxCut] = getYCutRange(draftEstates, yh);
        return [minCut - y, maxCut - y];
    } else if (y > 0) {
        const [minCut, maxCut] = getYCutRange(draftEstates, y);
        return [100 - maxCut, 100 - minCut];
    }
    return [100, 100];
}

function getDefaultSplit(layoutBase, targetCount) {
    let maxArea = -1;
    let maxIdx = 0;
    layoutBase.estates.forEach((e, idx) => {
        const area = e.pct_w * e.pct_h;
        if (area > maxArea) {
            maxArea = area;
            maxIdx = idx;
        }
    });

    const estate = layoutBase.estates[maxIdx];
    let e1, e2;
    if (estate.pct_w >= estate.pct_h) {
        const halfW = Math.round(estate.pct_w / 2);
        e1 = { x: estate.pct_x, y: estate.pct_y, w: halfW, h: estate.pct_h };
        e2 = { x: estate.pct_x + halfW, y: estate.pct_y, w: estate.pct_w - halfW, h: estate.pct_h };
    } else {
        const halfH = Math.round(estate.pct_h / 2);
        e1 = { x: estate.pct_x, y: estate.pct_y, w: estate.pct_w, h: halfH };
        e2 = { x: estate.pct_x, y: estate.pct_y + halfH, w: estate.pct_w, h: estate.pct_h - halfH };
    }

    const newLayoutEstates = [];
    layoutBase.estates.forEach((e, i) => {
        if (i === maxIdx) {
            newLayoutEstates.push(e1);
        } else {
            newLayoutEstates.push({ x: e.pct_x, y: e.pct_y, w: e.pct_w, h: e.pct_h });
        }
    });
    newLayoutEstates.push(e2);
    newLayoutEstates.forEach((item, i) => {
        item.id = i + 1;
    });

    return newLayoutEstates;
}

// --- Layout Preview & Editor Class ---

export const LayoutPreviewPage = GObject.registerClass(
class LayoutPreviewPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({ title: 'Layout Editor', icon_name: 'view-grid-symbolic' });
        this.settings = settings;

        this._editingCount = null;
        this._draftLayouts = null;

        const previewGroup = new Adw.PreferencesGroup({ title: 'Escalator Layout Previews' });
        this.add(previewGroup);

        const previewContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12
        });
        previewGroup.add(previewContainer);

        this._changedId = this.settings.connect('changed::custom-layouts', () => {
            if (this._editingCount === null) {
                this.rebuild(previewContainer);
            }
        });
        this.rebuild(previewContainer);
    }

    _initializeDrafts() {
        this._draftLayouts = new Map();
        const customJson = this.settings.get_string('custom-layouts');
        let data = {};
        try {
            data = JSON.parse(customJson || '{}');
        } catch (e) {}

        Object.keys(data).forEach(k => {
            const count = parseInt(k, 10);
            const arr = data[k];
            if (Array.isArray(arr)) {
                this._draftLayouts.set(count, arr.map(e => ({
                    x: Math.round(e.x),
                    y: Math.round(e.y),
                    w: Math.round(e.w),
                    h: Math.round(e.h),
                    id: parseInt(e.id || 1, 10)
                })));
            }
        });
    }

    _openSplitDialog(baseCount, targetCount, parentWindow, onSplitSuccess) {
        const customJson = this.settings.get_string('custom-layouts');
        let escalator = null;
        try {
            escalator = LayoutParser.parse(customJson);
        } catch (e) {}

        if (!escalator) return;
        const layoutBase = escalator.getLayoutForCount(baseCount);
        if (!layoutBase) return;

        const dialog = new Adw.Window({
            title: `Split Layout for ${targetCount} Windows`,
            modal: true,
            transient_for: parentWindow,
            default_width: 500,
            default_height: 500
        });

        const contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
        dialog.set_content(contentBox);

        const headerBar = new Adw.HeaderBar();
        const cancelBtn = new Gtk.Button({
            label: 'Stop',
            valign: Gtk.Align.CENTER
        });
        cancelBtn.connect('clicked', () => dialog.close());
        headerBar.pack_start(cancelBtn);

        const editBtn = new Gtk.Button({
            label: 'Go to Edit',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        editBtn.connect('clicked', () => {
            const defaultEstates = getDefaultSplit(layoutBase, targetCount);
            onSplitSuccess(defaultEstates);
            dialog.close();
        });
        headerBar.pack_end(editBtn);
        contentBox.append(headerBar);

        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_start: 18,
            margin_end: 18,
            margin_top: 12,
            margin_bottom: 18
        });
        contentBox.append(container);

        const instructions = new Gtk.Label({
            label: `Select split direction and click inside any slot of the ${baseCount}-window layout to split it.`,
            css_classes: ['title-4'],
            justify: Gtk.Justification.CENTER,
            wrap: true
        });
        container.append(instructions);

        const switcherBox = new Gtk.Box({ halign: Gtk.Align.CENTER, css_classes: ['linked'] });
        const btnVert = new Gtk.ToggleButton({ label: 'Vertical Split', active: true });
        const btnHoriz = new Gtk.ToggleButton({ label: 'Horizontal Split', group: btnVert });
        switcherBox.append(btnVert);
        switcherBox.append(btnHoriz);
        container.append(switcherBox);

        const splitArea = new Gtk.DrawingArea({
            width_request: 320,
            height_request: 200,
            hexpand: true,
            vexpand: true
        });
        container.append(splitArea);

        let hoverX = -1, hoverY = -1;
        let splitDirection = 'vertical';
        let monitorGeometry = null;

        btnVert.connect('toggled', () => {
            if (btnVert.active) {
                splitDirection = 'vertical';
                splitArea.queue_draw();
            }
        });
        btnHoriz.connect('toggled', () => {
            if (btnHoriz.active) {
                splitDirection = 'horizontal';
                splitArea.queue_draw();
            }
        });

        const getEstateAtCoords = (x, y) => {
            if (!monitorGeometry) return null;
            const innerX = x - monitorGeometry.x - monitorGeometry.marginX;
            const innerY = y - monitorGeometry.y - monitorGeometry.marginY;
            const pctX = (innerX / monitorGeometry.innerW) * 100;
            const pctY = (innerY / monitorGeometry.innerH) * 100;

            if (pctX < 0 || pctX > 100 || pctY < 0 || pctY > 100) return null;

            for (let idx = 0; idx < layoutBase.estates.length; idx++) {
                const e = layoutBase.estates[idx];
                if (pctX >= e.pct_x && pctX <= (e.pct_x + e.pct_w) &&
                    pctY >= e.pct_y && pctY <= (e.pct_y + e.pct_h)) {
                    return { estate: e, index: idx, pctX, pctY };
                }
            }
            return null;
        };

        splitArea.set_draw_func((area, cr, w, h) => {
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

            const outerMargin = 8.0;
            const availableW = w - 2 * outerMargin;
            const availableH = h - 2 * outerMargin;

            let drawW = availableW;
            let drawH = availableW / aspect;

            if (drawH > availableH) {
                drawH = availableH;
                drawW = availableH * aspect;
            }

            const monitorX = outerMargin + (availableW - drawW) / 2;
            const monitorY = outerMargin + (availableH - drawH) / 2;

            monitorGeometry = {
                x: monitorX,
                y: monitorY,
                w: drawW,
                h: drawH,
                innerW: drawW - 2 * 8.0,
                innerH: drawH - 2 * 8.0,
                marginX: 8.0,
                marginY: 8.0
            };

            cr.setSourceRGBA(0.12, 0.12, 0.14, 1.0);
            cr.rectangle(monitorX, monitorY, drawW, drawH);
            cr.fill();

            cr.setSourceRGBA(0.25, 0.25, 0.28, 1.0);
            cr.setLineWidth(2.0);
            cr.rectangle(monitorX, monitorY, drawW, drawH);
            cr.stroke();

            const gap = 4.0;
            let hoveredEstateInfo = null;

            if (hoverX >= 0 && hoverY >= 0) {
                hoveredEstateInfo = getEstateAtCoords(hoverX, hoverY);
            }

            layoutBase.estates.forEach((estate, idx) => {
                const ex = monitorX + monitorGeometry.marginX + monitorGeometry.innerW * (estate.pct_x / 100) + gap / 2;
                const ey = monitorY + monitorGeometry.marginY + monitorGeometry.innerH * (estate.pct_y / 100) + gap / 2;
                const ew = monitorGeometry.innerW * (estate.pct_w / 100) - gap;
                const eh = monitorGeometry.innerH * (estate.pct_h / 100) - gap;

                if (ew <= 0 || eh <= 0) return;

                const colors = [
                    { r: 0.14, g: 0.48, b: 0.85 },
                    { r: 0.08, g: 0.63, b: 0.52 },
                    { r: 0.52, g: 0.34, b: 0.82 },
                    { r: 0.86, g: 0.38, b: 0.18 },
                    { r: 0.72, g: 0.68, b: 0.08 }
                ];
                const c = colors[idx % colors.length];

                cr.newSubPath();
                const radius = 4.0;
                cr.arc(ex + radius, ey + radius, radius, Math.PI, 1.5 * Math.PI);
                cr.arc(ex + ew - radius, ey + radius, radius, 1.5 * Math.PI, 2 * Math.PI);
                cr.arc(ex + ew - radius, ey + eh - radius, radius, 0, 0.5 * Math.PI);
                cr.arc(ex + radius, ey + eh - radius, radius, 0.5 * Math.PI, Math.PI);
                cr.closePath();

                const isHovered = hoveredEstateInfo && hoveredEstateInfo.index === idx;
                cr.setSourceRGBA(c.r, c.g, c.b, isHovered ? 0.9 : 0.6);
                cr.fillPreserve();

                cr.setSourceRGBA(c.r + 0.15, c.g + 0.15, c.b + 0.15, 1.0);
                cr.setLineWidth(isHovered ? 2.5 : 1.5);
                cr.stroke();

                cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
                cr.selectFontFace("Sans", 0, 0);
                cr.setFontSize(16.0);
                const text = `${idx + 1}`;
                const extents = cr.textExtents(text);
                const tx = ex + (ew / 2) - (extents.width / 2) - extents.x_bearing;
                const ty = ey + (eh / 2) - (extents.height / 2) - extents.y_bearing;
                cr.moveTo(tx, ty);
                cr.showText(text);
            });

            if (hoveredEstateInfo) {
                const { estate, pctX, pctY } = hoveredEstateInfo;
                cr.setSourceRGBA(1.0, 1.0, 1.0, 0.8);
                cr.setLineWidth(2.0);
                cr.setDash([6.0, 4.0], 0);

                if (splitDirection === 'vertical') {
                    const splitXVal = Math.round(pctX);
                    if (splitXVal >= estate.pct_x + 5 && splitXVal <= estate.pct_x + estate.pct_w - 5) {
                        const lx = monitorX + monitorGeometry.marginX + monitorGeometry.innerW * (splitXVal / 100);
                        const ly1 = monitorY + monitorGeometry.marginY + monitorGeometry.innerH * (estate.pct_y / 100);
                        const ly2 = ly1 + monitorGeometry.innerH * (estate.pct_h / 100);
                        cr.moveTo(lx, ly1);
                        cr.lineTo(lx, ly2);
                        cr.stroke();
                    }
                } else {
                    const splitYVal = Math.round(pctY);
                    if (splitYVal >= estate.pct_y + 5 && splitYVal <= estate.pct_y + estate.pct_h - 5) {
                        const ly = monitorY + monitorGeometry.marginY + monitorGeometry.innerH * (splitYVal / 100);
                        const lx1 = monitorX + monitorGeometry.marginX + monitorGeometry.innerW * (estate.pct_x / 100);
                        const lx2 = lx1 + monitorGeometry.innerW * (estate.pct_w / 100);
                        cr.moveTo(lx1, ly);
                        cr.lineTo(lx2, ly);
                        cr.stroke();
                    }
                }
                cr.setDash([], 0);
            }
        });

        const motionCtrl = new Gtk.EventControllerMotion();
        motionCtrl.connect('motion', (ctrl, x, y) => {
            hoverX = x;
            hoverY = y;
            splitArea.queue_draw();
        });
        motionCtrl.connect('leave', () => {
            hoverX = -1;
            hoverY = -1;
            splitArea.queue_draw();
        });
        splitArea.add_controller(motionCtrl);

        const clickCtrl = new Gtk.GestureClick();
        clickCtrl.connect('pressed', (ctrl, n_press, x, y) => {
            const info = getEstateAtCoords(x, y);
            if (info) {
                const { estate, index, pctX, pctY } = info;
                let splitVal;
                let splitOk = false;
                let e1, e2;

                if (splitDirection === 'vertical') {
                    splitVal = Math.round(pctX);
                    if (splitVal >= estate.pct_x + 5 && splitVal <= estate.pct_x + estate.pct_w - 5) {
                        splitOk = true;
                        e1 = { x: estate.pct_x, y: estate.pct_y, w: splitVal - estate.pct_x, h: estate.pct_h, id: estate.id || (index + 1) };
                        e2 = { x: splitVal, y: estate.pct_y, w: estate.pct_x + estate.pct_w - splitVal, h: estate.pct_h, id: targetCount };
                    }
                } else {
                    splitVal = Math.round(pctY);
                    if (splitVal >= estate.pct_y + 5 && splitVal <= estate.pct_y + estate.pct_h - 5) {
                        splitOk = true;
                        e1 = { x: estate.pct_x, y: estate.pct_y, w: estate.pct_w, h: splitVal - estate.pct_y, id: estate.id || (index + 1) };
                        e2 = { x: estate.pct_x, y: splitVal, w: estate.pct_w, h: estate.pct_y + estate.pct_h - splitVal, id: targetCount };
                    }
                }

                if (splitOk) {
                    const newLayoutEstates = [];
                    layoutBase.estates.forEach((e, i) => {
                        if (i === index) {
                            newLayoutEstates.push(e1);
                        } else {
                            newLayoutEstates.push({ x: e.pct_x, y: e.pct_y, w: e.pct_w, h: e.pct_h, id: e.id || (i + 1) });
                        }
                    });
                    newLayoutEstates.push(e2);
                    newLayoutEstates.forEach((item, i) => {
                        item.id = i + 1;
                    });

                    onSplitSuccess(newLayoutEstates);
                    dialog.close();
                }
            }
        });
        splitArea.add_controller(clickCtrl);

        dialog.present();
    }

    rebuild(previewContainer) {
        let child = previewContainer.get_first_child();
        while (child) {
            previewContainer.remove(child);
            child = previewContainer.get_first_child();
        }

        if (this._editingCount !== null && !this._draftLayouts) {
            this._initializeDrafts();
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

        let counts = [];
        if (this._editingCount !== null && this._draftLayouts) {
            counts = Array.from(this._draftLayouts.keys()).sort((a, b) => a - b);
        } else if (escalator) {
            counts = Array.from(escalator._layouts.keys()).sort((a, b) => a - b);
        }

        if (counts.length === 0) {
            const emptyLabel = new Gtk.Label({
                label: 'No layouts configured.',
                margin_start: 24,
                margin_top: 24,
                margin_bottom: 24
            });
            previewContainer.append(emptyLabel);

            const addFirstBtn = new Gtk.Button({
                label: 'Add First Layout',
                css_classes: ['suggested-action'],
                halign: Gtk.Align.CENTER,
                margin_bottom: 24
            });
            addFirstBtn.connect('clicked', () => {
                const initial = { "1": [{ "x": 0, "y": 0, "w": 100, "h": 100, "id": 1 }] };
                this.settings.set_string('custom-layouts', JSON.stringify(initial, null, 2));
                this._editingCount = 1;
                this._initializeDrafts();
                this.rebuild(previewContainer);
            });
            previewContainer.append(addFirstBtn);
            return;
        }

        // Removed Gtk.FlowBox to stack items vertically without selection/hover effects

        let idx = 0;
        for (const count of counts) {
            if (idx > 0) {
                const arrow = new Gtk.Image({
                    icon_name: 'pan-down-symbolic',
                    css_classes: ['dim-label'],
                    margin_bottom: 4,
                    icon_size: Gtk.IconSize.LARGE
                });
                previewContainer.append(arrow);
            }

            const isEditingThis = (count === this._editingCount);
            let estates = [];

            if (isEditingThis) {
                estates = this._draftLayouts.get(count) || [];
            } else if (escalator) {
                const layout = escalator.getLayoutForCount(count);
                if (layout) {
                    estates = layout.estates.map((e, idx) => ({
                        x: Math.round(e.pct_x),
                        y: Math.round(e.pct_y),
                        w: Math.round(e.pct_w),
                        h: Math.round(e.pct_h),
                        id: e.id || (idx + 1)
                    }));
                }
            }

            if (estates.length === 0) continue;

            const itemBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_start: 12,
                margin_end: 12,
                margin_top: 12,
                margin_bottom: 12,
                halign: Gtk.Align.CENTER,
                css_classes: ['card']
            });

            // Card Header
            const headerBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 8,
                margin_top: 8,
                margin_start: 8,
                margin_end: 8,
                halign: Gtk.Align.END
            });
            if (!isEditingThis && count > 1) {
                const editBtn = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    tooltip_text: 'Edit layout',
                    css_classes: ['flat']
                });
                editBtn.connect('clicked', () => {
                    this._editingCount = count;
                    this._initializeDrafts();
                    this.rebuild(previewContainer);
                });
                headerBox.append(editBtn);

                const deleteBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Delete layout',
                    css_classes: ['flat', 'destructive-action']
                });
                deleteBtn.connect('clicked', () => {
                    const maxCount = Math.max(...counts);
                    if (count === maxCount) {
                        const currentData = JSON.parse(this.settings.get_string('custom-layouts') || '{}');
                        delete currentData[count];
                        this.settings.set_string('custom-layouts', JSON.stringify(currentData, null, 2));
                        this.rebuild(previewContainer);
                    } else {
                        // Cascading delete confirmation
                        const parentWindow = deleteBtn.get_root();
                        const dialog = new Adw.AlertDialog({
                            heading: 'Confirm Cascading Deletion',
                            body: `Deleting the layout for ${count} windows will also delete all subsequent layouts (${counts.filter(c => c > count).join(', ')} windows) to maintain sequence.`
                        });
                        dialog.add_response('cancel', 'Stop');
                        if (count > 1) {
                            dialog.add_response('redo', 'Redo Split Instead');
                            dialog.set_response_appearance('redo', Adw.ResponseAppearance.SUGGESTED);
                        }
                        dialog.add_response('delete', 'Do (Delete All Subsequent)');
                        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
                        
                        dialog.connect('response', (self, response) => {
                            if (response === 'delete') {
                                const currentData = JSON.parse(this.settings.get_string('custom-layouts') || '{}');
                                Object.keys(currentData).forEach(k => {
                                    const cVal = parseInt(k, 10);
                                    if (cVal >= count) {
                                        delete currentData[k];
                                    }
                                });
                                this.settings.set_string('custom-layouts', JSON.stringify(currentData, null, 2));
                                // rebuild is handled by the 'changed::custom-layouts' signal listener
                            } else if (response === 'redo') {
                                // Transition into edit mode for this count
                                this._editingCount = count;
                                this._initializeDrafts();
                                this.rebuild(previewContainer);
                                
                                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                    this._openSplitDialog(count - 1, count, parentWindow, (newEstates) => {
                                        const draft = this._draftLayouts.get(count);
                                        if (draft) {
                                            draft.length = 0;
                                            newEstates.forEach(e => draft.push(e));
                                            this.rebuild(previewContainer);
                                        }
                                    });
                                    return GLib.SOURCE_REMOVE;
                                });
                            }
                        });
                        dialog.present(parentWindow);
                    }
                });
                headerBox.append(deleteBtn);
            }
            itemBox.append(headerBox);

            // Drawing Area Visual representation
            const drawingArea = new Gtk.DrawingArea({
                width_request: 240,
                height_request: 150,
                margin_bottom: 8,
                margin_start: 8,
                margin_end: 8
            });

            let monitorGeometry = null;

            drawingArea.set_draw_func((area, cr, w, h) => {
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

                const outerMargin = 8.0;
                const availableW = w - 2 * outerMargin;
                const availableH = h - 2 * outerMargin;

                let drawW = availableW;
                let drawH = availableW / aspect;

                if (drawH > availableH) {
                    drawH = availableH;
                    drawW = availableH * aspect;
                }

                const monitorX = outerMargin + (availableW - drawW) / 2;
                const monitorY = outerMargin + (availableH - drawH) / 2;
                
                const margin = 8.0;
                const innerW = drawW - 2 * margin;
                const innerH = drawH - 2 * margin;
                
                monitorGeometry = { x: monitorX + margin, y: monitorY + margin, w: innerW, h: innerH };

                cr.setSourceRGBA(0.12, 0.12, 0.14, 1.0);
                cr.rectangle(monitorX, monitorY, drawW, drawH);
                cr.fill();

                cr.setSourceRGBA(0.25, 0.25, 0.28, 1.0);
                cr.setLineWidth(2.0);
                cr.rectangle(monitorX, monitorY, drawW, drawH);
                cr.stroke();

                let accentR = 0.14, accentG = 0.48, accentB = 0.85;
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

                const gap = 4.0;
                estates.forEach((estate, idx) => {
                    const ex = monitorGeometry.x + monitorGeometry.w * (estate.x / 100) + gap / 2;
                    const ey = monitorGeometry.y + monitorGeometry.h * (estate.y / 100) + gap / 2;
                    const ew = monitorGeometry.w * (estate.w / 100) - gap;
                    const eh = monitorGeometry.h * (estate.h / 100) - gap;

                    if (ew <= 0 || eh <= 0) return;

                    const colors = [
                        { r: accentR, g: accentG, b: accentB },
                        { r: 0.08, g: 0.63, b: 0.52 },
                        { r: 0.52, g: 0.34, b: 0.82 },
                        { r: 0.86, g: 0.38, b: 0.18 },
                        { r: 0.72, g: 0.68, b: 0.08 }
                    ];
                    const c = colors[idx % colors.length];

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

                    // Centered Slot number
                    cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
                    cr.selectFontFace("Sans", 0, 0);
                    cr.setFontSize(14.0);

                    const slotText = `${idx + 1}`;
                    const slotExt = cr.textExtents(slotText);
                    const tx = ex + (ew / 2) - (slotExt.width / 2) - slotExt.x_bearing;
                    const ty = ey + (eh / 2) - (slotExt.height / 2) - slotExt.y_bearing - 6;

                    cr.moveTo(tx, ty);
                    cr.showText(slotText);

                    // Centered Slot Dimensions
                    cr.setFontSize(9.0);
                    const dimText = `${Math.round(estate.w)}%×${Math.round(estate.h)}%`;
                    const dimExt = cr.textExtents(dimText);
                    const sx = ex + (ew / 2) - (dimExt.width / 2) - dimExt.x_bearing;
                    const sy = ey + (eh / 2) - (dimExt.height / 2) - dimExt.y_bearing + 10;

                    cr.moveTo(sx, sy);
                    cr.showText(dimText);
                });
            });
            itemBox.append(drawingArea);

            // Expandable Local Editing Panel
            if (isEditingThis) {
                const editPanel = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: 10,
                    margin_top: 8,
                    margin_bottom: 8,
                    margin_start: 12,
                    margin_end: 12
                });
                itemBox.append(editPanel);
                
                // Drag and Hover for drawingArea
                let hoverCutX = -1;
                let hoverCutY = -1;
                let draggingCutX = -1;
                let draggingCutY = -1;

                const getCutAtPx = (px, py) => {
                    if (!monitorGeometry) return { x: -1, y: -1 };
                    const pctX = (px - monitorGeometry.x) / monitorGeometry.w * 100;
                    const pctY = (py - monitorGeometry.y) / monitorGeometry.h * 100;
                    
                    const cuts = getCuts(estates);
                    let foundX = -1, foundY = -1;
                    
                    if (pctY >= 0 && pctY <= 100) {
                        for (const cx of cuts.x) {
                            const cutPx = monitorGeometry.x + (cx / 100) * monitorGeometry.w;
                            if (Math.abs(px - cutPx) < 8) foundX = cx;
                        }
                    }
                    if (pctX >= 0 && pctX <= 100) {
                        for (const cy of cuts.y) {
                            const cutPy = monitorGeometry.y + (cy / 100) * monitorGeometry.h;
                            if (Math.abs(py - cutPy) < 8) foundY = cy;
                        }
                    }
                    return { x: foundX, y: foundY };
                };

                const motion = new Gtk.EventControllerMotion();
                motion.connect('motion', (ctrl, x, y) => {
                    if (draggingCutX !== -1 || draggingCutY !== -1) return;
                    const cut = getCutAtPx(x, y);
                    hoverCutX = cut.x;
                    hoverCutY = cut.y;
                    
                    let cursor = 'default';
                    if (hoverCutX !== -1 && hoverCutY !== -1) cursor = 'all-scroll';
                    else if (hoverCutX !== -1) cursor = 'col-resize';
                    else if (hoverCutY !== -1) cursor = 'row-resize';
                    
                    drawingArea.set_cursor(Gdk.Cursor.new_from_name(cursor, null));
                });
                motion.connect('leave', () => {
                    if (draggingCutX === -1 && draggingCutY === -1) {
                        hoverCutX = -1;
                        hoverCutY = -1;
                        drawingArea.set_cursor(Gdk.Cursor.new_from_name('default', null));
                    }
                });
                drawingArea.add_controller(motion);

                const drag = new Gtk.GestureDrag();
                drag.connect('drag-begin', (gesture, startX, startY) => {
                    const cut = getCutAtPx(startX, startY);
                    if (cut.x !== -1 || cut.y !== -1) {
                        draggingCutX = cut.x;
                        draggingCutY = cut.y;
                        gesture.set_state(Gtk.EventSequenceState.CLAIMED);
                    } else {
                        gesture.set_state(Gtk.EventSequenceState.DENIED);
                    }
                });
                drag.connect('drag-update', (gesture, offsetX, offsetY) => {
                    if (draggingCutX === -1 && draggingCutY === -1) return;
                    if (!monitorGeometry) return;
                    
                    const startP = gesture.get_start_point();
                    const newPxX = startP[1] + offsetX;
                    const newPxY = startP[2] + offsetY;
                    
                    let newPctX = (newPxX - monitorGeometry.x) / monitorGeometry.w * 100;
                    let newPctY = (newPxY - monitorGeometry.y) / monitorGeometry.h * 100;
                    
                    newPctX = Math.max(5, Math.min(95, newPctX));
                    newPctY = Math.max(5, Math.min(95, newPctY));
                    
                    let updated = false;
                    if (draggingCutX !== -1) {
                        const [minX, maxX] = getXCutRange(estates, draggingCutX);
                        let clampedX = Math.max(minX, Math.min(maxX, newPctX));
                        adjustXCut(estates, draggingCutX, clampedX);
                        draggingCutX = clampedX;
                        updated = true;
                    }
                    if (draggingCutY !== -1) {
                        const [minY, maxY] = getYCutRange(estates, draggingCutY);
                        let clampedY = Math.max(minY, Math.min(maxY, newPctY));
                        adjustYCut(estates, draggingCutY, clampedY);
                        draggingCutY = clampedY;
                        updated = true;
                    }
                    
                    if (updated) {
                        drawingArea.queue_draw();
                        // Debounce UI update
                        if (this._updateTimeout) GLib.source_remove(this._updateTimeout);
                        this._updateTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                            refreshEditors();
                            this._updateTimeout = null;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                });
                drag.connect('drag-end', () => {
                    draggingCutX = -1;
                    draggingCutY = -1;
                    drawingArea.set_cursor(Gdk.Cursor.new_from_name('default', null));
                });
                drawingArea.add_controller(drag);

                const refreshEditors = () => {
                    let cChild = editPanel.get_first_child();
                    while (cChild) {
                        editPanel.remove(cChild);
                        cChild = editPanel.get_first_child();
                    }

                    let accentR = 0.14, accentG = 0.48, accentB = 0.85;
                    try {
                        const styleCtx = drawingArea.get_style_context();
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

                    const toHex = (val) => {
                        const hex = Math.round(val * 255).toString(16);
                        return hex.length === 1 ? '0' + hex : hex;
                    };
                    const accentHex = `#${toHex(accentR)}${toHex(accentG)}${toHex(accentB)}`;

                    const colors = [
                        { hex: accentHex },
                        { hex: '#14a084' },
                        { hex: '#8456d1' },
                        { hex: '#db602d' },
                        { hex: '#b7ad14' }
                    ];

                    const slotsHeader = new Gtk.Label({
                        label: '<b>Slot Percentages</b>',
                        use_markup: true,
                        halign: Gtk.Align.START,
                        margin_bottom: 6
                    });
                    editPanel.append(slotsHeader);

                    estates.forEach((estate, k) => {
                        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, margin_bottom: 4 });

                        const c = colors[k % colors.length];
                        const label = new Gtk.Label({
                            label: `<span foreground="${c.hex}">●</span> Slot ${estate.id || (k + 1)}:`,
                            use_markup: true,
                            width_request: 80,
                            halign: Gtk.Align.START
                        });
                        row.append(label);

                        // Width spinner
                        const [minW, maxW] = getSlotWidthRange(estates, k);
                        const wLabel = new Gtk.Label({ label: 'W:' });
                        const wSpinner = new Gtk.SpinButton({
                            adjustment: new Gtk.Adjustment({ lower: minW, upper: maxW, step_increment: 1, value: estate.w }),
                            numeric: true
                        });
                        row.append(wLabel);
                        row.append(wSpinner);

                        // Height spinner
                        const [minH, maxH] = getSlotHeightRange(estates, k);
                        const hLabel = new Gtk.Label({ label: 'H:' });
                        const hSpinner = new Gtk.SpinButton({
                            adjustment: new Gtk.Adjustment({ lower: minH, upper: maxH, step_increment: 1, value: estate.h }),
                            numeric: true
                        });
                        row.append(hLabel);
                        row.append(hSpinner);
                        editPanel.append(row);

                        let updatingW = false;
                        wSpinner.connect('value-changed', () => {
                            if (updatingW) return;
                            updatingW = true;
                            const wNew = Math.round(wSpinner.adjustment.value);
                            const x = Math.round(estate.x);
                            const xw = Math.round(estate.x + estate.w);
                            if (xw < 100) {
                                adjustXCut(estates, xw, x + wNew);
                            } else if (x > 0) {
                                adjustXCut(estates, x, 100 - wNew);
                            }
                            drawingArea.queue_draw();
                            updatingW = false;
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                refreshEditors();
                                return GLib.SOURCE_REMOVE;
                            });
                        });

                        let updatingH = false;
                        hSpinner.connect('value-changed', () => {
                            if (updatingH) return;
                            updatingH = true;
                            const hNew = Math.round(hSpinner.adjustment.value);
                            const y = Math.round(estate.y);
                            const yh = Math.round(estate.y + estate.h);
                            if (yh < 100) {
                                adjustYCut(estates, yh, y + hNew);
                            } else if (y > 0) {
                                adjustYCut(estates, y, 100 - hNew);
                            }
                            drawingArea.queue_draw();
                            updatingH = false;
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                refreshEditors();
                                return GLib.SOURCE_REMOVE;
                            });
                        });
                    });

                    // Action buttons
                    const btnBox = new Gtk.Box({
                        orientation: Gtk.Orientation.HORIZONTAL,
                        spacing: 8,
                        halign: Gtk.Align.END,
                        margin_top: 12
                    });

                    if (count > 1) {
                        const redoBtn = new Gtk.Button({
                            label: 'Redo Split',
                            css_classes: ['destructive-action']
                        });
                        redoBtn.connect('clicked', () => {
                            this._openSplitDialog(count - 1, count, redoBtn.get_root(), (newEstates) => {
                                estates.length = 0;
                                newEstates.forEach(e => estates.push(e));
                                drawingArea.queue_draw();
                                refreshEditors();
                            });
                        });
                        btnBox.append(redoBtn);
                    }

                    const cancelBtn = new Gtk.Button({ label: 'Cancel' });
                    cancelBtn.connect('clicked', () => {
                        this._editingCount = null;
                        this._draftLayouts = null;
                        this.rebuild(previewContainer);
                    });
                    btnBox.append(cancelBtn);

                    const saveBtn = new Gtk.Button({ label: 'Save', css_classes: ['suggested-action'] });
                    saveBtn.connect('clicked', () => {
                        const currentData = JSON.parse(this.settings.get_string('custom-layouts') || '{}');
                        currentData[count] = estates;
                        this.settings.set_string('custom-layouts', JSON.stringify(currentData, null, 2));
                        this._editingCount = null;
                        this._draftLayouts = null;
                        this.rebuild(previewContainer);
                    });
                    btnBox.append(saveBtn);
                    editPanel.append(btnBox);
                };

                refreshEditors();
            }

            previewContainer.append(itemBox);
            idx++;
        }

        const finalArrow = new Gtk.Image({
            icon_name: 'pan-down-symbolic',
            css_classes: ['dim-label'],
            margin_top: 4,
            margin_bottom: 4,
            icon_size: Gtk.IconSize.LARGE
        });
        previewContainer.append(finalArrow);

        const maxN = Math.max(...counts);
        const addBtnIcon = new Gtk.Image({
            icon_name: 'list-add-symbolic',
            pixel_size: 24
        });
        const addBtn = new Gtk.Button({
            child: addBtnIcon,
            tooltip_text: 'Add Layout',
            css_classes: ['suggested-action', 'circular'],
            halign: Gtk.Align.CENTER,
            margin_bottom: 24,
            width_request: 48,
            height_request: 48
        });
        addBtn.connect('clicked', () => {
            this._openSplitDialog(maxN, maxN + 1, addBtn.get_root(), (newEstates) => {
                const currentData = JSON.parse(this.settings.get_string('custom-layouts') || '{}');
                currentData[maxN + 1] = newEstates;
                this.settings.set_string('custom-layouts', JSON.stringify(currentData, null, 2));

                // Switch immediately to post-editing mode
                this._editingCount = maxN + 1;
                this._initializeDrafts();
                this.rebuild(previewContainer);
            });
        });
        previewContainer.append(addBtn);
    }
});
