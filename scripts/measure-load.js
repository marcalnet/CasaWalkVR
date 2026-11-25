// Measures how a model goes through CasaWalk's loading path, stage by stage,
// in Node (the app's own code; no browser, no GPU): time and memory for
// unzipping, preparing and parsing the OBJ models, building the home,
// merging, the BVH (the raycast trees) and the depth-shading bake, plus the
// draw calls and triangles after the merge. For the heavy-models
// investigation. Run with Node 24:
//   node --expose-gc --import ./tests/register.js scripts/measure-load.js test-output/stress/many-1m.sh3d
// Prints one JSON line. Memory: rss (the whole process), heap (JavaScript
// objects, strings) and buffers (typed arrays: the geometry), in MB, after
// each stage and at the highest point seen inside the stages.

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { EntryStore, loadModelEntry, sniff } from '../js/formats.js';
import { parseHome, buildHome } from '../js/sh3d.js';
import { optimiseModel, modelStats } from '../js/optimise.js';
import { DepthShading } from '../js/depth.js';

const file = process.argv[2];
const MB = (b) => Math.round(b / 1048576);
const gc = () => globalThis.gc?.();
const mem = () => { const m = process.memoryUsage(); return { rss: MB(m.rss), heap: MB(m.heapUsed), buffers: MB(m.arrayBuffers) }; };
const peak = { rss: 0, heap: 0, buffers: 0, where: {} };
const sample = (where) => { const m = mem(); for (const k of ['rss', 'heap', 'buffers']) if (m[k] > peak[k]) { peak[k] = m[k]; peak.where[k] = where; } };

// Hooks into the shared three.js classes (the app's modules use the same ones).
const time = { objParse: 0, bvh: 0 };
const parse = OBJLoader.prototype.parse;
OBJLoader.prototype.parse = function (text) {
	sample('obj: before parse');
	const t = performance.now(), r = parse.call(this, text);
	time.objParse += performance.now() - t;
	sample('obj: after parse');
	return r;
};
const bvh = THREE.BufferGeometry.prototype.computeBoundsTree;
THREE.BufferGeometry.prototype.computeBoundsTree = function (...a) {
	sample('merge: before a BVH');
	const t = performance.now(), r = bvh.apply(this, a);
	time.bvh += performance.now() - t;
	return r;
};
/** Bytes of geometry in a scene graph (each attribute array once). */
function geometryBytes(root) {
	const seen = new Set();
	let bytes = 0;
	root.traverse((o) => {
		const g = o.geometry;
		if (!g || seen.has(g)) return;
		seen.add(g);
		for (const a of [...Object.values(g.attributes), g.index].filter(Boolean)) bytes += a.array.byteLength;
	});
	return MB(bytes);
}

const out = { file: path.basename(file), mb: +(fs.statSync(file).size / 1048576).toFixed(1), stages: {} };
const stage = (name, t0, extra = {}) => { gc(); out.stages[name] = { s: +((performance.now() - t0) / 1000).toFixed(2), ...mem(), ...extra }; sample(name); };
try {
	gc(); out.start = mem();
	let t = performance.now();
	const bytes = new Uint8Array(fs.readFileSync(file));
	const zipped = sniff(bytes) === 'zip';
	const store = zipped ? EntryStore.fromZip(bytes) : new EntryStore(new Map([[path.basename(file), bytes]]));
	stage('unzip', t, { unpackedMB: MB([...store.entries.values()].reduce((n, b) => n + b.byteLength, 0)) });

	t = performance.now();
	let root, home = null, built = null;
	const objStart = time.objParse;
	if (store.entries.has('Home.xml')) {
		home = parseHome(new TextDecoder().decode(store.entries.get('Home.xml')));
		let loadS = 0;
		built = await buildHome(home, {
			loadModel: async (ref) => { const t1 = performance.now(); const m = await loadModelEntry(store, ref); loadS += performance.now() - t1; return m; },
			loadTexture: () => null,
		});
		root = built.root;
		out.stages.models = { s: +(loadS / 1000).toFixed(2), objParseS: +((time.objParse - objStart) / 1000).toFixed(2), prepareS: +((loadS - (time.objParse - objStart)) / 1000).toFixed(2) };
		stage('build', t, { geometryMB: geometryBytes(root), pieces: built.stats.pieces, missing: built.stats.missingModels });
		out.stages.build.buildOnlyS = +(out.stages.build.s - out.stages.models.s).toFixed(2);
	} else {
		const main = [...store.entries.keys()].find((k) => k.toLowerCase().endsWith('.obj'));
		root = await loadModelEntry(store, main);
		out.stages.models = { s: +((performance.now() - t) / 1000).toFixed(2), objParseS: +((time.objParse - objStart) / 1000).toFixed(2) };
		out.stages.models.prepareS = +(out.stages.models.s - out.stages.models.objParseS).toFixed(2);
		stage('build', t, { geometryMB: geometryBytes(root) });
	}
	let sourceTris = 0;
	root.traverse((o) => { if (o.isMesh) sourceTris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
	out.sourceTriangles = Math.round(sourceTris);

	t = performance.now();
	const bvh0 = time.bvh;
	const { group, layers } = optimiseModel(root);
	stage('merge', t, { geometryMB: geometryBytes(group), sourceGeometryMB: geometryBytes(root), ...modelStats(group) });
	out.stages.merge.bvhS = +((time.bvh - bvh0) / 1000).toFixed(2);
	out.stages.merge.mergeOnlyS = +(out.stages.merge.s - out.stages.merge.bvhS).toFixed(2);

	t = performance.now();
	const depth = new DepthShading();
	depth.setModel(layers);
	depth.setEnabled(true);
	let ticks = 0;
	while (depth.tick(50)) { if (++ticks % 20 === 0) sample('depth bake'); if (ticks > 200000) break; }
	stage('depth', t, { state: depth.state, geometryMB: geometryBytes(group) });
	out.ok = true;
} catch (e) {
	out.ok = false;
	out.error = `${e.name}: ${e.message}`.slice(0, 300);
}
out.peak = peak;
console.log(JSON.stringify(out));
