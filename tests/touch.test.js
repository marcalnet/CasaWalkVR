import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH, touchState, stepTouch, reset, ringSize } from '../js/touch.js';

// Milestone C0.2: keys are pressed by a fingertip from the front, like real
// keys; nothing else clicks.
const run = (frames, s = touchState()) => frames.flatMap((f) => stepTouch(s, { inside: true, lateral: 0, dt: 1 / 72, ...f }));
const approach = (to, from = 0.05, steps = 10) => Array.from({ length: steps + 1 }, (_, i) => ({ depth: from + (to - from) * i / steps }));

test('a straight press from the front clicks once, and again only after letting go', () => {
	const s = touchState();
	const ev = run([...approach(-0.01, 0.05, 30)], s);
	assert.deepEqual(ev, ['hover', 'contact', 'click']);
	assert.equal(s.phase, 'pressed');
	assert.ok(s.push > 0.008 && s.push <= TOUCH.STOP);
	// Deeper, then jitter around the click point: nothing more.
	assert.deepEqual(run([{ depth: -0.03 }], s), []);
	assert.equal(s.push, TOUCH.STOP); // the face stops however deep the finger goes
	assert.deepEqual(run([{ depth: -0.006 }, { depth: -0.009 }, { depth: 0.005 }, { depth: 0.012 }], s), []);
	// Back 15 mm in front: released, then a second press clicks again.
	assert.deepEqual(run([{ depth: 0.016 }], s), ['release']);
	assert.deepEqual(run(approach(-0.01, 0.016, 20), s), ['contact', 'click']);
});

test('touching without pushing 8 mm in does not click', () => {
	const s = touchState();
	assert.deepEqual(run([...approach(-0.006, 0.05, 30), { depth: 0.01 }, { depth: 0.07 }], s), ['hover', 'contact', 'leave']);
});

test('from the side, from behind or too fast: ignored until it comes back to the front', () => {
	// Arrives sideways already in the face (was not over it before).
	let s = touchState();
	assert.deepEqual(run([{ depth: -0.01, inside: false }, { depth: -0.01 }, { depth: -0.02 }], s), ['block']);
	assert.equal(s.phase, 'blocked');
	assert.deepEqual(run([{ depth: 0.02 }, ...approach(-0.01, 0.02, 20)], s), ['hover', 'contact', 'click']);
	// A slanted approach: mostly sideways at contact.
	s = touchState();
	assert.deepEqual(run([{ depth: 0.004 }, { depth: -0.001, lateral: 0.02 }, { depth: -0.02 }], s), ['hover', 'block']);
	// Too fast: 3 cm in one frame (over 2 m/s).
	s = touchState();
	assert.deepEqual(run([{ depth: 0.02 }, { depth: -0.01 }], s), ['hover', 'block']);
});

test('sliding off a pressed key releases it; losing the hand completes nothing', () => {
	const s = touchState();
	run(approach(-0.01, 0.05, 30), s);
	assert.deepEqual(run([{ depth: -0.01, inside: false }], s), ['release', 'leave']);
	const t = touchState();
	run(approach(-0.004, 0.05, 30), t);
	reset(t);
	assert.equal(t.phase, 'away');
	assert.deepEqual(run([{ depth: -0.02 }], t), ['block']); // reappearing inside the face never clicks
});

test('the hover ring shrinks as the tip comes closer', () => {
	assert.equal(ringSize(0.06), 0.025);
	assert.equal(ringSize(0), 0.01);
	assert.ok(ringSize(0.03) > 0.01 && ringSize(0.03) < 0.025);
});
