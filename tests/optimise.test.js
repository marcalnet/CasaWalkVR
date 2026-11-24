// Merge-by-material and BVH tests against the fixture homes.
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

const FIX = path.resolve(import.meta.dirname, 'fixtures');
const files = [
	// Always there: the example home in the repository. Optional: the public
	// Sweet Home 3D examples (npm run fixtures). Your own files in private/ only
	// when asked for (CASAWALK_PRIVATE=1 npm test; code audit, A2).
	path.resolve(import.meta.dirname, '../examples/example-home.sh3d'),
	...(fs.existsSync(FIX) ? fs.readdirSync(FIX).filter((f) => f.endsWith('.sh3d')).map((f) => path.join(FIX, f)) : []),
	...(process.env.CASAWALK_PRIVATE === '1' && fs.existsSync(path.join(FIX, 'private')) ? fs.readdirSync(path.join(FIX, 'private')).filter((f) => f.endsWith('.sh3d')).map((f) => path.join(FIX, 'private', f)) : []),
];

async function build(file) {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	return buildHome(home, {
		loadModel: async (ref) => {
			const bytes = entries[ref] || entries[decodeURIComponent(ref)];
			if (!bytes || bytes[0] === 0x50) return null;
			const text = new TextDecoder().decode(bytes);
			if (text.startsWith('<?xml')) return null;
			// Two materials per model so the multi-material path is exercised.
			const obj = new OBJLoader().parse(prepareObjText(text).replace(/^\s*mtllib.*$/gm, ''));
			obj.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(() => new THREE.MeshLambertMaterial()) : new THREE.MeshLambertMaterial(); });
			return obj;
		},
	});
}

function countTriangles(root) {
	let t = 0;
	root.traverseVisible((o) => {
		if (!o.isMesh) return;
		const g = o.geometry;
		const mats = Array.isArray(o.material) ? o.material : [o.material];
		if (Array.isArray(o.material) && g.groups.length) {
			for (const gr of g.groups) if (mats[gr.materialIndex]?.visible !== false) t += Math.floor(gr.count / 3);
		} else {
			t += (g.index ? g.index.count : g.attributes.position.count) / 3;
		}
	});
	return Math.round(t);
}

for (const file of files) {
	test(`merge ${path.basename(file)}`, async (t) => {
		const built = await build(file);
		const before = countTriangles(built.root);
		const boxBefore = new THREE.Box3().setFromObject(built.root);
		const { group, layers, stats } = optimiseModel(built.root);
		t.diagnostic(JSON.stringify(stats));

		assert.ok(stats.drawCalls < 150, `draw calls ${stats.drawCalls}`);
		assert.equal(stats.triangles, before, 'no triangles lost or added');
		const boxAfter = new THREE.Box3().setFromObject(group);
		assert.ok(boxAfter.min.distanceTo(boxBefore.min) < 1e-3 && boxAfter.max.distanceTo(boxBefore.max) < 1e-3, 'same bounds');
		for (const m of group.children.flatMap((l) => l.children)) {
			assert.ok(m.geometry.attributes.position.array.every(Number.isFinite), 'finite positions');
		}

		// A BVH raycast straight down through the middle of a room lands on a floor.
		const floors = layers.floors.children;
		assert.ok(floors.length > 0);
		const fb = new THREE.Box3().setFromObject(layers.floors);
		const rc = new THREE.Raycaster();
		rc.firstHitOnly = true;
		let hits = 0;
		for (let i = 0; i < 25; i++) {
			const x = fb.min.x + (fb.max.x - fb.min.x) * ((i % 5) + 0.5) / 5;
			const z = fb.min.z + (fb.max.z - fb.min.z) * (Math.floor(i / 5) + 0.5) / 5;
			rc.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
			if (rc.intersectObjects(floors, false).length) hits++;
		}
		assert.ok(hits >= 10, `floor hits ${hits}/25`);
		assert.ok(floors.every((m) => m.geometry.boundsTree), 'floors have a BVH');
	});
}
