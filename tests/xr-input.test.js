import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHandSource, nextPinch, pinchValue, PINCH_ON, PINCH_OFF } from '../js/xr-input.js';

// Milestone C0.1: bare hands are not controllers, so a pinch (which the Quest
// reports as a select, with a controller-like gamepad) never acts as a trigger.
test('hands, gaze and transient pinches are told apart from controllers', () => {
	const pad = (axes) => ({ mapping: 'xr-standard', buttons: [{}, {}], axes: new Array(axes).fill(0) });
	const touch = { targetRayMode: 'tracked-pointer', profiles: ['meta-quest-touch-plus', 'oculus-touch-v3', 'generic-trigger-squeeze-thumbstick'], gamepad: pad(4) };
	assert.equal(isHandSource(touch), false);
	assert.equal(isHandSource({ ...touch, profiles: [] }), false); // a controller with no profile list yet
	assert.equal(isHandSource({ ...touch, hand: {} }), true); // hand joints
	assert.equal(isHandSource({ targetRayMode: 'tracked-pointer', profiles: ['oculus-hand', 'generic-hand', 'generic-hand-select'], gamepad: pad(0) }), true);
	assert.equal(isHandSource({ targetRayMode: 'tracked-pointer', profiles: [], gamepad: pad(0) }), true); // no thumbstick: not a controller
	assert.equal(isHandSource({ targetRayMode: 'tracked-pointer', profiles: [], gamepad: null }), true);
	assert.equal(isHandSource({ targetRayMode: 'transient-pointer', profiles: [], gamepad: null }), true); // Vision Pro gaze-and-pinch
	assert.equal(isHandSource({ targetRayMode: 'gaze', profiles: [] }), true);
	assert.equal(isHandSource(null), false);
});

// Milestone C0 groundwork: a pinch starts when the tips nearly meet and ends
// only once they are clearly apart, so a shaky pinch never clicks twice.
test('pinch: hysteresis between starting and ending', () => {
	assert.ok(PINCH_ON < PINCH_OFF);
	let held = false;
	const seq = [0.06, 0.03, 0.02, 0.014, 0.02, 0.029, 0.025, 0.031, 0.02, 0.016, 0.012];
	const out = seq.map((d) => (held = nextPinch(held, d)));
	assert.deepEqual(out, [false, false, false, true, true, true, true, false, false, false, true]);
	assert.equal(pinchValue(0.2), 0);
	assert.equal(pinchValue(PINCH_ON), 1);
	assert.equal(pinchValue(0.005), 1);
	const mid = pinchValue(0.04);
	assert.ok(mid > 0 && mid < 1);
});
