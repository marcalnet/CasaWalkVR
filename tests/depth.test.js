// Depth shading: the grid cutter and the corner bake (js/depth.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parseHome, buildHome } from '../js/sh3d.js';
import { prepareObjText } from '../js/formats.js';
import { optimiseModel } from '../js/optimise.js';
import { DepthShading, sliceByGrid } from '../js/depth.js';

const area = (g) => {
	const p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	let sum = 0;
	const n = g.index ? g.index.count : p.count;
	const at = (i) => (g.index ? g.index.getX(i) : i);
	for (let i = 0; i < n; i += 3) {
		a.fromBufferAttribute(p, at(i)); b.fromBufferAttribute(p, at(i + 1)); c.fromBufferAttribute(p, at(i + 2));
		sum += b.sub(a).cross(c.sub(a)).length() / 2;
	}
	return sum;
};

test('grid cutter: same surface, regular lattice, small pieces left alone', () => {
	// A wall face 2.0 x 1.0 m, standing in the plane z = 0.13.
	const wall = new THREE.PlaneGeometry(2, 1).translate(1.05, 0.5, 0.13);
	const cut = sliceByGrid(wall, 0.3);
	assert.notEqual(cut, wall);
	assert.ok(cut.index, 'indexed');
	assert.ok(Math.abs(area(cut) - 2) < 1e-4, `area ${area(cut)}`);
	const p = cut.attributes.position, n = cut.attributes.normal;
	for (let i = 0; i < p.count; i++) {
		assert.ok(Math.abs(p.getZ(i) - 0.13) < 1e-6, 'stays in its plane');
		assert.ok(Math.abs(n.getZ(i) - 1) < 1e-6, 'keeps its normal');
		assert.ok(p.getX(i) > 0.05 - 1e-6 && p.getX(i) < 2.05 + 1e-6 && p.getY(i) > -1e-6 && p.getY(i) < 1 + 1e-6, 'stays inside the face');
	}
	// No triangle is larger than one grid cell.
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	for (let i = 0; i < cut.index.count; i += 3) {
		a.fromBufferAttribute(p, cut.index.getX(i)); b.fromBufferAttribute(p, cut.index.getX(i + 1)); c.fromBufferAttribute(p, cut.index.getX(i + 2));
		assert.ok(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) < 0.3 * Math.SQRT2 + 1e-6);
	}
	// Roughly two triangles per cell, not an explosion of slivers.
	assert.ok(cut.index.count / 3 < 120, `${cut.index.count / 3} triangles`);
	// Something smaller than a cell and not crossing a grid plane is returned untouched.
	const small = new THREE.PlaneGeometry(0.1, 0.1).translate(0.15, 0.15, 0);
	assert.equal(sliceByGrid(small, 0.3), small);
});

test('the shader hook finds its places in the vendored three.js shaders', () => {
	// If a three.js update renames these, depth shading would silently do nothing.
	for (const lib of [THREE.ShaderLib.lambert, THREE.ShaderLib.phong]) {
		for (const token of ['#include <common>', '#include <begin_vertex>']) assert.ok(lib.vertexShader.includes(token), token);
		for (const token of ['#include <common>', '#include <opaque_fragment>']) assert.ok(lib.fragmentShader.includes(token), token);
	}
	const depth = new DepthShading();
	const material = new THREE.MeshLambertMaterial();
	depth.hook(material);
	const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
	material.onBeforeCompile(shader);
	assert.equal(shader.uniforms.cwDepth, depth.uniform);
	assert.match(shader.vertexShader, /attribute float cwAo;[\s\S]*vCwAo = cwAo;/);
	assert.match(shader.fragmentShader, /outgoingLight \*= mix\(1\.0, vCwAo \* [\s\S]*#include <opaque_fragment>/);
});

test('bake on the example home: corners are darker than the middle of a wall; VR only', async () => {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(path.resolve(import.meta.dirname, '../examples/example-home.sh3d'))));
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const built = await buildHome(home, { loadModel: async (ref) => new OBJLoader().parse(prepareObjText(new TextDecoder().decode(entries[ref])).replace(/^\s*mtllib.*$/gm, '')) });
	const { layers } = optimiseModel(built.root);
	const before = layers.walls.children.reduce((n, m) => n + m.geometry.index.count / 3, 0);

	const depth = new DepthShading();
	const states = [];
	depth.onChange = () => states.push(depth.state);
	depth.setModel(layers);
	assert.equal(depth.state, 'idle'); // switched off: nothing is prepared
	assert.equal(depth.label(), 'off');
	depth.setEnabled(true);
	assert.equal(depth.state, 'baking');
	assert.match(depth.label(), /^\d+%$/);
	let guard = 0;
	while (depth.tick(50)) assert.ok(++guard < 5000, 'the bake finishes');
	assert.equal(depth.state, 'ready');
	assert.equal(depth.label(), 'on');
	assert.ok(states.includes('baking') && states.at(-1) === 'ready');

	// Walls were cut up, and every wall mesh is still usable for raycasts.
	const after = layers.walls.children.reduce((n, m) => n + m.geometry.index.count / 3, 0);
	assert.ok(after > before * 3, `${before} -> ${after} wall triangles`);
	for (const m of layers.walls.children) assert.ok(m.geometry.boundsTree, 'BVH rebuilt');

	// Ground-floor living room: the north wall's inner face is at z = 0.10 m.
	// Its middle is open; where it meets the west wall and the floor it is dark.
	let middle = null, corner = null;
	const v = new THREE.Vector3();
	for (const m of layers.walls.children) {
		const p = m.geometry.attributes.position, n = m.geometry.attributes.normal, ao = m.geometry.attributes.cwAo;
		for (let i = 0; i < p.count; i++) {
			v.fromBufferAttribute(p, i);
			if (Math.abs(v.z - 0.1) > 1e-3 || n.getZ(i) < 0.9) continue;
			if (Math.abs(v.x - 3.6) < 0.16 && Math.abs(v.y - 1.5) < 0.16) middle = Math.max(middle ?? 0, ao.getX(i));
			if (v.x < 0.25 && v.y < 0.05) corner = Math.min(corner ?? 1, ao.getX(i));
		}
	}
	assert.ok(middle > 0.97, `middle of the wall ${middle}`);
	assert.ok(corner < 0.75, `floor corner ${corner}`);

	// The effect is for the headset only.
	assert.equal(depth.uniform.value, 0);
	depth.setActive(true);
	assert.equal(depth.uniform.value, 1);
	depth.setEnabled(false);
	assert.equal(depth.uniform.value, 0);
	depth.setEnabled(true);
	depth.setActive(false);
	assert.equal(depth.uniform.value, 0);
	assert.equal(depth.state, 'ready'); // switching back on does not bake again
});
