// The headset experience without a headset (js/xr.js and its parts): built
// in Node with a stand-in renderer and the example home, so the menus, mode
// changes, leaving VR and the tool claims are checked on every `npm test`.
// The emulated headset session (scripts/xr-test.js) checks the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { parseHome, buildHome } from '../js/sh3d.js';
import { prepareObjText } from '../js/formats.js';
import { optimiseModel, unmergedModel } from '../js/optimise.js';
import { readoutText } from '../js/hand-readout.js';
import { devFlags } from '../js/dev.js';
import { FIRST_TIME_CARDS } from '../js/lessons.js';
import { XRExperience } from '../js/xr.js';
import { HOLD } from '../js/xr-tools.js';

const FILE = path.resolve(import.meta.dirname, '../examples/example-home.sh3d');

/** An XRExperience with the example home, a pretend session and two pretend controllers. nomerge: the model as loaded (?nomerge). */
async function setup({ nomerge = false } = {}) {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(FILE)));
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const built = await buildHome(home, { loadModel: async (ref) => new OBJLoader().parse(prepareObjText(new TextDecoder().decode(entries[ref])).replace(/^\s*mtllib.*$/gm, '')) });
	const { group, layers } = nomerge ? unmergedModel(built.root) : optimiseModel(built.root);
	const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(), anchor = new THREE.Group(), centerer = new THREE.Group();
	rig.add(camera); anchor.add(centerer); centerer.add(group); scene.add(rig, anchor);
	camera.position.set(0, 1.6, 0);
	camera.updateMatrixWorld(true);
	let ended = 0;
	const renderer = { xr: { getController: () => new THREE.Group(), getControllerGrip: () => new THREE.Group(), getHand: () => Object.assign(new THREE.Group(), { joints: {} }) } };
	const x = new XRExperience({ renderer, scene, camera, rig, anchor, centerer, onEnd: () => ended++ });
	const b = built.bounds;
	centerer.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
	x.setModel({ group, layers, storeys: built.storeys, storeyNames: built.storeyNames, bounds: b, observer: built.observer, multiLevel: home.storeys.length > 1, plan: built.plan });
	// A pretend session with two controllers (buttons as in the xr-standard mapping).
	x.session = { end: () => x.handleEnd() };
	x.sessionMode = 'ar';
	const pads = {};
	for (const [i, hand] of [[0, 'left'], [1, 'right']]) {
		const c = x.input.controllers[i];
		pads[hand] = { buttons: Array.from({ length: 6 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] };
		c.source = { gamepad: pads[hand], handedness: hand };
		c.handedness = hand;
		c.isController = true;
		x.input.hands[hand] = c;
	}
	x.setMode('dollhouse', { measure: false });
	const BUTTON = { trigger: 0, grip: 1, stick: 3, a: 4, b: 5 };
	const press = (hand, name, v = true) => { pads[hand].buttons[BUTTON[name]].pressed = v; };
	const frame = (dt = 1 / 72) => x.update(dt);
	// Moving between layers takes a few frames (the dive or surface transition).
	const settle = () => { for (let i = 0; i < 120 && x.layerFx; i++) frame(); };
	const go = (id) => { x.menuAction(id); settle(); };
	return { x, ended: () => ended, press, frame, settle, go, hands: x.input.hands };
}

const shape = (rows) => rows.map((r) => r.map((c) => [c.id, c.type, c.label, ...(c.options ?? []).map((o) => o.label)].join(':')).join(' | '));

test('?nomerge (the model as loaded, for debugging): the headset takes it, shadows are set on every mesh, in and back work', async () => {
	const { x, go } = await setup({ nomerge: true });
	const meshes = [];
	x.model.layers.main.traverse((m) => { if (m.isMesh) meshes.push(m); });
	assert.ok(meshes.length > 10 && x.model.layers.main.children.some((c) => !c.isMesh), 'the layers hold the pieces\' groups, not merged meshes');
	assert.ok(meshes.every((m) => m.receiveShadow), 'every mesh, however deep, gets its shadow flags');
	go('in');
	assert.equal(x.mode, 'walk');
	go('back');
	assert.equal(x.mode, 'dollhouse');
});

test('the settings boards: the same tabs at both layers, a Close key, every target big enough to touch', async () => {
	const { x } = await setup();
	for (const p of Object.values(x.menus)) {
		assert.deepEqual(p.tabs.map((t) => t.label), ['View', 'Walk', 'Tools', 'General']);
		assert.equal(p.lead.label, '? How to move', 'the How to move key at the tabs\' left end');
		assert.deepEqual(shape(p.tabs[0].rows), ['light:choice:Time of day:Morning:Noon:Sunset:Night', 'shadows:switch:Shadows | depth:switch:Depth shading',
			'ceilings:switch:Ceilings | view:switch:Passthrough', 'seethrough:switch:Transparent walls']);
		assert.deepEqual(shape(p.tabs[1].rows), ['height:choice:Height:Yours:1.4 m:1.7 m:2.0 m', 'solid:switch:Solid walls']);
		assert.deepEqual(shape(p.tabs[2].rows), ['lens:choice:Camera lens:24 mm:28 mm:35 mm:50 mm']);
		assert.deepEqual(shape(p.tabs[3].rows), ['mainHand:choice:Main hand:Right:Left', 'sound:choice:Sound:Off:Effects']);
		assert.equal(p.actions.length, 0, 'no actions on the board: the doors are on the wrist');
		assert.ok(p.rects().some((r) => r.id === 'close'), 'a Close key');
		assert.ok(!p.get('levels'), 'Levels is not on the board: a stack of keys beside the doors');
		// Touch targets: at least 4 cm (the wing is 40 cm wide).
		const m = p.mesh.geometry.parameters.width / p.size.w;
		for (const r of p.rects()) assert.ok(Math.min(r.w, r.h) * m >= 0.04 - 1e-9, `${r.id} ${r.value ?? ''}: ${(Math.min(r.w, r.h) * m * 100).toFixed(1)} cm`);
	}
	assert.equal(x.menus.dollhouse.title, 'Settings \u00b7 Scale model');
	assert.equal(x.menus.walk.title, 'Settings \u00b7 Inside');
	// Scale-model settings are greyed out inside; the boards are the same size whatever the tab.
	assert.ok(Object.values(x.menus).every((p) => !p.get('figure') && !p.get('photo') && !p.get('recentre') && !p.get('exit')), 'no figure, Photo, Recentre or Exit VR');
	const h = x.menus.dollhouse.size.h;
	for (const tab of ['general', 'walk']) { x.menus.dollhouse.setTab(tab); assert.equal(x.menus.dollhouse.size.h, h, tab); }
	x.menus.dollhouse.setTab('view');
});

test('the wrist menu: ← Back on the left, Settings (and help) in the middle, Walk in → on the right; inside, the flat plate takes the right-hand place', async () => {
	const { keysFor } = await import('../js/wrist-menu.js');
	const doll = keysFor('dollhouse'), inside = keysFor('walk', 'Living room');
	assert.deepEqual(Object.fromEntries(Object.entries(doll).map(([k, v]) => [k, [v.id, v.look, v.label, v.caption ?? '']])), {
		up: ['settings', 'plain', 'Settings', 'and help'], right: ['in', 'filled', 'Walk in \u2192', 'Inside the home'],
		left: ['back', 'outline', '\u2190 Back', 'Leave VR'],
	});
	assert.deepEqual([inside.right.id, inside.right.look, inside.right.label, inside.right.caption], [null, 'flat', 'Inside', 'Living room'], 'inside: the flat plate stays in the right-hand place');
	assert.equal(inside.down, undefined, 'Help is in Settings, not on the wrist');
	assert.deepEqual([inside.left.id, inside.left.caption], ['back', 'Scale model']);
});

test('the wrist menu: an arc over the upper outer side of the orb, frozen once open, closed after 12 s with no finger or laser near a key', async () => {
	const { WRIST } = await import('../js/theme.js');
	const { x, frame, hands } = await setup();
	hands.left.grip.visible = hands.right.grip.visible = true; // (tracked)
	frame();
	const w = x.ui.wrist;
	w.show({ pinned: true });
	for (let i = 0; i < 20; i++) frame();
	assert.ok(w.open && Object.values(w.keys).every((k) => k.out), 'open, every key out');
	// Along the arc, as seen: ← Back, Settings, Walk in →; 50° apart on a 14 cm radius, 7 cm keys (Settings 11 cm long).
	const at = (slot) => w.keys[slot].group.position;
	const ang = (slot) => Math.round(THREE.MathUtils.radToDeg(Math.atan2(at(slot).y, at(slot).x)));
	assert.deepEqual(['left', 'up', 'right'].map(ang), [100, 50, 0]);
	for (const slot of ['left', 'up', 'right']) assert.ok(Math.abs(at(slot).length() - 0.14) < 0.003, slot);
	assert.equal(WRIST.key, 0.07);
	assert.ok(['left', 'up', 'right'].every((s) => at(s).y > -0.03), 'the orb\'s underside stays clear');
	assert.ok(['left', 'up', 'right'].every((s) => at(s).distanceTo(new THREE.Vector3()) > 0.1), 'no key over the orb');
	// Frozen: the cross stays where it opened while the wrist moves.
	const before = w.cross.position.clone();
	x.input.controllers.forEach((c) => c.grip.position.x += 0.2);
	for (let i = 0; i < 5; i++) frame();
	assert.ok(w.open && w.cross.position.distanceTo(before) < 1e-6, 'world-locked');
	// 12 s with no finger within 15 cm of the nearest key and no laser on one: it closes.
	for (let t = 0; t < 11.5; t += 1 / 72) w.update(1 / 72);
	assert.ok(w.open, 'still open at 11.5 s');
	// A fingertip near the nearest key (far from the cross's middle) holds it open.
	const tip = x.input.controllers.find((c) => c !== w.wearer);
	tip.touch.tracked = true; tip.touch.tip.copy(w.keys.right.group.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.1, 0));
	for (let t = 0; t < 3; t += 1 / 72) w.update(1 / 72);
	assert.ok(w.open, 'a finger near the far key: still open');
	tip.touch.tracked = false;
	for (let t = 0; t < 12.5; t += 1 / 72) w.update(1 / 72);
	assert.ok(!w.open, 'closed after 12 s');
});

test('the levels stack beside the doors: one key per level, ground at the bottom, the chosen one filled; one level has none', async () => {
	const { x } = await setup();
	const d = x.modes.dollhouse, key = (i) => d.doors.keys.get(`level${i}`), back = d.doors.keys.get('back');
	assert.equal(d.levelCount, 2, 'the example home has two levels');
	assert.deepEqual([0, 1].map((i) => [key(i).spec.id, key(i).spec.look, key(i).spec.label, key(i).group.visible]), [['level:0', 'plain', 'Ground floor', true], ['level:1', 'chosen', 'First floor', true]], 'the top key means all levels');
	assert.ok(key(0).group.position.y < key(1).group.position.y, 'ground at the bottom');
	assert.ok(key(0).group.position.x < back.group.position.x - 0.1 && Math.abs(key(0).group.position.x - key(1).group.position.x) < 1e-9, 'a stack to the left of ← Back');
	assert.deepEqual([key(0).w, key(0).h], [0.08, 0.04]);
	assert.ok(d.levelTitle.mesh.visible && d.levelTitle.text === 'Levels');
	x.menuAction({ id: 'levels', value: 0 });
	assert.equal(x.maxStorey, 0);
	assert.deepEqual([key(0).spec.look, key(1).spec.look], ['chosen', 'plain'], 'the level chosen is filled');
	x.menuAction({ id: 'levels', value: 1 });
	assert.equal(x.maxStorey, null);
	// A one-level home has no stack.
	x.model.storeys = 1; d.buildLevels();
	assert.ok(d.levelCount === 0 && !key(0).group.visible && !d.levelTitle.mesh.visible);
});

test('the first time inside: a looping hand with its arc and ring, no card; the first teleport ends it and is remembered; 15 s ends it unremembered; 40 s stuck: once more', async (t) => {
	const { loopAt, DEMO } = await import('../js/pinch-demo.js');
	const { writeSetting } = await import('../js/settings.js');
	const store = new Map(); // (Node has no localStorage: a small one for this test)
	globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
	t.after(() => { delete globalThis.localStorage; });
	assert.deepEqual([0, 0.6, 1.5, 2.0, 2.4, 2.9].map((t) => { const m = loopAt(t); return [+m.pinch.toFixed(1), +m.arc.toFixed(1), m.blue]; }),
		[[0, 0, false], [0.2, 0, false], [1, 0.8, false], [1, 1, true], [0.3, 0.3, false], [0, 0, false]], 'one loop: pinch, arc grows, ring blue, hand opens');
	const { x, go, frame } = await setup();
	const demo = x.pinchDemo;
	for (const k of ['lessonWalkControllers', 'lessonWalkHands']) writeSetting(k, false);
	go('in');
	assert.ok(demo.playing && demo.group.visible && !x.lessons.group.visible, 'the loop plays; no lesson card');
	assert.ok(demo.ring.position.distanceTo(x.headWorld()) > 1.4, 'its ring is on the floor ahead');
	const spot = demo.spot.clone(), head = x.headWorld();
	assert.ok(Math.abs(spot.y - head.y + 0.42) < 0.02 && spot.distanceTo(head) < 1.05 && spot.distanceTo(head) > 0.95, 'about 1 m ahead, 25° below the eyes');
	demo.update(0.5); demo.update(0.5);
	assert.ok(demo.state.fade === 1, 'faded in');
	x.lessons.note('teleport');
	for (let i = 0; i < 40; i++) demo.update(1 / 72);
	assert.ok(!demo.playing && !demo.group.visible, 'gone after the first teleport');
	const { readSetting } = await import('../js/settings.js');
	assert.equal(readSetting('lessonWalkControllers') || readSetting('lessonWalkHands'), true, 'remembered');
	// Another visit: not shown again.
	go('back'); go('in');
	assert.ok(!demo.playing, 'not again');
	// Not remembered after only a timeout: 15 s, then it goes; 40 s stuck, once more.
	for (const k of ['lessonWalkControllers', 'lessonWalkHands']) writeSetting(k, false);
	go('back'); go('in');
	assert.ok(demo.playing);
	for (let t = 0; t < 15.6; t += 0.1) demo.update(0.1);
	assert.ok(!demo.playing, '15 s: faded away');
	for (let t = 15.6; t < 40.2; t += 0.1) demo.update(0.1);
	assert.ok(demo.playing, '40 s inside with no teleport: once more');
	for (let t = 0; t < 16; t += 0.1) demo.update(0.1);
	for (let t = 0; t < 60; t += 0.1) demo.update(0.1);
	assert.ok(!demo.playing, 'then never again that visit');
	assert.equal(DEMO.SHOW, 15);
});

test('the tools show waits for you to look at the model, plays above it 15° below the eyes, and opens the fan for 2 s as they land', async () => {
	const { x, frame } = await setup();
	const intro = x.toolsIntro;
	assert.ok(intro.start({ again: true }) && intro.state.waiting, 'waiting for a look');
	x.camera.rotation.x = 0; x.camera.updateMatrixWorld(true);
	assert.ok(!intro.lookingAtModel(), 'looking straight ahead, 38° above the model: not yet');
	intro.update(0.1, () => {});
	assert.ok(intro.state.waiting && !intro.group.visible, 'it waits');
	x.camera.rotation.x = -0.6; x.camera.updateMatrixWorld(true); // (looking down at the model)
	assert.ok(intro.lookingAtModel(), 'the head looks towards the model');
	intro.update(0.1, () => {});
	assert.ok(!intro.state.waiting && intro.group.visible, 'begins once looked at');
	const head = x.headWorld(), p = intro.group.getWorldPosition(new THREE.Vector3());
	assert.ok(Math.abs(p.y - (head.y - 1.3 * Math.sin(THREE.MathUtils.degToRad(15)))) < 0.01, '15° below eye level');
	for (let t = 0; t < 5.2; t += 1 / 72) intro.update(1 / 72, () => {});
	assert.ok(x.fan.force > 0, 'the fan is told to open as they fly');
	intro.stop();
});

test('the tab you left a board on is the one the other board opens on', async () => {
	const { x, go } = await setup();
	x.ui.openMenu();
	x.menu.setTab('walk');
	x.ui.closeMenu();
	go('in');
	x.ui.openMenu();
	assert.equal(x.menu, x.menus.walk);
	assert.equal(x.menu.tab, 'walk');
});

test('Main hand: the wrist menu, the tool fan and the teleport hand flip together, remembered', async () => {
	const { x } = await setup();
	assert.equal(x.ui.wrist.side, 'right');
	x.menuAction({ id: 'mainHand', value: 'left' });
	assert.equal(x.toolFan, 'right');
	assert.equal(x.ui.wrist.side, 'left');
	assert.equal(x.menus.dollhouse.get('mainHand').value, 'left');
	x.menuAction({ id: 'mainHand', value: 'right' });
	assert.equal(x.ui.wrist.side, 'right');
});

test('Sound: off and on, remembered', async () => {
	const { x } = await setup();
	x.menuAction({ id: 'sound', value: 'off' });
	assert.equal(x.soundLevel, 'off');
	assert.equal(x.sound.level, 'off');
	assert.equal(x.menus.walk.get('sound').value, 'off');
	x.menuAction({ id: 'sound', value: 'effects' });
	assert.equal(x.sound.level, 'effects');
});

test('settings keep the board open; the doors move one layer at a time', async () => {
	const { x, ended, go } = await setup();
	const stays = (id, value) => { x.ui.openMenu(); x.menuAction(value === undefined ? id : { id, value }); return x.menu !== null; };
	for (const [id, v] of [['light', 'noon'], ['shadows'], ['depth'], ['ceilings'], ['ceilings'], ['seethrough'], ['seethrough'], ['levels', 0], ['levels', 1], ['view', 'ar'], ['sound', 'effects']]) {
		assert.equal(stays(id, v), true, id);
	}
	assert.equal(x.seeThroughAmount, 0);
	x.menuAction('seethrough');
	assert.equal(x.seeThroughAmount, 0.75, 'See-through is one switch: on is 75%');
	x.menuAction('seethrough');
	assert.equal(x.seeThroughAmount, 0);
	x.menuAction('close');
	assert.equal(x.menu, null, 'the Close key closes the board');
	// In: the scale model → inside (the board closes).
	x.ui.openMenu();
	go('in');
	assert.ok(x.mode === 'walk' && x.menu === null && !x.layerFx);
	for (const [id, v] of [['height', 1.7], ['height', 0], ['solid'], ['solid']]) assert.equal(stays(id, v), true, id);
	x.ui.closeMenu();
	go('in');
	assert.equal(x.mode, 'walk', 'In does nothing inside: you are as deep as it goes');
	// Back: inside → the scale model, then the scale model → leaving VR. No key skips a layer.
	go('back');
	assert.ok(x.mode === 'dollhouse' && ended() === 0);
	go('back');
	assert.ok(x.mode === null && ended() === 1);
});

test('the interface is never in a photo; what the tools make is', async () => {
	const { x } = await setup();
	const hidden = x.photoHidden;
	for (const o of [...Object.values(x.menus).map((p) => p.mesh), x.ui.wrist.cross, x.veil.mesh, x.arrival.mesh, x.ui.welcome.mesh, x.ui.photoNote.mesh, x.modes.walk.arc.dots, x.modes.walk.arc.ring,
		...x.modes.dollhouse.markers, ...x.input.controllers.flatMap((c) => [c.ray, c.grip])]) assert.ok(hidden.has(o), o.name || o.type);
	assert.ok(!hidden.has(x.tools.annotations) && x.tools.annotations.parent === x.centerer, 'measurements and drawings live in model space and show in photos');
});

test('the interface lives on its own layer: the headset shows it, a photo\'s camera does not, lasers still hit it', async () => {
	const { x } = await setup();
	const { INTERFACE_LAYER } = await import('../js/photo.js');
	const board = x.menus.dollhouse.mesh;
	assert.ok(board.layers.isEnabled(INTERFACE_LAYER) && !board.layers.isEnabled(0), 'the board is on the interface layer only');
	assert.ok(x.camera.layers.isEnabled(INTERFACE_LAYER) && x.camera.layers.isEnabled(0), 'the headset sees the model and the interface');
	const photoCamera = new THREE.PerspectiveCamera();
	assert.ok(!board.layers.test(photoCamera.layers), 'a new camera (a photo, the viewfinder) leaves it out');
	assert.ok(x.tools.annotations.layers.test(photoCamera.layers) && x.model.layers.walls.layers.test(photoCamera.layers), 'the model and what the tools made are in photos');
	// Added later under the interface (a ring on a key, a print): moved onto its layer before any photo.
	const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.2), new THREE.MeshBasicMaterial());
	x.ui.wrist.cross.add(ring);
	x.markInterface();
	assert.ok(ring.layers.isEnabled(INTERFACE_LAYER) && !ring.layers.test(photoCamera.layers));
	// A laser still hits the board.
	x.scene.updateMatrixWorld(true);
	board.visible = true;
	const at = board.getWorldPosition(new THREE.Vector3());
	x.raycaster.set(at.clone().add(new THREE.Vector3(0, 0, 1).applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion()))), new THREE.Vector3(0, 0, -1).applyQuaternion(board.getWorldQuaternion(new THREE.Quaternion())));
	x.raycaster.far = 5;
	assert.ok(x.raycaster.intersectObject(board, false).length > 0, 'the laser hits the board');
	board.visible = false;
});

test('leaving VR in the middle of a walk leaves nothing behind', async () => {
	const { x, ended, go, frame } = await setup();
	go('in');
	x.ui.openMenu();
	x.ui.setWelcome(true);
	const c = x.input.controllers[0];
	frame();
	assert.ok(x.ui.wrist.orb.holder, 'the orb is on a wrist');
	const walk = x.modes.walk;
	Object.assign(walk, { tele: { c, via: 'trigger' }, fade: { t: 0, action: () => { throw new Error('a stale teleport ran'); } } });
	walk.arc.dots.visible = true;
	x.veil.set('teleport', 1);
	x.ui.drag = { c, id: 'seethrough' };
	x.photoPending = true;
	x.tools.annotations.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
	x.end();
	assert.deepEqual([x.mode, x.menu, walk.tele, walk.fade, x.ui.drag, x.modes.dollhouse.grab, x.ui.welcomeOn, x.pendingRecentre, x.photoPending], [null, null, null, null, null, null, false, false, false]);
	const shown = [walk.arc.dots, walk.arc.ring, x.veil.mesh, x.ui.photoNote.mesh, x.walkSky, x.showroom, x.stage, x.ui.welcome.mesh, ...x.modes.dollhouse.markers, ...Object.values(x.menus).map((p) => p.mesh)].filter((o) => o.visible);
	assert.deepEqual(shown.map((o) => o.name || o.type), []);
	assert.ok(!x.ui.wrist.orb.group.parent && !x.ui.wrist.orb.holder && !x.ui.wrist.open);
	assert.equal(x.rig.position.length() + x.anchor.position.length() + x.lift, 0);
	assert.ok(x.model.layers.ground.visible && ended() === 1);
	assert.equal(x.tools.annotations.children.length, 0, 'measurements and drawings are cleared');
});

test('going back to the dollhouse while a teleport fades drops the teleport', async () => {
	const { x, press, frame, settle, go, hands } = await setup();
	go('in');
	let jumped = false;
	x.modes.walk.fade = { t: 0, action: () => { jumped = true; } };
	frame();
	assert.ok(x.veil.amount('teleport') > 0 && x.veil.mesh.visible, 'fading out');
	press('right', 'b'); frame(); press('right', 'b', false); frame();
	settle();
	assert.equal(x.mode, 'dollhouse');
	assert.ok(!x.veil.mesh.visible && x.modes.walk.fade === null, 'the view is not left half dark');
	go('in');
	for (let i = 0; i < 30; i++) frame();
	assert.ok(!jumped, 'the old teleport does not run on the next walk');
	assert.ok(hands.right);
});

test('holding the model: rolling the hand from palm down to palm up never turns or jumps it', async () => {
	const { x, press, frame, hands } = await setup();
	const d = x.modes.dollhouse, grip = hands.right.grip;
	grip.position.set(0.1, 1.0, -0.4); grip.rotation.set(0, 0, 0);
	frame();
	press('right', 'grip'); frame();
	const yaw0 = d.doll.yaw;
	let last = yaw0, worst = 0;
	// A roll about the hand's forward axis, and a pitch, each through 200°, a step a frame.
	for (const axis of ['z', 'x']) {
		for (let i = 0; i <= 100; i++) {
			grip.rotation.set(0, 0, 0); grip.rotation[axis] = THREE.MathUtils.degToRad(2 * i);
			frame();
			worst = Math.max(worst, Math.abs(d.doll.yaw - last)); last = d.doll.yaw;
		}
	}
	assert.ok(worst < THREE.MathUtils.degToRad(1), `largest turn in one frame: ${THREE.MathUtils.radToDeg(worst).toFixed(1)}°`);
	assert.ok(Math.abs(d.doll.yaw - yaw0) < THREE.MathUtils.degToRad(2) && d.level(), 'no turn about the vertical, still level');
	press('right', 'grip', false); frame();
});

test('the plinth faces where you look, even looking straight down or up', async () => {
	const { headHeading } = await import('../js/xr-dollhouse.js');
	const m = (pitch, yaw) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
	for (const yaw of [0, 1, -2.5]) for (const pitch of [0, -0.8, -Math.PI / 2 + 1e-4, -Math.PI / 2, 0.8, Math.PI / 2]) {
		const h = headHeading(m(pitch, yaw));
		assert.ok(Math.abs(Math.atan2(Math.sin(h - yaw), Math.cos(h - yaw))) < 1e-3, `pitch ${pitch.toFixed(2)}, yaw ${yaw}: got ${h.toFixed(3)}`);
	}
});

test('back from inside: the plinth in front of where you now stand and look, the model level on it, its zoom and turn kept', async () => {
	const { x, frame, go } = await setup();
	const d = x.modes.dollhouse;
	d.doll.zoom = 1.5; d.doll.yaw = 0.7; d.apply();
	go('in');
	// Inside, you walked 1 m to the side and turned round to face behind you.
	x.camera.position.set(1, 1.6, 0.5);
	x.camera.rotation.set(0, Math.PI * 0.9, 0);
	x.camera.updateMatrix();
	for (let i = 0; i < 5; i++) frame();
	go('back');
	assert.equal(x.mode, 'dollhouse');
	const st = x.stage;
	assert.ok(Math.abs(st.position.x - 1) < 1e-6 && Math.abs(st.position.z - 0.5) < 1e-6, 'the room stands where you stand');
	assert.ok(Math.abs(st.rotation.y - Math.PI * 0.9) < 1e-6, 'and faces where you look');
	assert.ok(d.level() && Math.abs(d.doll.pos.z + x.plinthDistance) < 1e-6 && Math.abs(d.doll.pos.x) < 1e-6, 'the model level, on the plinth');
	assert.ok(Math.abs(d.doll.zoom - 1.5) < 1e-6 && Math.abs(d.doll.yaw - 0.7) < 1e-6, 'its zoom and turn kept');
	x.camera.position.set(0, 0, 0); x.camera.rotation.set(0, 0, 0); x.camera.updateMatrix();
});

test('a held tool owns its hand\'s trigger, grip and A; the other hand and the menu keep theirs', async () => {
	const { x, press, frame, hands } = await setup();
	const got = [];
	const tool = { name: 'test', object: new THREE.Group(), trigger: (c, e) => got.push(`trigger ${e}`), secondary: (c, e) => got.push(`A ${e}`), putBack: () => got.push('back'), clear: () => got.push('clear') };
	x.tools.add(tool);
	assert.ok(x.photoHidden.has(tool.object), 'a tool is never in a photo');
	x.tools.take(tool, hands.right);
	// The right trigger goes to the tool: no step inside, whatever it points at.
	press('right', 'trigger'); frame();
	assert.equal(hands.right.claim.trigger, 'tool');
	assert.ok(!hands.right.line.visible && hands.left.line.visible, 'the hand holding a tool has no laser');
	press('right', 'trigger', false); frame();
	assert.deepEqual(got.splice(0), ['trigger down', 'trigger up']);
	assert.equal(x.mode, 'dollhouse');
	// A: a short press, then a long one (clear all).
	press('right', 'a'); frame(); press('right', 'a', false); frame();
	assert.ok(x.menu === null && !x.ui.wrist.open, 'A belongs to the tool, not the menu');
	press('right', 'a');
	for (let t = 0; t < HOLD + 0.1; t += 0.05) frame(0.05);
	press('right', 'a', false); frame();
	assert.deepEqual(got.splice(0), ['A press', 'A hold']);
	// X does nothing (the menu is on the right wrist); the other hand touching the orb opens it.
	press('left', 'a'); frame(); press('left', 'a', false); frame();
	assert.ok(!x.ui.wrist.open, 'X: not the menu wrist');
	x.rig.updateMatrixWorld(true);
	hands.left.grip.position.copy(x.rig.worldToLocal(x.ui.wrist.orb.group.getWorldPosition(new THREE.Vector3()))); // (the grip lives in the rig)
	frame();
	assert.ok(x.ui.wrist.open, 'the left controller touching the orb on the right wrist opens the menu');
	assert.equal(hands.left.claim.trigger, null);
	hands.left.grip.position.set(-0.3, 1, -0.3);
	frame();
	x.ui.closeAll();
	// Leaving VR puts it back and clears what it made.
	x.end();
	assert.deepEqual(got, ['back', 'clear']);
	assert.equal(x.tools.held, null);
});

test('mirrored: a tool in the left hand has Y as its second button', async () => {
	const { x, press, frame, go, hands } = await setup();
	const got = [];
	// (Y already held down when the tool is taken: that press is not the tool's.)
	press('left', 'b'); frame();
	x.tools.take({ secondary: (c, e) => got.push(e), controls: ['stickPress', 'nonsense'] }, hands.left);
	frame(); press('left', 'b', false); frame();
	assert.deepEqual(got, [], 'a press already under way when taking a tool does nothing');
	press('left', 'b'); frame(); press('left', 'b', false); frame();
	assert.deepEqual(got, ['press']);
	assert.equal(hands.left.claim.stickPress, 'tool', 'the marker owns its stick press');
	go('in');
	x.ui.openMenu();
	frame();
	assert.ok(!hands.left.line.visible && hands.right.line.visible, 'walking with the board open: still no laser on the tool hand');
	x.ui.closeMenu();
	assert.equal(hands.left.claim.b, 'tool');
	press('right', 'a'); frame(); press('right', 'a', false); frame();
	assert.ok(x.ui.wrist.open && x.ui.wrist.pinned, 'A opens the wrist menu, pinned');
});

test('the doors at the scale model: a big Walk in →, a small ← Back on its left; Walk in goes inside', async () => {
	const { x, go, frame, settle } = await setup();
	const d = x.modes.dollhouse.doors;
	const back = d.keys.get('back'), inn = d.keys.get('in');
	assert.deepEqual([back.spec.id, back.spec.look, inn.spec.id, inn.spec.look], ['back', 'outline', 'in', 'filled']);
	x.stage.updateMatrixWorld(true);
	const at = (k) => k.group.getWorldPosition(new THREE.Vector3());
	assert.ok(at(back).x < at(inn).x, 'Back on the left of Walk in');
	assert.ok(Math.min(inn.w, inn.h, back.w, back.h) >= 0.07, 'big enough to touch');
	assert.ok(inn.w >= 2 * back.w && back.h === inn.h, 'Walk in is the big one; Back half as long or less, the same height');
	assert.ok(at(inn).x - inn.w / 2 - (at(back).x + back.w / 2) >= 0.02, 'apart');
	// The laser presses it like any key: Walk in goes inside, as the wrist menu's does.
	assert.equal(d.press(inn, null).id, 'in');
	go('in');
	assert.equal(x.mode, 'walk');
	assert.ok(!x.stage.visible, 'inside, the plinth and its doors are gone');
	frame(); settle();
});

test('Help opens the board on How to move (for the input in hand, here, with the build at its foot); Help again closes it', async () => {
	const { x, frame } = await setup();
	frame();
	x.menuAction('help');
	assert.ok(x.ui.guide && x.ui.guide.mesh.visible && !x.menu, 'the left wing, How to move; Settings stays shut');
	const cell = x.ui.guide.cells.get('guide');
	assert.equal(cell.kind, 'dollhouse-controllers');
	assert.match(cell.foot, /^Build /);
	x.menuAction('help');
	assert.equal(x.ui.guide, null, 'Help again: closed');
});

test('the plinth doors fade out while the board is open, take no presses, and come back', async () => {
	const { x, frame } = await setup();
	const d = x.modes.dollhouse;
	frame();
	x.ui.openMenu();
	for (let i = 0; i < 20; i++) frame();
	assert.ok(!d.doorGroup.visible && d.doorAlpha === 0, 'gone while the board is open');
	x.ui.closeAll();
	for (let i = 0; i < 20; i++) frame();
	assert.ok(d.doorGroup.visible && d.doorAlpha === 1, 'back once it closes');
});

test('a session\'s first Settings opens How to move with it, until a teleport; afterwards How to move opens from its own key; the tab you left is kept', async () => {
	const { x } = await setup();
	x.ui.openMenu();
	assert.ok(x.menu && x.ui.guide, 'the first Settings of a session: both wings');
	assert.equal(x.menu.tab, 'view');
	x.menu.setTab('walk'); x.ui.toggleBoard();
	assert.ok(!x.menu && !x.ui.guide, 'Settings on the wrist closes both');
	x.ui.openMenu();
	assert.ok(x.menu && !x.ui.guide, 'the second time: only Settings');
	assert.equal(x.menu.tab, 'walk', 'the tab you left');
	x.menuAction('guideKey');
	assert.ok(x.ui.guide, 'the How to move key opens the left wing');
	x.menuAction('closeGuide');
	assert.ok(x.menu && !x.ui.guide, 'its Close key closes only that wing');
	x.ui.closeAll();
	x.ui.reset(); // (a new session)
	x.ui.onTeleport();
	x.ui.openMenu();
	assert.ok(x.menu && !x.ui.guide, 'after a teleport, even a new session\'s first Settings opens alone');
	x.ui.closeAll();
});

test('holding the model: it follows the grip, level (turned only about the vertical); let go in the air it floats, then goes home by itself', async () => {
	const { x, press, frame, hands } = await setup();
	const d = x.modes.dollhouse;
	const home = new THREE.Vector3(0, d.doll.pos.y, -x.plinthDistance); // (the middle of the plinth)
	const grip = hands.right.grip;
	grip.position.set(0.1, 1.0, -0.4);
	frame();
	press('right', 'grip'); frame();
	assert.ok(d.grab && d.grab.kind === 'controller', 'a grip held anywhere holds it');
	// Lift it 40 cm, tilt the hand 40° and turn it 30°: the model follows, smoothed, level, turned 30°.
	const yaw0 = d.doll.yaw;
	grip.position.y += 0.4;
	for (let i = 1; i <= 30; i++) { grip.rotation.set(THREE.MathUtils.degToRad(40 * i / 30), THREE.MathUtils.degToRad(30 * i / 30), 0, 'YXZ'); frame(); } // (over 0.4 s, as a hand turns)
	for (let i = 0; i < 60; i++) frame();
	assert.ok(d.doll.pos.y > home.y + 0.3, 'lifted');
	assert.ok(d.level(), 'never tilted');
	assert.ok(Math.abs(THREE.MathUtils.radToDeg(d.doll.yaw - yaw0) - 30) < 1, 'turned with the hand about the vertical');
	grip.rotation.set(0, 0, 0);
	press('right', 'grip', false); frame();
	assert.ok(!d.grab && d.floating, 'let go in the air: it floats');
	// A controller near it (within 30 cm) keeps it waiting.
	for (let i = 0; i < 72 * 5; i++) frame();
	assert.ok(d.floating && !d.floating.going, 'a hand near it: it waits');
	// Hands away: 4 s, then the glide home (0.8 s), level again.
	grip.position.set(2, 0, 2);
	hands.left.grip.position.set(-2, 0, 2);
	for (let i = 0; i < 72 * 3.5; i++) frame();
	assert.ok(d.floating && !d.floating.going, 'still counting down');
	for (let i = 0; i < 72 * 2; i++) frame();
	assert.equal(d.floating, null, 'home');
	assert.ok(d.doll.pos.distanceTo(home) < 1e-6 && d.level(), 'back in its place, level');
	// Taking hold again while it floats cancels the return.
	grip.position.set(0.1, 1.0, -0.4); frame();
	press('right', 'grip'); frame();
	grip.position.y += 0.4;
	for (let i = 0; i < 30; i++) frame();
	press('right', 'grip', false); frame();
	assert.ok(d.floating);
	press('right', 'grip'); frame();
	assert.ok(d.grab && !d.floating, 'touched again: the countdown stops');
});

test('the doors at the scale model: ← Back is held 0.6 s; let go early, nothing', async () => {
	const { x, ended, press, frame, settle, hands } = await setup();
	const d = x.modes.dollhouse;
	frame();
	// Points the right controller's laser at a door, from 40 cm in front of it.
	const aimAt = (slot) => {
		const k = d.doors.keys.get(slot);
		x.scene.updateMatrixWorld(true);
		const at = k.face.getWorldPosition(new THREE.Vector3());
		const n = new THREE.Vector3(0, 0, 1).transformDirection(k.face.matrixWorld);
		const from = at.clone().addScaledVector(n, 0.4);
		const ray = hands.right.ray;
		ray.position.copy(x.rig.worldToLocal(from.clone()));
		ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), at.clone().sub(from).normalize());
		ray.updateMatrixWorld(true);
	};
	aimAt('back');
	press('right', 'trigger'); for (let i = 0; i < 25; i++) frame(); // 0.35 s
	press('right', 'trigger', false); for (let i = 0; i < 10; i++) frame();
	assert.ok(x.mode === 'dollhouse' && ended() === 0 && !x.layerFx, 'let go early: nothing');
	press('right', 'trigger'); for (let i = 0; i < 50; i++) frame(); // 0.7 s
	assert.ok(x.layerFx?.dir === 'out', 'held 0.6 s: leaving VR');
	press('right', 'trigger', false); settle();
	assert.equal(ended(), 1);
});

test('Walk in on the plinth: the laser presses it on letting go over it', async () => {
	const { x, press, frame, settle, hands } = await setup();
	const d = x.modes.dollhouse;
	frame();
	const k = d.doors.keys.get('in');
	x.scene.updateMatrixWorld(true);
	const at = k.face.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(0, 0, 1).transformDirection(k.face.matrixWorld);
	const from = at.clone().addScaledVector(n, 0.4), ray = hands.right.ray;
	ray.position.copy(x.rig.worldToLocal(from.clone()));
	ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), at.clone().sub(from).normalize());
	// A pull straight away (the laser just arrived, aimed through the door at the model): nothing.
	press('right', 'trigger'); frame(); press('right', 'trigger', false); frame();
	assert.equal(x.mode, 'dollhouse', 'a laser that only passes over the door never presses it');
	for (let i = 0; i < 15; i++) frame(); // (resting on it 0.2 s)
	press('right', 'trigger'); frame(); frame();
	assert.equal(x.mode, 'dollhouse', 'not on the trigger going down');
	press('right', 'trigger', false); frame(); settle();
	assert.equal(x.mode, 'walk', 'on letting go over it');
});

test('the first-time cards are off for now: no lesson card, no welcome card, at the scale model or inside', async () => {
	const { x, go } = await setup();
	assert.equal(FIRST_TIME_CARDS.on, false);
	x.setMode('dollhouse');
	x.ui.setWelcome(true);
	assert.ok(x.lessons.place === null && !x.lessons.group.visible && !x.ui.welcome.mesh.visible, 'scale model: nothing');
	go('in');
	assert.ok(x.lessons.place === null && !x.lessons.group.visible, 'inside: nothing');
});

test('the first-time lessons (switched off for now; kept working): steps tick off in order; stepping inside starts the next; controllers skip the hand-only step', async (t) => {
	FIRST_TIME_CARDS.on = true;
	t.after(() => { FIRST_TIME_CARDS.on = false; });
	const { x, go } = await setup();
	const L = x.lessons;
	assert.equal(L.place, 'scale', 'shown at the scale model on entry');
	assert.equal(L.kind, 'controllers');
	assert.deepEqual(L.steps().map((s) => s.id), ['start', 'menu', 'tools', 'hold', 'inside'], 'the ready pose is for bare hands only');
	assert.ok(L.words(L.steps()[2]).includes('left controller'), 'the sides filled in: the fan on the left');
	assert.ok(!x.ui.welcome.mesh.visible, 'it replaces the welcome card');
	assert.equal(L.current().id, 'start');
	L.note('held'); // done early: counts, but Start is still the step to do
	assert.equal(L.current().id, 'start');
	assert.ok(!L.canClose(), 'Got it waits for the steps that must not be missed');
	L.note('start'); L.note('wrist');
	assert.ok(!L.canClose(), 'the tools step must be done too');
	L.note('fan');
	assert.ok(L.canClose());
	assert.equal(L.current().id, 'inside');
	go('in');
	assert.equal(L.place, 'walk', 'inside: the next lesson');
	assert.equal(L.current().id, 'arc');
	L.note('arc'); L.note('teleport'); L.note('turn');
	assert.equal(L.place, 'walk', 'the last step has no gesture: it waits for Got it');
	assert.ok(L.keys.keys.get('close'), 'the card has its own Close key');
	assert.ok(L.canClose());
	L.finish();
	assert.equal(L.place, null);
});

test('the fan shows the camera from the front, the meter and the marker from the side, each with a name tag', async () => {
	const { x } = await setup();
	const by = Object.fromEntries(x.fan.slots.map((s) => [s.name, s]));
	assert.equal(by.camera.pose.rotation.y, Math.PI, 'camera: lens towards you');
	assert.equal(by.meter.pose.rotation.y, Math.PI / 2, 'meter: side on');
	assert.equal(by.marker.pose.rotation.y, Math.PI / 2, 'marker: side on');
	assert.deepEqual(x.fan.slots.map((s) => s.label.text), ['Camera', 'Meter', 'Marker']);
	assert.ok(x.fan.slots.every((s) => s.label.mesh.parent === s.home && s.object.parent === s.pose), 'tags beside the tools, tools in their pose');
});

test('the tool fan: opens over the raised left hand in view; the right tip touches a tool, the grip takes it, swaps, puts back', async () => {
	const { x, press, frame, hands } = await setup();
	const fan = x.fan;
	x.lessons.stop();
	// The left controller held up in front of you, the right one down at your side.
	hands.left.grip.visible = hands.right.grip.visible = true; // (tracked)
	hands.left.grip.position.set(-0.1, 1.3, -0.45);
	hands.right.grip.position.set(0.3, 0.8, 0);
	for (let i = 0; i < 20; i++) frame();
	assert.ok(fan.group.visible && fan.alpha === 1, 'open: the left hand raised, in view');
	// The right controller's tip on the meter.
	const tipTo = (name) => {
		const s = fan.slots.find((s) => s.name === name);
		const at = s.home.getWorldPosition(new THREE.Vector3());
		// (the tip is 4.5 cm in front of the grip, in its own space: put the grip so the tip lands on the tool)
		hands.right.grip.position.copy(x.rig.worldToLocal(at.clone().add(new THREE.Vector3(0, 0.01, 0.045))));
		hands.right.grip.rotation.set(0, 0, 0);
	};
	tipTo('meter'); frame(); frame();
	assert.equal(fan.hot?.name, 'meter', 'touched: it lifts');
	const doll = x.modes.dollhouse;
	press('right', 'grip'); frame();
	press('right', 'grip', false); frame();
	assert.equal(x.tools.held?.tool.name, 'meter', 'the grip takes it');
	assert.ok(!doll.grab, 'a squeeze that takes a tool never grabs the model');
	// Swap: the marker, the same way.
	tipTo('marker'); frame(); frame();
	press('right', 'grip'); frame(); press('right', 'grip', false); frame();
	assert.equal(x.tools.held?.tool.name, 'marker', 'taking another swaps them');
	assert.equal(fan.slots.find((s) => s.name === 'meter').held, false, 'the meter is back in its place');
	// The street camera (milestone D): taken like the others; its trigger is the shutter.
	tipTo('camera'); frame(); frame();
	press('right', 'grip'); frame(); press('right', 'grip', false); frame();
	assert.equal(x.tools.held?.tool.name, 'camera', 'the camera is taken too');
	let shots = 0;
	x.capturePhoto = (o) => { shots++; assert.ok(o.width / o.height === 1.5 && Math.abs(o.fov - 46.4) < 0.1, '3:2, 28 mm'); };
	press('right', 'trigger'); frame(); press('right', 'trigger', false); frame();
	assert.equal(shots, 1, 'the trigger is the shutter');
	x.menuAction({ id: 'lens', value: 50 });
	assert.ok(Math.abs(x.fan.camera.view.fov - 27) < 0.1, 'the lens setting: 50 mm');
	// A squeeze away from the fan puts the held tool back.
	hands.right.grip.position.set(0.3, 0.8, 0); frame(); frame();
	press('right', 'grip'); frame(); press('right', 'grip', false); frame();
	assert.equal(x.tools.held, null, 'put back');
	// Hand lowered: the fan fades out.
	hands.left.grip.position.set(-0.3, 0.7, 0);
	for (let i = 0; i < 30; i++) frame();
	assert.ok(!fan.group.visible, 'closed: the hand lowered');
});

test('bare hands, Quest 2: a pinch held aims; opening it on white goes nowhere; a hand holding a tool never aims', async () => {
	const { x, go } = await setup();
	go('in');
	const c = x.input.hands.right;
	c.isHand = true; c.isController = false; // (this entry plays a bare hand)
	c.gesture = { shape: { pinchAt: new THREE.Vector3(0.25, 1.15, -0.35) } }; // (palm down, chest height, in front)
	x.input._gh = [c]; // (this frame's bare hands)
	c.touch.tracked = true;
	const tool = { name: 'test', object: new THREE.Group(), trigger: () => {} };
	x.tools.take(tool, c);
	c.gestures = [{ type: 'pinch' }];
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele, null, 'the hand holding a tool never aims');
	assert.equal(x.aimBlock(c, c.gesture.shape.pinchAt), 'tool');
	x.tools.putBack();
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele?.via, 'hand', 'with no tool in that hand, the pinch aims');
	c.gestures = [];
	x.modes.walk.handMoves(1 / 72);
	const at = x.rig.position.clone();
	c.gestures = [{ type: 'pinchEnd' }];
	x.modes.walk.handMoves(1 / 72);
	assert.ok(x.modes.walk.tele === null && !x.modes.walk.fade && x.rig.position.equals(at), 'let go before the ring is blue: nothing moves');
	// Dropped below the waist while aiming: cancelled.
	c.gestures = [{ type: 'pinch' }];
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele?.via, 'hand');
	c.gesture.shape.pinchAt.y = x.headWorld().y - 1;
	c.gestures = [];
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele, null, 'the hand dropped: cancelled');
	// The wrist menu open: a pinch is not a teleport.
	c.gesture.shape.pinchAt.y = 1.15;
	x.ui.wrist.open = true;
	c.gestures = [{ type: 'pinch' }];
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele, null, 'the wrist menu is open: no aim');
	x.ui.wrist.open = false;
});

test('a pinch within 15 cm of a door\'s face is the door\'s, not a teleport; further away it may aim', async () => {
	const { x } = await setup();
	const d = x.modes.dollhouse, k = d.doors.keys.get('in');
	x.scene.updateMatrixWorld(true);
	const at = (z, y = 0) => k.group.localToWorld(new THREE.Vector3(0, y, z));
	assert.ok(d.doors.near(at(0.1), 0.15), '10 cm in front of Walk in →');
	assert.ok(!d.doors.near(at(0.2), 0.15), '20 cm in front: free');
	assert.ok(!d.doors.near(at(0.05, 0.25), 0.15), '25 cm above its middle (20 cm above its edge): free');
	assert.equal(x.aimBlock({ index: 1 }, at(0.1)), 'key');
});

test('the veil round the eyes: the strongest request shows; a flash during a fade never lightens it', async () => {
	const { x } = await setup();
	const v = x.veil;
	v.set('teleport', 0.6);
	v.set('flash', 0.3, 0xffffff);
	assert.ok(v.mesh.visible && v.mesh.material.opacity === 0.6 && v.mesh.material.color.getHex() === 0x000000, 'the darker fade wins');
	v.set('teleport', 0);
	assert.ok(v.mesh.material.opacity === 0.3 && v.mesh.material.color.getHex() === 0xffffff, 'the flash, alone');
	v.set('flash', 0);
	assert.ok(!v.mesh.visible, 'nothing asked: nothing shown');
	let spheres = 0;
	x.camera.traverse((o) => { if (o.isMesh && o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius < 1) spheres++; }); // (the walk sky is a sphere too, far out)
	assert.equal(spheres, 1, 'one sphere round the eyes');
});

test('the safety net: an error in a frame shows the card; errors every frame end the session', async () => {
	const { x, ended } = await setup();
	x.safety.begin(); x.safety.log = () => {};
	const real = x.modes.dollhouse.update;
	x.modes.dollhouse.update = () => { throw new Error('boom'); };
	x.frame(1 / 72);
	assert.ok(x.ui.errorNote.mesh.visible, 'the card shows');
	for (let i = 0; i < 300 && !ended(); i++) x.frame(1 / 72);
	assert.equal(ended(), 1, 'the session ended');
	assert.ok(x.safety.failed && x.safety.lastError.message === 'boom');
	assert.ok(!x.ui.errorNote.mesh.visible, 'nothing left showing after the end');
	x.modes.dollhouse.update = real;
});

test('Meta\'s menu over the app: no input is read, a held model is let go', async () => {
	const { x, press, frame, hands } = await setup();
	const d = x.modes.dollhouse;
	hands.right.grip.position.set(0.1, 1.0, -0.4);
	frame(); press('right', 'grip'); frame();
	assert.ok(d.grab);
	x.setHidden(true);
	assert.ok(!d.grab, 'let go (over the plinth: it settles)');
	press('right', 'grip', false); frame(); press('right', 'grip'); frame();
	assert.ok(!d.grab, 'a grip behind the menu holds nothing');
	x.setHidden(false);
	press('right', 'grip', false); frame(); press('right', 'grip'); frame();
	assert.ok(d.grab, 'shown again: input works');
});

test('Meta\'s menu over the app: nothing of yours stays drawn frozen (hands, controllers, orb, tools, wrist menu, fan), vibration stops', async () => {
	const { x, frame } = await setup();
	let stopped = 0;
	const stop = x.haptics.stop.bind(x.haptics);
	x.haptics.stop = () => { stopped++; stop(); };
	frame();
	x.ui.wrist.open = true; x.fan.group.visible = true;
	for (const v of x.handViews) v.group.visible = true;
	x.setHidden(true);
	frame();
	assert.ok(stopped > 0, 'the vibration stopped');
	assert.ok(!x.ui.wrist.open, 'the wrist menu closed');
	assert.ok(!x.fan.group.visible, 'the fan hidden');
	assert.ok(x.handViews.every((v) => !v.group.visible), 'hands hidden');
	assert.ok(x.input.controllers.every((c) => !c.ray.visible && !c.grip.visible && !c.wrist.visible), 'controllers, their orb and tools hidden');
	x.setHidden(false);
	frame();
	assert.ok(x.input.controllers.every((c) => c.ray.visible && c.grip.visible && c.wrist.visible), 'back again');
});

test('the safety net: an error during a move between layers ends the session cleanly', async () => {
	const { x, ended } = await setup();
	x.safety.begin(); x.safety.log = () => {};
	x.goLayer('in', () => { throw new Error('half-way in'); });
	for (let i = 0; i < 300 && !ended(); i++) x.frame(1 / 72);
	assert.equal(ended(), 1, 'the session ended');
	assert.equal(x.safety.lastError.message, 'half-way in');
});

test('the development switches (js/dev.js) and the ?hands readout: only with ?hands; palm angle, pinch, and ready, aiming or what blocks it', async () => {
	const f = devFlags('?x=1&hands&plinth=10');
	assert.ok(f.hands && !f.stats && !f.test && !devFlags('').hands && !devFlags('?nomerge').hands);
	const { x, go } = await setup();
	go('in');
	const c = x.input.hands.right;
	c.isHand = true; c.isController = false;
	const eye = x.headWorld().y;
	c.gesture = { shape: { normal: new THREE.Vector3(0, -1, 0), pinch: 0.012, pinchAt: new THREE.Vector3(0.2, eye - 0.45, -0.35) } };
	assert.match(readoutText(x, c), /^R · palm \d+° to eyes · pinch 1\.2 cm · pinched$/, 'palm down, pinched: it would aim');
	c.gesture.shape.pinch = 0.05;
	assert.match(readoutText(x, c), /· ready: pinch$/);
	c.gesture.shape.pinch = 0.012;
	c.gesture.shape.normal.copy(x.headWorld().sub(c.gesture.shape.pinchAt).normalize()); // (the palm straight at the eyes)
	assert.match(readoutText(x, c), /palm 0° to eyes .* palm towards you$/);
	c.gesture.shape.pinchAt.y = eye - 1;
	c.gesture.shape.normal.set(0, -1, 0);
	assert.match(readoutText(x, c), /below the waist$/);
	c.gesture.shape.pinchAt.y = eye - 0.45;
	x.ui.wrist.open = true;
	assert.match(readoutText(x, c), /blocked: wrist menu$/);
	x.ui.wrist.open = false;
	x.modes.walk.tele = { c, via: 'hand' };
	assert.match(readoutText(x, c), /aiming$/);
	x.modes.walk.tele = null;
});

test('the laser meter: two triggers measure a line in model space; A undoes, holding A clears', async () => {
	const { x, frame } = await setup();
	const meter = x.fan.meter, c = x.input.hands.right;
	x.tools.take(meter, c);
	frame();
	// Where the dot is (in the world), at the scale model's zoom: 1.6 m apart in the home.
	const s = x.anchor.scale.x;
	const at = (mx) => x.centerer.localToWorld(new THREE.Vector3(mx, 0.75, 0));
	meter.hit = at(0); meter.trigger(c, 'down');
	meter.hit = at(1.6); meter.trigger(c, 'down');
	assert.equal(meter.m.lines.length, 1);
	assert.equal(meter.m.lines[0].label, '1.60 m', 'real metres, whatever the zoom');
	assert.ok(s < 0.2, 'the scale model is small');
	assert.ok(x.tools.annotations.getObjectByName('measurements'), 'drawn in model space');
	meter.secondary(c, 'press');
	assert.equal(meter.m.lines.length, 0, 'A: undo');
	meter.hit = at(0); meter.trigger(c, 'down'); meter.hit = at(1); meter.trigger(c, 'down');
	meter.hit = at(2); meter.trigger(c, 'down'); meter.hit = at(3); meter.trigger(c, 'down');
	meter.secondary(c, 'hold');
	assert.equal(meter.m.lines.length + meter.marks.length, 0, 'hold A: clear all');
	meter.hit = null; meter.trigger(c, 'down');
	assert.equal(meter.m.pending, null, 'pointing at nothing: no point');
	x.tools.putBack();
});

test('the marker: hold the trigger and move to draw; the stick press changes colour; A undoes', async () => {
	const { x, press, frame, hands } = await setup();
	const marker = x.fan.marker, c = hands.right;
	c.grip.position.set(0.2, 1.2, -0.4);
	frame();
	x.tools.take(marker, c);
	frame();
	press('right', 'trigger'); frame();
	for (let i = 0; i < 30; i++) { c.ray.position.x -= 0.01; frame(); } // (a controller carries its tool along its pointing ray)
	press('right', 'trigger', false); frame();
	assert.equal(marker.strokes.length, 1, 'one stroke');
	assert.ok(marker.strokes[0].n > 5, `drawn along the way: ${marker.strokes[0].n} points`);
	press('right', 'stick'); frame(); press('right', 'stick', false); frame();
	assert.equal(marker.ink, 1, 'the stick press: blue');
	press('right', 'a'); frame(); press('right', 'a', false); frame();
	assert.equal(marker.strokes.length, 0, 'A: undo');
	x.tools.putBack();
});

test('Vision Pro look-and-pinch: a pinch on a room steps inside; inside, on the floor, teleports; never leaves VR by the held door', async () => {
	const { act } = await import('../js/transient-pointer.js');
	const { x, ended, frame, settle } = await setup();
	frame();
	const head = x.headWorld();
	// ← Back on the plinth needs a hold: a single pinch on it does nothing.
	const back = x.modes.dollhouse.doors.keys.get('back').face.getWorldPosition(new THREE.Vector3());
	assert.equal(act(x, head, back.clone().sub(head)), null);
	assert.equal(ended(), 0);
	// A room of the scale model.
	const room = x.modes.walk.spots().find((s) => s.kind === 'room');
	const at = x.centerer.localToWorld(new THREE.Vector3(room.x, room.y, room.z));
	assert.equal(act(x, head, at.clone().sub(head)), 'inside');
	settle();
	assert.equal(x.mode, 'walk');
	// Inside: the floor a little ahead.
	const h2 = x.headWorld();
	assert.equal(act(x, h2, new THREE.Vector3(0, -1, -0.25)), 'teleport', 'the floor just ahead');
	assert.equal(act(x, h2, new THREE.Vector3(0, 1, 0)), null, 'the ceiling: nothing');
});

test('20 measurements and 20 strokes cost a handful of draw calls', async () => {
	const { x, frame } = await setup();
	const meter = x.fan.meter, marker = x.fan.marker, c = x.input.hands.right;
	frame();
	const at = (mx, my) => x.centerer.localToWorld(new THREE.Vector3(mx, my, 0));
	for (let i = 0; i < 20; i++) { meter.hit = at(0, i * 0.1); meter.trigger(c, 'down'); meter.hit = at(1 + i * 0.05, i * 0.1 + 0.3); meter.trigger(c, 'down'); }
	x.tools.take(marker, c);
	for (let k = 0; k < 20; k++) {
		if (k % 5 === 0) marker.nextInk();
		marker.trigger(c, 'down');
		for (let i = 0; i <= 8; i++) { marker.object.position.set(i * 0.01, k * 0.02, 0); marker.object.updateMatrixWorld(true); marker.update(1 / 72); }
		marker.trigger(c, 'up');
	}
	x.tools.putBack();
	frame();
	let meshes = 0;
	x.tools.annotations.traverse((o) => { if (o.isMesh && o.visible) meshes++; });
	assert.equal(meter.m.lines.length, 20);
	assert.equal(marker.strokes.length, 20);
	assert.ok(meshes <= 6, `all of it in ${meshes} meshes (lines, labels, one per ink)`);
});

test('round scales only: the plate and the model rest on 1:5, 1:10, 1:15 ... never 1:23 or 1:8', async () => {
	const { roundScale, roundScaleUp, ROUND_SCALES } = await import('../js/xr-dollhouse.js');
	assert.equal(roundScale(23), 25); assert.equal(roundScale(8), 10); assert.equal(roundScale(12), 10); assert.equal(roundScale(13), 15);
	assert.equal(roundScaleUp(23.4), 25, 'the fit scale rounds up, so the model still fits'); assert.equal(roundScaleUp(25), 25);
	const { x, frame } = await setup();
	frame();
	const d = x.modes.dollhouse, ratio = () => 1 / (x.baseScale * d.doll.zoom);
	assert.ok(ROUND_SCALES.includes(Math.round(ratio())) && Math.abs(ratio() - Math.round(ratio())) < 1e-6, `on entry: 1:${ratio()}`);
	assert.equal(x.plate.text, `1:${Math.round(ratio())}`);
	// Zooming between two round scales: the plate shows the nearest; letting go glides onto it.
	d.doll.zoom *= 1.19; d.apply();
	assert.ok(ROUND_SCALES.includes(Number(x.plate.text.slice(2))), `while zooming: ${x.plate.text}`);
	d.zoomHand = x.input.controllers[1];
	d.settleZoom(d.zoomHand);
	for (let i = 0; i < 40; i++) frame();
	assert.ok(ROUND_SCALES.some((s) => Math.abs(s - ratio()) < 1e-6), `settled on 1:${ratio()}`);
});

test('bare hands teleport with one hand: the main hand while it is empty, the other while it holds a tool; Main hand flips them', async () => {
	const { x } = await setup();
	const L = { handedness: 'left' }, R = { handedness: 'right' };
	assert.equal(x.mainHand, 'right');
	assert.ok(!x.teleportHand(L) && x.teleportHand(R), 'main hand right: the right hand teleports');
	x.tools.held = { c: R, tool: {} };
	assert.ok(x.teleportHand(L) && !x.teleportHand(R), 'the right hand holds a tool: the left one teleports');
	x.tools.held = null;
	x.menuAction({ id: 'mainHand', value: 'left' });
	assert.ok(x.teleportHand(L) && !x.teleportHand(R), 'main hand left: the left hand teleports');
	x.menuAction({ id: 'mainHand', value: 'right' });
});

test('the fan: opens only on the "look at your watch" pose; tools slide aside from the orb (20 cm kept); the orb yields to its own hand', async () => {
	const { x, frame, hands } = await setup();
	const fan = x.fan;
	x.lessons.stop();
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.left.grip.position.set(-0.1, 1.3, -0.45);
	hands.right.grip.position.set(0.3, 0.8, 0);
	// The left controller's face turned away from your eyes (face down): the fan stays closed.
	hands.left.grip.rotation.set(Math.PI, 0, 0);
	for (let i = 0; i < 20; i++) frame();
	assert.ok(!fan.group.visible, 'a hand held face down: no fan');
	hands.left.grip.rotation.set(0, 0, 0.0);
	hands.left.grip.rotation.x = 0.6; // tilted so the face looks at the eyes
	for (let i = 0; i < 20; i++) frame();
	assert.ok(fan.group.visible && fan.alpha === 1, 'the face towards the eyes: the fan opens');
	// The orb (on the right wrist) brought near the open fan: the tools slide away, never nearer than 20 cm.
	const orb = x.ui.wrist.orb.group, o = new THREE.Vector3(), p = new THREE.Vector3();
	const meter = fan.slots.find((s) => s.name === 'meter');
	meter.home.getWorldPosition(p);
	x.ui.wrist.wearer ?? null;
	hands.right.grip.position.copy(x.rig.worldToLocal(p.clone().add(new THREE.Vector3(0.15, 0, 0)))); // (the wrist, 15 cm from the meter)
	for (let i = 0; i < 40; i++) frame();
	orb.getWorldPosition(o);
	meter.home.getWorldPosition(p);
	assert.ok(fan.group.visible, 'the fan stays open');
	assert.ok(p.distanceTo(o) >= 0.19, `the meter keeps its distance: ${p.distanceTo(o).toFixed(3)}`);
	assert.ok(meter.pushWorld.length() > 0.01, 'it was pushed aside');
});

test('the tools show also starts on a wider look after 4 s, and by itself after 10 s, never behind an open board', async () => {
	const { x } = await setup();
	const intro = x.toolsIntro;
	x.camera.rotation.x = 1.2; x.camera.updateMatrixWorld(true); // (looking up, far from the model)
	intro.start();
	for (let t = 0; t < 9.5; t += 1 / 72) intro.update(1 / 72, () => {});
	assert.ok(intro.state.waiting && !intro.lookingAtModel(Math.PI / 3), 'not before 10 s when looking far away');
	x.ui.openMenu();
	for (let t = 0; t < 2; t += 1 / 72) intro.update(1 / 72, () => {});
	assert.ok(intro.state.waiting, 'the board is open: it waits');
	x.ui.closeMenu();
	intro.update(1 / 72, () => {});
	assert.ok(!intro.state.waiting && intro.group.visible, 'timed: it begins');
	intro.stop();
});

test('the plinth: 0.60 m with a controller, 0.90 m with only bare hands; a switch waits 1 s, then rises over 0.8 s with the model on it; never while the model floats', async () => {
	const { x, frame } = await setup();
	const d = x.modes.dollhouse;
	frame();
	assert.equal(x.plinthH, 0.6, 'controllers: 0.60 m');
	const top = () => x.pedestal.userData.parts.slab.position.y + 0.015;
	assert.ok(Math.abs(top() - 0.6) < 1e-6);
	// The controllers put down: only bare hands (no controller source).
	const sources = x.input.controllers.map((c) => c.source);
	x.input.controllers.forEach((c) => { c.source = null; });
	for (let i = 0; i < 40; i++) frame(); // 0.55 s: still waiting (a flicker must not bob the plinth)
	assert.equal(x.plinthH, 0.6, 'waits 1 s');
	for (let i = 0; i < 40; i++) frame(); // 1.1 s: the move began
	assert.ok(x.plinthH > 0.6 && x.plinthH < 0.9 || x.plinthH === 0.9, 'moving');
	for (let i = 0; i < 100; i++) frame();
	assert.ok(Math.abs(x.plinthH - 0.9) < 1e-6 && Math.abs(top() - 0.9) < 1e-6, 'bare hands: 0.90 m');
	assert.ok(Math.abs(d.doll.pos.y - 0.904) < 1e-6, 'the model rode up with it');
	assert.ok(Math.abs(x.plate.mesh.position.y - (0.9 + x.plate.mesh.userData.tiltHalf)) < 1e-6, 'and the plate');
	// A controller is back, but the model is floating: it waits.
	d.floating = { wait: 0, going: null };
	x.input.controllers.forEach((c, i) => { c.source = sources[i]; });
	for (let i = 0; i < 200; i++) frame();
	assert.equal(x.plinthH, 0.9, 'not while the model floats');
	d.stopFloating();
	for (let i = 0; i < 200; i++) frame();
	assert.ok(Math.abs(x.plinthH - 0.6) < 1e-6, 'back to 0.60 m once at rest');
});

test('going home turns the model square to the plinth (unless you turned it with the stick)', async () => {
	const { squareYaw } = await import('../js/xr-dollhouse.js');
	const q = Math.PI / 2;
	assert.ok(Math.abs(squareYaw(0.3) - 0) < 1e-9 && Math.abs(squareYaw(1.3) - q) < 1e-9 && Math.abs(squareYaw(-2.8) + Math.PI) < 1e-9);
});

test('a laser on a wing hovers its cell', async () => {
	const { x, frame, hands } = await setup();
	x.lessons.stop();
	hands.right.grip.visible = true;
	frame();
	x.ui.openMenu();
	frame();
	const p = x.menu, r = p.rects().find((t) => t.id === 'ceilings');
	const g = p.mesh.geometry.parameters;
	p.mesh.updateMatrixWorld(true);
	const at = p.mesh.localToWorld(new THREE.Vector3((((r.x + r.w / 2) / p.size.w) - 0.5) * g.width, (0.5 - (r.y + r.h / 2) / p.size.h) * g.height, 0));
	// The right controller 0.4 m in front of the cell, pointing at it.
	const from = at.clone().add(new THREE.Vector3(0.1, 0.1, 0.4));
	hands.right.grip.position.copy(x.rig.worldToLocal(from));
	const dir = at.clone().sub(from).normalize(), orig = x.input.setRaycaster.bind(x.input);
	x.input.setRaycaster = (c, rc) => { if (c === x.input.controllers[1]) rc.set(from, dir); else orig(c, rc); };
	for (let i = 0; i < 5; i++) frame();
	const c = x.input.controllers[1]; x.input.setRaycaster(c, x.raycaster); const hit = x.raycaster.intersectObject(p.mesh, false)[0];
	assert.ok(x.menu.hover?.startsWith('ceilings|'), `hover=${x.menu.hover} hit=${hit?.distance} claim=${c.claim.trigger} active=${x.input.active().length} panels=${x.ui.openPanels().length} vis=${p.mesh.visible}`);
});
