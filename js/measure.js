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

/**
 * A length in metres, as the label reads, in units 'cm' (metric: "8 cm" under
 * 10 cm, "85 cm" under 1 m, "1.60 m", "12.4 m") or 'ftin' (the next-build asks
 * 3.4.1: under a foot, inches to the nearest quarter, 7¼"; to 33 ft, feet and
 * inches to the nearest quarter, 5' 3", 12' 4½", 12' 0", 12" carrying to the
 * next foot; from 33 ft, feet and whole inches, 48' 3").
 */
export function formatLength(m, units = 'cm') {
	if (!Number.isFinite(m) || m < 0) return '';
	if (units === 'ftin') return formatImperial(m);
	if (m < 1) return `${Math.round(m * 100)} cm`;
	if (m < 10) return `${m.toFixed(2)} m`;
	return `${m.toFixed(1)} m`;
}

const QUARTERS = ['', '¼', '½', '¾'];
const INCH = 0.0254;

function formatImperial(m) {
	const inches = m / INCH;
	if (inches < 12) {
		const q = Math.round(inches * 4);
		if (q < 48) return `${Math.floor(q / 4) || (q % 4 ? '' : 0)}${QUARTERS[q % 4]}"`;
		return `1' 0"`; // (rounds up to a foot)
	}
	if (inches < 33 * 12) {
		const q = Math.round(inches * 4), feet = Math.floor(q / 48), rest = q - feet * 48;
		const whole = Math.floor(rest / 4), part = QUARTERS[rest % 4];
		return `${feet}' ${whole || (part ? '' : 0)}${part}"`;
	}
	const whole = Math.round(inches), feet = Math.floor(whole / 12);
	return `${feet}' ${whole - feet * 12}"`;
}

/**
 * The meter's starting units from the browser's language and region
 * (navigator.languages[0]): regions US, LR and MM start in feet and inches;
 * every other region, and a language with no region, in centimetres.
 */
export function defaultUnits(language = '') {
	const region = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/i.exec(language)?.[1]?.toUpperCase();
	return ['US', 'LR', 'MM'].includes(region) ? 'ftin' : 'cm';
}

/** The distance from the meter to where its dot is (the live reading on its screen), or '' when it hits nothing. */
export function liveReading(m, units = 'cm') {
	return m == null ? '' : formatLength(m, units);
}

/**
 * The meter's measurements. point(p) on a trigger: the first point waits, the
 * second makes a line ({ a, b, length, label, snap }). undo(), clear().
 */
export class Measurements {
	constructor() {
		this.units = 'cm'; // 'cm' | 'ftin' (the meter's dial)
		this.lines = [];
		this.pending = null; // the first point, waiting for its pair
	}

	/** A trigger on point p (model space). Returns { kind: 'start' } or { kind: 'line', line }. */
	point(p) {
		if (!this.pending) { this.pending = { ...p }; return { kind: 'start' }; }
		const a = this.pending, { point: b, snap } = snapLine(a, p);
		const length = len(sub(b, a));
		const line = { a, b, length, label: formatLength(length, this.units), snap };
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
