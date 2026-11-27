// Where the two settings wings go (build 111's design, item 1; 45° from build
// 120's test, the user's decision):
// How to move on the left, Settings on the right, beside the scale model like
// an open book with the model in its spine. The rule: nothing ever covers the
// model. Pure maths in view angles (Node-testable): the model's box seen from
// the eyes, plus a margin, is a keep-clear zone; a wing that would overlap it
// moves outward first (up to MAX_SIDE), then up (its centre no higher than
// MAX_UP below eye level).

import * as THREE from 'three';

const D = THREE.MathUtils.degToRad;
export const WING = {
	dist: 0.55, // metres from the eyes
	side: D(45), // from straight ahead (the user tested it: the model stays clear)
	drop: D(15), // centre below eye level
	tilt: D(20), // leaned back
	margin: D(5), // keep-clear margin round the model
	minMargin: D(2), // ... which gives way last, only when every other limit is spent, never below this (the house itself is never covered)
	maxSide: D(50), // (the Quest's view reaches about 50° to a side: further out a wing is mostly out of sight; build 120's design)
	minSide: D(30), // never nearer straight ahead than this, whatever happens (build 120's design, B8)
	maxDist: 0.62, // the last resort: further away a wing covers less of the view, never past a fingertip's reach (the harmony's conflict 13)
	ceiling: D(10), // no corner of a wing above this (the handbook's ceiling: keys up there cost the neck and the arm)
	maxUp: D(-5), // the centre never higher than this
	// With controllers (build 215's B5, the user's decision: it opened at neck or head height, pushed up clear of the
	// model): it stays low. Clearing the model it goes outward, then further away (a laser reaches it; past a controller
	// tip's reach, maxDist, only for controllers) up to laserDist, its row labels 15% larger (js/xr-ui.js) so their
	// text keeps about 0.74° there; only a home that needs more rises, just enough, its top within the ceiling (the
	// Designer, 27 Nov 2026).
	laserDist: 0.75, // metres: as far as it goes
};

/** { az (+ = left of where the head's yaw looks), el } of world point p from head. */
export function angleOf(p, head, yaw, out = { az: 0, el: 0 }) {
	const dx = p.x - head.x, dy = p.y - head.y, dz = p.z - head.z;
	const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
	const l = dx * -Math.cos(yaw) + dz * Math.sin(yaw);
	out.az = Math.atan2(l, f);
	out.el = Math.atan2(dy, Math.hypot(f, l));
	return out;
}

/**
 * The model's box seen from the head: a list of { az, el } for points on its
 * six faces (a 5 x 5 grid each: the silhouette of a box is on its edges, and a
 * small wing can sit wholly inside a big model's outline). box: a Box3 in the world.
 */
export function zoneOf(box, head, yaw) {
	const pts = [], p = { x: 0, y: 0, z: 0 };
	const lerp = (a, b, t) => a + (b - a) * t;
	const N = 4;
	for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
		const u = i / N, v = j / N;
		const xs = lerp(box.min.x, box.max.x, u), ys = lerp(box.min.y, box.max.y, u), zs = lerp(box.min.z, box.max.z, u);
		const xv = lerp(box.min.x, box.max.x, v), yv = lerp(box.min.y, box.max.y, v), zv = lerp(box.min.z, box.max.z, v);
		for (const [x, y, z] of [[xs, yv, box.min.z], [xs, yv, box.max.z], [box.min.x, yv, zs], [box.max.x, yv, zs], [xs, box.min.y, zv], [xs, box.max.y, zv]]) {
			p.x = x; p.y = y; p.z = z;
			const a = angleOf(p, head, yaw);
			if (Math.cos(a.az) > 0.05) pts.push(a);
		}
	}
	return pts.length ? pts : null;
}

/**
 * The angular rectangle of a wing w x h metres, centred at (az, el), dist away,
 * turned to the eyes and leaned back `tilt`: the bounds of its four real
 * corners as seen (the lower edge leans towards you, so it spans more than a
 * flat wing would: the interaction harmony's conflict 13).
 */
export function wingRect(az, el, w, h, dist = WING.dist, tilt = WING.tilt) {
	const c = [-Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist];
	const len = Math.hypot(...c), z = c.map((v) => -v / len); // (its face towards the eyes)
	const xl = Math.hypot(z[2], z[0]), x = [z[2] / xl, 0, -z[0] / xl]; // up × z
	const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]; // z × x
	const r = { az0: Infinity, az1: -Infinity, el0: Infinity, el1: -Infinity }, a = { az: 0, el: 0 }, p = { x: 0, y: 0, z: 0 }, O = { x: 0, y: 0, z: 0 };
	for (const sx of [-w / 2, w / 2]) for (const sy of [-h / 2, h / 2]) {
		const u = sy * Math.cos(tilt), v = -sy * Math.sin(tilt); // (leaned back: the top away from you)
		p.x = c[0] + x[0] * sx + y[0] * u + z[0] * v; p.y = c[1] + x[1] * sx + y[1] * u + z[1] * v; p.z = c[2] + x[2] * sx + y[2] * u + z[2] * v;
		angleOf(p, O, 0, a);
		r.az0 = Math.min(r.az0, a.az); r.az1 = Math.max(r.az1, a.az); r.el0 = Math.min(r.el0, a.el); r.el1 = Math.max(r.el1, a.el);
	}
	return r;
}

/** The outline of a zone (zoneOf) as seen: its convex hull, { az, el } points in order. */
export function zoneHull(zone) {
	const pts = [...zone].sort((p, q) => p.az - q.az || p.el - q.el);
	if (pts.length < 3) return pts;
	const cross = (o, a, b) => (a.az - o.az) * (b.el - o.el) - (a.el - o.el) * (b.az - o.az);
	const lower = [], upper = [];
	for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
	for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
	return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * True if the direction a ({ az, el }) is inside the model's silhouette seen
 * from the eyes (the hull of its zone), or within `margin` of it.
 */
export function inZone(a, hull, margin = 0) {
	if (!hull?.length) return false;
	let inside = hull.length >= 3, best = Infinity;
	for (let i = 0; i < hull.length; i++) {
		const p = hull[i], q = hull[(i + 1) % hull.length];
		const ex = q.az - p.az, ey = q.el - p.el, l2 = ex * ex + ey * ey;
		if (ex * (a.el - p.el) - ey * (a.az - p.az) < 0) inside = false; // (the hull runs anticlockwise: inside is on every edge's left)
		const t = l2 ? Math.max(0, Math.min(1, ((a.az - p.az) * ex + (a.el - p.el) * ey) / l2)) : 0;
		best = Math.min(best, Math.hypot(a.az - p.az - t * ex, a.el - p.el - t * ey));
	}
	return inside || best < margin;
}

/** True if any point along the edges of the angular rectangle r is in the silhouette (hull) or within margin of it. */
export function edgeIn(r, hull, margin = 0) {
	const N = 6, a = { az: 0, el: 0 };
	for (let i = 0; i <= N; i++) {
		const t = i / N;
		for (const [az, el] of [[r.az0 + (r.az1 - r.az0) * t, r.el0], [r.az0 + (r.az1 - r.az0) * t, r.el1], [r.az0, r.el0 + (r.el1 - r.el0) * t], [r.az1, r.el0 + (r.el1 - r.el0) * t]]) {
			a.az = az; a.el = el;
			if (inZone(a, hull, margin)) return true;
		}
	}
	return false;
}

/** True if any zone point is inside the rectangle r grown by margin. */
export function overlaps(r, zone, margin = 0) {
	return zone.some((q) => q.az > r.az0 - margin && q.az < r.az1 + margin && q.el > r.el0 - margin && q.el < r.el1 + margin);
}

/**
 * Where a wing goes: side +1 (left) or -1 (right); w, h its size (m); zone
 * the model's points in view (zoneOf; or null: nothing in the way, as inside the home).
 * Returns { az, el, dist, margin, clear } of its centre, relative to where
 * the head looks: outward first (to maxSide), then up (while its top stays
 * within the ceiling), then further from the eyes (within reach), and only
 * then the margin shrinks from WING.margin towards WING.minMargin (the
 * interaction harmony's conflict 13). clear is false when even that cannot
 * keep the model uncovered (a model zoomed up to fill the view).
 */
export function placeWing(side, w, h, zone, { laser = false } = {}) {
	let az = side * WING.side, el = -WING.drop, dist = WING.dist, margin = WING.margin;
	if (!zone) return { az, el, dist, margin, clear: true };
	const hull = zoneHull(zone), a = { az: 0, el: 0 };
	const hits = () => {
		const r = wingRect(az, el, w, h, dist);
		if (overlaps(r, zone, margin)) return true;
		for (const [x, y] of [[r.az0, r.el0], [r.az1, r.el0], [r.az1, r.el1], [r.az0, r.el1]]) { a.az = x; a.el = y; if (inZone(a, hull, margin)) return true; } // (a corner of it on the outline)
		return false;
	};
	while (hits() && Math.abs(az) < WING.maxSide) az += side * D(1); // outward first
	if (laser) { // (controllers: further away, then up just enough: see WING.laserDist)
		while (hits() && dist + 0.01 <= WING.laserDist + 1e-9) dist += 0.01;
		while (hits() && wingRect(az, el + D(1), w, h, dist).el1 <= WING.ceiling + 1e-9) el += D(1);
		while (hits() && margin - D(0.5) >= WING.minMargin - 1e-9) margin -= D(0.5);
		if (Math.abs(az) < WING.minSide) az = side * WING.minSide;
		return { az, el, dist, margin, clear: !hits() };
	}
	const under = (e) => wingRect(az, e, w, h, dist).el1 <= WING.ceiling + 1e-9; // (its top corners within the ceiling)
	while (hits() && el + D(1) <= WING.maxUp && under(el + D(1))) el += D(1); // then up, never past the ceiling
	while (hits() && dist + 0.01 <= WING.maxDist + 1e-9) dist += 0.01; // then back, within reach
	while (hits() && margin - D(0.5) >= WING.minMargin - 1e-9) margin -= D(0.5); // the margin gives way last
	if (Math.abs(az) < WING.minSide) az = side * WING.minSide; // (never inwards: only a guard)
	return { az, el, dist, margin, clear: !hits() };
}
