import { ScreenEstate, Layout, LayoutEscalator } from './layout.js';

/** Upper bounds keep the O(n²) overlap validation from freezing the single-threaded Shell on hostile input. */
const MAX_LAYOUTS = 50;
const MAX_ESTATES = 50;

export class LayoutParser {
    /**
     * Parses the user's layout JSON (shared by the extension and the preferences window).
     * @param {string} jsonString
     * @returns {LayoutEscalator|null} null for an empty string
     * @throws {SyntaxError} on malformed JSON
     * @throws {Error} on an invalid layout
     */
    static parse(jsonString) {
        if (!jsonString || jsonString.trim() === '') return null;

        const data = JSON.parse(jsonString);
        const counts = Object.keys(data)
            .map(Number)
            .sort((a, b) => a - b);
        if (counts.length > MAX_LAYOUTS) {
            throw new Error(`Too many layouts defined. Maximum allowed is ${MAX_LAYOUTS}.`);
        }

        const layouts = new Map();
        for (const count of counts) {
            const entries = data[count];
            if (!Array.isArray(entries)) throw new Error(`Layout for count ${count} must be an array`);
            if (entries.length > MAX_ESTATES) {
                throw new Error(`Layout for count ${count} exceeds maximum of ${MAX_ESTATES} estates`);
            }

            const estates = entries
                .map(({ id, x, y, w, h }) =>
                    new ScreenEstate({ id: Number(id), x: Number(x), y: Number(y), w: Number(w), h: Number(h) }),
                )
                .sort((a, b) => a.id - b.id);
            try {
                layouts.set(count, new Layout(estates));
            } catch (e) {
                throw new Error(`Layout for count ${count} ${e.message}`, { cause: e });
            }
        }

        if (layouts.size === 0) return null;
        return new LayoutEscalator(layouts);
    }

    /**
     * @param {string} jsonString
     * @returns {string|null} error message, or null when the JSON yields a valid, non-empty escalator
     */
    static validate(jsonString) {
        try {
            return LayoutParser.parse(jsonString) ? null : 'Layout JSON is empty';
        } catch (e) {
            return e.message;
        }
    }
}
