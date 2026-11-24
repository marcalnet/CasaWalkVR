// Bare-hand gestures read from the WebXR hand joints (SPEC.md, C0.4, "Moving"):
// Meta's hands locomotion, detected by us (a web page gets no microgesture
// events), plus the closed hand that holds the model. Pure: joint positions
// in, events out, so it runs in Node tests. Never reads the Quest's "select"
// (a pinch never clicks).
//
// The Quest 2 teleport (the user's decision, 24 Nov: the thumb tap was missed
// when meant and fired when not; it stays behind GESTURE.THUMB_TAP, off, to
// retry on a Quest 3):
//   pinch    palm down, thumb and index pinched and held PINCH_HOLD: aim
//   pinchEnd the pinch opens (over PINCH_OFF): go, if the landing is steady
//   open     the palm turns up while the pinch is held: cancel (the pinch must
//            open before it can aim again)
//   turn     while the pinch is held: a quick sideways flick of the wrist (the
//            hand turns over FLICK about the vertical within FLICK_TIME; dir +1
//            is to the right as you see it)
// With GESTURE.THUMB_TAP on (Meta's microgestures):
//   ready   hand sideways, four fingers curled, thumb resting on the side of
//           the index (held READY_HOLD): the teleport gesture can start
//   tap     while ready: the thumb lifts off the index and comes back quickly
//   turn    while ready: the thumb slides left or right on the index (dir -1 / +1)
//   step    while ready: the thumb slides forward or back on the index (dir +1 / -1)
//   open    the fingers open (cancels an aim)
// Always:
//   fist    a closed hand (three fingertips near their knuckles), and fistEnd
//   lost    the hand stopped being tracked (cancels everything)
//
// The thresholds are first guesses from the designer's notes; they are tuned
// on the headset (Quest 2). All in metres and seconds.

import * as THREE from 'three';

export const GESTURE = {
	// Meta's thumb tap (true), or palm-down pinch-and-hold (false, the Quest 2
	// design of 24 Nov). Only one ships.
	THUMB_TAP: false,
	CURLED: 0.055, // a fingertip this close to its knuckle is curled
	OPEN: 0.07, // ... and this far is open
	SIDEWAYS: Math.SQRT1_2, // palm normal within 45° of horizontal (|y| below this)
	PALM_DOWN: Math.SQRT1_2, // palm normal y below -this: palm down (within 45° of straight down)
	PALM_UP: 0.3, // palm normal y above this while pinching: turned up, cancel
	FLICK: THREE.MathUtils.degToRad(25), FLICK_TIME: 0.25, // a wrist flick: the hand turns this much about the vertical, this fast
	THUMB_REST: 0.025, // thumb tip this close to the index's side: resting on it
	READY_HOLD: 0.15, // the ready pose held this long
	TAP_LIFT: 0.012, // a tap lifts the thumb at least this far off its rest
	TAP_BACK: 0.006, // ... and comes back to within this of it
	TAP_TIME: 0.45, // ... within this time
	SWIPE: 0.015, // a swipe slides the thumb at least this far
	SWIPE_TIME: 0.35, // ... within this time, staying on the index (not lifted)
	FIST_ON: 0.045, // three fingertips this close to their knuckles: a closed hand
	FIST_OFF: 0.06, // two over this: open again
	FIST_HOLD: 0.15,
	PINCH_ON: 0.015, PINCH_OFF: 0.03, PINCH_HOLD: 0.25, // pinched under 1.5 cm, held 0.25 s; open over 3 cm
	TRACKED: 3, // frames a hand must have been tracked before it counts
	SMOOTH: 0.03, // seconds: joint smoothing (light: taps are quick)
};

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
/** The joints read here (WebXR names). */
export const JOINTS = ['wrist', 'thumb-tip', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
	...FINGERS.flatMap((f) => [`${f}-phalanx-proximal`, `${f}-tip`])];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** Distance from p to the segment a–b. */
export function segmentDistance(p, a, b) {
	_a.subVectors(b, a);
	const len2 = _a.lengthSq();
	const t = len2 > 1e-12 ? THREE.MathUtils.clamp(_b.subVectors(p, a).dot(_a) / len2, 0, 1) : 0;
	return _c.copy(a).addScaledVector(_a, t).distanceTo(p);
}

/**
 * What a hand is doing this frame, from its joints ({ name: Vector3 }, world
 * positions). handedness 'left' | 'right'. Returns null when a joint is missing.
 *   normal   palm normal (out of the palm)
 *   along    the hand's length (wrist to the middle knuckle), unit
 *   tips     each finger's tip-to-knuckle distance (index, middle, ring, little)
 *   thumbGap the thumb tip's distance from the side of the index (its middle phalanx)
 *   rel      the thumb tip from the index's middle joint: moves only when the
 *            thumb moves on the finger, never when the whole hand moves (the
 *            tester's finding: swipes are read from this)
 *   pinch    thumb tip to index tip
 *   pinchAt  the point between them (the aim passes through it)
 * out: an object to fill (reused each frame: nothing allocated).
 */
export function handShape(j, handedness, out = { normal: new THREE.Vector3(), along: new THREE.Vector3(), rel: new THREE.Vector3(), thumb: new THREE.Vector3(), pinchAt: new THREE.Vector3(), tips: [0, 0, 0, 0] }) {
	for (const n of JOINTS) if (!j[n]) return null;
	const w = j.wrist, ip = j['index-finger-phalanx-proximal'], lp = j['pinky-finger-phalanx-proximal'];
	out.normal.crossVectors(_a.subVectors(ip, w), _b.subVectors(lp, w)).normalize();
	if (handedness === 'left') out.normal.negate();
	out.along.subVectors(j['middle-finger-phalanx-proximal'], w).normalize();
	FINGERS.forEach((f, i) => { out.tips[i] = j[`${f}-tip`].distanceTo(j[`${f}-phalanx-proximal`]); });
	out.thumbGap = segmentDistance(j['thumb-tip'], j['index-finger-phalanx-intermediate'], j['index-finger-phalanx-distal']);
	out.rel.subVectors(j['thumb-tip'], j['index-finger-phalanx-intermediate']);
	out.thumb.copy(j['thumb-tip']);
	out.pinch = j['thumb-tip'].distanceTo(j['index-finger-tip']);
	out.pinchAt.addVectors(j['thumb-tip'], j['index-finger-tip']).multiplyScalar(0.5);
	return out;
}

/**
 * One hand's gesture reader. step() once per frame with the hand's joints (or
 * null when it is not tracked), the frame time, and the viewer's horizontal
 * right and forward axes (world, unit) so a swipe's direction reads as you see
 * it. Returns this frame's events (see the top of the file).
 */
export class HandGestures {
	constructor(handedness) {
		this.handedness = handedness;
		this.reset();
	}

	reset() {
		this.smooth = null; // smoothed joints
		this.tracked = 0;
		this.ready = false; this.readyTime = 0;
		this.rest = null; // the thumb's gap from the index at rest (while ready)
		this.lift = null; // a tap in progress: { t }
		this.slide = []; // recent thumb positions on the index (relative to it): [{ x, y, z, t }], from a pool
		this.pool ??= Array.from({ length: 64 }, () => ({ x: 0, y: 0, z: 0, t: 0 }));
		this.poolAt = 0;
		this._shape ??= undefined;
		this.fist = false; this.fistTime = 0;
		this.pinch = false; this.pinchTime = 0; this.pinchHeld = false; this.pinchSpent = false;
		this.flick = []; // the hand's heading while the pinch is held: [{ yaw, t }], from a pool
		this.clock = 0;
		this.shape = null;
	}

	step(joints, dt, axes) {
		const G = GESTURE, out = [];
		this.clock += dt;
		if (!joints) {
			if (this.tracked >= G.TRACKED || this.ready || this.fist || this.pinchHeld) out.push({ type: 'lost' });
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
		let curled = 0, open = 0, clenched = 0, loose = 0;
		for (const d of s.tips) { if (d < G.CURLED) curled++; if (d > G.OPEN) open++; if (d < G.FIST_ON) clenched++; if (d > G.FIST_OFF) loose++; }
		this.clenched = clenched;

		// A closed hand (holding the model).
		const closed = clenched >= 3;
		if (!this.fist) {
			this.fistTime = closed ? this.fistTime + dt : 0;
			if (this.fistTime >= G.FIST_HOLD) { this.fist = true; out.push({ type: 'fist' }); }
		} else if (loose >= 2) {
			this.fist = false; this.fistTime = 0; out.push({ type: 'fistEnd' });
		}

		if (G.THUMB_TAP) this.thumbGestures(s, curled, open, dt, axes, out);
		else this.pinchGesture(s, dt, out);
		return out;
	}

	/** Meta's microgestures: ready, tap, swipes; opening the hand cancels. */
	thumbGestures(s, curled, open, dt, axes, out) {
		const G = GESTURE;
		const sideways = Math.abs(s.normal.y) < G.SIDEWAYS;
		if (!this.ready) {
			// (Curled, not clenched: a fist is a closed hand, never the ready pose; the tester's finding.)
			this.readyTime = curled === 4 && this.clenched < 3 && sideways && s.thumbGap < G.THUMB_REST ? this.readyTime + dt : 0;
			if (this.readyTime >= G.READY_HOLD) {
				this.ready = true; this.rest = s.thumbGap; this.slide.length = 0; this.lift = null;
				out.push({ type: 'ready' });
			}
			return;
		}
		const unready = () => { this.ready = false; this.readyTime = 0; this.lift = null; this.slide.length = 0; out.push({ type: 'open' }); };
		// Ready: the fingers opening, the hand clenching into a fist, or turning palm up or down, ends it (and cancels an aim).
		if (open >= 2 || !sideways || this.clenched >= 3) return unready();
		const gap = s.thumbGap - this.rest;
		if (this.lift) {
			// A tap: lifted, then back on the index in time. Lifted too long: the hand left the pose.
			if (gap < G.TAP_BACK) {
				if (this.clock - this.lift.t <= G.TAP_TIME) out.push({ type: 'tap' });
				this.lift = null; this.slide.length = 0;
			} else if (this.clock - this.lift.t > G.TAP_TIME) unready();
			return;
		}
		if (gap > G.TAP_LIFT) { this.lift = { t: this.clock }; this.slide.length = 0; return; }
		this.rest += (s.thumbGap - this.rest) * Math.min(1, dt / 0.5); // (the rest drifts with the hand)
		// A swipe: the thumb slides on the index. Read in the hand's own frame (the
		// thumb relative to the index, so moving the whole hand is never a swipe):
		// across the hand (along the palm normal: left or right as you see a
		// sideways hand) turns, along it (towards the fingers or the wrist) steps.
		// The view axes only give the sign, as you see it.
		const e = this.pool[this.poolAt++ % this.pool.length];
		e.x = s.rel.x; e.y = s.rel.y; e.z = s.rel.z; e.t = this.clock;
		this.slide.push(e);
		while (this.slide.length && this.clock - this.slide[0].t > G.SWIPE_TIME) this.slide.shift();
		if (this.slide.length < 2 || !axes) return;
		const f = this.slide[0], d = _a.set(s.rel.x - f.x, s.rel.y - f.y, s.rel.z - f.z);
		const across = d.dot(s.normal), along = d.dot(s.along);
		if (Math.max(Math.abs(across), Math.abs(along)) < G.SWIPE) return;
		if (Math.abs(across) >= Math.abs(along)) {
			const dir = Math.sign(across * s.normal.dot(axes.right));
			if (dir) out.push({ type: 'turn', dir });
		} else {
			const dir = Math.sign(along * s.along.dot(axes.forward));
			if (dir) out.push({ type: 'step', dir });
		}
		this.slide.length = 0;
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
 * of the hand (the pinch point; the wrist with the thumb tap). head: world
 * position; right: the viewer's horizontal right axis. Returns { origin, dir }
 * (origin at that point).
 */
export function handAimRay(head, right, wrist, handedness) {
	const shoulder = head.clone().addScaledVector(right, handedness === 'left' ? -0.18 : 0.18);
	shoulder.y -= 0.15;
	const dir = wrist.clone().sub(shoulder);
	if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
	return { origin: wrist.clone(), dir: dir.normalize() };
}
