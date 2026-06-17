/**
 * geometry.js
 * Utility functions for spatial and directional calculations.
 */

/**
 * Determines the entering edge when moving from a source rectangle to a target rectangle.
 * @param {Object} sourceRect - The source geometry {x, y, width, height}.
 * @param {Object} targetRect - The target geometry {x, y, width, height}.
 * @returns {string} The entering edge ('left', 'right', 'top', 'bottom').
 */
export function getEnteringEdge(sourceRect, targetRect) {
    const dx = targetRect.x - sourceRect.x;
    const dy = targetRect.y - sourceRect.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx > 0 ? 'left' : 'right';
    } else {
        return dy > 0 ? 'top' : 'bottom';
    }
}

/**
 * Finds the best monitor in a given direction from a source monitor.
 * @param {number} currentMonitorIndex - The index of the source monitor.
 * @param {string} direction - The direction to look ('left', 'right', 'up', 'down').
 * @param {Array} logicalMonitors - The array of logical monitors.
 * @param {Function} getGeometryFn - Function that returns geometry given a monitor index.
 * @returns {number} The index of the selected monitor, or -1 if none found.
 */
export function findMonitorInDirection(currentMonitorIndex, direction, logicalMonitors, getGeometryFn) {
    const sourceMonitor = logicalMonitors[currentMonitorIndex];
    if (!sourceMonitor) return -1;

    const sRect = getGeometryFn(currentMonitorIndex);
    let candidates = [];
    const eps = 1;

    for (let i = 0; i < logicalMonitors.length; i++) {
        if (i === currentMonitorIndex) continue;
        const cRect = getGeometryFn(i);
        
        let inDirection = false;
        let dist = Infinity;

        if (direction === 'left') {
            inDirection = cRect.x + cRect.width <= sRect.x + eps;
            dist = sRect.x - (cRect.x + cRect.width);
        } else if (direction === 'right') {
            inDirection = cRect.x >= sRect.x + sRect.width - eps;
            dist = cRect.x - (sRect.x + sRect.width);
        } else if (direction === 'up') {
            inDirection = cRect.y + cRect.height <= sRect.y + eps;
            dist = sRect.y - (cRect.y + cRect.height);
        } else if (direction === 'down') {
            inDirection = cRect.y >= sRect.y + sRect.height - eps;
            dist = cRect.y - (sRect.y + sRect.height);
        }

        if (inDirection) {
            let overlap = 0;
            if (direction === 'left' || direction === 'right') {
                overlap = Math.max(0, Math.min(cRect.y + cRect.height, sRect.y + sRect.height) - Math.max(cRect.y, sRect.y));
            } else {
                overlap = Math.max(0, Math.min(cRect.x + cRect.width, sRect.x + sRect.width) - Math.max(cRect.x, sRect.x));
            }
            if (overlap > 0) {
                candidates.push({ index: i, dist, overlap, rect: cRect });
            }
        }
    }

    if (candidates.length === 0) {
        return -1;
    }

    candidates.sort((a, b) => {
        if (Math.abs(a.dist - b.dist) > eps) {
            return a.dist - b.dist;
        }
        if (Math.abs(a.overlap - b.overlap) > eps) {
            return b.overlap - a.overlap;
        }
        return a.index - b.index;
    });

    return candidates[0].index;
}

/**
 * Gets the most appropriate estate index on a specific edge of the layout.
 * @param {Array} estates - Array of layout estates.
 * @param {string} direction - The edge direction ('left', 'right', 'top', 'bottom').
 * @returns {number} The index of the chosen estate, or -1 if none found.
 */
export function getEdgingSlotForEstates(estates, direction) {
    const eps = 0.01;
    let candidates = [];

    estates.forEach((estate, index) => {
        let touches = false;
        if (direction === 'left') {
            touches = estate.pct_x <= eps;
        } else if (direction === 'right') {
            touches = (estate.pct_x + estate.pct_w) >= (100 - eps);
        } else if (direction === 'top') {
            touches = estate.pct_y <= eps;
        } else if (direction === 'bottom') {
            touches = (estate.pct_y + estate.pct_h) >= (100 - eps);
        }

        if (touches) {
            candidates.push({ estate, index });
        }
    });

    if (candidates.length === 0) {
        return -1;
    }

    candidates.sort((a, b) => {
        if (direction === 'left' || direction === 'right') {
            const diffHeight = b.estate.pct_h - a.estate.pct_h;
            if (Math.abs(diffHeight) > eps) {
                return diffHeight;
            }
            return a.estate.pct_y - b.estate.pct_y;
        } else {
            const diffWidth = b.estate.pct_w - a.estate.pct_w;
            if (Math.abs(diffWidth) > eps) {
                return diffWidth;
            }
            return b.estate.pct_x - a.estate.pct_x;
        }
    });

    return candidates[0].index;
}

/**
 * Checks if a target slot estate is in a specific direction relative to a source estate.
 */
export function isSlotInDirection(estate, c, direction, eps = 0.01) {
    let orthoOverlap = false;

    if (direction === 'left' || direction === 'right') {
        orthoOverlap = Math.max(c.pct_y, estate.pct_y) < Math.min(c.pct_y + c.pct_h, estate.pct_y + estate.pct_h) - eps;
        if (direction === 'left') {
            return orthoOverlap && c.pct_x + c.pct_w <= estate.pct_x + eps;
        }
        return orthoOverlap && c.pct_x >= estate.pct_x + estate.pct_w - eps;
    } else if (direction === 'up' || direction === 'down') {
        orthoOverlap = Math.max(c.pct_x, estate.pct_x) < Math.min(c.pct_x + c.pct_w, estate.pct_x + estate.pct_w) - eps;
        if (direction === 'up') {
            return orthoOverlap && c.pct_y + c.pct_h <= estate.pct_y + eps;
        }
        return orthoOverlap && c.pct_y >= estate.pct_y + estate.pct_h - eps;
    }
    return false;
}

/**
 * Calculates distance between two slot estates in a specific direction.
 */
export function calculateSlotDistance(estate, c, direction) {
    if (direction === 'left') return estate.pct_x - (c.pct_x + c.pct_w);
    if (direction === 'right') return c.pct_x - (estate.pct_x + estate.pct_w);
    if (direction === 'up') return estate.pct_y - (c.pct_y + c.pct_h);
    if (direction === 'down') return c.pct_y - (estate.pct_y + estate.pct_h);
    return 0;
}

/**
 * Finds the nearest slot index in a specific direction.
 */
export function findTargetSlotInDirection(layout, slot, estate, direction) {
    const eps = 0.01;
    let candidates = [];

    for (let i = 0; i < layout.size; i++) {
        if (i === slot) continue;
        const c = layout.getEstate(i);
        
        if (isSlotInDirection(estate, c, direction, eps)) {
            candidates.push({ 
                index: i, 
                distance: calculateSlotDistance(estate, c, direction) 
            });
        }
    }

    if (candidates.length === 0) return -1;

    candidates.sort((a, b) => a.distance - b.distance);
    const minDist = candidates[0].distance;
    
    candidates = candidates.filter(c => c.distance <= minDist + eps);
    candidates.sort((a, b) => a.index - b.index);
    
    return candidates[0].index;
}

/**
 * Finds the closest boundary window out of candidate windows in a given direction.
 */
export function findClosestBoundaryWindow(candidates, direction, sourceRect) {
    if (!candidates || candidates.length === 0) return null;
    if (!sourceRect) return candidates[0].win;

    candidates.sort((a, b) => {
        let overA = 0, overB = 0;
        
        if (direction === 'left' || direction === 'right') {
            overA = Math.max(0, Math.min(a.rect.y + a.rect.height, sourceRect.y + sourceRect.height) - Math.max(a.rect.y, sourceRect.y));
            overB = Math.max(0, Math.min(b.rect.y + b.rect.height, sourceRect.y + sourceRect.height) - Math.max(b.rect.y, sourceRect.y));
        } else {
            overA = Math.max(0, Math.min(a.rect.x + a.rect.width, sourceRect.x + sourceRect.width) - Math.max(a.rect.x, sourceRect.x));
            overB = Math.max(0, Math.min(b.rect.x + b.rect.width, sourceRect.x + sourceRect.width) - Math.max(b.rect.x, sourceRect.x));
        }

        if (overA !== overB) return overB - overA;

        if (direction === 'left') {
            if (a.rect.x !== b.rect.x) return b.rect.x - a.rect.x;
            return a.rect.y - b.rect.y;
        } else if (direction === 'right') {
            if (a.rect.x !== b.rect.x) return a.rect.x - b.rect.x;
            return a.rect.y - b.rect.y;
        } else if (direction === 'up') {
            if (a.rect.y !== b.rect.y) return b.rect.y - a.rect.y;
            return b.rect.x - a.rect.x;
        } else if (direction === 'down') {
            if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
            return b.rect.x - a.rect.x;
        }
        return 0;
    });

    return candidates[0].win;
}
