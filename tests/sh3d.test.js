// Parser and scene-builder tests against real .sh3d files.
// Run: npm test   (fixtures: npm run fixtures; personal files in tests/fixtures/private/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parseXml, parseHome, buildHome, arcCircleCenter, pieceTransform } from '../js/sh3d.js';
import { prepareObjText } from '../js/formats.js';

const FIX = path.resolve(import.meta.dirname, 'fixtures');

// Expected counts for the public examples (checked against Sweet Home 3D).
const EXPECTED = {
	'userGuideExample.sh3d': { walls: 19, rooms: 4, pieces: 80, doorsAndWindows: 7 },
	'SweetHome3DExample.sh3d': { walls: 16, rooms: 6, pieces: 62, doorsAndWindows: 10 },
};

const fixtures = [
	// Always there: the example home in the repository. Optional: the public
	// Sweet Home 3D examples (npm run fixtures). Your own files in private/ only
	// when asked for (CASAWALK_PRIVATE=1 npm test): the default output never
	// names or parses a private home (code audit, A2).
	path.resolve(import.meta.dirname, '../examples/example-home.sh3d'),
	...(fs.existsSync(FIX) ? fs.readdirSync(FIX).filter((f) => f.endsWith('.sh3d')).map((f) => path.join(FIX, f)) : []),
	...(process.env.CASAWALK_PRIVATE === '1' && fs.existsSync(path.join(FIX, 'private')) ? fs.readdirSync(path.join(FIX, 'private')).filter((f) => f.endsWith('.sh3d')).map((f) => path.join(FIX, 'private', f)) : []),
];

/** Loads OBJ geometry only (no materials/textures, which need a browser). */
function objLoaderFor(entries) {
	return async (ref) => {
		let key = ref;
		let bytes = entries[key] || entries[decodeURIComponent(key)];
		if (!bytes) return null;
		if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // nested zip
			const inner = unzipSync(bytes);
			key = Object.keys(inner).find((k) => k.toLowerCase().endsWith('.obj'));
			bytes = key && inner[key];
			if (!bytes) return null;
		}
		const text = new TextDecoder().decode(bytes);
		if (text.startsWith('<?xml') || bytes[0] === 0x4d || text.startsWith('glTF')) return null;
		return new OBJLoader().parse(prepareObjText(text).replace(/^\s*(mtllib|usemtl).*$/gm, ''));
	};
}

async function load(file) {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
	assert.ok(entries['Home.xml'], 'Home.xml present');
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const built = await buildHome(home, { loadModel: objLoaderFor(entries) });
	return { home, built };
}

test('XML reader handles entities, quotes and nesting', () => {
	const r = parseXml(`<?xml version='1.0'?><!-- c --><home a='x &amp; y' b="2"><wall id='w'><texture image='1'/></wall><room/></home>`);
	assert.equal(r.name, 'home');
	assert.equal(r.attrs.a, 'x & y');
	assert.equal(r.attrs.b, '2');
	assert.equal(r.children.length, 2);
	assert.equal(r.children[0].children[0].attrs.image, '1');
});

test('round wall centre matches Sweet Home 3D formula', () => {
	const w = { xStart: 0, yStart: 0, xEnd: 100, yEnd: 0, arcExtent: Math.PI / 2 };
	const [cx, cy] = arcCircleCenter(w);
	assert.ok(Math.abs(cx - 50) < 1e-6 && Math.abs(cy - 50) < 1e-6, `${cx},${cy}`);
	const big = arcCircleCenter({ ...w, arcExtent: 1.5 * Math.PI });
	assert.ok(Math.abs(big[0] - 50) < 1e-6 && Math.abs(big[1] + 50) < 1e-6, `${big}`);
});

test('piece transform: angle, mirror and elevation', () => {
	const p = { x: 100, y: 200, elevation: 10, angle: Math.PI / 2, width: 80, depth: 40, height: 60, pitch: 0, roll: 0, mirrored: true };
	const { matrix, effHeight } = pieceTransform(p, null, 250);
	assert.equal(effHeight, 60);
	const box = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrix);
	// Rotated 90°: width runs along plan y, depth along x.
	assert.ok(Math.abs(box.max.x - box.min.x - 40) < 1e-6);
	assert.ok(Math.abs(box.max.z - box.min.z - 80) < 1e-6);
	assert.ok(Math.abs(box.min.y - 260) < 1e-6 && Math.abs(box.max.y - 320) < 1e-6);
	assert.ok(matrix.determinant() < 0, 'mirrored piece flips handedness');
});

test('pitch/roll: effective height is the rotated bounding-box height', () => {
	const p = { x: 0, y: 0, elevation: 0, angle: 0, width: 95, depth: 15, height: 80, pitch: 0, roll: 3 * Math.PI / 2, mirrored: false };
	const { effHeight } = pieceTransform(p, null, 0);
	assert.ok(Math.abs(effHeight - 95) < 1e-3, `effHeight ${effHeight}`);
});

for (const file of fixtures) {
	const name = path.basename(file);
	test(`fixture ${name}`, async (t) => {
		const { home, built } = await load(file);
		const s = built.stats;
		t.diagnostic(JSON.stringify(s));

		if (EXPECTED[name]) {
			for (const [k, v] of Object.entries(EXPECTED[name])) assert.equal(s[k], v, `${k}`);
		}
		assert.ok(s.walls > 0 && s.rooms > 0 && s.pieces > 0);
		assert.ok(s.openings >= 1, 'at least one door/window cuts a wall');

		// No NaN anywhere: matrices and vertex positions.
		built.root.traverse((o) => {
			assert.ok(o.matrixWorld.elements.every(Number.isFinite), `matrix of ${o.name}`);
			const pos = o.geometry?.attributes?.position;
			if (pos) assert.ok(pos.array.every(Number.isFinite), `positions of ${o.name}`);
		});

		// Furniture lies inside the walls' bounding box (with a small margin).
		const wallsBox = new THREE.Box3().setFromObject(built.root.getObjectByName('walls'));
		const margin = 0.3; // metres
		const outside = [];
		for (const piece of built.root.getObjectByName('furniture').children) {
			const c = new THREE.Box3().setFromObject(piece).getCenter(new THREE.Vector3());
			if (c.x < wallsBox.min.x - margin || c.x > wallsBox.max.x + margin || c.z < wallsBox.min.z - margin || c.z > wallsBox.max.z + margin
				|| c.y < wallsBox.min.y - margin || c.y > wallsBox.max.y + margin) outside.push(piece.name);
		}
		// Allow a few genuinely outdoor items (plants, cars) but not systematic misplacement.
		assert.ok(outside.length <= Math.max(2, s.pieces * 0.1), `pieces outside walls: ${outside.join(', ')}`);
		if (outside.length) t.diagnostic(`outside walls: ${outside.join(', ')}`);
	});
}

test('OBJ concave polygons are triangulated without filling the hole (door frames)', () => {
	// An upside-down U, like the front face of Sweet Home 3D's door frame.
	const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 3 0', 'v 2 3 0', 'v 2 0 0', 'v 3 0 0', 'v 3 4 0', 'v 0 4 0', 'f 1 2 3 4 5 6 7 8', 'l 1 2'].join('\n');
	const mesh = new OBJLoader().parse(prepareObjText(obj)).children[0];
	assert.ok(mesh.isMesh, 'faces stay a mesh even with a stray line record');
	const pos = mesh.geometry.attributes.position;
	assert.equal(pos.count, 6 * 3, '8-gon -> 6 triangles');
	const tri = new THREE.Triangle();
	const doorway = new THREE.Vector3(1.5, 1, 0);
	let area = 0;
	for (let i = 0; i < pos.count; i += 3) {
		tri.setFromAttributeAndIndices(pos, i, i + 1, i + 2);
		assert.ok(!tri.containsPoint(doorway), 'no triangle covers the doorway');
		assert.ok(tri.getNormal(new THREE.Vector3()).z > 0, 'winding kept');
		area += tri.getArea();
	}
	assert.ok(Math.abs(area - 9) < 1e-6, `area ${area}`); // 3x4 minus the 1x3 doorway
});

test('OBJ faces mixing corners with and without (missing) normals get no NaN normals', () => {
	// Like Sweet Home 3D's glass door cabinet: no "vn" lines, yet some corners say //n.
	const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 0 1', 'v 0 0 1', 'v 0.5 0 1.5', 'f 1 2 3//7 5//8 4//9', 'f 1 2//3 3'].join('\n');
	const mesh = new OBJLoader().parse(prepareObjText(obj)).children[0];
	const n = mesh.geometry.attributes.normal;
	assert.ok(n.array.every(Number.isFinite), 'finite normals');
	for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.abs(n.getY(i)) - 1) < 1e-6, 'flat face normal is vertical');
});

test('compass is read in radians (north direction and latitude)', () => {
	const home = parseHome(`<home><compass x='0' y='0' diameter='100' northDirection='1.5707964' longitude='-0.001' latitude='0.8993254' timeZone='Europe/London'/></home>`);
	assert.ok(Math.abs(home.compass.northDirection - Math.PI / 2) < 1e-6);
	assert.ok(Math.abs(home.compass.latitude * 180 / Math.PI - 51.53) < 0.01);
	assert.equal(parseHome('<home/>').compass.northDirection, 0);
});
