// Bare-hand gestures from the joints (js/gestures.js): the Quest 2 teleport
// (palm down, pinch and hold, a wrist flick to turn), the closed hand, lost
// tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HandGestures, GESTURE, handShape, handAimRay } from '../js/gestures.js';

// A right hand in its own frame, in cm: x towards the thumb, y the back of the
// hand, z along the fingers. Curled fingers, the thumb on the side of the
// index's middle phalanx.
const PROX = { index: [2.5, 0, 9], middle: [0.8, 0, 9.5], ring: [-0.9, 0, 9], pinky: [-2.5, 0, 8] };
function hand({ curled = true, thumb = [4, -3.8, 10.5], clench = false } = {}) {
	const j = { wrist: [0, 0, 0], 'thumb-tip': thumb };
	for (const [f, p] of Object.entries(PROX)) {
		const name = f === 'pinky' ? 'pinky-finger' : `${f}-finger`;
		j[`${name}-phalanx-proximal`] = p;
		// (Curled loosely, about 5 cm from the knuckle; clenched for a fist, about 3.6 cm.)
		j[`${name}-tip`] = !curled ? [p[0], 0, p[2] + 8] : clench ? [p[0], -3.5, p[2] - 1] : [p[0], -4.6, p[2] - 1.8];
	}
	if (curled) Object.assign(j, { 'index-finger-phalanx-intermediate': [2.5, -3, 11.5], 'index-finger-phalanx-distal': [2.5, -4.5, 9.5], 'index-finger-tip': clench ? [2.5, -4, 7.8] : [2.5, -4.6, 7.4] });
	else Object.assign(j, { 'index-finger-phalanx-intermediate': [2.5, 0, 13], 'index-finger-phalanx-distal': [2.5, 0, 15.5], 'index-finger-tip': [2.5, 0, 17.5] });
	return j;
}
// Into the world (metres): held sideways in front of you (palm facing left,
// fingers forward, thumb up), or palm down.
const SIDEWAYS = ([x, y, z]) => new THREE.Vector3(y, x, -z).multiplyScalar(0.01).add(new THREE.Vector3(0.2, 1.2, -0.3));
const PALM_DOWN = ([x, y, z]) => new THREE.Vector3(-x, y, -z).multiplyScalar(0.01).add(new THREE.Vector3(0.2, 1.2, -0.3));
const world = (j, place = SIDEWAYS) => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, place(v)]));
const HEAD = new THREE.Vector3(0, 1.6, 0); // the eyes: 40 cm above and behind the test hand (at 0.2, 1.2, -0.3)
const DT = 1 / 72;

/** Runs a hand for `seconds` (joints, or a function of time), collecting events. */
function run(g, seconds, joints) {
	const events = [];
	for (let t = 0; t < seconds; t += DT) events.push(...g.step(typeof joints === 'function' ? joints(Math.min(1, (t + DT) / seconds)) : joints, DT, HEAD));
	return events.map((e) => e.dir ? `${e.type}${e.dir > 0 ? '+' : '-'}` : e.type);
}

test('the hand shape: a sideways palm, curled or open fingers', () => {
	const s = handShape(world(hand()), 'right');
	assert.ok(Math.abs(s.normal.y) < 0.1 && s.normal.x < -0.9, 'the palm faces left (towards the other hand)');
	assert.ok(s.tips.every((d) => d < 0.055), 'four fingers curled');
	assert.ok(handShape(world(hand({ curled: false })), 'right').tips.every((d) => d > 0.07), 'an open hand');
	assert.equal(handShape({ wrist: new THREE.Vector3() }, 'right'), null, 'missing joints: nothing');
});

test('a closed hand holds; opening lets go; a lost hand cancels', () => {
	const g = new HandGestures('right');
	const ev = run(g, 0.3, world(hand({ thumb: [3, -2, 6], clench: true })));
	assert.ok(ev.includes('fist'), 'three fingertips by their knuckles, 0.15 s');
	assert.deepEqual(run(g, 0.1, world(hand({ curled: false }))), ['fistEnd']);
	run(g, 0.3, world(hand({ thumb: [3, -2, 6], clench: true })));
	assert.ok(g.fist);
	assert.deepEqual(run(g, DT, null), ['lost']);
	assert.ok(!g.fist && !g.pinchHeld);
	assert.deepEqual(run(g, 2 * DT, world(hand())), [], 'tracked again: a few frames before it counts');
});

test('the left hand reads the same way', () => {
	const mirror = (j) => Object.fromEntries(Object.entries(j).map(([k, [x, y, z]]) => [k, [-x, y, z]]));
	// A left hand held sideways: palm facing right, thumb up.
	const LEFT = ([x, y, z]) => new THREE.Vector3(-y, -x, -z).multiplyScalar(0.01).add(new THREE.Vector3(-0.2, 1.2, -0.3));
	const s = handShape(world(mirror(hand()), LEFT), 'left');
	assert.ok(s.normal.x > 0.9, 'the palm faces right');
	const g = new HandGestures('left');
	assert.ok(run(g, 0.3, world(mirror(hand({ thumb: [3, -2, 6], clench: true })), LEFT)).includes('fist'));
});

// The teleport (eager since 25 Nov): any pinch held 0.1 s aims, unless the palm faces the eyes.
const PINCHED = [2.5, 0.5, 17.5], OPENED = [6, -1, 7];
/** A palm-down hand, turned by yaw (radians, about the vertical through the wrist; positive: to the left). */
const palmDown = (thumb, yaw = 0) => world(hand({ curled: false, thumb }), (v) => PALM_DOWN(v).sub(PALM_DOWN([0, 0, 0])).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(PALM_DOWN([0, 0, 0])));

test('the teleport: a pinch held 0.1 s aims, palm down or sideways; opening it goes', () => {
	const g = new HandGestures('right');
	const s = handShape(palmDown(PINCHED), 'right');
	assert.ok(s.pinch < GESTURE.PINCH_ON, 'pinched');
	assert.ok(s.pinchAt.distanceTo(palmDown(PINCHED)['thumb-tip']) < 0.01, 'the pinch point between thumb and index');
	assert.deepEqual(run(g, 0.05, palmDown(PINCHED)), [], 'not yet: held under 0.1 s');
	assert.deepEqual(run(g, 0.1, palmDown(PINCHED)), ['pinch']);
	assert.deepEqual(run(g, 0.1, palmDown(OPENED)), ['pinchEnd']);
	g.reset();
	assert.deepEqual(run(g, 0.3, world(hand({ curled: false, thumb: PINCHED }))), ['pinch'], 'sideways (the natural pinch): aims too');
	g.reset();
	// A looser pinch closes it: thumb and index 2 cm apart.
	assert.deepEqual(run(g, 0.3, palmDown([2.5, 2, 17.5])), ['pinch'], 'a loose 2 cm pinch aims');
});

test('the teleport: a palm facing your eyes never aims (Meta\'s menu gesture)', () => {
	const UP = ([x, y, z]) => new THREE.Vector3(x, -y, -z).multiplyScalar(0.01).add(new THREE.Vector3(0.2, 1.2, -0.3));
	const g = new HandGestures('right');
	assert.deepEqual(run(g, 0.5, world(hand({ curled: false, thumb: PINCHED }), UP)), [], 'palm up, towards the eyes');
	assert.ok(g.shape.toEyes > GESTURE.TO_EYES);
});

test('the teleport: turning the palm towards your eyes cancels, and the pinch must open before it aims again', () => {
	const g = new HandGestures('right');
	run(g, 0.4, palmDown(PINCHED));
	const UP = ([x, y, z]) => new THREE.Vector3(x, -y, -z).multiplyScalar(0.01).add(new THREE.Vector3(0.2, 1.2, -0.3));
	assert.deepEqual(run(g, 0.1, world(hand({ curled: false, thumb: PINCHED }), UP)), ['open']);
	assert.deepEqual(run(g, 0.5, palmDown(PINCHED)), [], 'palm down again, still pinched: no aim');
	assert.deepEqual(run(g, 0.1, palmDown(OPENED)), [], 'opened: nothing to end');
	assert.deepEqual(run(g, 0.4, palmDown(PINCHED)), ['pinch'], 'a new pinch aims');
});

test('the teleport: a quick wrist flick while aiming turns; a slow turn does not', () => {
	const g = new HandGestures('right');
	run(g, 0.4, palmDown(PINCHED));
	const deg = THREE.MathUtils.degToRad;
	assert.deepEqual(run(g, 0.15, (t) => palmDown(PINCHED, deg(-35) * t)), ['turn+'], 'flicked to the right');
	assert.deepEqual(run(g, 0.3, palmDown(PINCHED, deg(-35))), [], 'held there: nothing more');
	assert.deepEqual(run(g, 0.15, (t) => palmDown(PINCHED, deg(-35 + 35 * t))), ['turn-'], 'and back: to the left');
	assert.deepEqual(run(g, 1.5, (t) => palmDown(PINCHED, deg(40) * t)), [], 'a slow 40° turn in 1.5 s');
	assert.deepEqual(run(g, 0.1, palmDown(OPENED, deg(40))), ['pinchEnd']);
});

// Tracking jitter (about ±6 mm per joint, the tester's probe): a still pinch does nothing but aim.
test('a still pinch with ±6 mm jitter on every joint: no turns, no letting go in 10 s', () => {
	let seed = 7;
	const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.012;
	const g = new HandGestures('right');
	const base = palmDown([2.5, 0.2, 17.6]); // (thumb and index 2 mm apart: jitter never opens it past 4 cm)
	const ev = run(g, 10, () => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.clone().add(new THREE.Vector3(rnd(), rnd(), rnd()))])));
	assert.deepEqual(ev.filter((e) => e !== 'fist' && e !== 'fistEnd'), ['pinch'], JSON.stringify(ev));
});

test('the aim ray runs from the shoulder through the hand', () => {
	const head = new THREE.Vector3(0, 1.6, 0), right = new THREE.Vector3(1, 0, 0);
	const r = handAimRay(head, right, new THREE.Vector3(0.18, 1.2, -0.4), 'right');
	assert.ok(r.dir.z < -0.8 && r.dir.y < 0 && Math.abs(r.dir.x) < 1e-6, 'a relaxed hand at chest level aims ahead and down');
});

test('a clenched fist is a closed hand, never a pinch', () => {
	const g = new HandGestures('right');
	const ev = run(g, 0.4, world(hand({ clench: true }), PALM_DOWN));
	assert.ok(ev.includes('fist') && !ev.includes('pinch'), JSON.stringify(ev));
});


test('the teleport: turning your whole body with the pinch held is not a flick (the hand turns with the head)', () => {
	const g = new HandGestures('right');
	const deg = THREE.MathUtils.degToRad;
	const stepAll = (secs, rot, headYaw) => {
		const out = [];
		for (let t = 0; t < secs; t += 1 / 72) {
			const f = Math.min(1, t / secs);
			const joints = palmDown(PINCHED, rot * f);
			out.push(...g.step(joints, 1 / 72, new THREE.Vector3(0, 1.6, 0), headYaw * f).map((e) => e.type + (e.dir ?? '')));
		}
		return out;
	};
	stepAll(0.4, 0, 0);
	// The body turns 40 degrees in 0.15 s: hand and head together.
	assert.deepEqual(stepAll(0.15, deg(40), deg(40)).filter((e) => e.startsWith('turn')), [], 'a brisk body turn: no snap turn');
	// A real flick (the hand turns 40 degrees, the head does not).
	const g2 = new HandGestures('right');
	for (let t = 0; t < 0.4; t += 1 / 72) g2.step(palmDown(PINCHED), 1 / 72, new THREE.Vector3(0, 1.6, 0), 0);
	const ev = [];
	for (let t = 0; t < 0.15; t += 1 / 72) ev.push(...g2.step(palmDown(PINCHED, deg(40) * Math.min(1, t / 0.15)), 1 / 72, new THREE.Vector3(0, 1.6, 0), 0).map((e) => e.type));
	assert.ok(ev.includes('turn'), 'the flick alone still turns');
});
