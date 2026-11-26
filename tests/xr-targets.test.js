// What the lasers, the teleport arc and the feet may hit (js/xr-targets.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { targetSets, findFloor, hitSegment, inPortal, firstHit } from '../js/xr-targets.js';

const mat = new THREE.MeshLambertMaterial();
const box = (w, h, d, x, y, z, userData = {}) => {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x, y, z), mat);
	Object.assign(m.userData, userData);
	m.updateMatrixWorld(true);
	return m;
};
const group = (...children) => { const g = new THREE.Group(); if (children.length) g.add(...children); return g; };

/** A room: a floor, one wall, a table (top at 0.75 m), a door, and the ground. */
function home({ multiLevel = false, rooms = true } = {}) {
	const floor = box(6, 0.02, 6, 0, -0.01, 0);
	const wall = box(6, 2.5, 0.15, 0, 1.25, -3);
	const table = box(1.6, 0.75, 0.8, 1, 0.375, 0);
	const door = box(0.9, 2.1, 0.05, -1, 1.05, -2.9, { opening: true });
	const ground = box(40, 0.02, 40, 0, -0.03, 0);
	const layers = { main: group(table, door), walls: group(wall), floors: rooms ? group(floor) : group(), ground: group(ground), ceilings: group() };
	return { model: { layers, multiLevel }, floor, wall, table, door, ground };
}

const ray = new THREE.Raycaster();
const V = (...a) => new THREE.Vector3(...a);

test('free teleport: you stand on floors, the ground, water, stairs and platforms; furniture, walls and glass stop the arc; doors and windows never', () => {
	const h = home();
	const t = targetSets(h.model);
	assert.deepEqual(t.walkableList, [h.floor, h.ground]);
	assert.ok(t.walkable.has(h.floor) && !t.walkable.has(h.table), 'a table is never a landing');
	assert.ok(t.solid.includes(h.wall) && t.solid.includes(h.table) && !t.solid.includes(h.door), 'the arc meets furniture (to snap beside it), never a door');
	assert.deepEqual(t.pointable, [h.table, h.door, h.wall, h.floor]);
	assert.ok(t.wallLike.has(h.wall) && !t.wallLike.has(h.table));
	// Straight down onto the table: the arc ends on it, the ring on the clear floor beside it (towards where the arc came from).
	const seg = hitSegment(ray, V(1, 1.5, 0.05), V(1, 0.5, 0.05), t);
	assert.ok(seg.valid && Math.abs(seg.point.y - 0.75) < 1e-6, 'the arc ends where it hit');
	assert.ok(seg.land && Math.abs(seg.land.y) < 1e-6, `the landing on the floor: ${JSON.stringify(seg.land)}`);
	const off = Math.max(Math.abs(seg.land.x - 1) - 0.8, Math.abs(seg.land.z) - 0.4);
	assert.ok(off > 0.2, `beside the table, clear of it: ${JSON.stringify(seg.land)}`);
});

test('several levels or one: the same rule; a sofa or bed is never a platform; a deck or step by name is', async () => {
	const { PLATFORM_NAME, STAIR_NAME } = await import('../js/optimise.js');
	for (const n of ['Deck', 'Wooden decking', 'Step', 'Platform', 'Terrace', 'Podium', 'Terrassa', 'Plataforma']) assert.ok(PLATFORM_NAME.test(n), n);
	for (const n of ['Sofa', 'Bed', 'Coffee table', 'Dining table', 'Stepladder chair', 'Deckchair']) assert.ok(!PLATFORM_NAME.test(n), n);
	for (const n of ['Stair', 'Staircase', 'Spiral stairs', 'Escalera', 'Escalier', 'Treppe', 'Scala']) assert.ok(STAIR_NAME.test(n), n);
	const h = home({ multiLevel: true }), deck = box(2, 0.3, 2, -2, 0.15, 2, { platform: true });
	h.model.layers.main.add(deck);
	const t = targetSets(h.model);
	assert.ok(t.walkable.has(deck) && !t.walkable.has(h.table), 'the deck, never the table');
	const seg = hitSegment(ray, V(-2, 1.5, 2), V(-2, 0.1, 2), t);
	assert.ok(seg.valid && Math.abs(seg.point.y - 0.3) < 1e-6 && !seg.land, 'on the deck');
});

test('no rooms (OBJ, GLB): the safe way: an upward surface with space 0.3-1.6 m beneath it is an object, snapped beside', () => {
	const h = home({ rooms: false });
	const t = targetSets(h.model);
	assert.ok(t.objModel && t.walkable.has(h.table) && t.walkable.has(h.ground) && !t.walkable.has(h.wall) && !t.walkable.has(h.door));
	// A table top over the ground (0.75 m of space beneath): an object.
	const h2 = home({ rooms: false });
	h2.model.layers.main.remove(h2.table);
	const top = box(1.6, 0.04, 0.8, 1, 0.75, 0);
	h2.model.layers.main.add(top);
	const t2 = targetSets(h2.model);
	const seg = hitSegment(ray, V(1, 1.5, 0.1), V(1, 0.5, 0.1), t2);
	assert.ok(seg.valid && seg.land && Math.abs(seg.land.y + 0.02) < 0.03, `an object: snapped to the ground beside it (${JSON.stringify(seg.land)})`);
});

test('walls stop the arc: the landing is the floor at their foot, on your side; hidden storeys are left out', () => {
	const h = home();
	let t = targetSets(h.model);
	const seg = hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t);
	assert.ok(seg && seg.normal.z > 0.9, 'the normal faces the side the arc came from');
	assert.ok(seg.valid && seg.land && seg.land.z > -2.9 && seg.land.z < -2.5 && Math.abs(seg.land.y) < 1e-6, `at the wall's foot, on your side: ${JSON.stringify(seg.land)}`);
	assert.equal(hitSegment(ray, V(0, 1, 0), V(0, 1, 0), t), null, 'a zero-length segment hits nothing');
	h.table.visible = false;
	h.wall.visible = false;
	t = targetSets(h.model);
	assert.ok(!t.pointable.includes(h.table) && !t.solid.includes(h.wall));
	assert.equal(hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t), null);
});

test('a wall with furniture against it: never a landing inside a sofa or under a low shelf; the clear floor nearest your side (the audit\'s S2)', () => {
	// A sofa 0.9 m deep against the wall (its face at z = -2.925): aimed at the wall above it.
	let h = home();
	h.model.layers.main.add(box(2, 0.45, 0.9, 0, 0.225, -2.48));
	let t = targetSets(h.model);
	let seg = hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t);
	assert.ok(seg?.valid && seg.land && seg.land.z > -2.03 + 0.2 && Math.abs(seg.land.y) < 1e-6, `in front of the sofa, not in it: ${JSON.stringify(seg?.land)}`);
	// A shelf 1.0 m up against the wall: aimed at the wall under it.
	h = home();
	h.model.layers.main.add(box(2, 0.05, 0.4, 0, 1.0, -2.725));
	t = targetSets(h.model);
	seg = hitSegment(ray, V(0, 0.9, 0), V(0, 0.4, -4), t);
	assert.ok(seg?.valid && seg.land && seg.land.z > -2.525 + 0.2, `in front of the shelf, with headroom: ${JSON.stringify(seg?.land)}`);
});

test('red only where it makes no sense: a ceiling or underside, outside the site', () => {
	const h = home();
	h.model.layers.main.add(box(2, 0.05, 2, -2, 2.6, 2)); // (a slab overhead)
	const t = targetSets(h.model);
	const up = hitSegment(ray, V(-2, 1.5, 2), V(-2, 3, 2), t);
	assert.ok(up && !up.valid, 'its underside: red');
	assert.ok(t.bounds && !t.bounds.containsPoint(V(40, 0, 0)), 'the site: every layer\'s box grown by 1 m');
});

// Stairs (several levels): the arc meeting a step's front (the riser) lands on
// its top (the tread); only walls stay red.
test('stairs: an arc meeting a riser lands on the tread above it', () => {
	const h = home(); // (one level: stairs are landings in every home now)
	// Five steps going away from you (towards -z): treads 25 cm deep, risers 18 cm high.
	const steps = [];
	for (let i = 0; i < 5; i++) steps.push(box(1, 0.18 * (i + 1), 0.25, -2, 0.09 * (i + 1), 1 - 0.25 * i, { stair: true }));
	h.model.layers.main.add(...steps);
	const t = targetSets(h.model);
	// Flat at 0.30 m, towards the stair: meets the second step's riser (from 0.18 to 0.36 m) at z = 0.875.
	const seg = hitSegment(ray, V(-2, 0.3, 3), V(-2, 0.3, 0), t);
	assert.ok(seg.valid, 'the riser lands');
	assert.ok(Math.abs(seg.point.y - 0.36) < 1e-6 && seg.point.z < 0.875 && seg.point.z > 0.85, JSON.stringify(seg.point));
	assert.ok(seg.normal.y > 0.99, 'the ring lies flat on the tread');
	// A wall is never a landing itself, even with a floor behind its top: its foot, on your side.
	const wall = hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t);
	assert.ok(wall && wall.land && wall.land.z > -3, 'the wall: its foot on your side');
	// A 1 m block (furniture, not a step): the floor beside it.
	h.model.layers.main.add(box(1, 1, 1, 2, 0.5, 2));
	const tall = hitSegment(ray, V(2, 0.3, 4), V(2, 0.3, 0), targetSets(h.model));
	assert.ok(tall && tall.valid && tall.land && Math.abs(tall.land.y) < 1e-6 && tall.land.z > 2.5, `beside it, on your side: ${JSON.stringify(tall?.land)}`);
});

test('findFloor takes the first upward-facing floor below a point', () => {
	const h = home();
	const t = targetSets(h.model);
	const p = findFloor(ray, t.floors, V(2, 0.4, 1), 0.01);
	assert.ok(p && Math.abs(p.y) < 1e-6 && Math.abs(p.x - 2) < 1e-6);
	assert.equal(findFloor(ray, t.floors, V(30, 0.4, 30), 0.01), null, 'outside the ground: no floor');
});

// Water: you stand on its surface (the user's priority, 26 Nov 2026).
test('water is a floor and a landing: you stand on its surface, in any language', async () => {
	const { WATER_NAME, isWater } = await import('../js/optimise.js');
	for (const n of ['Pond water', 'Swimming pool', 'Water', 'Piscina', 'Agua', "Plan d'eau", 'Wasserfläche', 'Acqua', 'Estany']) assert.ok(WATER_NAME.test(n), n);
	for (const n of ['Watering can', 'Pooled lamp', 'Table', 'Beau chair', 'Water heater', 'Water tank', 'Pool table', 'Water-cooler', 'Wasserkocher']) assert.ok(!WATER_NAME.test(n), n);
	const piece = new THREE.Group();
	piece.userData.piece = { name: 'Pond', kind: 'piece' };
	const inner = new THREE.Mesh(new THREE.BoxGeometry(), mat);
	piece.add(inner);
	assert.ok(isWater(inner), 'a mesh inside a water piece, before the merge');
	const h = home();
	const pond = box(3, 0.02, 3, -1.5, 0.005, 1.5, { water: true });
	h.model.layers.main.add(pond);
	const t = targetSets(h.model);
	assert.ok(t.walkable.has(pond), 'water: a landing');
	const seg = hitSegment(ray, V(-1.5, 1.5, 1.5), V(-1.5, -0.1, 1.5), t);
	assert.ok(seg && seg.valid && Math.abs(seg.point.y - 0.015) < 1e-6 && !seg.land, 'on the water\'s surface');
	const f = findFloor(ray, t.floors, V(-1.5, 0, 1.5), 1);
	assert.ok(f && Math.abs(f.y - 0.015) < 1e-6, 'the feet stand on it, never on the pond\'s bed');
});

// Glass: like a wall (aimed at, the floor below on your side), never a landing.
test('glass is never a landing: aimed at, the floor below it on your side; by name or transparent material', async () => {
	const { GLASS_NAME, isGlass, isGlassMaterial, optimiseModel } = await import('../js/optimise.js');
	for (const n of ['Glass balustrade', 'Glazing', 'Glazed screen', 'Mesa de vidrio', 'Table en verre', 'Glasscheibe', 'Glas', 'Vetro']) assert.ok(GLASS_NAME.test(n), n);
	for (const n of ['Table', 'Sofa', 'Bookcase', 'Overglaze vase']) assert.ok(!GLASS_NAME.test(n), n);
	assert.ok(isGlassMaterial(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.3 })) && !isGlassMaterial(mat));
	const piece = new THREE.Group();
	piece.userData.piece = { name: 'Glass table', kind: 'piece' };
	const inner = new THREE.Mesh(new THREE.BoxGeometry(), mat);
	piece.add(inner);
	assert.ok(isGlass(inner), 'a mesh inside a glass piece, before the merge');
	// The merge: a stair's oak treads and its see-through rail in one piece; the rail is glass, the treads a stair.
	const root = new THREE.Group(), main = new THREE.Group();
	main.name = 'main'; root.add(main);
	const stair = new THREE.Group();
	stair.userData.piece = { name: 'Stair', kind: 'piece' };
	stair.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), new THREE.MeshLambertMaterial({ color: 0x996633 })),
		new THREE.Mesh(new THREE.BoxGeometry(0.01, 1, 1), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.25 })));
	main.add(stair);
	const merged = optimiseModel(root).layers.main.children;
	assert.equal(merged.filter((m) => m.userData.glass).length, 1, 'the rail merges as glass');
	assert.equal(merged.filter((m) => m.userData.stair).length, 1, 'the treads merge as a stair');
	// A glass balustrade at x = -1.5, aimed at from the room: the floor at its foot, on your side.
	const h = home();
	const pane = box(0.02, 1, 2, -1.5, 0.5, 1.5, { glass: true });
	h.model.layers.main.add(pane);
	const t = targetSets(h.model);
	assert.ok(!t.walkable.has(pane) && t.wallLike.has(pane));
	const seg = hitSegment(ray, V(0, 0.8, 1.5), V(-3, 0.8, 1.5), t);
	assert.ok(seg && seg.valid && seg.land && seg.land.x > -1.5 && Math.abs(seg.land.y) < 1e-6, `like a wall: the floor below, on your side (${JSON.stringify(seg?.land)})`);
});

test('a wall portal is a hole for the arc: through it you land beyond; outside it the wall still stops you', () => {
	// The wall at z = -3 (0.15 thick); a floor on both sides of it.
	const h = home();
	const beyond = box(6, 0.02, 4, 0, -0.01, -5);
	h.model.layers.floors.add(beyond);
	const t = targetSets(h.model);
	const from = V(0, 1.3, -2.5), to = V(0, -0.2, -3.6); // a steep arc segment crossing the wall, landing beyond it
	assert.ok(hitSegment(ray, from, to, t).land?.z > -3, 'no portal: the wall stops the arc (the landing at its foot, on your side)');
	t.cut = new Set([h.wall]);
	t.holes = [{ x: 0, y: 1, z: -3.0, w: 0.35 }];
	const seg = hitSegment(ray, V(0, 1.0, -2.8), V(0, -0.2, -3.8), t);
	assert.ok(seg && seg.valid && seg.point.z < -3.1, `through the hole, landing beyond: ${JSON.stringify(seg?.point)}`);
	t.holes = [{ x: 2, y: 1, z: -3.0, w: 0.35 }]; // a hole elsewhere in the wall
	assert.ok(hitSegment(ray, V(0, 1.0, -2.8), V(0, -0.2, -3.8), t).land?.z > -3, 'outside the hole: still a wall');
	// Only what the portal cuts: furniture inside the sphere still counts.
	assert.ok(!inPortal({ object: h.table, point: V(0, 1, -3) }, { holes: [{ x: 0, y: 1, z: -3, w: 0.35 }], cut: new Set([h.wall]) }));
	assert.equal(firstHit([1, 2], { holes: [] }), 1);
});
