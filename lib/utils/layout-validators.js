import { Layout } from '../layout.js';

export class LayoutValidator {
    static validate(estates, expectedCount = null) {
        // validate the correct count (if given)
        const count = expectedCount !== null ? expectedCount : estates.length;      
        if (estates.length !== count) {
            throw new Error(`contains ${estates.length} estates, expected ${count}`);
        }

        // validate the correct id slots
        const idSet = new Set(estates.map(e => e.id));
        if (idSet.size !== count) {
            throw new Error(`must have unique ids from 0 to ${count - 1}`);
        }
        for (let i = 0; i < count; i++) {
            if (!idSet.has(i)) {
                throw new Error(`is missing id ${i}`);
            }
        }

        // validate no overlap in any of the given estates
        const hasOverlap = estates.some((e1, i) => 
            estates.slice(i + 1).some(e2 => this._intersects(e1, e2))
        );
        if (hasOverlap) throw new Error('overlap detected between estates');

        // validate no empty space left/ total area used
        const area = estates.reduce((sum, e) => sum + (e.pct_w * e.pct_h), 0);
        if (Math.abs(area - 10000) > 0.1) {
            throw new Error(`total area is ${area}, expected 10000 (must have no gaps)`);
        }
    }

    // calculates if two given screenEstates overlap
    static _intersects(e1, e2) {
        const eps = 0.01; //FPA safeguard
        return !(
            e2.pct_x >= e1.pct_x + e1.pct_w - eps ||
            e2.pct_x + e2.pct_w <= e1.pct_x + eps ||
            e2.pct_y >= e1.pct_y + e1.pct_h - eps ||
            e2.pct_y + e2.pct_h <= e1.pct_y + eps
        );
    }
}

export class LayoutEscalatorValidator {
    static validate(layoutsMap) {
        const keys = Array.from(layoutsMap.keys()).sort((a, b) => a - b);
        if (keys.length === 0) return;

        // validates map starts at 1 window
        if (keys[0] !== 1) {
            throw new Error('Layout sequence must start with 1 window');
        }

        // validates true seqence of layouts
        const maxCount = keys[keys.length - 1];
        for (let i = 1; i <= maxCount; i++) {
            if (!layoutsMap.has(i)) {
                throw new Error(`Layout sequence is missing layout for ${i} window(s)`);
            }
            const layout = layoutsMap.get(i);
            if (!(layout instanceof Layout)) {
                throw new Error(`Layout for ${i} window(s) is not a Layout instance`);
            }
            if (layout.size !== i) {
                throw new Error(`Layout for ${i} window(s) contains ${layout.size} estates, expected ${i}`);
            }
        }
    }
}
