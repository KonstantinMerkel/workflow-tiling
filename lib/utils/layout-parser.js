import { ScreenEstate, Layout, LayoutEscalator } from '../layout.js';


export class LayoutParser {
    /**
     * parses the user input escalation JSON
     * @param {String} jsonString JSON **as provided by user** be careful
     * @returns {LayoutEscalator} the escalator to be used in runtime
     */
    static parse(jsonString) {
        if (!jsonString || jsonString.trim() === '') return null

        // basic  JSON parsing
        let data;
        try {
            data = JSON.parse(jsonString);
        } catch (e) {
            throw new Error(`Invalid JSON syntax: ${e.message}`);
        }

        const layouts = new Map();
        // sort by keys (ascending)
        const keys = Object.keys(data).map(Number).sort((a, b) => a - b);
        
        // Security relevant; Local DoS (Desktop Freeze)                                                            
        // GNOME Shell is single-threaded. LayoutValidator runs an O(N^2) overlap check. A user copy-pasting a
        // malicious JSON with 10,000 estates will completely freeze their desktop environment.
        if (keys.length > 50) {
            throw new Error('Too many layouts defined. Maximum allowed is 50.');
        }

        // Generates the layouts for each window count
        for (const count of keys) {
            const arr = data[count];
            if (!Array.isArray(arr)) {
                throw new Error(`Layout for count ${count} must be an array`);
            }
            if (arr.length > 50) {
                throw new Error(`Layout for count ${count} exceeds maximum of 50 estates`);
            }

            const parsedEstates = arr.map(e => {
                return new ScreenEstate(Number(e.id), Number(e.x), Number(e.y), Number(e.w), Number(e.h));
            });

            parsedEstates.sort((a, b) => a.id - b.id);
            let layout;
            try {
                layout = new Layout(parsedEstates);
            } catch (e) {
                throw new Error(`Layout for count ${count} ${e.message}`);
            }
            
            layouts.set(count, layout);
        }

        if (layouts.size === 0) return null;
        return new LayoutEscalator(layouts);
    }
}
