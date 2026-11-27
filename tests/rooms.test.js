// Where stepping inside lands (js/rooms.js, SPEC.md milestone B4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parseHome, buildHome } from '../js/sh3d.js';
import { inside, edgeDistance, area, roomAt, roomSpots, longAxis, alongAxis, headingOf, roomLanding, clearOfWalls, nearestRoom } from '../js/rooms.js';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
// An L-shaped room: a 6 x 2 m leg along x, and a 2 x 4 m leg going up z from its left end.
const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];

test('polygon basics', () => {
	assert.ok(inside(1, 1, L) && inside(1, 5, L) && !inside(4, 4, L));
	assert.equal(area(L), 6 * 2 + 2 * 4);
	assert.ok(Math.abs(edgeDistance(1, 1, rect(0, 0, 4, 2)) - 1) < 1e-12);
});

test('the clear middle of an L-shaped room is inside it, as far from its walls as it gets', () => {
	const room = { points: L, floorY: 0 };
	const spots = roomSpots(room);
	assert.ok(spots.length > 10 && spots.every((s) => inside(s.x, s.z, L) && s.clear >= 0.35));
	for (let i = 1; i < spots.length; i++) assert.ok(spots[i].clear <= spots[i - 1].clear, 'best first');
	const best = spots[0];
	assert.ok(best.clear > 1 && best.clear < 1.25 && best.x < 2 && best.z < 2, `${best.clear}`); // where the 2 m legs meet
	// (Its corners' average, (2.7, 2.2), is outside the room.)
	assert.ok(!inside(2.7, 2.2, L));
});

test('furniture in the middle: the next clearest spot', () => {
	const room = { points: rect(0, 0, 4, 4), floorY: 0 };
	const table = (x, z) => Math.abs(x - 2) < 0.8 && Math.abs(z - 2) < 0.8; // a table in the middle
	const l = roomLanding(room, (x, z) => !table(x, z));
	assert.ok(!table(l.x, l.z), `landed on the table at ${l.x}, ${l.z}`);
	assert.ok(edgeDistance(l.x, l.z, room.points) >= 0.35);
	// Nothing clear at all (a storeroom full of boxes): the most open spot anyway.
	const full = roomLanding(room, () => false);
	assert.ok(Math.abs(full.x - 2) < 0.1 && Math.abs(full.z - 2) < 0.1);
});

test('a tiny room still gives a spot', () => {
	const l = roomLanding({ points: rect(0, 0, 0.6, 0.6), floorY: 0 });
	assert.ok(l && inside(l.x, l.z, rect(0, 0, 0.6, 0.6)));
});

test('you face along the room, the way closer to where you were looking', () => {
	const room = { points: rect(0, 0, 8, 3), floorY: 0 }; // long along x
	const axis = longAxis(room);
	assert.ok(Math.abs(Math.abs(axis[0]) - 1) < 1e-6, JSON.stringify(axis));
	// Looking roughly towards +x (heading of [1, 0] is -90°): face +x.
	assert.ok(Math.abs(alongAxis(axis, headingOf([1, 0.3])) - headingOf([1, 0])) < 1e-6);
	assert.ok(Math.abs(Math.abs(alongAxis(axis, headingOf([-1, 0.3]))) - Math.abs(headingOf([-1, 0]))) < 1e-6);
	// headingOf: three.js yaw, forward = (-sin, -cos).
	const h = headingOf([0.6, -0.8]);
	assert.ok(Math.abs(-Math.sin(h) - 0.6) < 1e-12 && Math.abs(-Math.cos(h) + 0.8) < 1e-12);
});

test('the room under a point: by floor height, the smallest when rooms overlap', () => {
	const big = { name: 'Open plan', points: rect(0, 0, 10, 10), floorY: 0 };
	const nook = { name: 'Nook', points: rect(1, 1, 3, 3), floorY: 0 };
	const upstairs = { name: 'Bedroom', points: rect(0, 0, 5, 5), floorY: 2.62 };
	const plan = { rooms: [big, nook, upstairs], walls: [] };
	assert.equal(roomAt(plan, 2, 0, 2)?.name, 'Nook');
	assert.equal(roomAt(plan, 6, 0.01, 6)?.name, 'Open plan');
	assert.equal(roomAt(plan, 2, 2.62, 2)?.name, 'Bedroom');
	assert.equal(roomAt(plan, 20, 0, 20), null);
	assert.equal(roomAt(null, 1, 0, 1), null);
});

test('outside: pushed clear of the walls, never through them', () => {
	const plan = { rooms: [], walls: [{ a: [0, 0], b: [10, 0], thickness: 0.2, floorY: 0 }] };
	const [x, z] = clearOfWalls(plan, 5, 0, 0.3);
	assert.ok(Math.abs(x - 5) < 1e-9 && z >= 0.7 - 1e-6 && z < 0.75, `${x}, ${z}`);
	const [, z2] = clearOfWalls(plan, 5, 0, -0.2);
	assert.ok(z2 <= -0.7 + 1e-6, 'stays on its own side of the wall');
	assert.deepEqual(clearOfWalls(plan, 5, 0, 3), [5, 3], 'far from walls: unchanged');
	assert.deepEqual(clearOfWalls(plan, 5, 2.62, 0.3), [5, 0.3], 'walls on another storey do not count');
});

test('the example home: every room gives a clear spot inside it, on its own storey', async () => {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(path.resolve(import.meta.dirname, '../examples/example-home.sh3d'))));
	const built = await buildHome(parseHome(new TextDecoder().decode(entries['Home.xml'])), {});
	const { rooms, walls } = built.plan;
	assert.deepEqual(rooms.map((r) => r.name), ['Living room', 'Kitchen', 'Hall', 'Stairwell', 'Bedroom', 'Study']);
	assert.deepEqual(rooms.map((r) => r.floorY), [0, 0, 0, 0, 2.62, 2.62]);
	assert.equal(walls.length, 11);
	for (const room of rooms) {
		const l = roomLanding(room);
		assert.ok(inside(l.x, l.z, room.points) && edgeDistance(l.x, l.z, room.points) >= 0.35, room.name);
		assert.equal(roomAt(built.plan, l.x, room.floorY, l.z), room);
	}
});

// Build 215's D: a file without a Sweet Home 3D visitor walked in at the home's raw middle, which can fall in a wall
// or outside (an L-shaped home: its middle is in the garden). Now: the nearest room's clear middle, on the lowest floor.
test('without a visitor: the room at the home\'s middle, else the nearest one, on the lowest floor; named rooms first', () => {
	const hall = { name: 'Hall', points: rect(0, 0, 2, 6), floorY: 0 };
	const living = { name: 'Living', points: rect(2, 0, 8, 2), floorY: 0 };
	const upstairs = { name: 'Bedroom', points: rect(0, 0, 8, 6), floorY: 2.6 };
	const terrace = { name: '', points: rect(-5, -5, 13, 11), floorY: 0 }; // (an unnamed floor under everything)
	const plan = { rooms: [terrace, upstairs, hall, living], walls: [] };
	// The L-shaped home's middle, (4, 3), is outside both ground-floor rooms: the nearer is the living room (1 m away).
	assert.equal(nearestRoom(plan, 4, 3), living);
	assert.equal(nearestRoom(plan, 1, 3), hall, 'inside a room: that one');
	assert.equal(nearestRoom({ rooms: [terrace], walls: [] }, 4, 3), terrace, 'only an unnamed room: it will do');
	assert.equal(nearestRoom({ rooms: [], walls: [] }, 4, 3), null, 'no rooms (OBJ, GLB): none');
	assert.equal(nearestRoom(null, 4, 3), null);
	const l = roomLanding(nearestRoom(plan, 4, 3));
	assert.ok(inside(l.x, l.z, living.points) && edgeDistance(l.x, l.z, living.points) > 0.9, 'its clear middle, well inside');
});
