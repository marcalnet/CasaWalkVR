// Where the settings wings go: never over the model (js/wings.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { angleOf, zoneOf, wingRect, overlaps, placeWing, WING, zoneHull, inZone } from '../js/wings.js';

const head = new THREE.Vector3(0, 1.89, 0);
/** A box w x h x w m on a plinth top 0.6 m up, its front edge 0.6 m ahead. */
const box = (w = 1.2, h = 0.3, top = 0.6) => new THREE.Box3(new THREE.Vector3(-w / 2, top, -0.6 - w), new THREE.Vector3(w / 2, top + h, -0.6));
const corners = box;

test('angleOf: straight ahead is 0, left is positive, below is negative', () => {
	assert.ok(Math.abs(angleOf(new THREE.Vector3(0, 1.89, -1), head, 0).az) < 1e-9);
	assert.ok(angleOf(new THREE.Vector3(-1, 1.89, -1), head, 0).az > 0.7);
	assert.ok(angleOf(new THREE.Vector3(0, 0.9, -1), head, 0).el < -0.7);
});

test('at the default zoom the wings stay within 15 degrees of 45 and 15 below, and are clear of the model', () => {
	const zone = zoneOf(corners(), head, 0);
	for (const side of [1, -1]) {
		const p = placeWing(side, side > 0 ? 0.34 : 0.4, side > 0 ? 0.3 : 0.34, zone);
		assert.ok(p.clear && Math.abs(p.az) - WING.side < 15 * Math.PI / 180, `${side}: ${JSON.stringify(p)}`);
		assert.ok(!overlaps(wingRect(p.az, p.el, side > 0 ? 0.34 : 0.4, side > 0 ? 0.3 : 0.34, p.dist), zone, WING.margin));
	}
});

test('a zoomed-up model pushes the wings outward, then up, and never under it', () => {
	const zone = zoneOf(corners(2.6, 0.6), head, 0);
	for (const side of [1, -1]) {
		const w = 0.4, h = 0.34, p = placeWing(side, w, h, zone);
		assert.ok(Math.abs(p.az) > WING.side || p.el > -WING.drop, `moved: ${JSON.stringify(p)}`);
		if (p.clear) assert.ok(!overlaps(wingRect(p.az, p.el, w, h, p.dist), zone, WING.margin), 'clear');
		assert.ok(Math.abs(p.az) <= WING.maxSide + 1e-6 && p.el <= WING.maxUp + 0.02 && p.dist <= WING.maxDist + 1e-9, 'within the limits');
	}
});

test('no model in view (inside the home): the wings sit at 45 degrees, 15 below', () => {
	assert.deepEqual(placeWing(1, 0.34, 0.3, null), { az: WING.side, el: -WING.drop, dist: WING.dist, margin: WING.margin, clear: true });
});

test('a wing leaned back 20°: its lower edge comes towards you and spans more below than a flat one (harmony, conflict 13)', () => {
	const flat = wingRect(0, -0.26, 0.4, 0.5, 0.55, 0), leaned = wingRect(0, -0.26, 0.4, 0.5, 0.55);
	const hh = Math.atan(0.25 / 0.55);
	assert.ok(Math.abs(flat.el1 - flat.el0 - 2 * hh) < 0.06, 'flat: about the old rectangle');
	assert.ok(leaned.el0 < flat.el0 - 0.01, `the lower edge lower: ${leaned.el0.toFixed(3)} vs ${flat.el0.toFixed(3)}`);
});

test('the model\'s silhouette as seen: inside, outside, within a margin', () => {
	const hull = zoneHull(zoneOf(box(), head, 0));
	const a = (azDeg, elDeg) => ({ az: azDeg * Math.PI / 180, el: elDeg * Math.PI / 180 });
	const mid = angleOf(new THREE.Vector3(0, 0.75, -1.2), head, 0);
	assert.ok(inZone(mid, hull), 'the model\'s middle');
	assert.ok(!inZone(a(60, -10), hull), 'far to the side');
	const top = Math.max(...hull.map((p) => p.el));
	assert.ok(!inZone({ az: 0, el: top + 0.06 }, hull) && inZone({ az: 0, el: top + 0.06 }, hull, 0.087), '3.4° above its top: outside, but inside 5° of margin');
});
