// Where you land when the teleport arc meets something you can't stand on
// (the next-build asks, "Free teleport", "The snaps, in order"). The arc still
// ends where it hit; the ring shows where you will land (hit.land).
//
//   1. A wall, door, window or glass: step back 0.3 m towards where the arc
//      came from (your side), then look down for a floor within 3 m. It must
//      be clear (3): against a sofa or under a low shelf, the ring search (2)
//      from there finds the clear floor nearest your side (the code audit's S2).
//   2. Furniture (its side or top): clear floor round the piece, on rings
//      0.3, 0.6 and 1.0 m out from the hit, nearest first, the side facing you
//      first.
//   3. Clear: a standing circle 25 cm in radius, with 1.6 m of
//      headroom, nothing inside it, and no wall between it and the hit (a
//      sight line at knee height).
//   4. Low headroom on a floor (under a table, under the stairs): the same
//      ring search.
//   5. Nothing within 1 m: no landing (red).
// OBJ and GLB (no rooms): an upward surface with another 0.3-1.6 m straight
// beneath it is an object (a table, a bed, a shelf), snapped beside like
// furniture. Pure functions of ray casts against the target sets
// (js/xr-targets.js targetSets): run in Node tests.

import * as THREE from 'three';

export const LAND = {
	BACK: 0.3, DOWN: 3, // a wall: this far back to your side, then a floor this far below
	RINGS: [0.3, 0.6, 1.0], DIRS: 8, // furniture: the rings searched round the hit, and the directions on each
	RADIUS: 0.25, HEADROOM: 1.6, KNEE: 0.45, // clear: the standing circle, the room above it, the sight line's height
	OBJ_MIN: 0.3, OBJ_MAX: 1.6, // OBJ and GLB: another surface this far beneath makes an object
};

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

/** The first hit of a ray (from, dir, far) against meshes, or undefined. */
function cast(raycaster, from, dir, far, meshes) {
	raycaster.set(from, dir);
	raycaster.far = far;
	return raycaster.intersectObjects(meshes, false)[0];
}

/** The walkable floor straight below `p` (world), within `depth`, facing up; or null. */
export function floorBelow(raycaster, p, depth, t) {
	raycaster.set(p, DOWN);
	raycaster.far = depth;
	const first = raycaster.firstHitOnly;
	raycaster.firstHitOnly = false; // (every hit: in OBJ and GLB an object's top is passed over for the floor beneath)
	const hits = raycaster.intersectObjects(t.walkableList, false);
	raycaster.firstHitOnly = first;
	for (const h of hits) {
		const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : UP;
		if (n.y <= 0.7) continue;
		if (t.objModel && spaceBeneath(raycaster, h.point, t)) continue;
		return h.point.clone();
	}
	return null;
}

/**
 * True if a person can stand at floor point f: 1.6 m of headroom, nothing
 * within the standing circle (at knee height), and (from, if given) no wall
 * between f and the hit, at knee height.
 */
/**
 * True if there is HEADROOM above floor point f: nothing solid between 5 cm
 * and HEADROOM above it. (Looked for from above, down: a ray starting inside
 * a piece never meets its faces.)
 */
export function headroom(raycaster, f, t) {
	return !cast(raycaster, _a.copy(f).addScaledVector(UP, LAND.HEADROOM), DOWN, LAND.HEADROOM - 0.05, t.solid);
}

export function standable(raycaster, f, t, from = null) {
	const solidNotFloor = t.solid.filter((m) => !t.walkable.has(m));
	if (!headroom(raycaster, f, t)) return false;
	const edge = new THREE.Vector3();
	for (let i = 0; i < 4; i++) {
		const u = (i / 4) * Math.PI * 2;
		// Nothing over the standing circle (from above), and no wall across it (at knee height, outwards).
		if (!headroom(raycaster, edge.set(f.x + Math.cos(u) * LAND.RADIUS, f.y, f.z + Math.sin(u) * LAND.RADIUS), t)) return false;
		if (cast(raycaster, _a.copy(f).addScaledVector(UP, LAND.KNEE), _d.set(Math.cos(u), 0, Math.sin(u)), LAND.RADIUS, solidNotFloor)) return false;
	}
	if (from) {
		const a = _b.copy(from).setY(f.y + LAND.KNEE), to = _d.copy(f).setY(f.y + LAND.KNEE).sub(a);
		const len = to.length();
		if (len > 1e-3 && cast(raycaster, a, to.divideScalar(len), len, [...t.wallLike])) return false;
	}
	return true;
}

/**
 * The clear floor nearest a hit (the rings round it, the side facing you
 * first: towards, a horizontal unit vector from the hit to you), or null.
 */
export function ringSearch(raycaster, point, towards, t) {
	for (const r of LAND.RINGS) {
		const dirs = [];
		for (let i = 0; i < LAND.DIRS; i++) {
			const u = (i / LAND.DIRS) * Math.PI * 2, d = new THREE.Vector3(Math.cos(u), 0, Math.sin(u));
			dirs.push({ d, score: d.dot(towards) });
		}
		dirs.sort((a, b) => b.score - a.score);
		for (const { d } of dirs) {
			const above = point.clone().addScaledVector(d, r);
			above.y += 0.3;
			const f = floorBelow(raycaster, above, LAND.DOWN, t);
			if (f && standable(raycaster, f, t, point)) return f;
		}
	}
	return null;
}

/** OBJ and GLB: true if another upward surface lies OBJ_MIN-OBJ_MAX straight beneath p (it is an object, not a floor). */
export function spaceBeneath(raycaster, p, t) {
	const h = cast(raycaster, _a.copy(p).addScaledVector(DOWN, 0.01), DOWN, LAND.OBJ_MAX, t.walkableList);
	if (!h) return false;
	const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : UP;
	const gap = p.y - h.point.y;
	return n.y > 0.7 && gap >= LAND.OBJ_MIN && gap <= LAND.OBJ_MAX;
}

/**
 * Where to land for a hit the arc met (hit: { object, point, normal }; from:
 * where that arc segment came from): { land } (a world floor point) or null
 * (no landing within reach: red).
 */
export function landFor(raycaster, hit, from, t) {
	const towards = _d.copy(from).sub(hit.point).setY(0);
	if (towards.lengthSq() < 1e-9) towards.copy(hit.normal).setY(0);
	towards.normalize();
	const dir = towards.clone();
	if (t.wallLike.has(hit.object)) {
		// A wall, door, window or glass: back to your side, then the floor below, if it is clear
		// (not inside a sofa or under a shelf against the wall); else the clear floor nearest it.
		const back = hit.point.clone().addScaledVector(dir, LAND.BACK);
		const f = floorBelow(raycaster, back, LAND.DOWN, t);
		if (f && standable(raycaster, f, t)) return { land: f };
		const near = ringSearch(raycaster, f ?? back, dir, t);
		return near ? { land: near } : null;
	}
	const f = ringSearch(raycaster, hit.point, dir, t);
	return f ? { land: f } : null;
}
