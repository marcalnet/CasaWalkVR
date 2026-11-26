// Heavy pieces simplified for the Quest (heavy homes, step 3): a home counted over SIMPLIFY.above triangles before
// building (js/triangles.js) has its heavy models simplified, once per model,
// before the pieces are placed and merged, so the whole home lands near
// SIMPLIFY.target. meshoptimizer's careful mode (vendored with three.js: MIT,
// WebAssembly, no eval) collapses edges onto existing corners within a 1%
// error, so shapes hold; then:
//   - each material keeps its own part (simplified apart: never mixed);
//   - each piece keeps its outer size exactly (the laser meter must read the
//     file's 2.20 m, not 2.18 m): the corners are stretched back onto the
//     original box, a fraction of a millimetre;
//   - open edges (thin flat parts, a table's top) stay put (LockBorder);
//   - pieces under SIMPLIFY.pieceMin triangles, and walls, floors and rooms,
//     are never touched.
// No DOM: runs in Node tests and in the OBJ worker (js/obj-worker.js).

// (By relative path: the OBJ worker has no import map. The same files as the page's map gives.)
import * as THREE from '../vendor/three/three.module.js';
import { mergeVertices } from '../vendor/worker/BufferGeometryUtils.js';
import { MeshoptSimplifier } from '../vendor/three/addons/libs/meshopt_simplifier.module.js';

export const SIMPLIFY = {
	above: 1_500_000, // a home counted over this is simplified (in the headset: js/main.js)
	target: 1_000_000, // ... towards this (the Quest 2's draw budget, CONFIG.budget)
	pieceMin: 5_000, // a model under this many triangles is never touched
	floor: 0.02, // never below 2% of a model's triangles
	error: 0.01, // the largest move allowed, as a share of the piece's size (careful mode)
};

/**
 * The share of the heavy models' triangles to keep so the home lands near
 * `target`: models (ref -> { triangles, uses }) under pieceMin stay whole.
 * Returns 1 when nothing need change.
 */
export function keepRatio(total, models, { target = SIMPLIFY.target, pieceMin = SIMPLIFY.pieceMin, floor = SIMPLIFY.floor } = {}) {
	let heavy = 0;
	for (const { triangles, uses } of models.values()) if (triangles >= pieceMin) heavy += triangles * uses;
	if (total <= target || heavy === 0) return 1;
	const light = total - heavy;
	return Math.min(1, Math.max(floor, (target - light) / heavy));
}

/** Triangles drawn by an object's meshes. */
export function objectTriangles(object) {
	let n = 0;
	object.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
	return n;
}

/**
 * Simplifies every mesh of a loaded model in place, keeping `ratio` of its
 * triangles (at most: the 1% error bound may keep more). Returns { before, after }.
 */
export async function simplifyObject(object, ratio, { error = SIMPLIFY.error } = {}) {
	await MeshoptSimplifier.ready;
	let before = 0, after = 0;
	const meshes = [];
	object.traverse((o) => { if (o.isMesh && o.geometry?.attributes.position) meshes.push(o); });
	for (const mesh of meshes) {
		const geo = mesh.geometry, n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
		before += n;
		if (ratio >= 1 || n < 64) { after += n; continue; }
		const out = simplifyGeometry(geo, ratio, error);
		if (out !== geo) { geo.dispose(); mesh.geometry = out; }
		after += (out.index ? out.index.count : out.attributes.position.count) / 3;
	}
	return { before, after };
}

/** Resolves once the simplifier's WebAssembly is ready (simplifyGeometry needs it). */
export const simplifierReady = () => MeshoptSimplifier.ready;

/** A simplified copy of a geometry (or the geometry itself if it cannot be): per material group, outer box kept. After simplifierReady(). */
export function simplifyGeometry(geo, ratio, error = SIMPLIFY.error) {
	const box0 = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
	// Shared corners first (OBJLoader gives every triangle its own): seams of normals and UVs stay
	// separate corners, which meshoptimizer keeps as seams. A faceted model (every triangle its own
	// normal, as OBJLoader makes for an OBJ without normals) shares none that way: it is welded
	// without its normals, and gets flat ones back afterwards, faceted as it was.
	let welded = geo.index ? geo : mergeVertices(geo, 1e-6), faceted = false;
	if (!geo.index && geo.attributes.normal && welded.attributes.position.count > 0.6 * geo.attributes.position.count) {
		const bare = geo.clone();
		bare.deleteAttribute('normal');
		welded.dispose?.();
		welded = mergeVertices(bare, 1e-6);
		faceted = true;
	}
	const positions = welded.attributes.position.array instanceof Float32Array && welded.attributes.position.itemSize === 3 && !welded.attributes.position.isInterleavedBufferAttribute
		? welded.attributes.position.array : Float32Array.from({ length: welded.attributes.position.count * 3 }, (_, i) => welded.attributes.position.getComponent(Math.floor(i / 3), i % 3));
	const index = welded.index.array;
	const groups = geo.groups.length ? geo.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
	const parts = [], newGroups = [];
	let at = 0;
	for (const g of groups) {
		const start = g.start, count = Math.min(g.count, index.length - g.start);
		if (count <= 0) continue;
		const slice = new Uint32Array(index.subarray(start, start + count));
		const target = Math.max(3, Math.floor((count * ratio) / 3) * 3);
		let kept = slice;
		if (target < count) {
			try { [kept] = MeshoptSimplifier.simplify(slice, positions, 3, target, error, ["LockBorder"]); } catch (e) { console.warn('Simplify failed: kept whole', e); kept = slice; }
			if (!kept.length) kept = slice; // (never lose a material's part entirely)
		}
		parts.push(kept);
		newGroups.push({ start: at, count: kept.length, materialIndex: g.materialIndex ?? 0 });
		at += kept.length;
	}
	const all = new Uint32Array(at);
	let o = 0;
	for (const p of parts) { all.set(p, o); o += p.length; }
	const out = welded === geo ? geo.clone() : welded;
	out.setIndex(new THREE.BufferAttribute(all, 1));
	out.clearGroups();
	if (geo.groups.length) for (const g of newGroups) out.addGroup(g.start, g.count, g.materialIndex);
	keepBox(out, box0);
	if (faceted) {
		// (Flat normals again: each triangle its own corners, as OBJLoader made them.)
		const flat = out.toNonIndexed();
		out.dispose();
		flat.computeVertexNormals();
		flat.computeBoundingBox();
		flat.computeBoundingSphere();
		return flat;
	}
	out.computeBoundingBox();
	out.computeBoundingSphere();
	return out;
}

/** Stretches the corners still in use back onto the original box (the laser meter reads the file's sizes). */
function keepBox(geo, box0) {
	const pos = geo.attributes.position, idx = geo.index.array;
	const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity), v = new THREE.Vector3();
	const used = new Uint8Array(pos.count);
	for (let i = 0; i < idx.length; i++) used[idx[i]] = 1;
	for (let i = 0; i < pos.count; i++) if (used[i]) { v.fromBufferAttribute(pos, i); min.min(v); max.max(v); }
	if (!Number.isFinite(min.x)) return;
	const s = (a0, a1, b0, b1) => (b1 - b0 > 1e-9 ? (a1 - a0) / (b1 - b0) : 1);
	const sx = s(box0.min.x, box0.max.x, min.x, max.x), sy = s(box0.min.y, box0.max.y, min.y, max.y), sz = s(box0.min.z, box0.max.z, min.z, max.z);
	if (Math.abs(sx - 1) < 1e-7 && Math.abs(sy - 1) < 1e-7 && Math.abs(sz - 1) < 1e-7) return;
	for (let i = 0; i < pos.count; i++) {
		pos.setXYZ(i, box0.min.x + (pos.getX(i) - min.x) * sx, box0.min.y + (pos.getY(i) - min.y) * sy, box0.min.z + (pos.getZ(i) - min.z) * sz);
	}
	pos.needsUpdate = true;
}
