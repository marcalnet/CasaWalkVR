// The areas (js/zones.js; the next-build asks, section 5): left, centre, right.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ZONES, TOOLS, scaleCentre, walkCentre, followBody, areaOf, edgeSpot, keepFromEyes, dampTowards, yawTo, angleDiff } from '../js/zones.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const deg = THREE.MathUtils.radToDeg;

test('the scale model\'s centre: the span of what must stay clear plus 5°, at least ±20° and at most ±40° about ahead', () => {
	const head = V(0, 1.6, 0), plinth = V(0, 1.24, -1.2);
	assert.ok(Math.abs(yawTo(head, plinth)) < 1e-9, 'ahead: the plinth\'s centre');
	const small = scaleCentre(head, plinth, [V(-0.1, 1.3, -1.2), V(0.1, 1.3, -1.2)]);
	assert.ok(Math.abs(deg(small.left) - 20) < 1e-6 && Math.abs(deg(small.right) + 20) < 1e-6, 'a small model: ±20°');
	const wide = scaleCentre(head, plinth, [V(-0.8, 1.3, -1), V(0.5, 1.3, -1)]);
	const leftSpan = deg(Math.atan2(0.8, 1)) + 5, rightSpan = deg(Math.atan2(0.5, 1)) + 5;
	assert.ok(Math.abs(deg(wide.left) - Math.min(40, leftSpan)) < 1e-6 && Math.abs(-deg(wide.right) - Math.min(40, rightSpan)) < 1e-6, `its span plus 5°, at most 40° (${deg(wide.left).toFixed(1)}, ${deg(wide.right).toFixed(1)})`);
});

test('inside: the body follows the head slowly (still within ±25°, a 0.8 s pull beyond, never 60° behind); the centre ±20° about it', () => {
	let body = followBody(null, 0, 1 / 72);
	assert.equal(body.yaw, 0, 'it starts where the head looks');
	for (let i = 0; i < 72; i++) body = followBody(body, THREE.MathUtils.degToRad(20), 1 / 72);
	assert.equal(body.yaw, 0, 'looking 20° aside: the body stays');
	body = followBody(body, THREE.MathUtils.degToRad(90), 1 / 72);
	assert.ok(deg(body.yaw) >= 30 - 1e-6 && deg(body.yaw) < 32, 'a quick 90° turn: never more than 60° behind');
	for (let i = 0; i < 72 * 4; i++) body = followBody(body, THREE.MathUtils.degToRad(90), 1 / 72);
	assert.ok(Math.abs(deg(angleDiff(body.yaw, THREE.MathUtils.degToRad(90)))) < 1.01 && !body.following, 'turned to face it: the body faces the same way within a few seconds');
	const c = walkCentre(0);
	assert.ok(Math.abs(deg(c.left) - 20) < 1e-9 && Math.abs(deg(c.right) + 20) < 1e-9);
});

test('which area a hand is in, with 5° of hysteresis (it enters the centre at the edge, leaves 5° outside); height doesn\'t matter', () => {
	const c = walkCentre(0), r = THREE.MathUtils.degToRad;
	assert.equal(areaOf(r(30), c), 'left');
	assert.equal(areaOf(r(-30), c), 'right');
	assert.equal(areaOf(r(10), c), 'centre');
	assert.equal(areaOf(r(22), c, 'centre'), 'centre', 'just outside: still the centre');
	assert.equal(areaOf(r(26), c, 'centre'), 'left', 'more than 5° outside: out');
	assert.equal(areaOf(r(22), c, 'left'), 'left', 'from outside: enters only at the edge');
	assert.ok(ZONES.HYST > 0);
});

test('the waiting tools: at the edge, 3° inside the fan\'s area, 10-35° below eye level, 0.40-0.60 m away; never at the face; a damped glide', () => {
	const head = V(0, 1.6, 0), c = walkCentre(0);
	const p = edgeSpot(head, c, 1, V(0.1, 1.6, -0.2));
	const yaw = deg(yawTo(head, p)), d = p.distanceTo(head), below = deg(Math.asin((head.y - p.y) / d));
	assert.ok(Math.abs(yaw - 23) < 1e-6, `the left edge plus 3° (${yaw.toFixed(1)}°)`);
	assert.ok(Math.abs(d - 0.4) < 1e-9 && Math.abs(below - 10) < 1e-6, `the hand near the face, level: clamped to 0.40 m and 10° below (${d.toFixed(2)} m, ${below.toFixed(1)}°)`);
	const right = edgeSpot(head, c, -1, V(0, 0.5, -1));
	assert.ok(Math.abs(deg(yawTo(head, right)) + 23) < 1e-6 && Math.abs(right.distanceTo(head) - 0.6) < 1e-9, 'Main hand: Left: the right edge, 0.60 m at most');
	const near = keepFromEyes(V(0, 1.6, -0.1), head);
	assert.ok(Math.abs(near.distanceTo(head) - TOOLS.EYES) < 1e-9, 'pushed out to 0.30 m, never hidden');
	const pos = V(0, 0, 0), vel = V(0, 0, 0), to = V(1, 0, 0);
	let over = 0;
	for (let i = 0; i < 72; i++) { dampTowards(pos, vel, to, 1 / 72); over = Math.max(over, pos.x - 1); }
	assert.ok(pos.x > 0.98 && over <= 1e-9, `there within a second, no overshoot (${pos.x.toFixed(3)})`);
});
