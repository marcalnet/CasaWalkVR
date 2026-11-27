// The areas (js/zones.js; the next-build asks, section 5): left, centre, right.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ZONES, TOOLS, scaleCentre, walkCentre, followBody, areaOf, bodyAreaOf, sideOf, edgeSpot, keepFromEyes, dampTowards, yawTo, angleDiff } from '../js/zones.js';

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
	// The keys always count in full, past 40° if need be (the UX review's S1: the levels stack at about 35-45° to the left).
	const keyEdge = V(-0.75 * Math.sin(THREE.MathUtils.degToRad(43)), 1.0, -0.75 * Math.cos(THREE.MathUtils.degToRad(43)));
	const keyed = scaleCentre(head, plinth, [V(-0.1, 1.3, -1.2), V(0.1, 1.3, -1.2)], [keyEdge, V(0.1, 1.0, -0.6)]);
	assert.ok(Math.abs(deg(keyed.left) - 48) < 1e-6 && Math.abs(deg(keyed.right) + 20) < 1e-6, `a key edge at 43°: the centre reaches 48° (${deg(keyed.left).toFixed(1)})`);
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

test('the orb never hides a live key: covers when nearer and within the radii plus 1°; clear only beyond plus 3°; a live key always wins', async () => {
	const { SIGHT, covers: orbCovers } = await import('../js/zones.js');
	SIGHT.ORB_R = 0.035; // (a main hand's key, 7 cm across: the rule the orb had, build 215's C8)
	const eye = V(0, 1.6, 0), key = V(0, 1.0, -0.4); // (the waist door, ahead and below)
	const onLine = eye.clone().lerp(key, 0.6);
	assert.ok(orbCovers(eye, onLine, SIGHT.ORB_R, key, 0.17), 'on the line to the key: covers');
	assert.ok(!orbCovers(eye, key.clone().add(V(0, 0, -0.3)), SIGHT.ORB_R, key, 0.17), 'behind the key: never');
	// Just past the edge: covers only if it covered already (2° of hysteresis).
	const dO = onLine.distanceTo(eye), dK = key.distanceTo(eye);
	const edge = Math.asin(SIGHT.ORB_R / dO) + Math.asin(0.17 / dK) + THREE.MathUtils.degToRad(2);
	const toKey = key.clone().sub(eye).normalize(), axis = toKey.clone().cross(V(0, 1, 0)).normalize();
	const dir = toKey.clone().applyAxisAngle(axis, edge), at = eye.clone().addScaledVector(dir, dO);
	assert.ok(!orbCovers(eye, at, SIGHT.ORB_R, key, 0.17, false) && orbCovers(eye, at, SIGHT.ORB_R, key, 0.17, true), 'between +1° and +3°: it keeps what it was');
});

test('inside, the areas are by the body, in metres (build 215, C7): more than 12 cm left or right of its centre line, from the base of the neck; a side is left only within 8 cm', () => {
	assert.deepEqual([ZONES.NECK_DOWN, ZONES.NECK_BACK, ZONES.SIDE, ZONES.SIDE_OUT], [0.15, 0.08, 0.12, 0.08]);
	const head = V(0, 1.6, 0), r = THREE.MathUtils.degToRad;
	// By the hip, out to the side at arm's length, at the shoulder, held ahead: one area each side, whatever the angle from the eyes.
	const spots = { hip: [0.22, 0.95, 0.05], arm: [0.6, 1.35, -0.1], shoulder: [0.2, 1.45, -0.15], ahead: [0.15, 1.2, -0.5] };
	for (const yaw of [0, r(90), r(-150)]) {
		const turn = (x, y, z) => V(x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)); // (the body turned: its left stays its left)
		for (const [name, [x, y, z]] of Object.entries(spots)) {
			assert.equal(bodyAreaOf(sideOf(head, yaw, turn(-x, y, z))), 'left', `${name}, left (yaw ${yaw.toFixed(2)})`);
			assert.equal(bodyAreaOf(sideOf(head, yaw, turn(x, y, z))), 'right', `${name}, right`);
		}
		assert.equal(bodyAreaOf(sideOf(head, yaw, turn(-0.05, 1.3, -0.4))), 'centre', 'in front of you');
		assert.equal(bodyAreaOf(sideOf(head, yaw, turn(0.05, 1.3, -0.4))), 'centre');
	}
	// The hysteresis: into the left past 12 cm, out of it only within 8 cm; the same on the right.
	assert.equal(bodyAreaOf(0.10, 'centre'), 'centre');
	assert.equal(bodyAreaOf(0.13, 'centre'), 'left');
	assert.equal(bodyAreaOf(0.09, 'left'), 'left', 'within 12 cm but beyond 8: still left');
	assert.equal(bodyAreaOf(0.07, 'left'), 'centre');
	assert.equal(bodyAreaOf(-0.09, 'right'), 'right');
	assert.equal(bodyAreaOf(-0.13, null), 'right');
	// The line starts 8 cm behind the eyes, so a hand right at the eyes' side counts as beside the body.
	assert.ok(Math.abs(sideOf(head, 0, V(-0.2, 1.6, 0.08)) - 0.2) < 1e-9, 'level with the neck, 20 cm left');
});
