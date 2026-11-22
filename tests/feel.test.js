// The "feel" kit: tweens, vibration patterns and synthesised sounds
// (js/tween.js, js/haptics.js, js/sound.js). The parts that need a browser
// (playing sound, real vibration) are checked in scripts/xr-test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ease, arcPoint, Tweens, FEEDBACK_MAX } from '../js/tween.js';
import { PATTERNS, BUZZ, Haptics } from '../js/haptics.js';
import { RECIPES, LEVELS, envelopeAt, recipeLength, Sound } from '../js/sound.js';

test('easing curves start at 0 and end exactly at 1', () => {
	for (const [name, f] of Object.entries(ease)) {
		assert.equal(f(0), 0, name);
		assert.equal(f(1), 1, name);
	}
	assert.ok(ease.out(0.5) > 0.5 && Math.abs(ease.inOut(0.5) - 0.5) < 1e-12);
});

test('the spring overshoots a little, then settles', () => {
	let peak = 0;
	for (let t = 0; t <= 1; t += 0.001) peak = Math.max(peak, ease.spring(t));
	assert.ok(peak > 1.03 && peak < 1.12, `overshoot ${((peak - 1) * 100).toFixed(1)}%`);
	assert.ok(Math.abs(ease.spring(0.95) - 1) < 0.01, 'settled before the end');
});

test('an arc rises by its lift in the middle and ends where it should', () => {
	const a = new THREE.Vector3(0, 1, 0), b = new THREE.Vector3(1, 1, 0), out = new THREE.Vector3();
	assert.deepEqual(arcPoint(a, b, 0.1, 0, out).toArray(), [0, 1, 0]);
	assert.ok(arcPoint(a, b, 0.1, 1, out).distanceTo(b) < 1e-12);
	const mid = arcPoint(a, b, 0.1, 0.5, out);
	assert.ok(Math.abs(mid.y - 1.1) < 1e-12 && Math.abs(mid.x - 0.5) < 1e-12);
});

test('tweens run on the frame clock, are capped short, and end once', () => {
	const tw = new Tweens();
	const seen = [];
	let done = 0;
	tw.start({ duration: 2, step: (k) => seen.push(k), done: () => done++ });
	assert.deepEqual(seen, [0], 'the first step is at once');
	let t = 0;
	while (tw.running && t < 5) { tw.update(1 / 72); t += 1 / 72; }
	assert.ok(Math.abs(t - FEEDBACK_MAX) < 1 / 72 + 1e-9, `feedback motion is capped at ${FEEDBACK_MAX} s (took ${t.toFixed(3)} s)`);
	assert.equal(done, 1);
	assert.equal(seen.at(-1), 1);
	for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'ease.out never goes back');
	// A long one (the first-time introduction) keeps its length.
	tw.start({ duration: 2, long: true });
	for (let i = 0; i < 72; i++) tw.update(1 / 72);
	assert.equal(tw.running, 1);
	// Stopped: no done (unless finished on purpose); a tween started from done runs next frame.
	tw.clear();
	let chained = 0;
	const a = tw.start({ duration: 0.1, done: () => tw.start({ duration: 0.1, done: () => chained++ }) });
	const b = tw.start({ duration: 0.2, done: () => { throw new Error('stopped tweens never finish'); } });
	tw.stop(b);
	for (let i = 0; i < 30; i++) tw.update(0.02);
	assert.equal(chained, 1);
	assert.equal(tw.running, 0);
	let finished = 0;
	const c = tw.start({ duration: 0.2, step: (k) => { if (k === 1) finished++; }, done: () => finished++ });
	tw.stop(c, { finish: true });
	assert.equal(finished, 2);
	assert.ok(a);
	// A callback may stop another tween, or clear them all, mid-frame.
	const steps = { x: 0, y: 0 };
	const y = tw.start({ duration: 0.2, step: () => steps.y++ });
	tw.start({ duration: 0.2, step: (k) => { steps.x++; if (k > 0) tw.stop(y); } });
	tw.start({ duration: 0.2, step: (k) => { if (k > 0.5) tw.clear(); } });
	assert.doesNotThrow(() => { for (let i = 0; i < 20; i++) tw.update(0.02); });
	assert.equal(steps.y, 2, 'stepped once at the start and once in the first frame, never twice in a frame');
	assert.equal(tw.running, 0);
});

test('vibration patterns are short and gentle, one per meaning', () => {
	assert.deepEqual(Object.keys(PATTERNS).sort(), ['click', 'deny', 'shutter', 'tick']);
	for (const [name, pulses] of Object.entries(PATTERNS)) {
		for (const p of pulses) {
			assert.ok(p.strength > 0 && p.strength <= 1 && p.ms > 0 && p.ms <= 60 && p.at >= 0 && p.at < 0.3, name);
		}
	}
	assert.ok(PATTERNS.tick[0].strength < PATTERNS.click[0].strength, 'a tick is lighter than a click');
	assert.ok(BUZZ.strength < PATTERNS.tick[0].strength && BUZZ.every * 1000 < BUZZ.ms, 'the drawing buzz is faint and continuous');
});

test('Haptics plays patterns on the frame clock, and only on controllers that can vibrate', () => {
	const pulses = [];
	const c = { source: { gamepad: { hapticActuators: [{ pulse: (s, ms) => { pulses.push([s, ms]); return Promise.resolve(true); } }] } } };
	const h = new Haptics();
	h.play(c, 'shutter');
	assert.deepEqual(pulses, [[0.6, 18]]);
	h.update(0.02); // (the frame it was played in: its time doesn't count)
	h.update(0.03);
	assert.equal(pulses.length, 1);
	h.update(0.04);
	assert.deepEqual(pulses, [[0.6, 18], [0.35, 25]], 'the second knock 60 ms after the first');
	pulses.length = 0;
	h.buzz(c, true);
	for (let i = 0; i < 10; i++) h.update(0.02); // 0.2 s
	assert.ok(pulses.length >= 4 && pulses.length <= 6 && pulses.every(([s]) => s === BUZZ.strength), `${pulses.length} buzz pulses`);
	h.buzz(c, false);
	pulses.length = 0;
	h.update(0.1);
	assert.equal(pulses.length, 0);
	// No motor, a dropped controller, a motor that throws: silently nothing.
	assert.doesNotThrow(() => { h.play({}, 'click'); h.play({ source: null }, 'tick'); h.play({ source: { gamepad: { hapticActuators: [{ pulse() { throw new Error('gone'); } }] } } }, 'click'); });
	h.play(c, 'shutter');
	h.stop();
	h.update(1);
	assert.equal(pulses.length, 1, 'stop() drops the rest of a pattern');
});

test('sound recipes: short, never clipping, envelopes that start and end silent', () => {
	assert.deepEqual(Object.keys(RECIPES).sort(), ['aim', 'beep', 'close', 'deny', 'grab', 'open', 'press', 'release', 'settle', 'shutter', 'squeak', 'step', 'tick', 'whoosh']);
	for (const [name, r] of Object.entries(RECIPES)) {
		const len = recipeLength(r);
		assert.ok(len > 0.01 && len <= FEEDBACK_MAX + 0.01, `${name}: ${len} s`);
		let peaks = 0;
		for (const l of r.layers) {
			const e = l.env;
			assert.deepEqual([e[0][0], e[0][1], e.at(-1)[1]], [0, 0, 0], `${name}: starts at 0 and ends silent`);
			for (let i = 1; i < e.length; i++) assert.ok(e[i][0] > e[i - 1][0], `${name}: times increase`);
			for (const [, v] of e) assert.ok(v >= 0 && v <= 1, name);
			peaks += Math.max(...e.map(([, v]) => v));
			const hz = [].concat(l.noise ? (l.band ?? []) : l.hz);
			for (const f of hz) assert.ok(f >= 40 && f <= 12000, `${name}: ${f} Hz`);
			assert.ok(l.noise || ['sine', 'triangle', 'square', 'sawtooth'].includes(l.tone), name);
		}
		assert.ok(peaks <= 1, `${name}: layers together stay below full scale (${peaks})`);
	}
	assert.equal(envelopeAt([[0, 0], [0.1, 1], [0.2, 0]], 0.05), 0.5);
	assert.equal(envelopeAt([[0, 0], [0.1, 1], [0.2, 0]], 0.3), 0);
	assert.deepEqual(LEVELS, ['off', 'effects', 'all']);
});

test('Sound can be made without a browser and does nothing until unlocked', () => {
	const s = new Sound();
	assert.doesNotThrow(() => { s.play('tick'); s.update(1); s.suspend(); s.setLevel('effects'); s.unlock(); });
	assert.equal(s.ctx, null, 'no audio context in Node');
	assert.equal(s.level, 'effects');
	s.setLevel('loud');
	assert.equal(s.level, 'all', 'an unknown level is the default');
});
