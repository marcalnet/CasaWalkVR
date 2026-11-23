// Teleport hotspots (js/hotspots.js): room middles and both sides of doorways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotspots, snapTo, HOTSPOT } from '../js/hotspots.js';

// Two 4 x 3 m rooms side by side, a door in the wall between them (at x = 4).
const plan = {
	rooms: [
		{ name: 'Living room', storey: 0, floorY: 0, points: [[0, 0], [4, 0], [4, 3], [0, 3]] },
		{ name: 'Kitchen', storey: 0, floorY: 0, points: [[4, 0], [8, 0], [8, 3], [4, 3]] },
		{ name: '', storey: 0, floorY: 0, points: [[0, 3], [8, 3], [8, 4], [0, 4]] }, // a helper floor: no hotspot
	],
	doors: [{ x: 4, z: 1.5, angle: Math.PI / 2, width: 0.9, depth: 0.1, storey: 0, floorY: 0 }],
};

test('a hotspot in each named room, and one on each side of a door', () => {
	const s = hotspots(plan);
	const rooms = s.filter((h) => h.kind === 'room'), doors = s.filter((h) => h.kind === 'door');
	assert.deepEqual(rooms.map((h) => h.name).sort(), ['Kitchen', 'Living room']);
	assert.equal(doors.length, 2);
	const xs = doors.map((h) => +h.x.toFixed(2)).sort((a, b) => a - b);
	assert.deepEqual(xs, [3.55, 4.45], '40 cm from the door, each side');
	assert.deepEqual(doors.map((h) => h.name).sort(), ['Kitchen', 'Living room'], 'named by the room it stands in');
	assert.ok(doors.every((h) => Math.abs(h.z - 1.5) < 1e-9 && h.y === 0));
	assert.deepEqual(hotspots(null), [], 'no plan (OBJ, GLB): no hotspots');
	assert.equal(hotspots(plan, () => false).filter((h) => h.kind === 'door').length, 0, 'a doorway side blocked by furniture: none there');
});

test('the ring snaps to a hotspot near where you point, on your floor, within reach', () => {
	const s = hotspots(plan);
	const door = s.find((h) => h.kind === 'door' && h.x > 4);
	assert.equal(snapTo(s, { x: door.x + 0.3, y: 0, z: door.z }, { x: 3, z: 1.5 }), door, 'within 0.5 m');
	assert.equal(snapTo(s, { x: door.x + 0.7, y: 0, z: door.z + 0.7 }, { x: 3, z: 1.5 }), null, 'further: lands where you point');
	assert.equal(snapTo(s, { x: door.x, y: 3, z: door.z }, { x: 3, z: 1.5 }), null, 'another floor');
	assert.equal(snapTo(s, { x: door.x, y: 0, z: door.z }, { x: door.x + 5, z: 1.5 }), null, 'more than 4 m from you');
	assert.equal(snapTo(s, { x: door.x + 0.3, y: 0, z: door.z }, { x: 3, z: 1.5 }, () => false), null, 'a wall in between: no snap');
});
