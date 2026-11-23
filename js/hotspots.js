// Teleport hotspots (SPEC.md, C0.4, "Hotspots"): spots the teleport ring
// snaps to, so you land well: each room's clear middle (js/rooms.js) and both
// sides of each doorway, 40 cm from the door. Hotspots help, they never
// forbid: pointing elsewhere still lands where you point. Pure (model metres
// in the plan's frame: x, z = plan x, y), so it runs in Node tests. OBJ and
// GLB files have no plan: no hotspots.

import { roomLanding, roomAt } from './rooms.js';

export const HOTSPOT = {
	DOOR_GAP: 0.4, // a doorway's hotspots: this far from the door, on each side
	SNAP: 0.5, // the ring snaps to a hotspot within this distance of where you point
	REACH: 4, // ... if the hotspot is within this distance of you
	SHOW: 6, // hotspots within this distance show as faint discs while aiming
	LEVEL: 0.3, // a hotspot is on your floor if within this height of where you point
};

/**
 * Every hotspot of a plan: [{ x, y (floor height), z, kind: 'room' | 'door', name }].
 * isClear(x, y, z): whether a spot is free of furniture (the caller casts
 * rays; default: always).
 */
export function hotspots(plan, isClear = () => true) {
	const out = [];
	for (const room of plan?.rooms ?? []) {
		if (!room.name) continue; // (unnamed rooms are floors or ceilings drawn as rooms: not places)
		const l = room.landing ?? roomLanding(room, (x, z) => isClear(x, room.floorY, z));
		if (l) out.push({ x: l.x, y: room.floorY, z: l.z, kind: 'room', name: room.name });
	}
	for (const d of plan?.doors ?? []) {
		// The door's normal in the plan: its depth axis (the piece's local y, turned by its angle).
		const nx = -Math.sin(d.angle), nz = Math.cos(d.angle), k = d.depth / 2 + HOTSPOT.DOOR_GAP;
		for (const s of [1, -1]) {
			const x = d.x + nx * k * s, z = d.z + nz * k * s;
			const room = roomAt(plan, x, d.floorY, z);
			if (isClear(x, d.floorY, z)) out.push({ x, y: d.floorY, z, kind: 'door', name: room?.name ?? '' });
		}
	}
	return out;
}

/**
 * The hotspot the ring snaps to, or null: the nearest one within SNAP of the
 * pointed floor point p ({ x, y, z }), on its floor, and within REACH of you
 * (from { x, z }).
 */
export function snapTo(spots, p, from) {
	let best = null, bestD = HOTSPOT.SNAP;
	for (const s of spots) {
		if (Math.abs(s.y - p.y) > HOTSPOT.LEVEL) continue;
		if (Math.hypot(s.x - from.x, s.z - from.z) > HOTSPOT.REACH) continue;
		const d = Math.hypot(s.x - p.x, s.z - p.z);
		if (d < bestD) { best = s; bestD = d; }
	}
	return best;
}
