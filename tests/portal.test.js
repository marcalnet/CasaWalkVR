// The wall portal (js/portal.js): the shader chunk, the hand portal's timing
// and rules, which materials are cut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../js/optimise.js'; // (installs computeBoundsTree)
import { Portals, PORTAL, portalShader, portalUniforms, handRadius, nearestSurface, eyeOpening } from '../js/portal.js';

const V = (...a) => new THREE.Vector3(...a);
const DT = 1 / 72;

test('the shader chunk goes into a Lambert and a Basic shader once each', () => {
	for (const name of ['lambert', 'basic']) {
		const lib = THREE.ShaderLib[name];
		const s = portalShader({ uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }, portalUniforms());
		for (const [text, where] of [['vCwWorld = (modelMatrix', s.vertexShader], ['uniform vec4 cwPortalHand;', s.fragmentShader], ['if (cwOpen > 0.999) discard;', s.fragmentShader], ['gl_FragColor.a *= max(1.0 - cwOpen, cwRim);', s.fragmentShader]]) {
			assert.equal(where.split(text).length, 2, `${name}: ${text}`);
		}
		assert.ok(s.uniforms.cwPortalHand && s.uniforms.cwPortalHand2 && s.uniforms.cwPortalEye, name);
	}
});

test('the hand portal opens over 0.25 s and closes over 0.4 s', () => {
	assert.equal(handRadius(true, 0, 0), 0);
	assert.ok(handRadius(true, 0, 0.1) > 0.2, 'ease-out: most of it early');
	assert.equal(handRadius(true, 0, PORTAL.HAND_OPEN), PORTAL.HAND_R);
	assert.equal(handRadius(false, PORTAL.HAND_R, 0), PORTAL.HAND_R);
	assert.equal(handRadius(false, PORTAL.HAND_R, PORTAL.HAND_CLOSE), 0);
});

/** A room: a wall facing +z at z = 0 (20 cm thick), a closed door in it, a floor, a sofa sharing the door's material. */
function room() {
	const wallMat = new THREE.MeshLambertMaterial(), doorMat = new THREE.MeshLambertMaterial(), floorMat = new THREE.MeshLambertMaterial();
	const mesh = (geo, mat, userData = {}) => { geo.computeBoundsTree(); const m = new THREE.Mesh(geo, mat); Object.assign(m.userData, userData); return m; };
	const wall = mesh(new THREE.BoxGeometry(6, 2.5, 0.2).translate(0, 1.25, -0.1), wallMat);
	const door = mesh(new THREE.BoxGeometry(0.9, 2.1, 0.05).translate(2, 1.05, 0.02), doorMat, { opening: true });
	const sofa = mesh(new THREE.BoxGeometry(2, 0.8, 0.9).translate(-1, 0.4, 2), doorMat);
	const floor = mesh(new THREE.BoxGeometry(6, 0.02, 6).translate(0, -0.01, 3), floorMat);
	const g = (...c) => { const x = new THREE.Group(); x.add(...c); return x; };
	const layers = { walls: g(wall), main: g(door, sofa), floors: g(floor), ground: g(), ceilings: g() };
	const scene = new THREE.Scene();
	scene.add(...Object.values(layers));
	scene.updateMatrixWorld(true);
	return { layers, scene, wall, door, sofa, floor, wallMat, doorMat, floorMat };
}

/** A pretend experience: walking, one controller whose tip is at `tip`. */
function fakeXR(r, tip) {
	const c = { isController: true, touch: { tracked: true, tip } };
	const played = [], buzzed = [];
	const camera = new THREE.Object3D();
	camera.position.set(0.5, 1.6, 2); camera.updateMatrix(); // (the eyes 2 m from the wall)
	return {
		rig: new THREE.Object3D(), camera,
		eyes(z) { camera.position.z = z; camera.updateMatrix(); },
		mode: 'walk', solid: false, scene: r.scene, modes: { walk: { fade: null } }, layerFx: null,
		input: { controllers: [c] }, c, played, buzzed, block: null,
		aimBlock() { return this.block; },
		sound: { play: (n) => played.push(n) },
		haptics: { play: (_, n) => buzzed.push(n) },
		hideFromPhotos() {},
	};
}
const run = (p, xr, s) => { for (let t = 0; t < s; t += DT) p.update(xr, DT); };

test('which materials are cut: walls and doors; furniture and floors never (a shared material is copied)', () => {
	const r = room();
	const p = new Portals();
	p.setModel(r.layers);
	p.prepare();
	assert.deepEqual(p.meshes, [r.wall, r.door]);
	assert.equal(r.wall.material, r.wallMat, 'the wall keeps its own material');
	assert.notEqual(r.door.material, r.doorMat, 'the door gets its own copy (the sofa shares its material)');
	assert.equal(r.sofa.material, r.doorMat);
	assert.ok(p.hooked.has(r.wall.material) && p.hooked.has(r.door.material) && !p.hooked.has(r.doorMat) && !p.hooked.has(r.floorMat));
	assert.ok(r.wall.material.alphaToCoverage, 'the soft edge: alpha-to-coverage');
	assert.match(r.wall.material.customProgramCacheKey(), /cw-portal$/);
});

test('nearestSurface: the point, the outward normal, behind the face', () => {
	const r = room();
	const s = nearestSurface([r.wall], V(0, 1.2, 0.05), 0.15, { point: V(), normal: V() });
	assert.ok(Math.abs(s.distance - 0.05) < 1e-6 && s.normal.z > 0.99 && !s.behind);
	const inside = nearestSurface([r.wall], V(0, 1.2, -0.03), 0.15, { point: V(), normal: V() });
	assert.ok(inside.behind && inside.normal.z > 0.99, 'a fingertip pushed into the wall');
	assert.equal(nearestSurface([r.wall], V(0, 1.2, 0.5), 0.15, { point: V(), normal: V() }), null);
});

test('a fingertip touching a wall opens a 0.42 m portal in 0.25 s, centred on the touch; pulled back 15 cm, it closes', () => {
	const r = room(), tip = V(0.5, 1.3, 0.02), xr = fakeXR(r, tip), p = new Portals();
	p.setModel(r.layers);
	run(p, xr, 0.3);
	const u = p.uniforms.cwPortalHand.value;
	assert.equal(u.w, PORTAL.HAND_R);
	assert.ok(V(u.x, u.y, u.z).distanceTo(V(0.5, 1.3, -PORTAL.INSET)) < 0.01, JSON.stringify(u));
	assert.deepEqual(xr.played, ['portal']);
	assert.deepEqual(xr.buzzed, ['tick'], 'a controller feels the touch');
	tip.z = 0.1; run(p, xr, 0.2);
	assert.equal(u.w, PORTAL.HAND_R, 'still within 15 cm: open');
	tip.z = 0.3; run(p, xr, 0.45);
	assert.equal(u.w, 0, 'closed');
	assert.deepEqual(xr.played, ['portal'], 'closing is silent');
});

test('no hand portal from a hand at a tool or key, or at the scale model', () => {
	const r = room(), tip = V(0.5, 1.3, 0.02), xr = fakeXR(r, tip), p = new Portals();
	p.setModel(r.layers);
	xr.block = 'tool'; tip.z = 0.5; run(p, xr, 0.1); tip.z = 0.02;
	run(p, xr, 0.3);
	assert.equal(p.uniforms.cwPortalHand.value.w, 0, 'a hand holding a tool');
	xr.block = null; xr.mode = 'dollhouse';
	run(p, xr, 0.3);
	assert.equal(p.uniforms.cwPortalHand.value.w, 0, 'never at the scale model');
});

test('a jump shuts the hand portal at once; a photo sees the walls whole', () => {
	const r = room(), tip = V(0.5, 1.3, 0.02), xr = fakeXR(r, tip), p = new Portals();
	p.setModel(r.layers);
	run(p, xr, 0.3);
	const u = p.uniforms.cwPortalHand.value;
	p.hide();
	assert.equal(u.w, 0, 'hidden for the photo');
	p.show();
	assert.equal(u.w, PORTAL.HAND_R, 'back after it');
	xr.modes.walk.fade = { t: 0 };
	p.update(xr, DT);
	assert.equal(u.w, 0, 'the teleport fade: shut at once');
});

test('the eye portal: none at 0.35 m, opening from 0.30 m, 0.48 m radius at 0.20 m; set at once behind a fade', () => {
	assert.equal(eyeOpening(0.35), 0);
	assert.equal(eyeOpening(0.3), 0);
	assert.ok(eyeOpening(0.29) > 0 && eyeOpening(0.29) < 0.02, 'eased in: a small hole first');
	assert.equal(eyeOpening(0.2), 1);
	const r = room(), xr = fakeXR(r, V(0.5, 1.3, 2)), p = new Portals();
	p.setModel(r.layers);
	const u = p.uniforms.cwPortalEye.value;
	xr.eyes(0.35); p.update(xr, DT);
	assert.equal(u.w, 0, '35 cm: the wall whole');
	xr.eyes(0.25); p.update(xr, DT);
	assert.ok(u.w > 0 && u.w < PORTAL.EYE_R, `25 cm: opening (${u.w})`);
	assert.ok(Math.abs(u.z + PORTAL.INSET) < 1e-6 && Math.abs(u.y - 1.6) < 1e-6, 'centred on the point nearest the eyes, 0.1 m inside');
	xr.eyes(0.2); p.update(xr, DT);
	assert.ok(Math.abs(u.w - PORTAL.EYE_R) < 1e-9, '20 cm: fully open');
	xr.eyes(-0.05); p.update(xr, DT);
	assert.ok(Math.abs(u.w - PORTAL.EYE_R) < 1e-9, 'inside the wall: fully open');
	xr.eyes(2); p.update(xr, DT);
	xr.modes.walk.fade = { t: 0 }; xr.eyes(0.2); p.update(xr, DT);
	assert.ok(Math.abs(u.w - PORTAL.EYE_R) < 1e-9, 'landing next to a wall: already open behind the fade');
	xr.mode = 'dollhouse'; p.update(xr, DT);
	assert.equal(u.w, 0, 'never at the scale model');
});

test('both hands open their own portal; a third touch has none to open; the arc may pass through either', () => {
	const r = room(), tipA = V(0.5, 1.3, 0.02), tipB = V(-1.5, 1.2, 0.02), xr = fakeXR(r, tipA), p = new Portals();
	xr.input.controllers.push({ isController: true, touch: { tracked: true, tip: tipB } });
	p.setModel(r.layers);
	run(p, xr, 0.3);
	const a = p.uniforms.cwPortalHand.value, b = p.uniforms.cwPortalHand2.value;
	assert.equal(a.w, PORTAL.HAND_R); assert.equal(b.w, PORTAL.HAND_R, 'the other hand has its own');
	assert.ok(V(a.x, a.y, a.z).distanceTo(V(b.x, b.y, b.z)) > 1.5, 'two different places');
	assert.equal(p.holes().length, 2);
	tipA.z = 0.4; run(p, xr, 0.5);
	assert.equal(a.w, 0, 'the first closes when its hand leaves'); assert.equal(b.w, PORTAL.HAND_R, 'the second stays');
});
