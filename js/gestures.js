// Bare-hand gestures read from the WebXR hand joints (SPEC.md, C0.4, "Moving"):
// Meta's hands locomotion, detected by us (a web page gets no microgesture
// events), plus the closed hand that holds the model. Pure: joint positions
// in, events out, so it runs in Node tests. Never reads the Quest's "select"
// (a pinch never clicks).
//
//   ready   hand sideways, four fingers curled, thumb resting on the side of
//           the index (held READY_HOLD): the teleport gesture can start
//   tap     while ready: the thumb lifts off the index and comes back quickly
//   turn    while ready: the thumb slides left or right on the index (dir -1 / +1)
//   step    while ready: the thumb slides forward or back on the index (dir +1 / -1)
//   open    the fingers open (cancels an aim)
//   fist    a closed hand (three fingertips near their knuckles), and fistEnd
//   pinch   the fallback gesture (palm down, pinch held PINCH_HOLD), and pinchEnd
//   lost    the hand stopped being tracked (cancels everything)
//
// The thresholds are first guesses from the designer's notes; they are tuned
// on the headset (Quest 2). All in metres and seconds.

import * as THREE from 'three';

export const GESTURE = {
	// One switch for the headset trial: Meta's thumb tap (true), or the
	// fallback palm-down pinch-and-hold (false). Only one ships.
	THUMB_TAP: true,
	CURLED: 0.055, // a fingertip this close to its knuckle is curled
	OPEN: 0.07, // ... and this far is open
	SIDEWAYS: Math.SQRT1_2, // palm normal within 45° of horizontal (|y| below this)
	PALM_DOWN: 0.6, // palm normal y below -this: palm down (the fallback)
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
	PINCH_ON: 0.015, PINCH_OFF: 0.03, PINCH_HOLD: 0.25,
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
 *   tips     each finger's tip-to-knuckle distance (index, middle, ring, little)
 *   thumbGap the thumb tip's distance from the side of the index (its middle phalanx)
 *   pinch    thumb tip to index tip
 */
export function handShape(j, handedness) {
	for (const n of JOINTS) if (!j[n]) return null;
	const w = j.wrist, ip = j['index-finger-phalanx-proximal'], lp = j['pinky-finger-phalanx-proximal'];
	const normal = new THREE.Vector3().crossVectors(_a.subVectors(ip, w), _b.subVectors(lp, w)).normalize();
	if (handedness === 'left') normal.negate();
	const tips = FINGERS.map((f) => j[`${f}-tip`].distanceTo(j[`${f}-phalanx-proximal`]));
	const thumbGap = segmentDistance(j['thumb-tip'], j['index-finger-phalanx-intermediate'], j['index-finger-phalanx-distal']);
	return { normal, tips, thumbGap, pinch: j['thumb-tip'].distanceTo(j['index-finger-tip']), thumb: j['thumb-tip'].clone() };
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
		this.slide = []; // recent thumb positions on the index: [{ p, t }]
		this.fist = false; this.fistTime = 0;
		this.pinch = false; this.pinchTime = 0; this.pinchHeld = false;
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
		const s = this.shape = handShape(this.smooth, this.handedness);
		this.tracked++;
		if (this.tracked < G.TRACKED) return out;
		const curled = s.tips.filter((d) => d < G.CURLED).length, open = s.tips.filter((d) => d > G.OPEN).length;

		// A closed hand (holding the model).
		const closed = s.tips.filter((d) => d < G.FIST_ON).length >= 3;
		if (!this.fist) {
			this.fistTime = closed ? this.fistTime + dt : 0;
			if (this.fistTime >= G.FIST_HOLD) { this.fist = true; out.push({ type: 'fist' }); }
		} else if (s.tips.filter((d) => d > G.FIST_OFF).length >= 2) {
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
			this.readyTime = curled === 4 && sideways && s.thumbGap < G.THUMB_REST ? this.readyTime + dt : 0;
			if (this.readyTime >= G.READY_HOLD) {
				this.ready = true; this.rest = s.thumbGap; this.slide = []; this.lift = null;
				out.push({ type: 'ready' });
			}
			return;
		}
		const unready = () => { this.ready = false; this.readyTime = 0; this.lift = null; this.slide = []; out.push({ type: 'open' }); };
		// Ready: the fingers opening, or the hand turning palm up or down, ends it (and cancels an aim).
		if (open >= 2 || !sideways) return unready();
		const gap = s.thumbGap - this.rest;
		if (this.lift) {
			// A tap: lifted, then back on the index in time. Lifted too long: the hand left the pose.
			if (gap < G.TAP_BACK) {
				if (this.clock - this.lift.t <= G.TAP_TIME) out.push({ type: 'tap' });
				this.lift = null; this.slide = [];
			} else if (this.clock - this.lift.t > G.TAP_TIME) unready();
			return;
		}
		if (gap > G.TAP_LIFT) { this.lift = { t: this.clock }; this.slide = []; return; }
		this.rest += (s.thumbGap - this.rest) * Math.min(1, dt / 0.5); // (the rest drifts with the hand)
		// A swipe: the thumb slides on the index, as you see it: left / right turns, forward / back steps.
		this.slide.push({ p: s.thumb.clone(), t: this.clock });
		while (this.slide.length && this.clock - this.slide[0].t > G.SWIPE_TIME) this.slide.shift();
		if (this.slide.length < 2 || !axes) return;
		const d = _a.subVectors(s.thumb, this.slide[0].p);
		const x = d.dot(axes.right), z = d.dot(axes.forward);
		if (Math.max(Math.abs(x), Math.abs(z)) < G.SWIPE) return;
		out.push(Math.abs(x) >= Math.abs(z) ? { type: 'turn', dir: Math.sign(x) } : { type: 'step', dir: Math.sign(z) });
		this.slide = [];
	}

	/** The fallback: palm down, pinch and hold; letting go ends it. */
	pinchGesture(s, dt, out) {
		const G = GESTURE;
		if (!this.pinch) {
			if (s.pinch < G.PINCH_ON) { this.pinch = true; this.pinchTime = 0; }
		} else if (s.pinch > G.PINCH_OFF) {
			this.pinch = false;
			if (this.pinchHeld) { this.pinchHeld = false; out.push({ type: 'pinchEnd' }); }
			return;
		}
		if (this.pinch && !this.pinchHeld) {
			this.pinchTime += dt;
			if (this.pinchTime >= G.PINCH_HOLD && s.normal.y < -G.PALM_DOWN) { this.pinchHeld = true; out.push({ type: 'pinch' }); }
		}
	}
}

/**
 * The aim ray for a bare hand (Meta's hand guidance): from an estimated
 * shoulder (15 cm below the head, 18 cm to the hand's side) through the
 * wrist. head: world position; right: the viewer's horizontal right axis.
 * Returns { origin, dir } (origin at the wrist).
 */
export function handAimRay(head, right, wrist, handedness) {
	const shoulder = head.clone().addScaledVector(right, handedness === 'left' ? -0.18 : 0.18);
	shoulder.y -= 0.15;
	const dir = wrist.clone().sub(shoulder);
	if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
	return { origin: wrist.clone(), dir: dir.normalize() };
}
