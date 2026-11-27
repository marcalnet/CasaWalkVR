// Holding a tool (build 215's C1 and C2, the user's "sticky tools"; the
// UX/UI Designer's spec): take, use, bring back.
//
//   Take     close your hand on a tool in the fan (or squeeze a controller's
//            grip on it): it sticks to that hand. Every take starts in dock mode.
//   Dock     the held tool within HOLD.DOCK of the dock's middle (the fan over
//            the left hand, or waiting at its edge): take and put back. A pinch
//            (or a controller's trigger) does nothing; a fist on another tool
//            swaps them.
//   Use      the held tool more than HOLD.USE from the dock's middle (10 cm of
//            hysteresis): the hand is free, and the holding hand's pinch (or
//            the trigger) is the tool's trigger. Its quiet ring lights to full.
//   Back     the magnet: armed once the tool has been in use mode since it was
//            taken; an armed tool within HOLD.MAGNET of its own place (never
//            another tool's) glides into it, and the hand is empty again.
//            Within HOLD.OUTLINE, the empty place shows a faint outline.
//   Lost     tracking lost: the tool never drops; it stays where the hand was
//            for HOLD.LOST_HOLD, then fades; it comes back with the hand.
//
// A bare hand holds its tool in a hold frame, not at the raw wrist joint: its
// origin the middle of the palm (between the wrist and the middle finger's
// knuckle), moved HOLD.OUT out of the palm and HOLD.FORWARD forward, so the
// open fingers and the pinch stay free; the tool's working axis along the
// hand's aim ray (js/gestures.js), its up the world's up. Each tool then sits
// its own way in that frame (POSE). Pure: runs in Node tests.

import * as THREE from 'three';

export const HOLD = {
	DOCK: 0.15, USE: 0.25, // dock mode within this of the dock's middle; use mode beyond USE (m)
	MAGNET: 0.10, // an armed tool this close to its own place goes back (m)
	OUTLINE: 0.30, // an armed tool this close to its own place: the place shows its outline (m)
	GLIDE: 0.25, // seconds: the glide into its place
	OUT: 0.04, FORWARD: 0.03, // the hold frame: out of the palm, and forward of its middle (m), unless the tool says otherwise (toolPose)
	LOST_HOLD: 1, LOST_FADE: 0.2, // tracking lost: it stays this long, then fades over this (s)
	PINCH_BACK: 0.1, // the meter's point: where its dot was this long before the pinch closed (s)
	STROKE_SKIP: 0.03, // the marker: the first this much of a pinched stroke is not drawn (s)
};

/** The mode after this frame, from the last one and the held tool's distance to the dock's middle (m). */
export function nextMode(mode, dist) {
	if (mode === 'use') return dist < HOLD.DOCK ? 'dock' : 'use';
	return dist > HOLD.USE ? 'use' : 'dock';
}

/**
 * The magnet, one frame: s { armed } (armed once in use mode since the take);
 * mode this frame; dist the held tool's distance to its own place (m).
 * Returns { fire (it goes back now), outline (its place shows its outline) }.
 */
export function magnetStep(s, mode, dist) {
	if (mode === 'use') s.armed = true;
	return { fire: !!s.armed && dist < HOLD.MAGNET, outline: !!s.armed && dist < HOLD.OUTLINE };
}

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * The hold frame of a bare hand (world): wrist and knuckle (the middle
 * finger's proximal joint) give the palm's middle and its forward; normal is
 * the palm's (js/gestures.js handShape: out of the palm); aim the hand's aim
 * direction (unit). Writes out.position and out.quaternion (the tool's -Z
 * along aim, its +Y as near the world's up as aim allows).
 */
export function holdFrame(wrist, knuckle, normal, aim, out, { out: away = HOLD.OUT, forward = HOLD.FORWARD } = {}) {
	const mid = out.position.addVectors(wrist, knuckle).multiplyScalar(0.5);
	_f.subVectors(knuckle, wrist).normalize();
	mid.addScaledVector(normal, away).addScaledVector(_f, forward);
	const z = _f.copy(aim).negate().normalize(); // (+Z backwards: the tool looks along -Z)
	_u.set(0, 1, 0);
	if (Math.abs(_u.dot(z)) > 0.99) _u.set(0, 0, 1); // (aimed straight up or down: any up will do)
	const x = _r.crossVectors(_u, z).normalize(), y = _u.crossVectors(z, x);
	out.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
	return out;
}

/**
 * How each tool sits in the holding hand's frame (the Designer's table, C1),
 * for side 'right' or 'left' (mirrored): { out, forward (the hold frame's
 * offsets from the palm's middle, m), position [x, y, z] of the tool's grip
 * point in the frame, rotation [x, y, z] (radians, XYZ) }.
 *   camera  level, lens forward; its body runs inwards (it is held at its outer end)
 *   meter   upright, blade forward; its top rolled 15° in, towards the eyes
 *   marker  by its middle, straight along the aim, the nib forward
 * out and forward: per tool, the pair nearest the palm's middle that keeps
 * every part of it at most 5 mm inside the hand's joint spheres, in IWER's
 * open and pinch poses, palm down or turned in, either hand (a sweep of 4-7
 * cm out and 3-9 cm forward in 0.5 cm steps: tests/hold.test.js; the
 * Designer's rule, 27 Nov 2026).
 */
export function toolPose(name, side = 'right') {
	const s = side === 'left' ? -1 : 1, d = THREE.MathUtils.degToRad;
	switch (name) {
		case 'meter': return { out: 0.06, forward: 0.07, position: [0, 0, 0], rotation: [0, 0, s * d(15)] };
		case 'marker': return { out: 0.045, forward: 0.03, position: [0, 0, 0], rotation: [0, 0, 0] };
		case 'camera': return { out: 0.06, forward: 0.065, position: [side === 'left' ? 0.088 : 0, 0, 0], rotation: [0, 0, 0] }; // (the left hand: as if held at its other end, 8.8 cm along: js/tool-models.js's grip is at its right end)
		default: return { out: HOLD.OUT, forward: HOLD.FORWARD, position: [0, 0, 0], rotation: [0, 0, 0] };
	}
}
