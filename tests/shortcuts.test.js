import { describe, it, expect } from 'vitest';
import {
    applyShortcutModes,
    findConflicts,
    hasDirectionalShortcuts,
    isShortcutSet,
    normalizeAccelerator,
    shortcutEntries,
} from '../lib/utils/shortcuts.js';
import { readFileSync } from 'node:fs';
import { DIRECTIONAL_SHORTCUTS, SHORTCUT_PRESETS, boundKey, customKey, keysForMode } from '../lib/domain/shortcuts.js';

describe('normalizeAccelerator', () => {
    it('spells equal key combinations the same', () => {
        const same = ['<Primary><Shift>h', '<Shift><Control>H', '<shift><ctrl>h', '<Control><Shift><Shift>h', '<Ctl><Shft>h'];
        expect(new Set(same.map(normalizeAccelerator))).toEqual(new Set(['<Control><Shift>h']));
        expect(normalizeAccelerator('<Mod4><Mod1>Left')).toBe(normalizeAccelerator('<Alt><Super>Left'));
    });

    it('keeps modifiers apart and key names only Mutter knows', () => {
        expect(normalizeAccelerator('<Super>h')).not.toBe(normalizeAccelerator('<Super><Shift>h'));
        expect(normalizeAccelerator('<Super>Above_Tab')).toBe('<Super>above_tab');
    });

    it('treats empty and disabled entries as no shortcut', () => {
        expect(normalizeAccelerator('')).toBeNull();
        expect(normalizeAccelerator('disabled')).toBeNull();
        expect(normalizeAccelerator(null)).toBeNull();
        expect(normalizeAccelerator('<Super>a\nb')).toBe('<Super>a\nb'); // junk from dconf, but no crash
        expect(isShortcutSet([])).toBe(false);
        expect(isShortcutSet(['', 'disabled'])).toBe(false);
        expect(isShortcutSet(['', '<Super>x'])).toBe(true);
    });

    it('turns read sources into comparable entries', () => {
        expect(shortcutEntries([{ id: 'a/b', label: 'B', accels: ['<Primary>q', ''] }])).toEqual([
            { accel: '<Control>q', id: 'a/b', label: 'B' },
        ]);
    });
});

describe('findConflicts', () => {
    it('names every other entry sharing one of the keys of a checked id, once', () => {
        const entries = [
            { accel: '<Super>up', id: 'a', label: 'A' },
            { accel: '<Alt>f10', id: 'a', label: 'A' },
            { accel: '<Alt>f10', id: 'g', label: 'G' },
            { accel: '<Super>up', id: 'g', label: 'G' },
            { accel: '<Super>up', id: 'a', label: 'A' },
            { accel: '<Super>x', id: 'b', label: 'B' },
        ];
        expect(findConflicts(entries, ['a', 'b', 'c'])).toEqual(
            new Map([['a', ['G']], ['b', []], ['c', []]]),
        );
    });
});

describe('shortcut modes', () => {
    const settings = (values) => {
        const store = { ...values };
        return {
            store,
            get_string: (k) => store[k] ?? 'none',
            get_strv: (k) => store[k] ?? [],
            set_strv: (k, v) => (store[k] = v),
        };
    };
    const [focus, move] = DIRECTIONAL_SHORTCUTS;

    it('defines one group per mode key, with bound and own keys per direction', () => {
        expect(DIRECTIONAL_SHORTCUTS.map((g) => g.modeKey)).toEqual(['focus-window-mode', 'keybindings-mode']);
        expect(boundKey(move, 'left')).toBe('move-window-left');
        expect(customKey(focus, 'down')).toBe('custom-focus-window-down');
    });

    it('lists the same presets in the schema as in the code, for both modes', () => {
        const schema = readFileSync(
            new URL('../schemas/org.gnome.shell.extensions.workflow-tiling.gschema.xml', import.meta.url),
            'utf8',
        );
        for (const { modeKey } of DIRECTIONAL_SHORTCUTS) {
            const key = new RegExp(`<key name="${modeKey}"[\\s\\S]*?</choices>`).exec(schema)[0];
            const choices = [...key.matchAll(/<choice value="([^"]+)"/g)].map((m) => m[1]);
            expect(choices).toEqual(['none', ...Object.keys(SHORTCUT_PRESETS), 'custom']);
        }
    });

    it('binds nothing in None or an unknown mode, fixed keys for a preset, own keys in Custom', () => {
        const own = (dir) => [`<Super>${dir}`];
        expect(keysForMode('none', own).up).toEqual([]);
        expect(keysForMode('default', own).up).toEqual([]); // old value of the dev setup
        expect(keysForMode('ctrl-shift-hjkl', own).down).toEqual(['<Control><Shift>j']);
        expect(keysForMode('custom', own).up).toEqual(['<Super>up']);
    });

    it('writes the bound keys of every mode, only where they differ, and keeps own keys', () => {
        const s = settings({ 'keybindings-mode': 'super-arrows', 'custom-move-window-left': ['<Super>h'] });
        applyShortcutModes(s);
        expect(s.store['move-window-left']).toEqual(['<Super>Left']);
        expect(s.store['custom-move-window-left']).toEqual(['<Super>h']);
        expect(s.store['focus-window-left']).toBeUndefined(); // None and nothing stored: nothing to write
    });

    it('counts a mode as in use when it binds a key', () => {
        expect(hasDirectionalShortcuts(settings({ 'custom-move-window-left': ['<Super>Left'] }))).toBe(false);
        expect(hasDirectionalShortcuts(settings({ 'keybindings-mode': 'custom' }))).toBe(false);
        expect(hasDirectionalShortcuts(settings({ 'keybindings-mode': 'custom', 'custom-move-window-up': ['disabled'] }))).toBe(false);
        expect(hasDirectionalShortcuts(settings({ 'focus-window-mode': 'custom', 'custom-focus-window-up': ['<Super>k'] }))).toBe(true);
        expect(hasDirectionalShortcuts(settings({ 'keybindings-mode': 'super-arrows' }))).toBe(true);
    });
});
