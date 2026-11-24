// Bare-hand gestures read from the WebXR hand joints (SPEC.md, C0.4, "Moving";
// a web page gets no gesture events, so they are detected here). Pure: joint
// positions in, events out, so it runs in Node tests. Never reads the Quest's
// "select" (a pinch never clicks a key).
//
//   pinch    palm down, thumb and index pinched and held PINCH_HOLD: aim
//   pinchEnd the pinch opens (over PINCH_OFF): go, if the landing is steady
//   open     the palm turns up while the pinch is held: cancel (the pinch must
//            open before it can aim again)
//   turn     while the pinch is held: a quick sideways flick of the wrist (the
//            hand turns over FLICK about the vertical within FLICK_TIME; dir +1
//            is to the right as you see it)
//   fist     a closed hand (three fingertips near their knuckles), and fistEnd
//   lost     the hand stopped being tracked (cancels everything)
//
// (Meta's thumb tap and swipes, the first bare-hand teleport, missed when meant
// and fired when not on the Quest 2: the user replaced them with the pinch on
// 24 Nov 2026, and the code audit's clean-up (A4) removed them. They are in the
// history (last in b9857de; SPEC.md, C0, lists the files), to retry on a Quest 3.)
//
// The thresholds are tuned on the headset (Quest 2; ?hands shows what they
// read: js/hand-readout.js). All in metres and seconds.

import * as THREE from 'three';

export const GESTURE = {
	PALM_DOWN: Math.SQRT1_2, // palm normal y below -this: palm down (within 45° of straight down)
	PALM_UP: 0.3, // palm normal y above this while pinching: turned up, cancel
	FLICK: THREE.MathUtils.degToRad(25), FLICK_TIME: 0.25, // a wrist flick: the hand turns this much about the vertical, this fast
	FIST_ON: 0.045, // three fingertips this close to their knuckles: a closed hand
	FIST_OFF: 0.06, // two over this: open again
	FIST_HOLD: 0.15,
	PINCH_ON: 0.015, PINCH_OFF: 0.03, PINCH_HOLD: 0.25, // pinched under 1.5 cm, held 0.25 s; open over 3 cm
	TRACKED: 3, // frames a hand must have been tracked before it counts
	SMOOTH: 0.03, // seconds: joint smoothing (light: a flick is quick)
};

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
/** The joints read here (WebXR names). */
export const JOINTS = ['wrist', 'thumb-tip', ...FINGERS.flatMap((f) => [`${f}-phalanx-proximal`, `${f}-tip`])];

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/**
 * What a hand is doing this frame, from its joints ({ name: Vector3 }, world
 * positions). handedness 'left' | 'right'. Returns null when a joint is missing.
 *   normal   palm normal (out of the palm)
 *   along    the hand's length (wrist to the middle knuckle), unit
 *   tips     each finger's tip-to-knuckle distance (index, middle, ring, little)
 *   pinch    thumb tip to index tip
 *   pinchAt  the point between them (the aim passes through it)
 * out: an object to fill (reused each frame: nothing allocated).
 */
export function handShape(j, handedness, out = { normal: new THREE.Vector3(), along: new THREE.Vector3(), pinchAt: new THREE.Vector3(), tips: [0, 0, 0, 0] }) {
	for (const n of JOINTS) if (!j[n]) return null;
	const w = j.wrist, ip = j['index-finger-phalanx-proximal'], lp = j['pinky-finger-phalanx-proximal'];
	out.normal.crossVectors(_a.subVectors(ip, w), _b.subVectors(lp, w)).normalize();
	if (handedness === 'left') out.normal.negate();
	out.along.subVectors(j['middle-finger-phalanx-proximal'], w).normalize();
	FINGERS.forEach((f, i) => { out.tips[i] = j[`${f}-tip`].distanceTo(j[`${f}-phalanx-proximal`]); });
	out.pinch = j['thumb-tip'].distanceTo(j['index-finger-tip']);
	out.pinchAt.addVectors(j['thumb-tip'], j['index-finger-tip']).multiplyScalar(0.5);
	return out;
}

/**
 * One hand's gesture reader. step() once per frame with the hand's joints (or
 * null when it is not tracked) and the frame time. Returns this frame's
 * events (see the top of the file).
 */
export class HandGestures {
	constructor(handedness) {
		this.handedness = handedness;
		this.reset();
	}

	reset() {
		this.smooth = null; // smoothed joints
		this.tracked = 0;
		this.pool ??= Array.from({ length: 64 }, () => ({ x: 0, t: 0 }));
		this.poolAt = 0;
		this._shape ??= undefined;
		this.fist = false; this.fistTime = 0;
		this.pinch = false; this.pinchTime = 0; this.pinchHeld = false; this.pinchSpent = false;
		this.flick = []; // the hand's heading while the pinch is held: [{ yaw, t }], from a pool
		this.clock = 0;
		this.shape = null;
	}

	step(joints, dt) {
		const G = GESTURE, out = [];
		this.clock += dt;
		if (!joints) {
			if (this.tracked >= G.TRACKED || this.fist || this.pinchHeld) out.push({ type: 'lost' });
			this.reset();
			return out;
		}
		// Light smoothing (an exponential filter per joint).
		const k = this.smooth ? 1 - Math.exp(-dt / G.SMOOTH) : 1;
		if (!this.smooth) this.smooth = {};
		for (const n of JOINTS) {
			if (!joints[n]) return out; // (a partial frame: wait)
			if (!this.smooth[n]) this.smooth[n] = joints[n].clone();
			else this.smooth[n].lerp(joints[n], k);
		}
		const s = this.shape = this._shape ? handShape(this.smooth, this.handedness, this._shape) : (this._shape = handShape(this.smooth, this.handedness));
		this.tracked++;
		if (this.tracked < G.TRACKED) return out;
		let clenched = 0, loose = 0;
		for (const d of s.tips) { if (d < G.FIST_ON) clenched++; if (d > G.FIST_OFF) loose++; }

		// A closed hand (holding the model).
		const closed = clenched >= 3;
		if (!this.fist) {
			this.fistTime = closed ? this.fistTime + dt : 0;
			if (this.fistTime >= G.FIST_HOLD) { this.fist = true; out.push({ type: 'fist' }); }
		} else if (loose >= 2) {
			this.fist = false; this.fistTime = 0; out.push({ type: 'fistEnd' });
		}

		this.pinchGesture(s, dt, out);
		return out;
	}

	/**
	 * Palm down, pinch and hold: aim; open the pinch: go. Turning the palm up
	 * cancels (open), and the pinch must open before it can aim again. While
	 * held, a quick wrist flick turns (turn).
	 */
	pinchGesture(s, dt, out) {
		const G = GESTURE;
		if (!this.pinch) {
			if (s.pinch < G.PINCH_ON) { this.pinch = true; this.pinchTime = 0; }
		} else if (s.pinch > G.PINCH_OFF) {
			this.pinch = false; this.pinchSpent = false;
			if (this.pinchHeld) { this.pinchHeld = false; out.push({ type: 'pinchEnd' }); }
			return;
		}
		if (!this.pinch || this.pinchSpent) return;
		if (!this.pinchHeld) {
			this.pinchTime += dt;
			// (The palm must be down all through the hold: a pinch while palm up or sideways never aims.)
			if (s.normal.y >= -G.PALM_DOWN) this.pinchTime = 0;
			if (this.pinchTime >= G.PINCH_HOLD) { this.pinchHeld = true; this.flick.length = 0; out.push({ type: 'pinch' }); }
			return;
		}
		if (s.normal.y > G.PALM_UP) { this.pinchHeld = false; this.pinchSpent = true; out.push({ type: 'open' }); return; }
		// A wrist flick: the hand's heading (its length, seen from above) turns over FLICK within FLICK_TIME.
		if (Math.hypot(s.along.x, s.along.z) < 0.3) return; // (pointing up or down: no heading)
		const yaw = Math.atan2(-s.along.x, -s.along.z);
		const e = this.pool[this.poolAt++ % this.pool.length];
		e.x = yaw; e.t = this.clock;
		this.flick.push(e);
		while (this.flick.length && this.clock - this.flick[0].t > G.FLICK_TIME) this.flick.shift();
		const d = THREE.MathUtils.euclideanModulo(yaw - this.flick[0].x + Math.PI, 2 * Math.PI) - Math.PI;
		if (Math.abs(d) >= G.FLICK) {
			out.push({ type: 'turn', dir: d > 0 ? -1 : 1 }); // (yaw grows turning left)
			this.flick.length = 0;
		}
	}
}

/**
 * The aim ray for a bare hand (Meta's hand guidance): from an estimated
 * shoulder (15 cm below the head, 18 cm to the hand's side) through a point
 * of the hand (the pinch point). head: world position; right: the viewer's
 * horizontal right axis. Returns { origin, dir } (origin at that point).
 */
export function handAimRay(head, right, through, handedness) {
	const shoulder = head.clone().addScaledVector(right, handedness === 'left' ? -0.18 : 0.18);
	shoulder.y -= 0.15;
	const dir = through.clone().sub(shoulder);
	if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
	return { origin: through.clone(), dir: dir.normalize() };
}
