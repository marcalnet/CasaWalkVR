// Where the two settings wings go (planning design, build 111 asks, item 1):
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
	side: D(40), // from straight ahead
	drop: D(15), // centre below eye level
	tilt: D(20), // leaned back
	margin: D(5), // keep-clear margin round the model
	maxSide: D(55),
	maxUp: D(-5), // the centre never higher than this
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

/** The angular rectangle of a wing w x h metres, centred at (az, el), dist away. */
export function wingRect(az, el, w, h, dist = WING.dist) {
	const hw = Math.atan(w / 2 / dist), hh = Math.atan(h / 2 / dist);
	return { az0: az - hw, az1: az + hw, el0: el - hh, el1: el + hh };
}

/** True if any zone point is inside the rectangle r grown by margin. */
export function overlaps(r, zone, margin = 0) {
	return zone.some((q) => q.az > r.az0 - margin && q.az < r.az1 + margin && q.el > r.el0 - margin && q.el < r.el1 + margin);
}

/**
 * Where a wing goes: side +1 (left) or -1 (right); w, h its size (m); zone
 * the model's points in view (zoneOf; or null: nothing in the way, as inside the home).
 * Returns { az, el } of its centre, relative to where the head looks.
 */
export function placeWing(side, w, h, zone) {
	let az = side * WING.side, el = -WING.drop;
	if (!zone) return { az, el };
	const hits = () => overlaps(wingRect(az, el, w, h), zone, WING.margin);
	while (hits() && Math.abs(az) < WING.maxSide) az += side * D(1); // outward first
	while (hits() && el < WING.maxUp) el += D(1); // then up
	return { az, el };
}
