// The committed example home (scripts/make-example.js): two storeys, lamps
// and stairs. Unlike the downloaded fixtures it is always there, so these
// tests always run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parseHome, buildHome } from '../js/sh3d.js';
import { prepareObjText } from '../js/formats.js';
import { optimiseModel } from '../js/optimise.js';
import { Lighting, DEFAULT_TIME } from '../js/lighting.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'examples/example-home.sh3d');

async function build() {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(FILE)));
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const built = await buildHome(home, {
		loadModel: async (ref) => new OBJLoader().parse(prepareObjText(new TextDecoder().decode(entries[ref])).replace(/^\s*mtllib.*$/gm, '')),
	});
	return { home, built };
}

test('example home: two storeys, lamps, stairs up to the first floor', async () => {
	const { home, built } = await build();
	assert.deepEqual(home.storeys, [0, 262]);
	assert.equal(built.storeys, 2);
	assert.deepEqual(built.storeyNames, ['Ground floor', 'First floor'], 'level names, for the Levels dropdown in the headset');
	assert.deepEqual({ walls: built.stats.walls, rooms: built.stats.rooms, doors: built.stats.doorsAndWindows, openings: built.stats.openings, missing: built.stats.missingModels },
		{ walls: 11, rooms: 6, doors: 14, openings: 14, missing: 0 });
	// Lamps: one bulb per light piece, inside the house, on the right storey.
	assert.equal(built.lamps.length, 5);
	for (const l of built.lamps) {
		assert.ok(built.bounds.containsPoint(l.position), `lamp at ${l.position.toArray()}`);
		assert.equal(l.storey, l.position.y > 2.62 ? 1 : 0);
		assert.ok(l.radius > 0.02 && l.radius < 0.2);
	}
	// The floor lamp's bulb is in its shade: 1.5-1.76 m up, beside the sofa.
	const floorLamp = built.lamps.find((l) => Math.abs(l.position.x - 4.4) < 0.01 && Math.abs(l.position.z - 2.9) < 0.01);
	assert.ok(floorLamp && floorLamp.position.y > 1.5 && floorLamp.position.y < 1.76);
	// The top of the stairs is level with the first floor (2.62 m).
	const stairs = built.root.getObjectByName('Stairs');
	const box = new THREE.Box3().setFromObject(stairs);
	assert.ok(Math.abs(box.max.y - 2.62) < 0.005, `stairs top ${box.max.y}`);
	assert.ok(Math.abs(box.min.z - 4.0) < 0.01 && Math.abs(box.max.z - 6.7) < 0.01, 'stairs run from y = 400 to 670 cm');
});

test('merged scene: storeys stay separate and vertices are shared', async () => {
	const { built } = await build();
	const { layers, stats } = optimiseModel(built.root);
	const seen = { 0: 0, 1: 0 };
	let vertices = 0, corners = 0;
	for (const [name, layer] of Object.entries(layers)) {
		for (const m of layer.children) {
			seen[m.userData.storey]++;
			assert.ok(m.geometry.index, `${name} mesh is indexed`);
			assert.ok(m.geometry.boundsTree || name === 'ceilings', `${name} mesh has a BVH`);
			vertices += m.geometry.attributes.position.count;
			corners += m.geometry.index.count;
		}
	}
	assert.ok(seen[0] > 2 && seen[1] > 2, JSON.stringify(seen)); // (without materials in Node, furniture is one mesh per storey)
	assert.equal(corners / 3, stats.triangles);
	assert.ok(vertices < corners * 0.8, `${vertices} vertices for ${corners} triangle corners`);
	// Ground-floor and first-floor ceilings are separate meshes.
	assert.deepEqual([...new Set(layers.ceilings.children.map((m) => m.userData.storey))].sort(), [0, 1]);
});

test('morning is the default light; lamps show at sunset and at night only', async () => {
	assert.equal(DEFAULT_TIME, 'morning');
	const { built } = await build();
	const lighting = new Lighting(new THREE.Scene(), { shadowMap: {} });
	assert.equal(lighting.time, 'morning');
	const lamps = lighting.setLamps(built.lamps);
	assert.equal(lamps.children.length, 4); // cores and halos for each of the two storeys
	const shown = {};
	for (const t of ['morning', 'noon', 'sunset', 'night']) { lighting.setTime(t); shown[t] = lamps.visible; }
	assert.deepEqual(shown, { morning: false, noon: false, sunset: true, night: true });
	assert.equal(lighting.setLamps([]), null);
});

test('offline worker only handles the app\'s own files', () => {
	const handlers = {};
	const self = { location: { href: 'https://example.github.io/CasaWalk/sw.js' }, addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting() {}, clients: {} };
	const ctx = vm.createContext({ self, URL, Set, Promise, setTimeout, caches: {}, fetch: () => Promise.reject(new Error('no network')) });
	vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')}\nself.appKey = appKey;`, ctx);
	const key = self.appKey;
	const base = 'https://example.github.io/CasaWalk/';
	assert.equal(key(base), base);
	assert.equal(key(`${base}?model=https://x.example/a.sh3d`), base); // the query is ignored
	assert.equal(key(`${base}js/main.js`), `${base}js/main.js`);
	assert.equal(key(`${base}vendor/three/three.module.js`), `${base}vendor/three/three.module.js`);
	assert.equal(key(`${base}examples/example-home.sh3d`), `${base}examples/example-home.sh3d`);
	assert.equal(key(`${base}vendor/kalam/kalam-latin-400.woff2`), `${base}vendor/kalam/kalam-latin-400.woff2`); // the notes' font, offline too
	assert.equal(key(`${base}assets/ui/scale-plate.png`), `${base}assets/ui/scale-plate.png`); // interface artwork, offline too
	// Left alone: other sites, other folders of the same site, model files, the worker itself.
	for (const u of ['https://dl.dropboxusercontent.com/s/x/home.sh3d', 'https://example.github.io/OtherProject/js/main.js', `${base}tests/fixtures/private/home.sh3d`, `${base}sw.js`, `${base}README.md`, 'not a url']) {
		assert.equal(key(u), null, u);
	}
	// Only GET requests are answered.
	let answered = false;
	handlers.fetch({ request: { method: 'POST', url: `${base}js/main.js` }, respondWith() { answered = true; } });
	assert.equal(answered, false);
});
