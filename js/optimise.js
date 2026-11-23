// Performance pass run once after loading (Quest 2 is a phone GPU):
//
// 1. Bake every mesh's world transform into its vertices and merge all
//    geometry that shares an equivalent material into one mesh
//    (BufferGeometryUtils.mergeGeometries). Materials are deduplicated by
//    type, colour, texture, opacity and side. A home with thousands of
//    pieces ends up with one draw call per distinct material (and per
//    storey, so upper storeys can be hidden in the dollhouse).
// 1b. Share identical vertices (same position, normal and uv) through an
//    index: typically 25-60% fewer vertices for the GPU to transform and
//    less memory, for a fraction of a second at load time.
// 2. Build a three-mesh-bvh bounds tree on each merged mesh, so every
//    raycast (laser pointer, floor marker, teleport, floor following) is fast.
//
// Layers are kept apart so they can be shown, hidden or raycast separately:
//   main     walls and furniture
//   floors   room floors (where the "stand here" marker lands)
//   ceilings room ceilings (toggle in VR)
//   ground   the ground plane around the home

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const LAYERS = ['main', 'walls', 'floors', 'ceilings', 'ground'];

/** The storey (0 = lowest) an object belongs to: set by the SH3D builder on the object or an ancestor. */
function storeyOf(obj) {
	for (let o = obj; o; o = o.parent) if (o.userData?.storey !== undefined) return o.userData.storey;
	return 0;
}

/**
 * True for a door or window (Sweet Home 3D's doorOrWindow pieces), set by the
 * SH3D builder on the piece's wrapper. Merged meshes carry it as
 * userData.opening, so the teleport arc can pass through doorways even where
 * furniture stops it (homes with several levels).
 */
export function isOpening(obj) {
	for (let o = obj; o; o = o.parent) {
		if (o.userData?.opening) return true;
		if (o.userData?.piece) return o.userData.piece.kind === 'door';
	}
	return false;
}

/**
 * Pieces named for water (a pond, a pool) are never stood on or landed on,
 * even in a home with several levels where other furniture can be (stairs).
 * A few languages, whole words (German: the start of one), case-insensitive.
 */
// (Not things named after water: a water heater, a pool table: the tester's finding.)
export const WATER_NAME = /\b(water|pond|pool|agua|eau|acqua|piscina|estany|bassa)\b(?![\s-]*(heater|tank|table|cooler|closet|bottle|jug|can|dispenser|softener|filter|pump|pipe|glass|cue))|\bwasser(?!(kocher|hahn|flasche|filter|boiler|tank))/i; // (German joins words: Wasserfläche)

/** True for a water piece (by its Sweet Home 3D name). Merged meshes carry it as userData.water. */
export function isWater(obj) {
	for (let o = obj; o; o = o.parent) {
		if (o.userData?.water) return true;
		if (o.userData?.piece) return WATER_NAME.test(o.userData.piece.name ?? '');
	}
	return false;
}

/**
 * Glass is never stood on or landed on either (the user's decision, with the
 * Pond House stair's glass balustrade): pieces named for glass, in a few
 * languages (German and Dutch: the start of a word), and any transparent
 * material on furniture (opacity below 1; doors and windows are openings).
 * It blocks no more than before: it is furniture, met only where furniture is.
 */
export const GLASS_NAME = /\b(glass|glazing|glazed|vidrio|verre|vetro|vidre)\b|\bglas/i; // (German joins words: Glasscheibe)

/** A glass material: see-through as loaded (the model's own opacity, before any headset setting). */
export function isGlassMaterial(m) {
	return !!m && m.opacity < 1;
}

/** True for a glass piece (by its Sweet Home 3D name). Merged meshes carry it as userData.glass. */
export function isGlass(obj) {
	for (let o = obj; o; o = o.parent) {
		if (o.userData?.glass) return true;
		if (o.userData?.piece) return GLASS_NAME.test(o.userData.piece.name ?? '');
	}
	return false;
}

/** Which layer an object of the loaded scene belongs to, from its top-level group name. */
function layerOf(obj, root) {
	let o = obj;
	while (o.parent && o.parent !== root) o = o.parent;
	switch (o.name) {
		case 'floors': return 'floors';
		case 'ceilings': return 'ceilings';
		case 'ground': return 'ground';
		case 'walls': return 'walls';
		default: return 'main';
	}
}

function materialKey(m) {
	const c = m.color ? m.color.getHexString() : '';
	const e = m.emissive ? m.emissive.getHexString() : '';
	return [m.type, c, e, m.map ? m.map.uuid : '', m.opacity.toFixed(3), m.transparent, m.side, m.vertexColors, m.alphaTest,
		m.shininess ?? '', m.specular ? m.specular.getHexString() : ''].join('|');
}

/**
 * A copy of one draw range of a non-indexed geometry, with position, normal,
 * uv (and color if wanted) only. `base` must be non-indexed.
 */
function extract(base, start, count, wantColor) {
	const total = base.attributes.position.count;
	const from = Math.max(0, start), to = Math.min(total, start + count);
	const g = new THREE.BufferGeometry();
	for (const name of ['position', 'normal', 'uv', ...(wantColor ? ['color'] : [])]) {
		const attr = base.attributes[name];
		if (!attr) continue;
		const s = attr.itemSize;
		const src = attr.isInterleavedBufferAttribute ? null : attr.array;
		const arr = src && src instanceof Float32Array && !attr.normalized
			? src.slice(from * s, to * s)
			: Float32Array.from({ length: (to - from) * s }, (_, i) => attr.getComponent(from + Math.floor(i / s), i % s));
		g.setAttribute(name, new THREE.BufferAttribute(arr, s));
	}
	if (!g.attributes.normal) g.computeVertexNormals();
	const n = g.attributes.position.count;
	if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
	if (wantColor && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
	return g;
}

/** Reverses triangle winding (needed after baking a mirrored transform). */
function flipWinding(g) {
	for (const attr of Object.values(g.attributes)) {
		const a = attr.array, s = attr.itemSize;
		for (let t = 0; t < attr.count; t += 3) {
			for (let k = 0; k < s; k++) {
				const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k;
				const tmp = a[i1]; a[i1] = a[i2]; a[i2] = tmp;
			}
		}
	}
}

/**
 * Merges the loaded scene. `root` is the object returned by the loaders
 * (in metres). Returns { group, layers: { main (furniture, or a whole OBJ/GLB), walls, floors, ceilings, ground },
 * stats: { drawCalls, triangles, materials, sourceMeshes } }.
 */
export function optimiseModel(root) {
	root.updateMatrixWorld(true);
	const buckets = new Map(); // `${layer}#${materialKey}` -> { layer, material, geoms: [] }
	let sourceMeshes = 0;

	root.traverseVisible((o) => {
		if (!o.isMesh || !o.geometry?.attributes?.position) return;
		sourceMeshes++;
		const layer = layerOf(o, root);
		const storey = storeyOf(o);
		const opening = layer === 'main' && isOpening(o); // doors and windows merge on their own
		const water = layer === 'main' && !opening && isWater(o); // and so does water
		const glassPiece = layer === 'main' && !opening && !water && isGlass(o); // and glass (also by material, below)
		const m = o.matrixWorld;
		const mirrored = m.determinant() < 0;
		const g0 = o.geometry;
		const base = g0.index ? g0.toNonIndexed() : g0; // once per mesh
		const total = base.attributes.position.count;
		const parts = Array.isArray(o.material)
			? (g0.groups.length ? g0.groups.map((gr) => ({ start: gr.start, count: gr.count, material: o.material[gr.materialIndex] })) : [{ start: 0, count: total, material: o.material[0] }])
			: [{ start: 0, count: total, material: o.material }];
		for (const part of parts) {
			if (!part.material || part.material.visible === false || part.count < 3) continue;
			// Group ranges index the original (possibly indexed) geometry; after
			// toNonIndexed() vertex i corresponds to index position i, so the
			// same start/count still applies.
			const g = extract(base, part.start, part.count, !!part.material.vertexColors);
			g.applyMatrix4(m);
			if (mirrored) flipWinding(g);
			const glass = glassPiece || (layer === 'main' && !opening && !water && isGlassMaterial(part.material));
			const key = `${layer}#${storey}#${opening ? 'opening' : water ? 'water' : glass ? 'glass' : ''}#${materialKey(part.material)}`;
			let b = buckets.get(key);
			if (!b) { b = { layer, storey, opening, water, glass, material: part.material, geoms: [] }; buckets.set(key, b); }
			b.geoms.push(g);
		}
	});

	const group = new THREE.Group();
	group.name = root.name || 'model';
	const layers = {};
	for (const name of LAYERS) {
		layers[name] = new THREE.Group();
		layers[name].name = name;
		group.add(layers[name]);
	}
	let triangles = 0, drawCalls = 0;
	for (const b of buckets.values()) {
		const joined = b.geoms.length === 1 ? b.geoms[0] : mergeGeometries(b.geoms, false);
		if (!joined) continue;
		const merged = mergeVertices(joined);
		merged.computeBoundingBox();
		merged.computeBoundingSphere();
		if (b.layer !== 'ceilings') merged.computeBoundsTree(); // ceilings are never raycast
		const mesh = new THREE.Mesh(merged, b.material);
		mesh.matrixAutoUpdate = false;
		mesh.userData.storey = b.storey;
		if (b.opening) mesh.userData.opening = true;
		if (b.water) mesh.userData.water = true;
		if (b.glass) mesh.userData.glass = true;
		layers[b.layer].add(mesh);
		triangles += merged.index.count / 3;
		drawCalls++;
	}
	return { group, layers, stats: { drawCalls, triangles: Math.round(triangles), materials: buckets.size, sourceMeshes } };
}
