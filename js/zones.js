// The areas (the next-build asks, section 5; the code audit's step 3): three
// horizontal areas round you, left, centre and right, so the tools, the
// hands and the orb never meet by accident.
//
//   left    belongs to the tools: in it they float full size over the left
//           hand; nothing hides them.
//   centre  belongs to the model (inside, to the view ahead).
//   right   belongs to the orb and the Settings wing.
// (Written for the main hand on the right; with Main hand: Left everything
// mirrors: "left" is the fan hand's side, `side` below.)
//
// Ahead: at the scale model, the direction from the head to the plinth's
// centre (it moves only as you move round the plinth); inside, the body's
// direction: the head's yaw followed slowly (still within ±25°, beyond that
// turning towards the head with a 0.8 s time constant, never lagging more
// than 60°; a snap turn or teleport turns it at once with the rig).
// The centre: at the scale model, the span as seen of the model, the plinth
// and its keys, plus 5° each side, at least ±20° and at most ±40° about
// ahead; inside, ±20°. A hand is in an area by the horizontal angle from the
// eyes to its wrist (or grip), with 5° of hysteresis: it enters the centre at
// its edge and leaves only 5° outside it. Height doesn't matter.
//
// The tools (TOOLS): home over the left hand while it is in the left area;
// else they wait at the left edge of the centre, 3° inside the left area, at
// the left hand's height and distance clamped to 10-35° below eye level and
// 0.40-0.60 m from the eyes; they glide between on a critically damped spring
// of 0.25 s. Never within 0.30 m of the eyes: pushed out along the line from
// the eyes, never hidden.
// Pure: angles in radians (positive turns left, as the rig's yaw), points in
// the world. Runs in Node tests.

import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

export const ZONES = {
	MARGIN: deg(5), MIN: deg(20), MAX: deg(40), // the scale model's centre: its span plus 5°, within ±20-40°
	HYST: deg(5), // a hand leaves the centre only this far outside its edge
	WALK_HALF: deg(20), // inside: the centre is ±20° about the body's direction
	BODY_STILL: deg(25), BODY_TAU: 0.8, BODY_LAG: deg(60), // the body's direction follows the head's
};

export const TOOLS = {
	EDGE_IN: deg(3), // waiting: this far inside the left area
	BELOW_MIN: deg(10), BELOW_MAX: deg(35), // waiting: between these below eye level
	NEAR: 0.4, FAR: 0.6, // waiting: this far from the eyes
	SPRING: 0.25, // the glide (s): critically damped
	EYES: 0.3, // never nearer the eyes than this (the clip distance): pushed out
	REACH: 0.25, REACH_CLEAR: 0.35, // the other hand's tip this close to a tool: within reach, until this far
	LOST_HOLD: 1, LOST_FADE: 0.2, // tracking lost: they stay 1 s, then fade
};

/** The shortest signed angle from a to b. */
export const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** The yaw (positive turns left; 0 looks along -Z) from `from` to `to`, horizontally. */
export const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/**
 * The scale model's centre: ahead (yaw from the head to the plinth's centre)
 * and its two edges (yaws), from the points that must stay clear (the model's
 * box corners, the plinth's corners, the keys), plus MARGIN each side, at
 * least MIN and at most MAX each side of ahead.
 */
export function scaleCentre(head, plinthCentre, points) {
	const ahead = yawTo(head, plinthCentre);
	let left = 0, right = 0;
	for (const p of points) {
		const a = angleDiff(ahead, yawTo(head, p));
		left = Math.max(left, a); right = Math.min(right, a);
	}
	const clamp = (v) => THREE.MathUtils.clamp(v + ZONES.MARGIN, ZONES.MIN, ZONES.MAX);
	return { ahead, left: ahead + clamp(left), right: ahead - clamp(-right) };
}

/** Inside: the centre ±WALK_HALF about the body's direction. */
export const walkCentre = (body) => ({ ahead: body, left: body + ZONES.WALK_HALF, right: body - ZONES.WALK_HALF });

/**
 * The body's direction, following the head's yaw: still while the head is
 * within BODY_STILL of it; beyond that it turns towards the head (BODY_TAU)
 * until it faces the same way again (within 1°), never more than BODY_LAG
 * behind. body: { yaw, following } or null (it starts where the head looks).
 * Returns the new state.
 */
export function followBody(body, head, dt) {
	if (!body) return { yaw: head, following: false };
	let { yaw, following } = body;
	let d = angleDiff(yaw, head);
	if (Math.abs(d) > ZONES.BODY_STILL) following = true;
	if (following) {
		yaw += d * (1 - Math.exp(-dt / ZONES.BODY_TAU));
		d = angleDiff(yaw, head);
		if (Math.abs(d) < THREE.MathUtils.degToRad(1)) following = false;
	}
	if (Math.abs(d) > ZONES.BODY_LAG) yaw = head - Math.sign(d) * ZONES.BODY_LAG;
	return { yaw, following };
}

/**
 * Which area a hand is in ('left' | 'centre' | 'right') by its yaw from the
 * eyes, against a centre { left, right } (yaws); `was`: its area last frame
 * (the hysteresis: once in the centre it leaves only HYST outside the edge).
 */
export function areaOf(yaw, centre, was = null) {
	const l = angleDiff(centre.left, yaw), r = angleDiff(centre.right, yaw); // (> 0: left of that edge)
	const h = was === 'centre' ? ZONES.HYST : 0;
	if (l > h) return 'left';
	if (r < -h) return 'right';
	return 'centre';
}

/**
 * Where the waiting tools go: on the fan hand's side of the centre (side +1:
 * the left area; -1: the right, with Main hand: Left), EDGE_IN inside that
 * area, at the hand's height and distance clamped (BELOW_MIN-BELOW_MAX below
 * eye level, NEAR-FAR from the eyes). Returns a world point.
 */
export function edgeSpot(head, centre, side, hand, out = new THREE.Vector3()) {
	const yaw = (side > 0 ? centre.left : centre.right) + side * TOOLS.EDGE_IN;
	const d = Math.hypot(hand.x - head.x, hand.y - head.y, hand.z - head.z);
	const flat = Math.hypot(hand.x - head.x, hand.z - head.z);
	const below = THREE.MathUtils.clamp(Math.atan2(head.y - hand.y, flat), TOOLS.BELOW_MIN, TOOLS.BELOW_MAX);
	const dist = THREE.MathUtils.clamp(d, TOOLS.NEAR, TOOLS.FAR);
	return out.set(head.x - Math.sin(yaw) * Math.cos(below) * dist, head.y - Math.sin(below) * dist, head.z - Math.cos(yaw) * Math.cos(below) * dist);
}

/** A point kept at least TOOLS.EYES from the eyes: pushed out along the line from them. */
export function keepFromEyes(p, head) {
	const d = p.distanceTo(head);
	if (d < TOOLS.EYES && d > 1e-6) p.sub(head).multiplyScalar(TOOLS.EYES / d).add(head);
	return p;
}

/**
 * A critically damped spring towards `target` over `time` (s): moves `pos`
 * and its velocity `vel` (vectors, in place) one step of dt. No overshoot.
 */
export function dampTowards(pos, vel, target, dt, time = TOOLS.SPRING) {
	const w = 2 / Math.max(1e-3, time), x = w * dt, k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	const cx = pos.x - target.x, cy = pos.y - target.y, cz = pos.z - target.z;
	const tx = (vel.x + w * cx) * dt, ty = (vel.y + w * cy) * dt, tz = (vel.z + w * cz) * dt;
	vel.set((vel.x - w * tx) * k, (vel.y - w * ty) * k, (vel.z - w * tz) * k);
	pos.set(target.x + (cx + tx) * k, target.y + (cy + ty) * k, target.z + (cz + tz) * k);
	return pos;
}

/**
 * The orb never hides a live key (the next-build asks 5.8, the Lead's
 * decision): from the eyes, the orb covers a key when it is nearer than the
 * key and the angle between their centres is under the orb's angular radius +
 * the key's angular half-diagonal + IN; clear again only beyond the same sum +
 * OUT (2° of hysteresis). Both at full size, so the orb shrinking never makes
 * it "clear". A live key behind the orb always wins (the Designer's revision, 26 Nov:
 * no "on purpose" exception: looking at the orb and at the key behind it are the same look).
 */
export const SIGHT = { IN: THREE.MathUtils.degToRad(1), OUT: THREE.MathUtils.degToRad(3), CLEAR_FOR: 0.4, ORB_R: 0.037 };

const _o = new THREE.Vector3(), _k = new THREE.Vector3();
/** True if the orb (centre orb, radius orbR) covers a key (centre key, half-diagonal keyR) seen from eye; was: it covered last frame. */
export function orbCovers(eye, orb, orbR, key, keyR, was = false) {
	const dO = _o.subVectors(orb, eye).length(), dK = _k.subVectors(key, eye).length();
	if (dO >= dK || dO < 1e-6) return false;
	const sum = Math.asin(Math.min(1, orbR / dO)) + Math.asin(Math.min(1, keyR / dK)) + (was ? SIGHT.OUT : SIGHT.IN);
	return _o.angleTo(_k) < sum;
}
