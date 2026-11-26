// Heavy pieces simplified for the Quest (js/simplify.js; heavy homes, step 3):
// the home lands near its target, each material keeps its part, each piece
// keeps its outer size exactly, light models stay whole, and the page is told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SIMPLIFY, keepRatio, simplifyGeometry, simplifyObject, objectTriangles, simplifierReady } from '../js/simplify.js';
import { openFiles } from '../js/formats.js';

/** A dense, unshared sphere in two materials (top and bottom halves), as OBJLoader gives a scanned piece. */
function denseSphere(segments = 160) {
	const g = new THREE.SphereGeometry(0.4, segments, segments / 2).toNonIndexed();
	g.translate(0.3, 0.4, -0.1);
	const n = g.attributes.position.count, half = Math.floor(n / 6) * 3;
	g.addGroup(0, half, 0);
	g.addGroup(half, n - half, 1);
	return g;
}

test('how much of the heavy models to keep: the home lands near the target; light models stay whole', () => {
	const models = new Map([['sofa', { triangles: 400_000, uses: 2 }], ['plant', { triangles: 600_000, uses: 1 }], ['chair', { triangles: 2_000, uses: 50 }]]);
	const total = 400_000 * 2 + 600_000 + 2_000 * 50;
	const r = keepRatio(total, models);
	assert.ok(Math.abs(100_000 + r * 1_400_000 - SIMPLIFY.target) < 1, `ratio ${r}`);
	assert.equal(keepRatio(900_000, models), 1, 'under the target: nothing');
	assert.equal(keepRatio(1e9, models), SIMPLIFY.floor, 'never below the floor');
});

test('a dense piece: about the share asked, each material its own part, the outer box exactly the same', async () => {
	await simplifierReady();
	const g = denseSphere(), n0 = g.attributes.position.count / 3;
	const box0 = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
	const out = simplifyGeometry(g, 0.1);
	const n1 = out.index.count / 3;
	assert.ok(n1 < n0 * 0.2 && n1 > n0 * 0.05, `${n0} -> ${n1} triangles`);
	assert.equal(out.groups.length, 2, 'two materials, two parts');
	assert.ok(out.groups.every((gr) => gr.count > 0) && out.groups[1].start === out.groups[0].count, 'each part kept, in order');
	const used = new THREE.Box3(), v = new THREE.Vector3();
	for (const i of out.index.array) used.expandByPoint(v.fromBufferAttribute(out.attributes.position, i));
	for (const k of ['min', 'max']) for (const a of ['x', 'y', 'z']) assert.ok(Math.abs(used[k][a] - box0[k][a]) < 1e-6, `${k}.${a}: ${used[k][a]} vs ${box0[k][a]}`);
});

test('a heavy OBJ opened with simplification: fewer triangles, the same size, and the page told', async () => {
	const g = denseSphere(200);
	const p = g.attributes.position, lines = ['usemtl a'];
	for (let i = 0; i < p.count; i++) lines.push(`v ${p.getX(i)} ${p.getY(i)} ${p.getZ(i)}`);
	for (let t = 0; t < p.count / 3; t++) lines.push(`f ${3 * t + 1} ${3 * t + 2} ${3 * t + 3}`);
	const bytes = new TextEncoder().encode(lines.join('\n'));
	const plain = await openFiles([{ name: 'ball.obj', bytes }], { units: 'm' });
	const lighter = await openFiles([{ name: 'ball.obj', bytes }], { units: 'm', simplifyAbove: 10_000, simplifyTarget: 8_000 });
	assert.equal(plain.simplified, null, 'not asked: untouched');
	const t0 = objectTriangles(plain.root), t1 = objectTriangles(lighter.root);
	assert.ok(lighter.simplified && lighter.simplified.models === 1 && t1 < t0 / 2, `${t0} -> ${t1}`);
	const s0 = plain.bounds.getSize(new THREE.Vector3()), s1 = lighter.bounds.getSize(new THREE.Vector3());
	assert.ok(s0.distanceTo(s1) < 1e-5, 'the same outer size');
	const mesh = new THREE.Mesh(denseSphere(16), new THREE.MeshBasicMaterial());
	const small = await simplifyObject(mesh, 1);
	assert.equal(small.before, small.after, 'nothing to keep out: whole');
});
