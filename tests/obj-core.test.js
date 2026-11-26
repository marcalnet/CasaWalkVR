// OBJ reading shared with the worker (js/obj-core.js; heavy homes, step 5):
// read as plain data and rebuilt, every sample model gives the same meshes and
// materials as three.js's OBJLoader with the material creator, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { prepareObjText, parseObjBytes, buildObj, transferables } from '../js/obj-core.js';
import { defaultMtlFor, usedMaterialNames, definedMaterialNames } from '../js/obj-defaults.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The material creator for a model, as js/formats.js makes it (its .mtl, then the built-in names). */
function creatorFor(entries, ref, text) {
	const folder = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/') + 1) : '';
	const lib = text.match(/^\s*mtllib\s+(.+?)\s*$/m)?.[1];
	let mtl = lib && entries[folder + lib] ? new TextDecoder().decode(entries[folder + lib]) : '';
	mtl += '\n' + defaultMtlFor(usedMaterialNames(text), definedMaterialNames(mtl));
	const c = new MTLLoader().parse(mtl, '');
	c.preload();
	return c;
}

const describe = (group) => group.children.map((o) => ({
	type: o.type, name: o.name,
	attributes: Object.fromEntries(Object.entries(o.geometry.attributes).map(([k, a]) => [k, [a.itemSize, Array.from(a.array)]])),
	index: o.geometry.index ? Array.from(o.geometry.index.array) : null, groups: o.geometry.groups,
	materials: [].concat(o.material).map((m) => [m.type, m.name, m.flatShading, m.vertexColors, m.color?.getHexString(), m.opacity, m.transparent, !!m.map]),
	many: Array.isArray(o.material),
}));

test('every sample model: read as data and rebuilt, the same meshes and materials as OBJLoader gives', async () => {
	let n = 0;
	for (const file of ['pond-house', 'apartment', 'example-home']) {
		const entries = unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, `examples/${file}.sh3d`))));
		for (const [ref, bytes] of Object.entries(entries)) {
			if (ref === 'Home.xml') continue;
			const text = new TextDecoder().decode(bytes);
			if (!/^\s*f\s/m.test(text)) continue;
			const old = new OBJLoader().setMaterials(creatorFor(entries, ref, text)).parse(prepareObjText(text));
			const parsed = await parseObjBytes(bytes);
			const now = buildObj(parsed, creatorFor(entries, ref, text));
			assert.deepEqual(describe(now), describe(old), `${file}/${ref}`);
			n++;
		}
	}
	assert.ok(n > 40, `${n} models compared`);
});

test('the arrays a worker hands over are the geometry\'s own (nothing copied)', async () => {
	const parsed = await parseObjBytes(new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl a\nf 1 2 3\n'));
	const list = transferables(parsed);
	assert.ok(list.length >= 1 && list.every((b) => b instanceof ArrayBuffer));
	assert.ok(list.includes(parsed.meshes[0].attributes.position.array.buffer));
	assert.deepEqual(parsed.used, ['a']);
});
