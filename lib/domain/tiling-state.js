import { Mode, holdsSlot, location, locationKey, sameLocation } from './types.js';

/**
 * Builds the read-only face of a state. Records are immutable, so they are returned as they are; slot lists are
 * returned as copies.
 * @param {() => TilingState} getState
 */
export function makeView(getState) {
    return Object.freeze({
        has: (id) => getState().has(id),
        record: (id) => getState().record(id),
        slotOf: (id) => getState().slotOf(id),
        slotsAt: (loc) => getState().slotsAt(loc),
        floatingAt: (loc) => getState().floatingAt(loc),
        evacuated: () => getState().evacuated(),
        locations: () => getState().locations(),
        records: () => getState().records(),
    });
}

/**
 * Intended placement of every tracked window: one ordered slot list per location (slot = index) and one immutable
 * record per window. A window is in exactly one slot list, or floating, or evacuated.
 *
 * WindowRecord: { id, sequence, location, mode, evacuated: null | { slot, edid, connector } }
 */
export class TilingState {
    constructor() {
        this._lists = new Map(); // locationKey -> { location, ids: WindowId[] }
        this._records = new Map(); // WindowId -> WindowRecord
    }

    has(id) {
        return this._records.has(id);
    }

    record(id) {
        return this._records.get(id) ?? null;
    }

    slotsAt(loc) {
        return [...(this._lists.get(locationKey(loc))?.ids ?? [])];
    }

    /** @returns {number} slot index, or -1 for floating, evacuated and unknown windows */
    slotOf(id) {
        const record = this._records.get(id);
        if (!record || record.evacuated || !holdsSlot(record.mode)) return -1;
        return this._lists.get(locationKey(record.location))?.ids.indexOf(id) ?? -1;
    }

    floatingAt(loc) {
        return this.records()
            .filter((r) => !r.evacuated && r.mode === Mode.FLOATING && sameLocation(r.location, loc))
            .sort((a, b) => a.sequence - b.sequence);
    }

    evacuated() {
        return this.records().filter((r) => r.evacuated);
    }

    records() {
        return [...this._records.values()];
    }

    /** @returns {Array} every location holding a slot list or a floating window */
    locations() {
        const byKey = new Map();
        for (const { location: loc, ids } of this._lists.values()) {
            if (ids.length > 0) byKey.set(locationKey(loc), loc);
        }
        for (const record of this._records.values()) {
            if (!record.evacuated) byKey.set(locationKey(record.location), record.location);
        }
        return [...byKey.values()];
    }

    /**
     * @param {number} id
     * @param {number} sequence creation order (get_stable_sequence)
     * @param {object} loc Location
     * @param {string} mode
     * @param {number|null} slot insert position for slot-holding modes; appended when null
     */
    place(id, sequence, loc, mode, slot = null) {
        if (this._records.has(id)) this.remove(id);
        this._records.set(id, Object.freeze({ id, sequence, location: loc, mode, evacuated: null }));
        if (holdsSlot(mode)) this._insert(loc, id, slot);
    }

    /** @returns {object|null} the removed record */
    remove(id) {
        const record = this._records.get(id);
        if (!record) return null;
        this._detach(record);
        this._records.delete(id);
        return record;
    }

    /**
     * Moves a window to another location. A null slot makes it FLOATING there; a slot makes a floating window TILED
     * and keeps any other mode.
     */
    relocate(id, loc, slot) {
        const record = this._records.get(id);
        if (!record) return;
        this._detach(record);
        if (slot === null) {
            this._update(record, { location: loc, mode: Mode.FLOATING });
            return;
        }
        this._insert(loc, id, slot);
        this._update(record, { location: loc, mode: record.mode === Mode.FLOATING ? Mode.TILED : record.mode });
    }

    /** Exchanges the slots (and locations) of two slot-holding windows. */
    swap(a, b) {
        const ra = this._records.get(a);
        const rb = this._records.get(b);
        if (!ra || !rb || this.slotOf(a) === -1 || this.slotOf(b) === -1) return;
        const la = this._lists.get(locationKey(ra.location));
        const lb = this._lists.get(locationKey(rb.location));
        const ia = la.ids.indexOf(a);
        const ib = lb.ids.indexOf(b);
        la.ids[ia] = b;
        lb.ids[ib] = a;
        this._update(ra, { location: rb.location });
        this._update(rb, { location: ra.location });
    }

    /** Exchanges everything placed at two locations: slot lists and floating windows. */
    swapMonitors(locA, locB) {
        const a = this._list(locA);
        const b = this._list(locB);
        [a.ids, b.ids] = [b.ids, a.ids];
        for (const record of this.records()) {
            if (record.evacuated) continue;
            if (sameLocation(record.location, locA)) this._update(record, { location: locB });
            else if (sameLocation(record.location, locB)) this._update(record, { location: locA });
        }
    }

    /** Changes the mode; entering FLOATING frees the slot, leaving FLOATING appends to the slot list. */
    setMode(id, mode) {
        const record = this._records.get(id);
        if (!record || record.mode === mode) return;
        if (!record.evacuated) {
            if (holdsSlot(record.mode) && !holdsSlot(mode)) this._detach(record);
            else if (!holdsSlot(record.mode) && holdsSlot(mode)) this._insert(record.location, id, null);
        }
        this._update(record, { mode });
    }

    /**
     * Removes the window from its slot list and remembers its slot and monitor identity. Callers evacuating several
     * windows of one location pass the slots captured before the first removal.
     */
    evacuate(id, edid, connector, slot = this.slotOf(id)) {
        const record = this._records.get(id);
        if (!record || record.evacuated) return;
        this._detach(record);
        this._update(record, { evacuated: Object.freeze({ slot: slot === -1 ? null : slot, edid, connector }) });
    }

    /** Places an evacuated window again; a null slot makes it FLOATING. */
    restore(id, loc, slot) {
        const record = this._records.get(id);
        if (!record || !record.evacuated) return;
        if (slot === null) {
            this._update(record, { location: loc, mode: Mode.FLOATING, evacuated: null });
            return;
        }
        this._insert(loc, id, slot);
        this._update(record, {
            location: loc,
            mode: record.mode === Mode.FLOATING ? Mode.TILED : record.mode,
            evacuated: null,
        });
    }

    /** Renames a location, keeping slot order; its windows are appended to anything already at the target. */
    rekey(from, to) {
        if (sameLocation(from, to)) return;
        const source = this._lists.get(locationKey(from));
        if (source) {
            this._list(to).ids.push(...source.ids);
            this._lists.delete(locationKey(from));
        }
        this._moveRecords([from], to);
    }

    /** Merges several locations into one; the merged slot list is ordered by creation sequence. */
    merge(froms, to) {
        const ids = this.slotsAt(to);
        for (const from of froms) {
            if (sameLocation(from, to)) continue;
            ids.push(...this.slotsAt(from));
            this._lists.delete(locationKey(from));
        }
        ids.sort((a, b) => this._records.get(a).sequence - this._records.get(b).sequence);
        this._list(to).ids = ids;
        this._moveRecords(froms, to);
    }

    /** Drops empty slot lists of a workspace that no longer exists. */
    dropWorkspace(workspace) {
        for (const [key, list] of this._lists) {
            if (list.location.workspace === workspace && list.ids.length === 0) this._lists.delete(key);
        }
    }

    view() {
        return makeView(() => this);
    }

    clone() {
        const copy = new TilingState();
        for (const [key, list] of this._lists) copy._lists.set(key, { location: list.location, ids: [...list.ids] });
        copy._records = new Map(this._records);
        return copy;
    }

    _list(loc) {
        const key = locationKey(loc);
        let list = this._lists.get(key);
        if (!list) {
            list = { location: location(loc.workspace, loc.monitor), ids: [] };
            this._lists.set(key, list);
        }
        return list;
    }

    _insert(loc, id, slot) {
        const ids = this._list(loc).ids;
        const index = slot === null || slot === undefined ? ids.length : Math.max(0, Math.min(slot, ids.length));
        ids.splice(index, 0, id);
    }

    _detach(record) {
        const list = this._lists.get(locationKey(record.location));
        if (!list) return;
        const index = list.ids.indexOf(record.id);
        if (index !== -1) list.ids.splice(index, 1);
    }

    _moveRecords(froms, to) {
        for (const record of this.records()) {
            if (!record.evacuated && froms.some((from) => sameLocation(record.location, from))) {
                this._update(record, { location: to });
            }
        }
    }

    _update(record, patch) {
        this._records.set(record.id, Object.freeze({ ...record, ...patch }));
    }
}
