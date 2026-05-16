import { describe, it, expect } from 'vitest';
import { WorkspaceGrid } from '../lib/workspace.js';
import { createDefaultEscalator } from '../lib/layout.js';

describe('WorkspaceGrid', () => {
    const escalator = createDefaultEscalator();
    const monitorRect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('should track and re-tile windows', () => {
        const grid = new WorkspaceGrid({}, escalator);
        const w1 = { id: 1 };
        const w2 = { id: 2 };

        grid.trackWindow(w1, 0);
        grid.trackWindow(w2, 0);

        const ops = grid.getRetileOperations(0, monitorRect);
        expect(ops.length).toBe(2);
        expect(ops[0].rect.width).toBe(500);
        expect(ops[1].rect.x).toBe(500);
    });

    it('should handle monitor isolation', () => {
        const grid = new WorkspaceGrid({}, escalator);
        grid.trackWindow({ id: 1 }, 0);
        grid.trackWindow({ id: 2 }, 1);

        const ops0 = grid.getRetileOperations(0, monitorRect);
        const ops1 = grid.getRetileOperations(1, monitorRect);

        expect(ops0.length).toBe(1);
        expect(ops1.length).toBe(1);
    });
});
