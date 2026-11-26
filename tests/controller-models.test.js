// The real controllers (js/controller-model.js, next-build asks §6): the three
// vendored profiles and their licence, one draw call per controller with the
// buttons still moving, the held tool's buttons glowing, the touch point on
// the model's nose, and the orb and the tools clear of every model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { buildControllerModel, ControllerModel, frontAlong, LOOK } from '../js/controller-model.js';
import { MotionController } from 'three/addons/libs/motion-controllers.module.js';
import { ORB_ON_GRIP } from '../js/wrist-menu.js';
import { SIGHT } from '../js/zones.js';
import { ABOVE } from '../js/tool-fan.js';
import { buildCamera, buildMeter, buildMarker } from '../js/tool-models.js';
import { readGlb, sceneOf } from './glb-scene.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'vendor/controllers');
const PROFILES = ['meta-quest-touch-plus', 'meta-quest-touch-pro', 'oculus-touch-v3'];

/** A fake XRInputSource with a Quest gamepad (the trigger at `trigger`). */
function source(handedness, trigger = 0) {
	const buttons = Array.from({ length: 8 }, (_, i) => ({ value: i === 0 ? trigger : 0, pressed: i === 0 && trigger > 0.5, touched: i === 0 && trigger > 0 }));
	return { handedness, profiles: [], gamepad: { buttons, axes: [0, 0, 0, 0] } };
}

/** A built model with its motion controller, for one profile and hand. */
function model(profileId, hand, gamepad = source(hand)) {
	const profile = JSON.parse(fs.readFileSync(path.join(DIR, profileId, 'profile.json'), 'utf8'));
	const b = buildControllerModel(sceneOf(path.join(DIR, profileId, `${hand}.glb`)));
	return { b, m: new ControllerModel(`${profileId}/${hand}/test`, b, new MotionController(gamepad, profile, '')), gamepad };
}

test('the three controller profiles are vendored with their MIT licence, and only they are listed', () => {
	const list = JSON.parse(fs.readFileSync(path.join(DIR, 'profilesList.json'), 'utf8'));
	assert.deepEqual(Object.keys(list).sort(), PROFILES, 'profilesList.json names the three vendored profiles only');
	for (const id of PROFILES) {
		assert.ok(fs.existsSync(path.join(DIR, list[id].path)), `${id}: its profile.json`);
		for (const hand of ['left', 'right']) {
			const { json } = readGlb(path.join(DIR, id, `${hand}.glb`));
			const outside = [...(json.buffers ?? []), ...(json.images ?? [])].filter((x) => x.uri);
			assert.equal(outside.length, 0, `${id} ${hand}: self-contained (no file or address named inside)`);
		}
	}
	const licence = fs.readFileSync(path.join(DIR, 'LICENSE.md'), 'utf8');
	assert.match(licence, /MIT License/);
	assert.match(licence, /Amazon/);
	const versions = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/VERSIONS.json'), 'utf8'));
	assert.ok(versions['@webxr-input-profiles/assets (controllers)'], 'its version recorded');
	assert.ok(fs.existsSync(path.join(ROOT, 'vendor/three/addons/libs/motion-controllers.module.js')), 'the profiles reader is vendored');
	assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'js/controller-model.js'), 'utf8'), /https?:\/\//, 'nothing loads from a CDN');
});

test('each controller is one draw call, Lambert with an emissive floor, its buttons still moving', () => {
	for (const id of PROFILES) for (const hand of ['left', 'right']) {
		const { b, m, gamepad } = model(id, hand);
		const meshes = [];
		b.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
		assert.equal(meshes.length, 1, `${id} ${hand}: one mesh`);
		assert.ok(meshes[0].isSkinnedMesh && meshes[0].material.isMeshLambertMaterial, 'skinned, Lambert');
		assert.ok(Math.abs(meshes[0].material.emissive.r - LOOK.EMISSIVE) < 1e-6, 'the emissive floor');
		// The trigger's part moves when the trigger is pulled; the body doesn't.
		const trig = b.parts.findIndex((p, i) => m.partButton[i] === 0);
		const body = b.parts.findIndex((p, i) => m.partButton[i] === -1);
		assert.ok(trig >= 0 && body >= 0, `${id} ${hand}: the trigger and the body are parts`);
		// (Each part's vertex furthest from its node's pivot: it moves most when the part turns.)
		const far = (part) => {
			const pivot = new THREE.Vector3().setFromMatrixPosition(part.bone.parent.matrixWorld), v = new THREE.Vector3();
			let best = part.start, d = -1;
			for (let k = part.start; k < part.start + part.count; k++) {
				const dk = v.fromBufferAttribute(b.mesh.geometry.attributes.position, k).distanceTo(pivot);
				if (dk > d) { d = dk; best = k; }
			}
			return best;
		};
		const at = (k) => {
			b.root.updateMatrixWorld(true);
			b.mesh.skeleton.update();
			return b.mesh.applyBoneTransform(k, new THREE.Vector3().fromBufferAttribute(b.mesh.geometry.attributes.position, k));
		};
		m.update(0);
		const kt = far(b.parts[trig]), kb = far(b.parts[body]);
		const t0 = at(kt), body0 = at(kb);
		gamepad.gamepad.buttons[0].value = 1; gamepad.gamepad.buttons[0].pressed = gamepad.gamepad.buttons[0].touched = true;
		m.update(0);
		assert.ok(at(kt).distanceTo(t0) > 0.001, `${id} ${hand}: the trigger moves when pulled (${(at(kt).distanceTo(t0) * 1000).toFixed(1)} mm)`);
		assert.ok(at(kb).distanceTo(body0) < 1e-9, 'the body stays');
	}
});

test('holding a tool: the controller fades to 35% in 0.2 s, its tool\'s buttons glow; put down, it goes', () => {
	const { b, m } = model('oculus-touch-v3', 'right');
	const tint = b.mesh.geometry.attributes.tint;
	const glows = (i) => tint.getX(b.parts[i].start) + tint.getY(b.parts[i].start) > 0;
	m.setLook(LOOK.FADED, ['trigger', 'a']);
	m.update(0.1);
	assert.ok(m.opacity < 1 && m.opacity > LOOK.FADED && b.mesh.material.transparent, 'fading');
	m.update(0.2);
	assert.equal(m.opacity, LOOK.FADED);
	b.parts.forEach((p, i) => assert.equal(glows(i), [0, 4].includes(m.partButton[i]), `part ${p.bone.name}: glows only if the tool uses it`));
	assert.ok(b.parts.some((p, i) => m.partButton[i] === 5 && !glows(i)), 'B does not glow');
	m.setLook(1, []);
	m.update(1);
	assert.ok(!b.mesh.material.transparent && b.parts.every((p, i) => !glows(i)), 'full again, nothing glowing');
	m.setLook(0, []);
	m.update(1);
	assert.equal(b.mesh.visible, false, 'put down: gone');
});

test('the touch point: where the laser\'s line leaves the front of the model', () => {
	const box = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.1));
	const tip = frontAlong(box, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
	assert.ok(Math.abs(tip.z + 0.05) < 1e-6 && Math.abs(tip.x) < 1e-6, 'the front face, on the line');
	assert.equal(frontAlong(box, new THREE.Vector3(0.5, 0, 0), new THREE.Vector3(0, 0, -1)), null, 'a line that misses: none (the default stays)');
	// (Each profile's own line comes from WebXR at run time: measured once per profile and hand, js/xr-input.js updateModels.)
});

test('the orb sits at least 1 cm clear of every model, and the tools at least 4 cm above its ring', () => {
	// The lowest point of a tool in the fan: its lowest part (at its fan size), the outer slots' sag and the bob (js/tool-fan.js place()).
	const drop = Math.max(...[buildCamera(), buildMeter(), buildMarker()].map((g) => -new THREE.Box3().setFromObject(g).min.y * g.userData.fanScale));
	const lowestTool = ABOVE - drop - (0.02 - Math.cos(0.5) * 0.02) - 0.004;
	for (const id of PROFILES) for (const hand of ['left', 'right']) {
		const { b } = model(id, hand);
		const pos = b.probe.geometry.attributes.position, index = b.probe.geometry.index;
		const tri = new THREE.Triangle(), q = new THREE.Vector3();
		let orb = Infinity, top = -Infinity;
		for (let i = 0; i < index.count; i += 3) {
			tri.setFromAttributeAndIndices(pos, index.getX(i), index.getX(i + 1), index.getX(i + 2));
			tri.closestPointToPoint(ORB_ON_GRIP, q);
			orb = Math.min(orb, q.distanceTo(ORB_ON_GRIP));
			top = Math.max(top, tri.a.y, tri.b.y, tri.c.y);
		}
		assert.ok(orb - SIGHT.ORB_R >= 0.01, `${id} ${hand}: the orb (rings included) ${((orb - SIGHT.ORB_R) * 100).toFixed(1)} cm clear`);
		assert.ok(lowestTool - top >= 0.04, `${id} ${hand}: the lowest tool ${((lowestTool - top) * 100).toFixed(1)} cm above the ring`);
	}
});
