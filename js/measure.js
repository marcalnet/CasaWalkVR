// The laser meter's measuring (SPEC.md phase 17, milestone E), pure: points
// in, lines and labels out, so the rules are tested in Node. Points are in
// model space, where one unit is one real metre whatever the scale model's
// zoom (measurements belong to the home: they move with the scale model and
// stay put while walking).
//
//   Trigger on one point, then on another: a line between them, its label its
//   real length ("1.60 m"). A line within SNAP_DEG of vertical or of level
//   snaps straight (the second point moves; a small mark says so).
//   Undo: the point waiting for its pair, else the last line. Clear: all.

export const SNAP_DEG = 3;
const SNAP = Math.sin((SNAP_DEG * Math.PI) / 180);

/** A point { x, y, z }. */
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);

/**
 * The second point of a line from a, snapped straight when nearly vertical or
 * nearly level. Returns { point, snap: 'vertical' | 'level' | null }.
 */
export function snapLine(a, b) {
	const d = sub(b, a), l = len(d);
	if (l < 1e-9) return { point: { ...b }, snap: null };
	const flat = Math.hypot(d.x, d.z);
	if (flat / l < SNAP) return { point: { x: a.x, y: b.y, z: a.z }, snap: 'vertical' };
	if (Math.abs(d.y) / l < SNAP) return { point: { x: b.x, y: a.y, z: b.z }, snap: 'level' };
	return { point: { ...b }, snap: null };
}

/** A length in metres, as the label reads: "8 cm" under 10 cm, "85 cm" under 1 m, "1.60 m", "12.4 m". */
export function formatLength(m) {
	if (!Number.isFinite(m) || m < 0) return '';
	if (m < 1) return `${Math.round(m * 100)} cm`;
	if (m < 10) return `${m.toFixed(2)} m`;
	return `${m.toFixed(1)} m`;
}

/** The distance from the meter to where its dot is (the live reading on its screen), or '' when it hits nothing. */
export function liveReading(m) {
	return m == null ? '' : formatLength(m);
}

/**
 * The meter's measurements. point(p) on a trigger: the first point waits, the
 * second makes a line ({ a, b, length, label, snap }). undo(), clear().
 */
export class Measurements {
	constructor() {
		this.lines = [];
		this.pending = null; // the first point, waiting for its pair
	}

	/** A trigger on point p (model space). Returns { kind: 'start' } or { kind: 'line', line }. */
	point(p) {
		if (!this.pending) { this.pending = { ...p }; return { kind: 'start' }; }
		const a = this.pending, { point: b, snap } = snapLine(a, p);
		const length = len(sub(b, a));
		const line = { a, b, length, label: formatLength(length), snap };
		this.lines.push(line);
		this.pending = null;
		return { kind: 'line', line };
	}

	/** Undo: the waiting point, else the last line. Returns what went: 'point', 'line' or null. */
	undo() {
		if (this.pending) { this.pending = null; return 'point'; }
		return this.lines.pop() ? 'line' : null;
	}

	clear() {
		const had = this.lines.length > 0 || !!this.pending;
		this.lines.length = 0;
		this.pending = null;
		return had;
	}
}
