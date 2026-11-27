// What the lasers, the teleport arc and the feet may hit in the headset
// (SPEC.md, "Experience and controls", walk mode). Pure functions of the
// model's layers, so the rules can be tested in Node.
//
//   Free teleport (the next-build asks, "Free teleport"; one rule for every
//   Sweet Home 3D home, however many levels): a landing is valid wherever a
//   person could stand. You stand on room floors, the ground, water (on its
//   surface), stairs and structural platforms (decks, steps, terraces: by
//   name or catalogue, js/optimise.js; never by size). Other furniture, walls
//   and glass stop the arc, and the landing snaps to the clear floor beside
//   them, on your side (js/landing.js). Doors and windows let the arc through
//   (doorways). Walls always stop the arc; portals let it through.
//   No rooms (OBJ and GLB): anything but doors and windows may be stood on,
//   but an upward surface with space 0.3-1.6 m beneath it is an object (a
//   table, a bed) and snaps beside, like furniture.

import * as THREE from 'three';
import { isOpening, isWater, isGlass, isStair, isPlatform } from './optimise.js';
import { landFor, spaceBeneath, headroom } from './landing.js';

/**
 * Every "this hand belongs to that" decision in the headset (the interaction
 * harmony's rule 4): a hand within NEAR of a key, the fan or a wing
 * is claimed by it; it lets go beyond CLEAR. One place, so a change moves
 * them all (the B9 slide and the model's 30 cm are spaces, not claims).
 */
export const CLAIM = { near: 0.15, clear: 0.25 };

export const UP = new THREE.Vector3(0, 1, 0);
export const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Mesh sets for a model { layers, multiLevel }: what the laser can hit
 * (pointable), what counts as floor in the dollhouse (floors), what the
 * teleport arc hits (solid), what you can stand on (walkable, as a Set
 * and as a list), and what a landing spot must be clear of (obstacles:
 * furniture, doors, windows and walls). Only what is shown: storeys hidden by the level picker are
 * left out. Ask again after showing or hiding meshes.
 */
export function targetSets(model) {
	const shown = (name) => (model.layers[name]?.children ?? []).filter((m) => m.visible);
	const L = { main: shown('main'), walls: shown('walls'), floors: shown('floors'), ground: shown('ground') };
	const walls = L.walls;
	const objModel = L.floors.length === 0; // (no rooms: OBJ and GLB, the safe rule)
	const water = L.main.filter((m) => isWater(m));
	const pieces = L.main.filter((m) => !isOpening(m) && !water.includes(m));
	const glass = pieces.filter((m) => isGlass(m));
	const stand = pieces.filter((m) => !glass.includes(m) && (objModel || isStair(m) || isPlatform(m)));
	const furniture = pieces.filter((m) => !glass.includes(m) && !stand.includes(m));
	const walkable = [...L.floors, ...L.ground, ...water, ...stand];
	return {
		pointable: [...L.main, ...walls, ...L.floors],
		floors: walkable, // (where the feet and a pointed laser find floor: water too, on its surface)
		solid: [...walls, ...walkable, ...glass, ...furniture], // (the arc meets all of these; only walkable tops are landings)
		walkable: new Set(walkable),
		walkableList: walkable,
		wallLike: new Set([...walls, ...glass]), // (met: step back to your side, then the floor below)
		objModel,
		obstacles: [...L.main, ...walls],
		bounds: siteBounds(model), // (outside the site: no landing)
	};
}

/** The site: the box of every layer, grown by 1 m (beyond it no landing). */
function siteBounds(model) {
	const box = new THREE.Box3();
	for (const name of ['main', 'walls', 'floors', 'ground']) for (const m of model.layers[name]?.children ?? []) if (m.visible) box.expandByObject(m);
	return box.isEmpty() ? null : box.expandByScalar(1);
}

/** A ray hit's face normal in world space. */
export function worldNormal(hit) {
	if (!hit.face) return new THREE.Vector3(0, 1, 0);
	return hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
}

/**
 * Floor under a point: cast straight down from `lift` above it (the model is
 * only ever yawed and uniformly scaled, so "down" in model space is down in
 * the world) and take the first upward-facing floor hit. Returns a world
 * point or null.
 */
export function findFloor(raycaster, floors, worldPoint, lift) {
	raycaster.set(worldPoint.clone().addScaledVector(UP, lift), DOWN);
	raycaster.far = Infinity;
	const hits = raycaster.intersectObjects(floors, false);
	const h = hits.find((x) => !x.face || worldNormal(x).y > 0.7);
	return h ? h.point : null; // (water too: you stand on its surface)
}

// Stairs: the arc meeting a step's steep front (the riser) lands on its top
// (the tread). Look down from this far above the hit, this far behind the face.
const STEP_UP = 0.25, STEP_IN = 0.02;

/**
 * First solid hit between two world points (`t`: targetSets()), with its
 * world normal turned to the side the segment came from; valid only on a
 * walkable, upward-facing surface. A steep face of something walkable (a
 * stair's riser; walls never are walkable) lands on the walkable top found
 * just above and behind it, if there is one within STEP_UP: so only real
 * walls stay red.
 */
export function hitSegment(raycaster, a, b, t) {
	const dir = b.clone().sub(a);
	const len = dir.length();
	if (len < 1e-6) return null;
	raycaster.set(a, dir.divideScalar(len));
	raycaster.far = len;
	const h = firstHit(raycaster.intersectObjects(t.solid, false), t);
	if (!h) return null;
	const normal = worldNormal(h);
	if (normal.dot(dir) > 0) normal.negate(); // the side the arc came from
	const point = h.point, walk = t.walkable.has(h.object);
	if (t.bounds && !t.bounds.containsPoint(point)) return { point, normal, valid: false }; // (outside the site)
	if (normal.y < -0.3) return { point, normal, valid: false }; // (a ceiling or an underside)
	if (walk && normal.y > 0.7) {
		// A floor, water, a stair's tread, a platform: here, unless it is an object (OBJ, GLB) or the headroom is low (under a table).
		if (!(t.objModel && spaceBeneath(raycaster, point, t)) && headroom(raycaster, point, t)) return { point, normal, valid: true };
	} else if (walk) {
		const tread = treadAbove(raycaster, point, normal, t); // (a stair's riser: the tread above it)
		if (tread) return tread;
	}
	// Something you can't stand on: the floor beside it, on your side (js/landing.js); the arc still ends here.
	const l = landFor(raycaster, { object: h.object, point, normal }, a, t);
	return { point, normal, valid: !!l, land: l?.land ?? null, wall: t.wallLike.has(h.object) };
}

/**
 * True where a ray hit is inside a wall portal's hole (t.holes: spheres
 * { x, y, z, w }; t.cut: the meshes they cut): the arc and the snap's sight
 * lines pass through it as the eyes do.
 */
export function inPortal(hit, t) {
	if (!t?.holes?.length || !t.cut?.has(hit.object)) return false;
	for (const u of t.holes) if (Math.hypot(hit.point.x - u.x, hit.point.y - u.y, hit.point.z - u.z) < u.w) return true;
	return false;
}

/** The first of a ray's hits (nearest first) that is not inside a portal's hole. */
export function firstHit(hits, t) {
	if (!t?.holes?.length) return hits[0];
	return hits.find((h) => !inPortal(h, t));
}

/** The walkable top just above and behind a steep face at `point` (normal: towards the arc), or null. */
function treadAbove(raycaster, point, normal, t) {
	const back = new THREE.Vector3(-normal.x, 0, -normal.z);
	if (back.lengthSq() < 1e-6) return null;
	back.normalize();
	raycaster.set(point.clone().addScaledVector(back, STEP_IN).addScaledVector(UP, STEP_UP), DOWN);
	raycaster.far = STEP_UP;
	const h = raycaster.intersectObjects(t.solid, false)[0];
	if (!h || !t.walkable.has(h.object)) return null;
	const n = worldNormal(h);
	return n.y > 0.7 ? { point: h.point, normal: n, valid: true } : null;
}
