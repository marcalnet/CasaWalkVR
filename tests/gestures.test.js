// Bare-hand gestures from the joints (js/gestures.js): Meta's thumb tap and
// swipes, the closed hand, the pinch-and-hold fallback, lost tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HandGestures, GESTURE, handShape, handAimRay } from '../js/gestures.js';

// A right hand in its own frame, in cm: x towards the thumb, y the back of the
// hand, z along the fingers. Curled fingers, the thumb on the side of the
// index's middle phalanx (the ready pose).
const PROX = { index: [2.5, 0, 9], middle: [0.8, 0, 9.5], ring: [-0.9, 0, 9], pinky: [-2.5, 0, 8] };
function hand({ curled = true, thumb = [4, -3.8, 10.5], clench = false } = {}) {
	const j = { wrist: [0, 0, 0], 'thumb-tip': thumb };
	for (const [f, p] of Object.entries(PROX)) {
		const name = f === 'pinky' ? 'pinky-finger' : `${f}-finger`;
		j[`${name}-phalanx-proximal`] = p;
		// (Curled loosely for the ready pose, about 5 cm from the knuckle; clenched for a fist, about 3.6 cm.)
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
const axes = { right: new THREE.Vector3(1, 0, 0), forward: new THREE.Vector3(0, 0, -1) };
const DT = 1 / 72;

/** Runs a hand for `seconds` (joints, or a function of time), collecting events. */
function run(g, seconds, joints) {
	const events = [];
	for (let t = 0; t < seconds; t += DT) events.push(...g.step(typeof joints === 'function' ? joints(Math.min(1, (t + DT) / seconds)) : joints, DT, axes));
	return events.map((e) => e.dir ? `${e.type}${e.dir > 0 ? '+' : '-'}` : e.type);
}
/** The same, without the closed hand's events (the ready pose is a closed hand too: near the model it holds, js/xr-dollhouse.js). */
const moves = (...a) => run(...a).filter((e) => e !== 'fist' && e !== 'fistEnd');
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const REST = [4, -3.8, 10.5];

test('the hand shape: a sideways palm, curled fingers, the thumb on the index', () => {
	const s = handShape(world(hand()), 'right');
	assert.ok(Math.abs(s.normal.y) < 0.1 && s.normal.x < -0.9, 'the palm faces left (towards the other hand)');
	assert.ok(s.tips.every((d) => d < GESTURE.CURLED), 'four fingers curled');
	assert.ok(s.thumbGap < GESTURE.THUMB_REST, 'the thumb rests on the index');
	assert.ok(handShape(world(hand({ curled: false })), 'right').tips.every((d) => d > GESTURE.OPEN), 'an open hand');
	assert.equal(handShape({ wrist: new THREE.Vector3() }, 'right'), null, 'missing joints: nothing');
});

test('ready, tap, swipe to turn, swipe to step, open to cancel', () => {
	const g = new HandGestures('right');
	assert.deepEqual(moves(g, 0.3, world(hand())), ['ready'], 'the pose held 0.15 s');
	// A tap: the thumb lifts 1.6 cm and comes back within 0.45 s.
	const up = [5.6, -3.8, 10.5];
	assert.deepEqual([...moves(g, 0.12, world(hand({ thumb: up }))), ...moves(g, 0.1, world(hand()))], ['tap']);
	// A slow lift that stays away is not a tap: it ends the pose.
	assert.deepEqual(moves(g, 0.7, world(hand({ thumb: up }))), ['open']);
	assert.deepEqual(moves(g, 0.3, world(hand())), ['ready']);
	// The thumb slides right (as you see it) along the index: turn right; left: turn left.
	assert.deepEqual(moves(g, 0.2, (t) => world(hand({ thumb: lerp(REST, [4, -1.8, 10.5], t) }))), ['turn+']);
	assert.deepEqual(moves(g, 0.2, (t) => world(hand({ thumb: lerp([4, -1.8, 10.5], REST, t) }))), ['turn-']);
	// Forward (away from you): a step forward; back: a step back.
	assert.deepEqual(moves(g, 0.2, (t) => world(hand({ thumb: lerp(REST, [4, -3.8, 12.5], t) }))), ['step+']);
	assert.deepEqual(moves(g, 0.2, (t) => world(hand({ thumb: lerp([4, -3.8, 12.5], REST, t) }))), ['step-']);
	// Opening the hand ends it.
	assert.deepEqual(moves(g, 0.1, world(hand({ curled: false, thumb: [6, -1, 7] }))), ['open']);
});

test('nothing by chance: palm down, open fingers or a quick flash of the pose is not ready', () => {
	const g = new HandGestures('right');
	assert.deepEqual(moves(g, 0.5, world(hand(), PALM_DOWN)).filter((e) => e !== 'fist'), [], 'palm down: not sideways');
	g.reset();
	assert.deepEqual(moves(g, 0.5, world(hand({ curled: false }))), [], 'open fingers');
	g.reset();
	assert.deepEqual(moves(g, 0.08, world(hand())), [], 'held under 0.15 s');
	// A pinch with open fingers is not a tap.
	g.reset();
	assert.deepEqual(moves(g, 0.3, world(hand({ curled: false, thumb: [2.5, 0, 17.5] }))), []);
});

test('a closed hand holds; opening lets go; a lost hand cancels', () => {
	const g = new HandGestures('right');
	const ev = run(g, 0.3, world(hand({ thumb: [3, -2, 6], clench: true })));
	assert.ok(ev.includes('fist'), 'three fingertips by their knuckles, 0.15 s');
	assert.deepEqual(run(g, 0.1, world(hand({ curled: false }))), ['fistEnd']);
	run(g, 0.3, world(hand()));
	assert.ok(g.ready);
	assert.deepEqual(run(g, DT, null), ['lost']);
	assert.ok(!g.ready && !g.fist);
	assert.deepEqual(run(g, 2 * DT, world(hand())), [], 'tracked again: a few frames before it counts');
});

test('the left hand reads the same way', () => {
	const mirror = (j) => Object.fromEntries(Object.entries(j).map(([k, [x, y, z]]) => [k, [-x, y, z]]));
	// A left hand held sideways: palm facing right, thumb up.
	const LEFT = ([x, y, z]) => new THREE.Vector3(-y, -x, -z).multiplyScalar(0.01).add(new THREE.Vector3(-0.2, 1.2, -0.3));
	const s = handShape(world(mirror(hand()), LEFT), 'left');
	assert.ok(s.normal.x > 0.9, 'the palm faces right');
	const g = new HandGestures('left');
	assert.deepEqual(moves(g, 0.3, world(mirror(hand()), LEFT)), ['ready']);
});

test('the fallback: palm down, pinch held 0.25 s; letting go ends it', () => {
	GESTURE.THUMB_TAP = false;
	try {
		const g = new HandGestures('right');
		const pinch = world(hand({ curled: false, thumb: [2.5, 0.5, 17.5] }), PALM_DOWN);
		assert.deepEqual(run(g, 0.4, pinch), ['pinch']);
		assert.deepEqual(run(g, 0.1, world(hand({ curled: false, thumb: [6, -1, 7] }), PALM_DOWN)), ['pinchEnd']);
		g.reset();
		assert.deepEqual(run(g, 0.4, world(hand({ curled: false, thumb: [2.5, 0.5, 17.5] }))), [], 'sideways: not the fallback pose');
	} finally { GESTURE.THUMB_TAP = true; }
});

test('the aim ray runs from the shoulder through the wrist', () => {
	const head = new THREE.Vector3(0, 1.6, 0), right = new THREE.Vector3(1, 0, 0);
	const r = handAimRay(head, right, new THREE.Vector3(0.18, 1.2, -0.4), 'right');
	assert.ok(r.dir.z < -0.8 && r.dir.y < 0 && Math.abs(r.dir.x) < 1e-6, 'a relaxed hand at chest level aims ahead and down');
});

// The tester's finding: moving the whole hand in the ready pose is never a swipe.
test('a hand moving in the ready pose (thumb still on the index) turns and steps nothing', () => {
	const g = new HandGestures('right');
	assert.deepEqual(moves(g, 0.3, world(hand())), ['ready']);
	const shifted = (dx, dz) => (t) => Object.fromEntries(Object.entries(world(hand())).map(([k, v]) => [k, v.clone().add(new THREE.Vector3(dx * t, 0, dz * t))]));
	assert.deepEqual(moves(g, 0.3, shifted(0.05, 0)), [], 'drifting 5 cm to the right in 0.3 s');
	assert.deepEqual(moves(g, 0.3, shifted(0, -0.1)), [], 'moving 10 cm forward');
	assert.ok(g.ready, 'still ready');
});

test('a clenched fist is a closed hand, never the ready pose', () => {
	const g = new HandGestures('right');
	const ev = run(g, 0.4, world(hand({ clench: true })));
	assert.ok(ev.includes('fist') && !ev.includes('ready'), JSON.stringify(ev));
});

// Tracking jitter (about ±6 mm per joint, the tester's probe): a still hand in the ready pose does nothing.
test('a still ready hand with ±6 mm jitter on every joint: no taps, turns or steps in 10 s', () => {
	let seed = 42;
	const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.012;
	const g = new HandGestures('right');
	const base = world(hand());
	const ev = run(g, 10, () => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.clone().add(new THREE.Vector3(rnd(), rnd(), rnd()))])));
	assert.deepEqual(ev.filter((e) => e !== 'ready'), [], JSON.stringify(ev));
});
