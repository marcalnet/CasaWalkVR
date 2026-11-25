// Times mesh simplification on dense meshes, for the heavy-models
// investigation: meshoptimizer's simplifier (MIT; the
// copy that ships with three.js, WebAssembly, no eval) in its careful mode
// (simplify: edge collapses that keep the shape and the borders) and its
// fast mode (simplifySloppy: merges nearby vertices on a grid, ignoring the
// mesh's structure), and three.js's SimplifyModifier, which since three.js
// r16x is a thin wrapper round the same simplifier. Dev tool: it reads the
// simplifier from node_modules/three (npm install), not from vendor/.
//   node --import ./tests/register.js scripts/bench-simplify.js
// The error is meshoptimizer's own measure: the largest distance moved, as a
// share of the mesh's size (0.01 = 1% of its width).

import * as THREE from 'three';
import { MeshoptSimplifier } from '../node_modules/three/examples/jsm/libs/meshopt_simplifier.module.js';
import { SimplifyModifier } from '../node_modules/three/examples/jsm/modifiers/SimplifyModifier.js';

await MeshoptSimplifier.ready;

/** A dense rippled sphere as an indexed mesh of 2 * lat * lon triangles (like the stress models' 3D Warehouse pieces). */
function blob(lat, lon) {
	const pos = new Float32Array((lat + 1) * lon * 3);
	let k = 0;
	for (let i = 0; i <= lat; i++) {
		const t = (i / lat) * Math.PI;
		for (let j = 0; j < lon; j++) {
			const p = (j / lon) * 2 * Math.PI, r = 0.4 * (1 + 0.06 * Math.sin(5 * p) * Math.sin(3 * t) + 0.02 * Math.sin(17 * p) * Math.sin(11 * t));
			pos[k++] = r * Math.sin(t) * Math.cos(p); pos[k++] = r * Math.cos(t); pos[k++] = r * Math.sin(t) * Math.sin(p);
		}
	}
	const idx = new Uint32Array(lat * lon * 6);
	k = 0;
	for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
		const a = i * lon + j, b = i * lon + (j + 1) % lon, c = (i + 1) * lon + (j + 1) % lon, d = (i + 1) * lon + j;
		idx[k++] = a; idx[k++] = d; idx[k++] = c; idx[k++] = a; idx[k++] = c; idx[k++] = b;
	}
	return { pos, idx };
}

const rows = [];
for (const [lat, lon] of [[354, 354], [707, 707], [1000, 1000]]) {
	const { pos, idx } = blob(lat, lon);
	const tris = idx.length / 3;
	for (const keep of [0.1, 0.02]) {
		const target = Math.floor(idx.length * keep / 3) * 3;
		let t = performance.now();
		const [a, ea] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.05, []);
		const careful = { ms: Math.round(performance.now() - t), tris: a.length / 3, error: +ea.toFixed(4) };
		t = performance.now();
		const [b, eb] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, target, 0.05);
		const sloppy = { ms: Math.round(performance.now() - t), tris: b.length / 3, error: +eb.toFixed(4) };
		rows.push({ triangles: tris, keep, careful, sloppy });
	}
	// three.js's SimplifyModifier (the same simplifier, plus copying attributes), to 10%.
	if (tris <= 2e6) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		g.setIndex(new THREE.BufferAttribute(idx, 1));
		const t = performance.now();
		const out = await new SimplifyModifier().modify(g, Math.floor(pos.length / 3 * 0.9));
		rows.push({ triangles: tris, modifier: { ms: Math.round(performance.now() - t), tris: out.index.count / 3 } });
	}
}
for (const r of rows) console.log(JSON.stringify(r));
