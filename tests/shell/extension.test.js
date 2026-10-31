import { describe, it, expect, vi } from 'vitest';

const { parts } = vi.hoisted(() => ({ parts: [] }));

// Every Shell part records its cleanup; StIndicator fails, as any part of enable() might
const part = (name, cleanup) =>
    class {
        constructor() {
            parts.push(this);
            this.name = name;
            this[cleanup] = vi.fn();
        }
    };

vi.mock('resource:///org/gnome/shell/extensions/extension.js', () => ({
    Extension: class {
        constructor(metadata) {
            this.metadata = metadata;
        }
        getSettings() {
            return {};
        }
    },
}));
vi.mock('resource:///org/gnome/shell/ui/messageTray.js', () => ({}));
vi.mock('../../lib/shell/config-source.js', () => ({
    GSettingsConfigSource: class extends part('config', 'destroy') {
        onConfigChanged() {}
        onConfigInvalid() {}
    },
}));
vi.mock('../../lib/shell/button-layout.js', () => ({
    MaximizeButtonHider: class extends part('buttons', 'disable') {
        enable() {}
    },
}));
vi.mock('../../lib/shell/display-port.js', () => ({ MutterDisplayPort: part('display', 'destroy') }));
vi.mock('../../lib/shell/window-port.js', () => ({ MutterWindowPort: part('windows', 'destroy') }));
vi.mock('../../lib/shell/st-indicator.js', () => ({
    StIndicator: class {
        constructor() {
            throw new Error('no stage');
        }
    },
}));

const { default: WorkflowTilingExtension } = await import('../../extension.js');

describe('WorkflowTilingExtension', () => {
    it('undoes what a failed enable() set up and still reports the error', () => {
        const extension = new WorkflowTilingExtension({ name: 'Workflow Tiling' });
        expect(() => extension.enable()).toThrow('no stage');
        expect(parts.map((p) => p.name)).toEqual(['config', 'buttons', 'display', 'windows']);
        for (const p of parts) expect(p.destroy ?? p.disable).toHaveBeenCalledOnce();
        expect(extension._buttonHider).toBeNull(); // the maximize button is shown again, nothing left to disable
    });
});
