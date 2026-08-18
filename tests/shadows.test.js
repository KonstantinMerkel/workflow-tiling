import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShadowManager } from '../lib/shadows.js';

describe('ShadowManager', () => {
    let mockExtensionSettings;
    let mockNativeSettings;

    beforeEach(() => {
        const extStore = {
            'shadowed-keybindings': '{}',
            'move-window-left': ['<Super><Alt>Left'],
            'move-window-right': ['<Control><Alt>t']
        };

        mockExtensionSettings = {
            get_string: vi.fn((key) => extStore[key] || ''),
            set_string: vi.fn((key, val) => { extStore[key] = val; }),
            get_strv: vi.fn((key) => extStore[key] || [])
        };

        const nativeStore = {
            'switch-to-workspace-1': ['<Super>1'],
            'toggle-tiled-left': ['<Super>Left'],
            'conflict-key': ['<Alt><Super>Left', '<Super>Up']
        };

        mockNativeSettings = {
            schema_id: 'org.gnome.desktop.wm.keybindings',
            list_keys: vi.fn(() => Object.keys(nativeStore)),
            get_value: vi.fn((key) => ({
                get_type_string: () => 'as'
            })),
            get_strv: vi.fn((key) => nativeStore[key] || []),
            set_strv: vi.fn((key, val) => { nativeStore[key] = val; })
        };
    });

    it('should parse and normalize accelerator strings', () => {
        const shadow = new ShadowManager(mockExtensionSettings);

        const norm1 = shadow._normalize('<Alt><Super>Left');
        const norm2 = shadow._normalize('<Super><Alt>Left');
        expect(norm1).toBe(norm2);
        expect(norm1).toBe('<Alt><Super>Left');

        const normCtrl = shadow._normalize('<Primary><Alt>t');
        expect(normCtrl).toBe('<Alt><Control>t');

        expect(shadow._normalize('<ctrl><shift>Page_Up')).toBe('<Control><Shift>Page_Up');
        expect(shadow._normalize('<mod1><mod4>Right')).toBe('<Alt><Super>Right');
        expect(shadow._normalize('  <super> <alt> Down  ')).toBe('<Alt><Super>Down');
        expect(shadow._normalize('<Super><Super>Up')).toBe('<Super>Up');
        expect(shadow._normalize('F11')).toBe('F11');

        expect(shadow._normalize('')).toBe('');
        expect(shadow._normalize('   ')).toBe('');
        expect(shadow._normalize(null)).toBe('');
        expect(shadow._normalize(undefined)).toBe('');
        expect(shadow._normalize(123)).toBe('');
    });

    it('should shadow conflicting native shortcuts and save backup state', () => {
        const shadow = new ShadowManager(mockExtensionSettings);
        shadow._nativeSchemas = [mockNativeSettings];

        shadow.shadowShortcuts(['move-window-left']);

        expect(mockNativeSettings.set_strv).toHaveBeenCalledWith('conflict-key', ['<Super>Up']);

        const savedJson = mockExtensionSettings.set_string.mock.calls.find(c => c[0] === 'shadowed-keybindings')[1];
        const state = JSON.parse(savedJson);
        expect(state['org.gnome.desktop.wm.keybindings']['conflict-key']).toEqual(['<Alt><Super>Left', '<Super>Up']);
    });

    it('should not shadow protected keys', () => {
        const shadow = new ShadowManager(mockExtensionSettings, ['conflict-key']);
        shadow._nativeSchemas = [mockNativeSettings];

        shadow.shadowShortcuts(['move-window-left']);

        expect(mockNativeSettings.set_strv).not.toHaveBeenCalled();
    });

    it('should restore shadowed shortcuts cleanly on restoreAll', () => {
        const shadow = new ShadowManager(mockExtensionSettings);
        shadow._nativeSchemas = [mockNativeSettings];

        mockExtensionSettings.get_string.mockReturnValue(JSON.stringify({
            'org.gnome.desktop.wm.keybindings': {
                'conflict-key': ['<Alt><Super>Left', '<Super>Up']
            }
        }));

        shadow.restoreAll();

        expect(mockNativeSettings.set_strv).toHaveBeenCalledWith('conflict-key', ['<Alt><Super>Left', '<Super>Up']);
        expect(mockExtensionSettings.set_string).toHaveBeenCalledWith('shadowed-keybindings', '{}');
    });

    it('should handle corrupt state JSON gracefully in restoreAll', () => {
        const shadow = new ShadowManager(mockExtensionSettings);
        mockExtensionSettings.get_string.mockReturnValue('invalid-json{');

        expect(() => shadow.restoreAll()).not.toThrow();
    });
});
