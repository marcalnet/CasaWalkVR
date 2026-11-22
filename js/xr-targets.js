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

import * as THREE from 'three';
import { isOpening, isWater } from './optimise.js';

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
	const walkable = [...L.floors, ...L.ground, ...(anywhere ? furniture : [])];
	return {
		pointable: [...L.main, ...walls, ...L.floors],
		floors: [...L.floors, ...L.ground, ...water], // (water is met first, and gives no floor: findFloor)
		solid: [...walls, ...walkable, ...water], // (met, never valid: not walkable)
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

/**
 * First solid hit between two world points (`t`: targetSets()), with its
 * world normal turned to the side the segment came from; valid only on a
 * walkable, upward-facing surface.
 */
export function hitSegment(raycaster, a, b, t) {
	const dir = b.clone().sub(a);
	const len = dir.length();
	if (len < 1e-6) return null;
	raycaster.set(a, dir.divideScalar(len));
	raycaster.far = len;
	const h = raycaster.intersectObjects(t.solid, false)[0];
	if (!h) return null;
	const normal = worldNormal(h);
	if (normal.dot(dir) > 0) normal.negate(); // the side the arc came from
	return { point: h.point, normal, valid: normal.y > 0.7 && t.walkable.has(h.object) };
}
