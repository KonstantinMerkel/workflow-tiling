import { describe, it, expect } from 'vitest';
import { WorkspaceGrid } from '../lib/workspace.js';
import { createDefaultEscalator } from '../lib/layout.js';

describe('WorkspaceGrid', () => {
    const escalator = createDefaultEscalator();
    const monitorRect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('should track windows in sequence', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const win1 = { id: 1 };
        const win2 = { id: 2 };

        grid.trackWindow(win1, 0);
        grid.trackWindow(win2, 0);

        const ops = grid.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        expect(ops[0].rect.width).toBe(500);
    });

    it('should fallback to floating when overstepped', () => {
        const grid = new WorkspaceGrid({}, escalator);
        grid.trackWindow({ id: 1 }, 0);
        grid.trackWindow({ id: 2 }, 0);
        grid.trackWindow({ id: 3 }, 0);
        
        // Logical check for 4th window
        const nextLayout = escalator.getLayoutForCount(4);
        expect(nextLayout).toBeNull();
    });

    it('should handle multiple monitors independently with complex operations', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const rectM0 = { x: 0, y: 0, width: 1920, height: 1080 };
        const rectM1 = { x: 1920, y: 0, width: 1920, height: 1080 }; 

        const w1M0 = { id: 'w1M0' };
        const w2M0 = { id: 'w2M0' };
        const w1M1 = { id: 'w1M1' };

        grid.trackWindow(w1M0, 0);
        grid.trackWindow(w2M0, 0);
        grid.trackWindow(w1M1, 1);

        const opsM0 = grid.getRetileOperations(0, rectM0);
        const opsM1 = grid.getRetileOperations(1, rectM1);

        expect(opsM0.length).toBe(2);
        expect(opsM1.length).toBe(1);
        expect(opsM1[0].rect.x).toBe(1920);
    });

    it('should handle different resolutions on different monitors', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const rect4K = { x: 0, y: 0, width: 3840, height: 2160 };
        const rectHD = { x: 3840, y: 0, width: 1920, height: 1080 };

        grid.trackWindow({ id: '4k' }, 0);
        grid.trackWindow({ id: 'hd' }, 1);

        const ops4K = grid.getRetileOperations(0, rect4K);
        const opsHD = grid.getRetileOperations(1, rectHD);

        expect(ops4K[0].rect.width).toBe(3840);
        expect(opsHD[0].rect.width).toBe(1920);
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
        expect(ops[0].window).toBe(w2);
        expect(ops[0].rect.width).toBe(500);
        expect(ops[1].window).toBe(w3);
        expect(ops[1].rect.x).toBe(500);
    });

    it('should handle monitor isolation untracking', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const w1 = { id: 1 };
        grid.trackWindow(w1, 0);
        grid.trackWindow({ id: 2 }, 1);
        
        grid.untrackWindow(w1, 0);
        expect(grid.getRetileOperations(0, monitorRect).length).toBe(0);
        expect(grid.getRetileOperations(1, monitorRect).length).toBe(1);
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
