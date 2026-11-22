import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHandSource } from '../js/xr-input.js';

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
