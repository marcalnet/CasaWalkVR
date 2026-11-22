// Depth shading for the headset (SPEC.md, "Performance"): soft dark gradients
// in corners and where things meet (ambient occlusion), plus a slight
// difference in brightness between faces that point different ways, so
// white walls no longer melt into each other while you walk around.
//
// Nothing here costs anything per frame beyond one multiply in the shader:
//
// - The corner gradients are worked out once per model ("baked") with short
//   rays against the model, and stored as one byte per vertex. Walls, floors
//   and ceilings are first cut along a regular 30 cm grid, so there are
//   vertices near every corner to carry an even gradient.
// - No post-processing pass, so nothing can flicker (see CLAUDE.md).
//
// The bake is spread over many frames (tick()), so the page and the headset
// stay responsive while it runs.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

const ATTR = 'cwAo'; // per-vertex light factor, 0-255 (255 = fully open)
const GRID = 0.3; // metres: walls, floors and ceilings are cut along a grid this fine
const REACH = 0.6; // metres: how far a corner's shade reaches
const FLOOR = 0.4; // never darker than this
const RAYS = 32; // rays per vertex: enough for clean, even gradients
const STRENGTH = 0.9; // how dark a fully enclosed vertex would get (1 = black)
// Only walls, floors and ceilings carry the baked shade. Furniture still
// darkens the walls and floors it touches (it blocks their rays), and its own
// faces are told apart by the side-light term in the shader. Baking every
// furniture vertex as well was tried: it tripled the preparation time for a
// barely visible gain.
const BAKED_LAYERS = ['walls', 'floors', 'ceilings'];
const BLOCKING_LAYERS = ['main', 'ground'];
const MAX_CUTS = 400; // per triangle and axis (a guard against absurdly large faces)

/**
 * Ray directions around +Z, denser near the surface normal (cosine-weighted),
 * on a golden-angle spiral so they are evenly spread.
 */
function directions(count) {
	return Array.from({ length: count }, (_, k) => {
		const u = (k + 0.5) / count, r = Math.sqrt(u), phi = k * 2.399963229728653;
		return new THREE.Vector3(r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u));
	});
}

/** Adds the per-vertex factor to a geometry if it has none (all "open"). */
function ensureAttribute(geometry) {
	if (geometry.attributes[ATTR]) return;
	const n = geometry.attributes.position.count;
	geometry.setAttribute(ATTR, new THREE.BufferAttribute(new Uint8Array(n).fill(255), 1, true));
}

/**
 * Cuts a geometry along the planes x, y, z = k * grid (model space), so
 * every large face gets a regular lattice of vertices: the gradient near a
 * corner then has the same width all along it. Neighbouring triangles are
 * cut at the same points, so no gaps open. Returns the same geometry when
 * nothing needed cutting, otherwise a new indexed one.
 */
export function sliceByGrid(geometry, grid = GRID) {
	const src = geometry.index ? geometry.toNonIndexed() : geometry;
	const names = Object.keys(src.attributes).filter((n) => n !== ATTR);
	const attrs = names.map((n) => src.attributes[n]);
	const S = attrs.reduce((n, a) => n + a.itemSize, 0);
	const offsetOf = (name) => (names.indexOf(name) < 0 ? -1 : attrs.slice(0, names.indexOf(name)).reduce((n, a) => n + a.itemSize, 0));
	const posAt = offsetOf('position'), normalAt = offsetOf('normal');
	const count = src.attributes.position.count;
	const EPS = 1e-5;

	const record = (i) => {
		const r = new Array(S);
		let o = 0;
		for (const a of attrs) for (let c = 0; c < a.itemSize; c++) r[o++] = a.getComponent(i, c);
		return r;
	};
	/** The point where edge a-b crosses the plane (coordinate `k` = `c`). */
	const cross = (a, b, k, c) => {
		const t = (c - a[k]) / (b[k] - a[k]);
		const m = a.map((v, i) => v + (b[i] - v) * t);
		m[k] = c;
		if (normalAt >= 0) {
			const l = Math.hypot(m[normalAt], m[normalAt + 1], m[normalAt + 2]) || 1;
			m[normalAt] /= l; m[normalAt + 1] /= l; m[normalAt + 2] /= l;
		}
		return m;
	};
	/**
	 * Splits a convex polygon (a list of vertices, in order) by one plane into
	 * the part below and the part above; either may be empty.
	 */
	const splitPolygon = (poly, k, c) => {
		const below = [], above = [];
		const d = poly.map((v) => (Math.abs(v[k] - c) < EPS ? 0 : v[k] - c));
		for (let i = 0; i < poly.length; i++) {
			const j = (i + 1) % poly.length;
			if (d[i] <= 0) below.push(poly[i]);
			if (d[i] >= 0) above.push(poly[i]);
			if (d[i] * d[j] < 0) { const m = cross(poly[i], poly[j], k, c); below.push(m); above.push(m); }
		}
		return [below.length >= 3 ? below : null, above.length >= 3 ? above : null];
	};

	const out = [];
	let cut = false;
	for (let t = 0; t + 2 < count; t += 3) {
		const source = [record(t), record(t + 1), record(t + 2)];
		// Cut into strips along x, each strip into cells along y, then z: the
		// pieces stay convex, and each is drawn as a fan of triangles.
		let pieces = [source];
		for (let axis = 0; axis < 3; axis++) {
			const k = posAt + axis;
			const lo = Math.min(...source.map((v) => v[k])), hi = Math.max(...source.map((v) => v[k]));
			const first = Math.ceil((lo + EPS) / grid), last = Math.floor((hi - EPS) / grid);
			if (!(last >= first) || last - first > MAX_CUTS) continue;
			const next = [];
			for (let rest of pieces) {
				for (let q = first; q <= last && rest; q++) {
					const [below, above] = splitPolygon(rest, k, q * grid);
					if (below && above) next.push(below);
					rest = above || below;
					if (!above) break; // this piece ends before the next plane
				}
				if (rest) next.push(rest);
			}
			pieces = next;
		}
		if (pieces.length > 1) cut = true;
		for (const poly of pieces) {
			for (let i = 1; i + 1 < poly.length; i++) {
				for (const v of [poly[0], poly[i], poly[i + 1]]) for (let c = 0; c < S; c++) out.push(v[c]);
			}
		}
	}
	if (src !== geometry && !cut) src.dispose();
	if (!cut) return geometry;

	const g = new THREE.BufferGeometry();
	const n = out.length / S;
	let o = 0;
	for (const [k, a] of attrs.entries()) {
		const arr = new Float32Array(n * a.itemSize);
		for (let i = 0; i < n; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = out[i * S + o + c];
		g.setAttribute(names[k], new THREE.BufferAttribute(arr, a.itemSize));
		o += a.itemSize;
	}
	if (src !== geometry) src.dispose();
	const merged = mergeVertices(g);
	g.dispose();
	merged.computeBoundingBox();
	merged.computeBoundingSphere();
	return merged;
}

/** One ray-tracing structure holding every triangle that blocks light. */
function buildOccluder(meshes) {
	let total = 0;
	for (const m of meshes) total += m.geometry.index.count;
	const positions = new Float32Array(total * 3);
	let o = 0;
	for (const m of meshes) {
		const pos = m.geometry.attributes.position, idx = m.geometry.index;
		for (let i = 0; i < idx.count; i++) {
			const v = idx.getX(i);
			positions[o++] = pos.getX(v); positions[o++] = pos.getY(v); positions[o++] = pos.getZ(v);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	return { geometry: g, bvh: new MeshBVH(g) };
}

export class DepthShading {
	constructor() {
		this.uniform = { value: 0 }; // shared by every model material: 0 = off, 1 = on
		this.enabled = false; // the user's switch
		this.active = false; // true while in the headset (the effect is for VR only)
		this.state = 'idle'; // 'idle' | 'baking' | 'ready'
		this.progress = 0; // 0-1 while baking
		this.layers = null;
		this.job = null;
		this.onChange = null; // called when state or progress changes
	}

	/** A newly loaded model: hook its materials, and bake if the switch is on. */
	setModel(layers) {
		this.layers = layers;
		this.job = null;
		this.state = 'idle';
		this.progress = 0;
		if (layers) {
			for (const layer of Object.values(layers)) {
				for (const mesh of layer.children) {
					ensureAttribute(mesh.geometry);
					for (const m of [].concat(mesh.material)) this.hook(m);
				}
			}
		}
		this.start();
		this.onChange?.();
	}

	setEnabled(on) {
		this.enabled = !!on;
		this.apply();
		this.start();
		this.onChange?.();
	}

	/** Called when a headset session starts and ends. */
	setActive(active) {
		this.active = !!active;
		this.apply();
	}

	apply() { this.uniform.value = this.enabled && this.active ? 1 : 0; }

	/** Short text for menus: off, a percentage while preparing, on. */
	label() {
		if (!this.enabled) return 'off';
		return this.state === 'baking' ? `${Math.round(this.progress * 100)}%` : 'on';
	}

	/**
	 * Adds the factor to a Lambert/Phong shader: the light leaving the surface
	 * is multiplied by the baked corner value and by a gentle side-light term
	 * (so walls facing different ways differ slightly). One uniform switches
	 * it, so turning it on and off never recompiles anything.
	 */
	hook(material) {
		if (material.userData.cwDepth) return;
		material.userData.cwDepth = true;
		const uniform = this.uniform;
		material.onBeforeCompile = (shader) => {
			shader.uniforms.cwDepth = uniform;
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>\nattribute float ${ATTR};\nvarying float vCwAo;\nvarying vec3 vCwNormal;`)
				.replace('#include <begin_vertex>', `#include <begin_vertex>\nvCwAo = ${ATTR};\nvCwNormal = normal;`);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nuniform float cwDepth;\nvarying float vCwAo;\nvarying vec3 vCwNormal;')
				.replace('#include <opaque_fragment>', [
					'float cwSide = 0.5 + 0.5 * dot(normalize(vCwNormal), vec3(0.545, 0.25, 0.8));',
					'outgoingLight *= mix(1.0, vCwAo * mix(0.8, 1.0, cwSide), cwDepth);',
					'#include <opaque_fragment>',
				].join('\n'));
		};
		material.customProgramCacheKey = () => 'cw-depth';
		material.needsUpdate = true;
	}

	/** Starts the bake if it is wanted and not done yet. */
	start() {
		if (!this.enabled || !this.layers || this.state !== 'idle') return;
		this.state = 'baking';
		this.progress = 0;
		this.job = this.steps(this.layers);
	}

	/** Advances the bake for up to `budgetMs`; call every frame. Returns true while there is work left. */
	tick(budgetMs) {
		if (!this.job) return false;
		const job = this.job, end = performance.now() + budgetMs;
		let last = Math.floor(this.progress * 100);
		do {
			if (job.next().done) {
				if (this.job === job) { this.job = null; this.state = 'ready'; this.progress = 1; this.onChange?.(); }
				return false;
			}
			if (this.job !== job) return !!this.job; // another model arrived meanwhile
		} while (performance.now() < end);
		if (Math.floor(this.progress * 100) !== last) this.onChange?.();
		return true;
	}

	/** The bake, as small steps (a generator, so tick() can pause it anywhere). */
	*steps(layers) {
		const of = (names) => names.flatMap((name) => (layers[name]?.children ?? []).map((mesh) => ({ mesh, name })));
		const baked = of(BAKED_LAYERS);
		// 1. Cut walls, floors and ceilings along a regular grid (5% of the progress bar).
		for (const [i, { mesh, name }] of baked.entries()) {
			const old = mesh.geometry;
			const cut = sliceByGrid(old);
			if (cut !== old) {
				ensureAttribute(cut);
				if (name !== 'ceilings') cut.computeBoundsTree(); // (ceilings are never raycast)
				mesh.geometry = cut;
				old.disposeBoundsTree?.();
				old.dispose();
			}
			this.progress = 0.05 * (i + 1) / baked.length;
			yield;
		}
		// 2. Everything that blocks light: the whole model except glass.
		// (The model's own opacity: see-through in the headset (js/walls.js) is not glass.)
		const solid = (mesh) => ![].concat(mesh.material).some((m) => { const b = m.userData.cwBase ?? m; return b.transparent && b.opacity < 0.9; });
		const blockers = [...baked, ...of(BLOCKING_LAYERS)].map((m) => m.mesh).filter(solid);
		const total = baked.reduce((n, m) => n + m.mesh.geometry.attributes.position.count, 0);
		if (!blockers.length || !total) return;
		const occluder = buildOccluder(blockers);
		yield;
		// 3. Short rays from every vertex: the more of them are blocked nearby, the darker it gets.
		const dirs = directions(RAYS);
		const ray = new THREE.Ray();
		const p = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3();
		let done = 0;
		for (const { mesh } of baked) {
			const g = mesh.geometry, pos = g.attributes.position, nrm = g.attributes.normal, ao = g.attributes[ATTR];
			for (let i = 0; i < pos.count; i++) {
				n.fromBufferAttribute(nrm, i);
				if (n.lengthSq() > 0.25) {
					p.fromBufferAttribute(pos, i);
					// Any two directions square to the normal.
					t.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
					b.crossVectors(n, t);
					ray.origin.copy(p).addScaledVector(n, 0.01);
					let blocked = 0;
					for (const d of dirs) {
						ray.direction.set(t.x * d.x + b.x * d.y + n.x * d.z, t.y * d.x + b.y * d.y + n.y * d.z, t.z * d.x + b.z * d.y + n.z * d.z);
						const hit = occluder.bvh.raycastFirst(ray, THREE.DoubleSide, 0, REACH);
						if (hit) blocked += 1 - hit.distance / REACH;
					}
					ao.setX(i, Math.max(FLOOR, 1 - STRENGTH * blocked / RAYS)); // (stored as a byte; setX converts)
				}
				if ((++done & 15) === 0) { this.progress = 0.05 + 0.95 * done / total; yield; }
			}
			ao.needsUpdate = true; // this mesh shows its corners from now on
		}
		occluder.geometry.dispose();
	}
}
