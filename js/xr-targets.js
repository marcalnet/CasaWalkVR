// What the lasers, the teleport arc and the feet may hit in the headset
// (SPEC.md, "Experience and controls", walk mode). Pure functions of the
// model's layers, so the rules can be tested in Node.
//
//   One level: you stand on room floors and the ground only, and the arc
//   flies through furniture to the floor.
//   More than one level (or no rooms, as in OBJ and GLB files): you can stand
//   on anything but walls, doors and windows, so stairs work and the arc still
//   passes through doorways.
//   Walls always stop the arc.
//   Water (pieces named water, pond, pool...: optimise.js WATER_NAME) is never
//   a landing or a floor: the arc meets it as a red landing, a laser pointing
//   at it finds no floor, and the feet never stand on it. It blocks no
//   movement.
//   Glass (pieces named glass..., or a transparent material: optimise.js
//   GLASS_NAME, isGlassMaterial) is never a landing or a floor either. It is
//   still furniture: met by the arc (as a red landing) only where furniture
//   is met, in a home with several levels; flown through in a one-level one.

import * as THREE from 'three';
import { isOpening, isWater, isGlass } from './optimise.js';

/**
 * Every "this hand belongs to that" decision in the headset (the interaction
 * harmony's rule 4): a hand within NEAR of a key, the orb, the fan or a wing
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
	const anywhere = model.multiLevel || L.floors.length === 0;
	const water = L.main.filter((m) => isWater(m));
	const furniture = L.main.filter((m) => !isOpening(m) && !water.includes(m));
	const glass = furniture.filter((m) => isGlass(m));
	const walkable = [...L.floors, ...L.ground, ...(anywhere ? furniture.filter((m) => !glass.includes(m)) : [])];
	return {
		pointable: [...L.main, ...walls, ...L.floors],
		floors: [...L.floors, ...L.ground, ...water], // (water is met first, and gives no floor: findFloor)
		solid: [...walls, ...walkable, ...water, ...(anywhere ? glass : [])], // (met, never valid: not walkable)
		walkable: new Set(walkable),
		walkableList: walkable,
		obstacles: [...L.main, ...walls],
	};
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
	return h && !isWater(h.object) ? h.point : null; // (water over the ground: no floor there)
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
	if (normal.y > 0.7 || !t.walkable.has(h.object) || normal.y < -0.3) return { point: h.point, normal, valid: normal.y > 0.7 && t.walkable.has(h.object) };
	return treadAbove(raycaster, h.point, normal, t) ?? { point: h.point, normal, valid: false };
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
