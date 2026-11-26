// OBJ reading shared by the page and the OBJ worker (heavy homes, step 5;
// js/obj-worker.js, behind ?worker): prepare the text, parse it with three.js's
// OBJLoader, simplify it if asked, and describe the result as plain data
// (typed arrays, names) that a worker can hand over without copying; the page
// rebuilds the meshes and their materials from it exactly as OBJLoader would
// (buildObj). No DOM, and three.js imported by relative path (a worker has no
// import map; the page's map gives the same file, so it is one three.js).

import * as THREE from '../vendor/three/three.module.js';
import { OBJLoader } from '../vendor/worker/OBJLoader.js';
import { usedMaterialNames } from './obj-defaults.js';
import { simplifyObject } from './simplify.js';

/**
 * Prepares OBJ text for three.js's OBJLoader:
 *
 * 1. Removes line ("l") and point ("p") records. A single stray "l" record
 *    makes OBJLoader turn a whole object into LineSegments; Sweet Home 3D
 *    ignores them, and we never draw lines anyway.
 * 2. Triangulates faces with 4+ corners properly. OBJLoader splits polygons
 *    into a fan from the first corner, which only works for convex shapes:
 *    on a U-shaped face (e.g. Sweet Home 3D's door frame) the fan fills in
 *    the doorway. Concave quads and all larger polygons go through earcut.
 *
 * Light on memory (heavy homes, step 2): one pass over
 * the text, line by line, without splitting it into an array of lines; the
 * vertices kept as numbers in one typed array (no object per vertex); and
 * the text returned untouched when nothing changes, else built once from
 * slices of it round the changed lines. (Before, a 364 MB OBJ became a list
 * of lines, an object per vertex and a second whole text: 2 GB at the peak.)
 */
export function prepareObjText(text) {
	if (text.includes('\r\n')) text = text.replace(/\r\n/g, '\n'); // (as OBJLoader would: the material names must match its own; one copy, Windows files only)
	let xyz = new Float64Array(3 * 4096), nv = 0;
	let vtCount = 0, vnCount = 0;
	const chunks = [];
	let kept = 0; // the text before this index is already in chunks
	const replace = (from, to, by) => { chunks.push(text.slice(kept, from)); if (by) chunks.push(by); kept = to; };
	const vert = (i) => { const k = i < 0 ? nv + i : i - 1; return k >= 0 && k < nv ? new THREE.Vector3(xyz[3 * k], xyz[3 * k + 1], xyz[3 * k + 2]) : null; };
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	const blank = (ch) => ch === 32 || ch === 9;
	const n = text.length;
	for (let start = 0; start < n;) {
		let end = text.indexOf('\n', start);
		if (end < 0) end = n;
		const lineEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end; // (before a CR)
		let i = start;
		while (i < lineEnd && blank(text.charCodeAt(i))) i++;
		const c0 = text.charCodeAt(i), c1 = text.charCodeAt(i + 1), c2 = text.charCodeAt(i + 2);
		if (c0 === 118 && blank(c1)) { // v
			const p = text.slice(i + 2, lineEnd).trim().split(/\s+/);
			if (3 * nv + 3 > xyz.length) { const grown = new Float64Array(xyz.length * 2); grown.set(xyz); xyz = grown; }
			xyz[3 * nv] = +p[0]; xyz[3 * nv + 1] = +p[1]; xyz[3 * nv + 2] = +p[2];
			nv++;
		} else if (c0 === 118 && c1 === 116 && blank(c2)) vtCount++; // vt
		else if (c0 === 118 && c1 === 110 && blank(c2)) vnCount++; // vn
		else if ((c0 === 108 || c0 === 112) && blank(c1)) replace(start, end + 1, null); // l, p: the whole line goes
		else if (c0 === 102 && blank(c1)) { // f
			let toks = text.slice(i + 2, lineEnd).split(/\s+/).filter(Boolean), done = false;
			if (toks.some((t) => t.includes('/'))) {
				const clean = cleanFaceRefs(toks, vtCount, vnCount);
				if (clean !== toks) { toks = clean; if (toks.length < 4) { replace(start, lineEnd, `f ${toks.join(' ')}`); done = true; } }
			}
			if (!done && toks.length >= 4) {
				const tris = triangulateFace(toks, vert, a, b, c);
				if (tris) replace(start, lineEnd, tris.map((tri) => `f ${tri.join(' ')}`).join('\n'));
			}
		}
		start = end + 1;
	}
	if (!chunks.length) return text;
	chunks.push(text.slice(kept));
	return chunks.join('');
}

/**
 * Face corners are "v", "v/vt", "v//vn" or "v/vt/vn". OBJLoader only checks
 * the first corner of each triangle for vt/vn, so a face that mixes corners
 * with and without them, or points at normals that don't exist, ends up with
 * NaN normals (black) once triangles start at a different corner. Keep a
 * texture/normal reference only if every corner has a valid one.
 * Returns the same array when nothing needs changing.
 */
function cleanFaceRefs(toks, vtCount, vnCount) {
	const parts = toks.map((tok) => tok.split('/'));
	const valid = (s, count) => {
		if (s === undefined || s === '') return false;
		const i = parseInt(s, 10);
		return Number.isFinite(i) && i !== 0 && (i > 0 ? i <= count : count + i >= 0);
	};
	const keepVt = parts.every((p) => valid(p[1], vtCount));
	const keepVn = parts.every((p) => valid(p[2], vnCount));
	const hasVt = parts.some((p) => p[1]), hasVn = parts.some((p) => p[2]);
	if ((keepVt || !hasVt) && (keepVn || !hasVn)) return toks;
	return parts.map((p) => p[0] + (keepVt ? `/${p[1]}` : keepVn ? '/' : '') + (keepVn ? `/${p[2]}` : ''));
}

/** Returns triangles (arrays of 3 face tokens) for an OBJ polygon, or null to keep it as is. vert(i): OBJ vertex i (1-based, or negative from the end) as a Vector3, or null. */
function triangulateFace(toks, vert, a, b, c) {
	const pts = toks.map((tok) => vert(parseInt(tok, 10)));
	if (pts.some((p) => !p)) return null;
	// Polygon normal (Newell's method)
	const n = new THREE.Vector3();
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i], q = pts[(i + 1) % pts.length];
		n.x += (p.y - q.y) * (p.z + q.z);
		n.y += (p.z - q.z) * (p.x + q.x);
		n.z += (p.x - q.x) * (p.y + q.y);
	}
	if (n.lengthSq() === 0) return null;
	const faces = (idx) => idx.map((tri) => {
		// Keep each triangle facing the same way as the polygon.
		const [i, j, k] = tri;
		a.subVectors(pts[j], pts[i]); b.subVectors(pts[k], pts[i]);
		return c.crossVectors(a, b).dot(n) < 0 ? [toks[i], toks[k], toks[j]] : [toks[i], toks[j], toks[k]];
	});
	if (pts.length === 4) {
		// Convex quad: the usual split works; otherwise split along the other diagonal.
		const ok = (i, j, k) => { a.subVectors(pts[j], pts[i]); b.subVectors(pts[k], pts[i]); return c.crossVectors(a, b).dot(n) > 0; };
		if (ok(0, 1, 2) && ok(0, 2, 3)) return null;
		return faces([[1, 2, 3], [1, 3, 0]]);
	}
	// Project on the plane most facing the normal, then earcut.
	const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
	const flat = pts.map((p) => (az >= ax && az >= ay ? new THREE.Vector2(p.x, p.y) : ax >= ay ? new THREE.Vector2(p.y, p.z) : new THREE.Vector2(p.z, p.x)));
	let idx;
	try { idx = THREE.ShapeUtils.triangulateShape(flat, []); } catch { return null; }
	if (!idx || idx.length < pts.length - 2) return null;
	return faces(idx);
}

/**
 * Reads OBJ bytes: { meshes (plain data: buildObj), mtllibs (material library
 * names), used (material names used), simplified ({ before, after } or null) }.
 */
export async function parseObjBytes(bytes, ratio = 1) {
	const text = prepareObjText(new TextDecoder().decode(bytes));
	const mtllibs = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
	const used = usedMaterialNames(text);
	const container = new OBJLoader().parse(text); // (no materials here: buildObj makes them)
	const simplified = ratio < 1 ? await simplifyObject(container, ratio) : null;
	const meshes = container.children.map((o) => {
		const g = o.geometry, attributes = {};
		for (const [name, a] of Object.entries(g.attributes)) attributes[name] = { array: a.array, itemSize: a.itemSize, normalized: a.normalized };
		const mats = [].concat(o.material);
		return {
			kind: o.isLineSegments ? 'lines' : o.isPoints ? 'points' : 'mesh', name: o.name, attributes,
			index: g.index ? g.index.array : null, groups: g.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })),
			materials: mats.map((m) => ({ name: m.name, smooth: !m.flatShading, vertexColors: !!m.vertexColors })), many: Array.isArray(o.material),
		};
	});
	return { meshes, mtllibs, used, simplified };
}

/** The arrays a worker hands over (transferred, not copied). */
export function transferables(parsed) {
	const out = new Set();
	for (const m of parsed.meshes) {
		for (const a of Object.values(m.attributes)) out.add(a.array.buffer);
		if (m.index) out.add(m.index.buffer);
	}
	return [...out];
}

/**
 * The model from parseObjBytes's data, its materials made as OBJLoader makes
 * them: from the material creator (an MTLLoader's, or null) by name, else a
 * Phong material of that name (flat unless the OBJ smooths it, vertex colours
 * if it has them), one per name, smoothing and colouring.
 */
export function buildObj(parsed, creator = null) {
	const container = new THREE.Group();
	const made = new Map();
	for (const m of parsed.meshes) {
		const geometry = new THREE.BufferGeometry();
		for (const [name, a] of Object.entries(m.attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
		if (m.index) geometry.setIndex(new THREE.BufferAttribute(m.index, 1));
		for (const g of m.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
		const materials = m.materials.map((spec) => {
			let material = creator ? creator.create(spec.name) : undefined;
			if (material && m.kind === 'points' && !material.isPointsMaterial) {
				const p = new THREE.PointsMaterial({ size: 10, sizeAttenuation: false });
				THREE.Material.prototype.copy.call(p, material);
				p.color.copy(material.color); p.map = material.map;
				material = p;
			} else if (material && m.kind === 'lines' && !material.isLineBasicMaterial) {
				const l = new THREE.LineBasicMaterial();
				THREE.Material.prototype.copy.call(l, material);
				l.color.copy(material.color);
				material = l;
			}
			if (material === undefined) {
				const key = `${m.kind}|${spec.name}_${spec.smooth}_${spec.vertexColors}`;
				material = made.get(key);
				if (!material) {
					material = m.kind === 'lines' ? new THREE.LineBasicMaterial() : m.kind === 'points' ? new THREE.PointsMaterial({ size: 1, sizeAttenuation: false }) : new THREE.MeshPhongMaterial();
					material.name = spec.name;
					material.flatShading = !spec.smooth;
					material.vertexColors = spec.vertexColors;
					made.set(key, material);
				}
			}
			return material;
		});
		const Kind = m.kind === 'lines' ? THREE.LineSegments : m.kind === 'points' ? THREE.Points : THREE.Mesh;
		const mesh = new Kind(geometry, m.many ? materials : materials[0]);
		mesh.name = m.name;
		container.add(mesh);
	}
	container.userData.simplified = parsed.simplified;
	return container;
}
