// The sample homes the page offers (js/samples.js, examples/): every entry has
// its file and picture, and Pond House parses as designed (scripts/make-pond-house.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { parseHome, buildHome } from '../js/sh3d.js';
import { prepareObjText } from '../js/formats.js';
import { SAMPLES, sampleById } from '../js/samples.js';
import { optimiseModel } from '../js/optimise.js';
import { targetSets } from '../js/xr-targets.js';

const ROOT = path.resolve(import.meta.dirname, '..');

async function open(entries) {
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const built = await buildHome(home, {
		// The model with its colours (MTL), as the app loads it: glass is told by its opacity.
		loadModel: async (ref) => {
			const text = prepareObjText(new TextDecoder().decode(entries[ref]));
			const loader = new OBJLoader();
			const lib = text.match(/^\s*mtllib\s+(.+?)\s*$/m)?.[1];
			const folder = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/') + 1) : '';
			if (lib && entries[folder + lib]) {
				const creator = new MTLLoader().parse(new TextDecoder().decode(entries[folder + lib]), '');
				creator.preload();
				loader.setMaterials(creator);
			}
			return loader.parse(text.replace(/^\s*mtllib.*$/gm, ''));
		},
	});
	return { home, built };
}

test('the sample list: unique ids, each with its file and picture in examples/', () => {
	assert.deepEqual(SAMPLES.map((s) => s.id).slice(0, 2), ['pond-house', 'apartment'], 'Pond House first, then the Apartment');
	assert.equal(sampleById('urban-flat')?.id, 'apartment', 'its old link still opens it');
	assert.equal(sampleById('nope'), null);
	assert.equal(new Set(SAMPLES.map((s) => s.id)).size, SAMPLES.length);
	for (const s of SAMPLES) {
		assert.match(s.id, /^[a-z0-9-]+$/);
		for (const f of [s.file, s.picture]) {
			assert.match(f, /^examples\/[\w-]+\.(sh3d|jpg)$/, 'served from the app, cached by sw.js');
			assert.ok(fs.existsSync(path.join(ROOT, f)), f);
		}
		assert.ok(s.name && s.line && s.size);
		assert.equal(sampleById(s.id), s);
	}
	assert.equal(sampleById('../tests/fixtures/private/home'), null, 'a ?sample= link names a listed home, never a file');
	assert.equal(sampleById(null), null);
});

test('Pond House: 2 levels, 17 rooms (14 named; the pond is water, not a room), a round wall, a sloping wall, unnamed helper rooms, nothing missing', async () => {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples/pond-house.sh3d'))));
	const xml = new TextDecoder().decode(entries['Home.xml']);
	assert.match(xml, /<home [^>]*selectedLevel=/, 'Sweet Home 3D opens it with its level tabs');
	const { home, built } = await open(entries);
	assert.equal(built.storeys, 2);
	assert.equal(built.stats.missingModels, 0);
	assert.ok(home.walls.some((w) => Math.abs(w.arcExtent) > 0.1), 'the round pond wall (arcExtent)');
	assert.ok(home.walls.some((w) => w.heightAtEnd !== null && Math.abs(w.heightAtEnd - w.height) > 1), 'the sloping path wall (heightAtEnd)');
	const named = built.plan.rooms.filter((r) => r.name), unnamed = built.plan.rooms.filter((r) => !r.name);
	assert.equal(built.plan.rooms.length, 17);
	assert.equal(named.length, 14, `named rooms: ${named.map((r) => r.name).join(', ')}`);
	assert.ok(unnamed.length > 0, 'pieces that only carry a floor or ceiling stay unnamed (one label per space)');
	assert.ok(built.lamps.length >= 4); // (hall, pendant, two bedside lamps)
	// The pond is water: merged on its own, never stood on (furniture can be: several levels).
	const { layers } = optimiseModel(built.root);
	const t = targetSets({ layers, multiLevel: true });
	const water = layers.main.children.filter((m) => m.userData.water);
	assert.ok(water.length > 0 && water.every((m) => !t.walkable.has(m)) && t.walkableList.some((m) => layers.main.children.includes(m)));
	// The stair's glass balustrade (and the shower's glass) is never stood on either.
	const glass = layers.main.children.filter((m) => m.userData.glass);
	assert.ok(glass.length > 0 && glass.every((m) => !t.walkable.has(m)), 'glass is never a landing');
});

test('Apartment: one level without <level> elements, named zones in one open room, lamps, nothing missing', async () => {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples/apartment.sh3d'))));
	const xml = new TextDecoder().decode(entries['Home.xml']);
	assert.doesNotMatch(xml, /<level /, 'the parser path without levels');
	const { built } = await open(entries);
	assert.equal(built.storeys, 1);
	assert.equal(built.stats.missingModels, 0);
	const names = built.plan.rooms.map((r) => r.name).filter(Boolean);
	for (const n of ['Living room', 'Kitchen', 'Bedroom', 'Bathroom']) assert.ok(names.some((x) => x.includes(n)), `${n} in ${names.join(', ')}`);
	assert.ok(built.lamps.length >= 10);
});
