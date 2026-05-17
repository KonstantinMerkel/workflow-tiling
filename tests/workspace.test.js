import { describe, it, expect } from 'vitest';
import { WorkspaceGrid } from '../lib/workspace.js';
import { createDefaultEscalator } from '../lib/layout.js';

describe('WorkspaceGrid', () => {
    const escalator = createDefaultEscalator();
    const monitorRect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('should track windows in sequence with gaps', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const win1 = { id: 1 };
        const win2 = { id: 2 };

        grid.trackWindow(win1, 0);
        grid.trackWindow(win2, 0);

        const ops = grid.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        // 50% split with 4px outer and 3px inner (half of 6)
        expect(ops[0].rect.width).toBe(493); 
    });

    it('should handle multiple monitors independently', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const rectM0 = { x: 0, y: 0, width: 1920, height: 1080 };
        const rectM1 = { x: 1920, y: 0, width: 1920, height: 1080 }; 

        grid.trackWindow({ id: 'w1M0' }, 0);
        grid.trackWindow({ id: 'w1M1' }, 1);

        const opsM0 = grid.getRetileOperations(0, rectM0);
        const opsM1 = grid.getRetileOperations(1, rectM1);

        expect(opsM0.length).toBe(1);
        expect(opsM1.length).toBe(1);
        // Monitor 1 starts at 1920, with 4px outer gap -> 1924
        expect(opsM1[0].rect.x).toBe(1924);
    });

    it('should handle different resolutions on different monitors', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const rect4K = { x: 0, y: 0, width: 3840, height: 2160 };
        const rectHD = { x: 3840, y: 0, width: 1920, height: 1080 };

        grid.trackWindow({ id: '4k' }, 0);
        grid.trackWindow({ id: 'hd' }, 1);

        const ops4K = grid.getRetileOperations(0, rect4K);
        const opsHD = grid.getRetileOperations(1, rectHD);

        // 3840 - 4(left) - 4(right) = 3832
        expect(ops4K[0].rect.width).toBe(3832);
        // 1920 - 4(left) - 4(right) = 1912
        expect(opsHD[0].rect.width).toBe(1912);
    });

    it('should provide retile operations when a window is removed', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const w1 = { id: 1 };
        const w2 = { id: 2 };
        const w3 = { id: 3 };

        grid.trackWindow(w1, 0);
        grid.trackWindow(w2, 0);
        grid.trackWindow(w3, 0);

        grid.untrackWindow(w1, 0);

        const ops = grid.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        expect(ops[0].rect.width).toBe(493);
    });

    it('should maintain independent window counts across monitors', () => {
        const grid = new WorkspaceGrid({}, escalator);
        grid.trackWindow({ id: 1 }, 0);
        grid.trackWindow({ id: 2 }, 1);
        grid.trackWindow({ id: 3 }, 1);

        expect(grid.getRetileOperations(0, monitorRect).length).toBe(1);
        expect(grid.getRetileOperations(1, monitorRect).length).toBe(2);
    });
});
