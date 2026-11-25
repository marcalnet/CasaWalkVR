// What the lasers, the teleport arc and the feet may hit (js/xr-targets.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { targetSets, findFloor, hitSegment } from '../js/xr-targets.js';

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

test('one level: you stand on floors and the ground only; the arc flies through furniture', () => {
	const h = home();
	const t = targetSets(h.model);
	assert.deepEqual(t.walkableList, [h.floor, h.ground]);
	assert.ok(t.walkable.has(h.floor) && !t.walkable.has(h.table));
	assert.ok(t.solid.includes(h.wall) && !t.solid.includes(h.table) && !t.solid.includes(h.door));
	assert.deepEqual(t.pointable, [h.table, h.door, h.wall, h.floor]);
	assert.deepEqual(t.floors, [h.floor, h.ground]);
	// From above the table straight down: lands on the floor, valid.
	const seg = hitSegment(ray, V(1, 1.5, 0), V(1, -0.05, 0), t);
	assert.ok(seg.valid && Math.abs(seg.point.y) < 1e-6, JSON.stringify(seg.point));
});

test('several levels: furniture (and so stairs) can be stood on; doors and windows never stop the arc', () => {
	const h = home({ multiLevel: true });
	const t = targetSets(h.model);
	assert.ok(t.walkable.has(h.table) && !t.walkable.has(h.door));
	assert.ok(t.solid.includes(h.table) && !t.solid.includes(h.door));
	const seg = hitSegment(ray, V(1, 1.5, 0), V(1, -0.05, 0), t);
	assert.ok(seg.valid && Math.abs(seg.point.y - 0.75) < 1e-6, JSON.stringify(seg.point));
});

test('no rooms (OBJ, GLB): anything but walls can be stood on', () => {
	const h = home({ rooms: false });
	const t = targetSets(h.model);
	assert.ok(t.walkable.has(h.table) && t.walkable.has(h.ground) && !t.walkable.has(h.wall) && !t.walkable.has(h.door));
});

test('walls stop the arc and are never a landing; hidden storeys are left out', () => {
	const h = home();
	let t = targetSets(h.model);
	const seg = hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t);
	assert.ok(seg && !seg.valid && seg.normal.z > 0.9, 'the normal faces the side the arc came from');
	assert.equal(hitSegment(ray, V(0, 1, 0), V(0, 1, 0), t), null, 'a zero-length segment hits nothing');
	h.table.visible = false;
	h.wall.visible = false;
	t = targetSets(h.model);
	assert.ok(!t.pointable.includes(h.table) && !t.solid.includes(h.wall));
	assert.equal(hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t), null);
});

// Stairs (several levels): the arc meeting a step's front (the riser) lands on
// its top (the tread); only walls stay red.
test('stairs: an arc meeting a riser lands on the tread above it', () => {
	const h = home({ multiLevel: true });
	// Five steps going away from you (towards -z): treads 25 cm deep, risers 18 cm high.
	const steps = [];
	for (let i = 0; i < 5; i++) steps.push(box(1, 0.18 * (i + 1), 0.25, -2, 0.09 * (i + 1), 1 - 0.25 * i));
	h.model.layers.main.add(...steps);
	const t = targetSets(h.model);
	// Flat at 0.30 m, towards the stair: meets the second step's riser (from 0.18 to 0.36 m) at z = 0.875.
	const seg = hitSegment(ray, V(-2, 0.3, 3), V(-2, 0.3, 0), t);
	assert.ok(seg.valid, 'the riser lands');
	assert.ok(Math.abs(seg.point.y - 0.36) < 1e-6 && seg.point.z < 0.875 && seg.point.z > 0.85, JSON.stringify(seg.point));
	assert.ok(seg.normal.y > 0.99, 'the ring lies flat on the tread');
	// A wall is never a landing, even with a floor behind its top.
	const wall = hitSegment(ray, V(0, 1.2, 0), V(0, 1.2, -4), t);
	assert.ok(wall && !wall.valid);
	// Too tall to be a step (the wall-like side of a 1 m block): red.
	h.model.layers.main.add(box(1, 1, 1, 2, 0.5, 2));
	const tall = hitSegment(ray, V(2, 0.3, 4), V(2, 0.3, 0), targetSets(h.model));
	assert.ok(tall && !tall.valid);
});

test('findFloor takes the first upward-facing floor below a point', () => {
	const h = home();
	const t = targetSets(h.model);
	const p = findFloor(ray, t.floors, V(2, 0.4, 1), 0.01);
	assert.ok(p && Math.abs(p.y) < 1e-6 && Math.abs(p.x - 2) < 1e-6);
	assert.equal(findFloor(ray, t.floors, V(30, 0.4, 30), 0.01), null, 'outside the ground: no floor');
});

// Pond House: a pond of flat water pieces. In a home with several levels you
// can stand on furniture (stairs), but never on water, nor on the ground under it.
test('water is never a landing or a floor, in any language; it blocks nothing', async () => {
	const { WATER_NAME, isWater } = await import('../js/optimise.js');
	for (const n of ['Pond water', 'Swimming pool', 'Water', 'Piscina', 'Agua', "Plan d'eau", 'Wasserfläche', 'Acqua', 'Estany']) assert.ok(WATER_NAME.test(n), n);
	for (const n of ['Watering can', 'Pooled lamp', 'Table', 'Beau chair', 'Water heater', 'Water tank', 'Pool table', 'Water-cooler', 'Wasserkocher']) assert.ok(!WATER_NAME.test(n), n);
	const piece = new THREE.Group();
	piece.userData.piece = { name: 'Pond', kind: 'piece' };
	const inner = new THREE.Mesh(new THREE.BoxGeometry(), mat);
	piece.add(inner);
	assert.ok(isWater(inner), 'a mesh inside a water piece, before the merge');
	const h = home({ multiLevel: true });
	const pond = box(3, 0.02, 3, -1.5, 0.005, 1.5, { water: true }); // merged: userData.water
	h.model.layers.main.add(pond);
	const t = targetSets(h.model);
	assert.ok(!t.walkable.has(pond) && t.walkable.has(h.table), 'furniture can be stood on (several levels), water not');
	const seg = hitSegment(ray, V(-1.5, 1.5, 1.5), V(-1.5, -0.1, 1.5), t);
	assert.ok(seg && !seg.valid, 'the arc meets the water: a red landing');
	assert.equal(findFloor(ray, t.floors, V(-1.5, 0, 1.5), 1), null, 'pointing at the pond: no floor, no marker');
	assert.ok(findFloor(ray, t.floors, V(2, 0, 2), 1), 'beside it: the floor');
});

// Glass (the user's decision, with the Pond House stair's glass balustrade):
// never a landing or a floor; by name or by a transparent material. It blocks
// no more than before: met by the arc only where furniture is (several levels).
test('glass is never a landing, by name or transparent material; it blocks nothing new', async () => {
	const { GLASS_NAME, isGlass, isGlassMaterial, optimiseModel } = await import('../js/optimise.js');
	for (const n of ['Glass balustrade', 'Glazing', 'Glazed screen', 'Mesa de vidrio', 'Table en verre', 'Glasscheibe', 'Glas', 'Vetro']) assert.ok(GLASS_NAME.test(n), n);
	for (const n of ['Table', 'Sofa', 'Bookcase', 'Overglaze vase']) assert.ok(!GLASS_NAME.test(n), n);
	assert.ok(isGlassMaterial(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.3 })) && !isGlassMaterial(mat));
	const piece = new THREE.Group();
	piece.userData.piece = { name: 'Glass table', kind: 'piece' };
	const inner = new THREE.Mesh(new THREE.BoxGeometry(), mat);
	piece.add(inner);
	assert.ok(isGlass(inner), 'a mesh inside a glass piece, before the merge');
	// The merge: a stair's oak treads and its see-through rail in one piece; only the rail is glass.
	const root = new THREE.Group(), main = new THREE.Group();
	main.name = 'main'; root.add(main);
	const stair = new THREE.Group();
	stair.userData.piece = { name: 'Stair', kind: 'piece' };
	stair.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), new THREE.MeshLambertMaterial({ color: 0x996633 })),
		new THREE.Mesh(new THREE.BoxGeometry(0.01, 1, 1), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.25 })));
	main.add(stair);
	const merged = optimiseModel(root).layers.main.children;
	assert.equal(merged.filter((m) => m.userData.glass).length, 1, 'the rail merges as glass, the treads do not');
	// Several levels: furniture can be stood on, glass not; the arc meets it as a red landing.
	const h = home({ multiLevel: true });
	const pane = box(1, 0.02, 1, -1.5, 1.0, 1.5, { glass: true }); // a glass table top, 1 m up
	h.model.layers.main.add(pane);
	let t = targetSets(h.model);
	assert.ok(!t.walkable.has(pane) && t.walkable.has(h.table), 'furniture can be stood on (several levels), glass not');
	const seg = hitSegment(ray, V(-1.5, 2, 1.5), V(-1.5, -0.1, 1.5), t);
	assert.ok(seg && !seg.valid, 'the arc meets the glass: a red landing');
	// One level: the arc flies through furniture, glass included, to the floor.
	const one = home();
	one.model.layers.main.add(box(1, 0.02, 1, -1.5, 1.0, 1.5, { glass: true }));
	t = targetSets(one.model);
	const through = hitSegment(ray, V(-1.5, 2, 1.5), V(-1.5, -0.1, 1.5), t);
	assert.ok(through && through.valid && Math.abs(through.point.y) < 0.02, 'one level: through the glass to the floor');
});
