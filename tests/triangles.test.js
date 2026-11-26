// The triangle check before building (js/triangles.js; heavy homes, step 1):
// counted from the raw bytes, close to what the built home really has, and a
// home over the limit refused calmly before anything is built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { objTriangles, gltfTriangles, homeTriangles, triangleVerdict, tooHeavyMessage } from '../js/triangles.js';
import { openFiles, UserError } from '../js/formats.js';
import { CONFIG } from '../config.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const bytes = (text) => new TextEncoder().encode(text);

test('OBJ: a face with n corners is n - 2 triangles; leading blanks, CRLF, comments and other records', () => {
	const obj = 'v 0 0 0\r\nv 1 0 0\nf 1 2 3\n  f 1/1 2/2 3/3 4/4\r\n# f 1 2 3 4 5\nvn 0 1 0\nf\t1//1\t2//2\t3//3\t4//4\t5//5\nl 1 2\nfoo 1 2 3\nf 1 2\n';
	assert.equal(objTriangles(bytes(obj)), 1 + 2 + 3);
	assert.equal(objTriangles(bytes('')), 0);
	assert.equal(objTriangles(bytes('f 1 2 3')), 1, 'no newline at the end');
});

test('glTF: indices or positions per triangle primitive, once per node using the mesh; lines and points draw none', () => {
	const json = {
		accessors: [{ count: 36 }, { count: 24 }, { count: 10 }],
		meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }, { primitives: [{ attributes: { POSITION: 2 }, mode: 5 }, { attributes: { POSITION: 2 }, mode: 1 }] }],
		nodes: [{ mesh: 0 }, { mesh: 0 }, { mesh: 1 }, {}],
	};
	assert.equal(gltfTriangles(json), 12 * 2 + 8);
});

test('a home: each model counted once, times the pieces using it; the verdict and the calm message', () => {
	const counts = { a: 1000, b: 50 };
	const pieces = [{ model: 'a' }, { model: 'a' }, { model: 'b' }, { model: 'c' }, { model: null }];
	const h = homeTriangles(pieces, (ref) => counts[ref] ?? null);
	assert.deepEqual([h.triangles, h.unknown, h.models.get('a')], [2050, 1, { triangles: 1000, uses: 2 }]);
	const limits = { warning: 1.5e6, limit: 6e6 };
	assert.equal(triangleVerdict(1e6, limits), 'load');
	assert.equal(triangleVerdict(2e6, limits), 'heavy');
	assert.equal(triangleVerdict(7e6, limits), 'refuse');
	assert.match(tooHeavyMessage(9.24e6, 6e6), /^This home has 9.2 million triangles: more than the 6 million CasaWalk can open on a Quest\./);
});

test('the example home: the count from its bytes is close to what is built; over the limit, it is refused before building', async () => {
	const file = path.join(ROOT, 'examples/example-home.sh3d'), data = new Uint8Array(fs.readFileSync(file));
	const opts = { makeTexture: (ref) => Object.assign(new THREE.Texture(), { name: ref }) };
	const built = await openFiles([{ name: 'example-home.sh3d', bytes: data }], opts);
	let furniture = 0;
	built.root.getObjectByName('furniture').traverse((o) => { if (o.isMesh) furniture += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
	built.store?.dispose();
	const { unzipSync } = await import('fflate');
	const { parseHome } = await import('../js/sh3d.js');
	const entries = unzipSync(data), home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const { triangles } = homeTriangles(home.pieces, (ref) => (entries[ref] ? objTriangles(entries[ref]) : null));
	assert.ok(triangles > 0 && Math.abs(triangles - furniture) / furniture < 0.05, `counted ${triangles}, built ${furniture}`);
	await assert.rejects(openFiles([{ name: 'example-home.sh3d', bytes: data }], { ...opts, triangleLimit: Math.floor(triangles / 2) }),
		(e) => e instanceof UserError && /million triangles/.test(e.message), 'refused with the calm message');
	assert.ok(CONFIG.triangleLimit > CONFIG.triangleWarning, 'the limit is above the warning');
});
