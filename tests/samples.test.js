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

test('Pond House: 2 levels, 30 rooms (15 named; the pond is water, not a room; the deck is pieces that never overlap), a round wall, a sloping wall, unnamed helper rooms, nothing missing', async () => {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples/pond-house.sh3d'))));
	const xml = new TextDecoder().decode(entries['Home.xml']);
	assert.match(xml, /<home [^>]*selectedLevel=/, 'Sweet Home 3D opens it with its level tabs');
	const { home, built } = await open(entries);
	assert.equal(built.storeys, 2);
	assert.equal(built.stats.missingModels, 0);
	assert.ok(home.walls.some((w) => Math.abs(w.arcExtent) > 0.1), 'the round pond wall (arcExtent)');
	assert.ok(home.walls.some((w) => w.heightAtEnd !== null && Math.abs(w.heightAtEnd - w.height) > 1), 'the sloping wall along the drive (heightAtEnd)');
	const named = built.plan.rooms.filter((r) => r.name), unnamed = built.plan.rooms.filter((r) => !r.name);
	assert.equal(built.plan.rooms.length, 30);
	assert.equal(named.length, 15, `named rooms: ${named.map((r) => r.name).join(', ')}`);
	assert.ok(unnamed.length > 0, 'pieces that only carry a floor or ceiling stay unnamed (one label per space)');
	assert.ok(built.lamps.length >= 4); // (hall, pendant, two bedside lamps)
	// The pond is water: merged on its own, never stood on (furniture can be: several levels).
	const { layers } = optimiseModel(built.root);
	const t = targetSets({ layers, multiLevel: true });
	const water = layers.main.children.filter((m) => m.userData.water);
	assert.ok(water.length > 0 && water.every((m) => !t.walkable.has(m)) && t.walkableList.some((m) => layers.main.children.includes(m)));
	// Glass (the shower's screens; the stair has an oak rod rail now) is never stood on either.
	const glass = layers.main.children.filter((m) => m.userData.glass);
	assert.ok(glass.every((m) => !t.walkable.has(m)), 'glass is never a landing');
});

test('Pond House: the water is sunk in a stone basin, the stepping stones stand 5 cm above it, nothing within 3 cm of anything at water level', async () => {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples/pond-house.sh3d'))));
	const xml = new TextDecoder().decode(entries['Home.xml']);
	const pieces = [...xml.matchAll(/<pieceOfFurniture ([^>]*)\/>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)='([^']*)'/g)].map((a) => [a[1], a[2]])));
	const by = (name) => pieces.filter((p) => p.name === name);
	const top = (p) => Number(p.elevation ?? 0) + Number(p.height);
	const water = by('Pond'), coping = by('Stone coping'), stones = by('Stepping stones'), lilies = by('Lily pads');
	assert.ok(water.length === 1 && coping.length === 1 && stones.length === 1 && lilies.length === 3, 'one wide pond (v7)');
	const level = Math.min(...water.map(top));
	assert.ok(coping.every((p) => top(p) - level >= 10 && top(p) - level <= 15), `the water sits 10-15 cm below the coping (${top(coping[0])} vs ${level} cm)`);
	assert.ok(stones.every((p) => Math.abs(top(p) - level - 5) < 0.01), 'the stepping stones: tops 5 cm above the water');
	assert.ok(lilies.every((p) => Number(p.elevation) - level >= 2 && Number(p.elevation) - level <= 3.5), 'the lilies float 2-3 cm clear of the water');
	assert.ok(water.every((p) => Number(p.elevation) >= 3), 'the water slab is clear of the ground');
	// The stones are no water: not named pool or water, so a visitor can stand on them (several levels).
	const { WATER_NAME } = await import('../js/optimise.js');
	assert.ok([...coping, ...stones, ...lilies].every((p) => !WATER_NAME.test(p.name)), 'only the water is named water');
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
