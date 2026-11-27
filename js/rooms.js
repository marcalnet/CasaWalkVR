// Where stepping inside lands (SPEC.md, milestone B4). Landing exactly where
// you point often put newcomers against a wall or facing nothing, so
// pointing at a room lands you in its clear middle, facing along it; pointing
// at the garden lands you where you point, kept clear of the walls and
// facing the house. Pure functions of the plan that js/sh3d.js exports (room
// outlines and wall lines, metres, x and z), so they run in Node tests.
//
// "Clear middle": the point inside the room farthest from its walls (not the
// average of its corners, which can fall outside an L-shaped room), moved off
// furniture: the caller says what is clear (raycasts against the model).

const STEP = 0.2; // metres between the spots tried in a room (wide enough that a table doesn't use up every try)
const MIN_CLEAR = 0.35; // a spot must be at least this far from the room's edges
const MAX_TRIED = 200; // spots checked for furniture, best first (5 raycasts each, once per room)
const OUTDOOR_CLEAR = 0.6; // outside, stand at least this far from any wall
const LEVEL_TOLERANCE = 0.3; // metres: a floor point belongs to rooms whose floor is this close

/** True if (x, z) is inside the polygon [[x, z], ...] (even-odd rule). */
export function inside(x, z, points) {
	let hit = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const [xi, zi] = points[i], [xj, zj] = points[j];
		if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
	}
	return hit;
}

/** Distance from (x, z) to the segment a-b. */
export function segmentDistance(x, z, [ax, az], [bx, bz]) {
	const dx = bx - ax, dz = bz - az;
	const len2 = dx * dx + dz * dz;
	const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
	return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

/** Distance from (x, z) to the nearest edge of a polygon. */
export function edgeDistance(x, z, points) {
	let d = Infinity;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) d = Math.min(d, segmentDistance(x, z, points[j], points[i]));
	return d;
}

/** Area of a polygon (absolute). */
export function area(points) {
	let a = 0;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
	return Math.abs(a) / 2;
}

/**
 * The room a floor point (model metres x, y, z) is in: among the rooms whose
 * floor is at that height, the smallest one containing it (rooms can overlap
 * in a plan). Null outside every room.
 */
export function roomAt(plan, x, y, z) {
	let best = null;
	for (const room of plan?.rooms ?? []) {
		if (Math.abs(room.floorY - y) > LEVEL_TOLERANCE || !inside(x, z, room.points)) continue;
		room.area ??= area(room.points);
		if (!best || room.area < best.area) best = room;
	}
	return best;
}

/**
 * The room to walk into when the file has no Sweet Home 3D visitor (build
 * 215's D: the home's raw middle could fall in a wall or outside): on the
 * lowest floor, the named room containing (x, z), else the named room
 * nearest it (its nearest edge). Unnamed rooms (floors or ceilings drawn as
 * rooms) only if there is no named one. Null without rooms.
 */
export function nearestRoom(plan, x, z) {
	const all = plan?.rooms ?? [];
	if (!all.length) return null;
	const named = all.filter((r) => r.name);
	const pool = named.length ? named : all;
	const lowest = Math.min(...pool.map((r) => r.floorY));
	let best = null, bestD = Infinity;
	for (const room of pool) {
		if (room.floorY - lowest > LEVEL_TOLERANCE) continue;
		room.area ??= area(room.points);
		const d = inside(x, z, room.points) ? -1 / room.area : edgeDistance(x, z, room.points); // (inside: the smallest that holds it)
		if (d < bestD) { bestD = d; best = room; }
	}
	return best;
}

/**
 * Spots to stand in a room, best first: points on a STEP grid inside it, at
 * least MIN_CLEAR from its edges, sorted by distance from the edges (the
 * farthest first). If the room is too small for that, its single most open
 * point. Each spot: { x, z, clear (metres to the nearest edge) }.
 */
export function roomSpots(room) {
	const xs = room.points.map((p) => p[0]), zs = room.points.map((p) => p[1]);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
	// (A huge "room", e.g. a whole terrain drawn as one, is sampled more coarsely.)
	const step = Math.max(STEP, Math.sqrt(((x1 - x0) * (z1 - z0)) / 20000));
	const spots = [];
	let open = null;
	for (let x = x0 + step / 2; x < x1; x += step) {
		for (let z = z0 + step / 2; z < z1; z += step) {
			if (!inside(x, z, room.points)) continue;
			const clear = edgeDistance(x, z, room.points);
			const s = { x, z, clear };
			if (!open || clear > open.clear) open = s;
			if (clear >= MIN_CLEAR) spots.push(s);
		}
	}
	spots.sort((a, b) => b.clear - a.clear);
	return spots.length ? spots : open ? [open] : [];
}

/**
 * The room's long direction, as a unit vector [x, z]: the main axis of the
 * points inside it (for an L-shaped room, the longer leg's way).
 */
export function longAxis(room, spots = roomSpots(room)) {
	const pts = spots.length > 2 ? spots : room.points.map(([x, z]) => ({ x, z }));
	let mx = 0, mz = 0;
	for (const p of pts) { mx += p.x; mz += p.z; }
	mx /= pts.length; mz /= pts.length;
	let sxx = 0, szz = 0, sxz = 0;
	for (const p of pts) { const dx = p.x - mx, dz = p.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
	const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz); // direction of greatest spread
	return [Math.cos(angle), Math.sin(angle)];
}

/** The heading (three.js yaw: forward is (-sin, -cos)) of a direction [x, z]. */
export const headingOf = ([dx, dz]) => Math.atan2(-dx, -dz);

/** Of the two ways along an axis, the heading closer to `heading`. */
export function alongAxis(axis, heading) {
	const a = headingOf(axis), b = headingOf([-axis[0], -axis[1]]);
	const diff = (h) => Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading)));
	return diff(a) <= diff(b) ? a : b;
}

/**
 * Inside a room: its clear middle. `isClear(x, z)` says whether a spot is
 * free of furniture (the caller casts rays); spots are tried best first. If
 * none is clear, the most open one. Returns { x, z, axis } or null.
 */
export function roomLanding(room, isClear = () => true) {
	const spots = roomSpots(room);
	if (!spots.length) return null;
	const axis = longAxis(room, spots);
	const n = Math.min(spots.length, MAX_TRIED);
	for (let i = 0; i < n; i++) if (isClear(spots[i].x, spots[i].z)) return { x: spots[i].x, z: spots[i].z, axis };
	return { x: spots[0].x, z: spots[0].z, axis };
}

/**
 * Outside: the pointed spot (model metres), moved straight away from any
 * wall closer than OUTDOOR_CLEAR (walls at the same floor height). Returns
 * [x, z].
 */
export function clearOfWalls(plan, x, y, z) {
	const walls = (plan?.walls ?? []).filter((w) => Math.abs(w.floorY - y) <= LEVEL_TOLERANCE);
	for (let round = 0; round < 4; round++) {
		let moved = false;
		for (const w of walls) {
			const [ax, az] = w.a, [bx, bz] = w.b;
			const want = OUTDOOR_CLEAR + w.thickness / 2;
			const d = segmentDistance(x, z, w.a, w.b);
			if (d >= want) continue;
			// Push along the wall's normal, away from its centre line.
			let nx = -(bz - az), nz = bx - ax;
			const len = Math.hypot(nx, nz) || 1;
			nx /= len; nz /= len;
			const side = (x - ax) * nx + (z - az) * nz;
			const s = side >= 0 ? 1 : -1;
			x += nx * s * (want - d + 1e-3);
			z += nz * s * (want - d + 1e-3);
			moved = true;
		}
		if (!moved) break;
	}
	return [x, z];
}
