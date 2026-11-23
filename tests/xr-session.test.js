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
import { optimiseModel } from '../js/optimise.js';
import { XRExperience } from '../js/xr.js';
import { HOLD } from '../js/xr-tools.js';

const FILE = path.resolve(import.meta.dirname, '../examples/example-home.sh3d');

/** An XRExperience with the example home, a pretend session and two pretend controllers. */
async function setup() {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(FILE)));
	const home = parseHome(new TextDecoder().decode(entries['Home.xml']));
	const built = await buildHome(home, { loadModel: async (ref) => new OBJLoader().parse(prepareObjText(new TextDecoder().decode(entries[ref])).replace(/^\s*mtllib.*$/gm, '')) });
	const { group, layers } = optimiseModel(built.root);
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

test('the settings boards: the same tabs at both layers, a Close key, every target big enough to touch', async () => {
	const { x } = await setup();
	for (const p of Object.values(x.menus)) {
		assert.deepEqual(p.tabs.map((t) => t.label), ['View', 'Walk', 'General']);
		assert.deepEqual(shape(p.tabs[0].rows), ['light:choice:Time of day:Morning:Noon:Sunset:Night', 'shadows:switch:Shadows | depth:switch:Depth shading',
			'ceilings:switch:Ceilings | view:switch:Passthrough', 'seethrough:switch:Transparent walls', `levels:choice:Levels${p === x.menus.dollhouse ? ':All levels (2):Up to Ground floor' : ''}`]);
		assert.deepEqual(shape(p.tabs[1].rows), ['height:choice:Height:Yours:1.4 m:1.7 m:2.0 m', 'solid:switch:Solid walls']);
		assert.deepEqual(shape(p.tabs[2].rows), ['toolFan:choice:Tool fan:Left hand:Right hand', 'sound:choice:Sound:Off:Effects']);
		assert.equal(p.actions.length, 0, 'no actions on the board: the doors are on the wrist');
		assert.ok(p.rects().some((r) => r.id === 'close'), 'a Close key');
		assert.ok(p.get('levels').stepper, 'Levels is a ‹ › stepper');
		// Touch targets: at least 4 cm (the board is 52 cm wide).
		const m = p.mesh.geometry.parameters.width / p.size.w;
		for (const r of p.rects()) assert.ok(Math.min(r.w, r.h) * m >= 0.04 - 1e-9, `${r.id} ${r.value ?? ''}: ${(Math.min(r.w, r.h) * m * 100).toFixed(1)} cm`);
	}
	assert.equal(x.menus.dollhouse.title, 'Settings \u00b7 Scale model');
	assert.equal(x.menus.walk.title, 'Settings \u00b7 Inside');
	// Scale-model settings are greyed out inside; the boards are the same size whatever the tab.
	assert.ok(x.menus.walk.get('levels').disabled && /scale model/i.test(x.menus.walk.get('levels').note));
	assert.ok(Object.values(x.menus).every((p) => !p.get('figure') && !p.get('photo') && !p.get('recentre') && !p.get('exit')), 'no figure, Photo, Recentre or Exit VR');
	const h = x.menus.dollhouse.size.h;
	x.menus.dollhouse.setTab('general');
	assert.equal(x.menus.dollhouse.size.h, h);
	x.menus.dollhouse.setTab('view');
});

test('the wrist menu: Settings above, Help below, ← Back on the left, Walk in → on the right', async () => {
	const { keysFor } = await import('../js/wrist-menu.js');
	const doll = keysFor('dollhouse'), inside = keysFor('walk', 'Living room');
	assert.deepEqual(Object.fromEntries(Object.entries(doll).map(([k, v]) => [k, [v.id, v.look, v.label, v.caption ?? '']])), {
		up: ['settings', 'plain', 'Settings', ''], right: ['in', 'filled', 'Walk in \u2192', 'Inside the home'],
		down: ['help', 'plain', 'Help', ''], left: ['back', 'outline', '\u2190 Back', 'Leave VR'],
	});
	assert.deepEqual([inside.right.id, inside.right.look, inside.right.label, inside.right.caption], [null, 'flat', 'Inside', 'Living room'], 'inside: a flat plate, you are as deep as it goes');
	assert.deepEqual([inside.left.id, inside.left.caption], ['back', 'Scale model']);
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

test('Tool fan: the wrist menu moves to the other wrist, remembered', async () => {
	const { x } = await setup();
	assert.equal(x.ui.wrist.side, 'right');
	x.menuAction({ id: 'toolFan', value: 'right' });
	assert.equal(x.toolFan, 'right');
	assert.equal(x.ui.wrist.side, 'left');
	assert.equal(x.menus.dollhouse.get('toolFan').value, 'right');
	x.menuAction({ id: 'toolFan', value: 'left' });
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
	for (const o of [...Object.values(x.menus).map((p) => p.mesh), ...Object.values(x.help).map((c) => c.mesh), x.ui.wrist.cross, x.curtain, x.arrival.mesh, x.ui.welcome.mesh, x.ui.flash, x.ui.photoNote.mesh, x.modes.walk.fadeMesh, x.modes.walk.arc.dots, x.modes.walk.arc.ring,
		...x.modes.dollhouse.markers, ...x.input.controllers.flatMap((c) => [c.ray, c.grip])]) assert.ok(hidden.has(o), o.name || o.type);
	assert.ok(!hidden.has(x.tools.annotations) && x.tools.annotations.parent === x.centerer, 'measurements and drawings live in model space and show in photos');
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
	walk.arc.dots.visible = walk.fadeMesh.visible = true;
	x.ui.drag = { c, id: 'seethrough' };
	x.photoPending = true;
	x.tools.annotations.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
	x.end();
	assert.deepEqual([x.mode, x.menu, walk.tele, walk.fade, x.ui.drag, x.modes.dollhouse.grab, x.ui.welcomeOn, x.pendingRecentre, x.photoPending], [null, null, null, null, null, null, false, false, false]);
	const shown = [walk.arc.dots, walk.arc.ring, walk.fadeMesh, x.ui.flash, x.ui.photoNote.mesh, x.walkSky, x.showroom, x.stage, x.ui.welcome.mesh, ...x.modes.dollhouse.markers, ...Object.values(x.menus).map((p) => p.mesh)].filter((o) => o.visible);
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
	assert.ok(x.modes.walk.fadeMesh.visible, 'fading out');
	press('right', 'b'); frame(); press('right', 'b', false); frame();
	settle();
	assert.equal(x.mode, 'dollhouse');
	assert.ok(!x.modes.walk.fadeMesh.visible && x.modes.walk.fade === null, 'the view is not left half dark');
	go('in');
	for (let i = 0; i < 30; i++) frame();
	assert.ok(!jumped, 'the old teleport does not run on the next walk');
	assert.ok(hands.right);
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

test('the wrist menu: Help opens beside it, and the menu stays', async () => {
	const { x, frame } = await setup();
	frame();
	x.ui.wrist.show({ pinned: true });
	x.menuAction('help');
	assert.ok(x.ui.wrist.open, 'the menu stays open');
	assert.ok(x.ui.help && x.ui.help.mesh.parent === x.ui.wrist.cross && x.ui.help.mesh.position.x > 0.15, 'on its right, in its plane');
	x.menuAction('help');
	assert.ok(!x.ui.help && x.ui.wrist.open, 'Help again: the card goes, the menu stays');
	x.menuAction('help');
	x.ui.wrist.close();
	assert.equal(x.ui.help, null, 'closing the menu takes Help with it');
});

test('holding the model: it follows the grip fully (tilt too); let go in the air it floats, then goes home by itself', async () => {
	const { x, press, frame, hands } = await setup();
	const d = x.modes.dollhouse;
	const home = new THREE.Vector3(0, d.doll.pos.y, -x.plinthDistance); // (the middle of the plinth)
	const grip = hands.right.grip;
	grip.position.set(0.1, 1.0, -0.4);
	frame();
	press('right', 'grip'); frame();
	assert.ok(d.grab && d.grab.kind === 'controller', 'a grip held anywhere holds it');
	// Lift it 40 cm and tilt it 40° (the hand turns): the model follows, smoothed.
	grip.position.y += 0.4;
	grip.rotation.x = THREE.MathUtils.degToRad(40);
	for (let i = 0; i < 60; i++) frame();
	assert.ok(d.doll.pos.y > home.y + 0.3, 'lifted');
	assert.ok(!d.level(), 'tilted');
	assert.equal(d.markers.filter((m) => m.visible).length, 0, 'a tilted model offers no landing');
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
	press('right', 'trigger'); frame(); frame();
	assert.equal(x.mode, 'dollhouse', 'not on the trigger going down');
	press('right', 'trigger', false); frame(); settle();
	assert.equal(x.mode, 'walk', 'on letting go over it');
});

test('the first-time lessons: steps tick off in order; stepping inside starts the next; controllers skip the hand-only step', async () => {
	const { x, go } = await setup();
	const L = x.lessons;
	assert.equal(L.place, 'scale', 'shown at the scale model on entry');
	assert.equal(L.kind, 'controllers');
	assert.deepEqual(L.steps().map((s) => s.id), ['start', 'menu', 'hold', 'inside'], 'the ready pose is for bare hands only');
	assert.ok(!x.ui.welcome.mesh.visible, 'it replaces the welcome card');
	assert.equal(L.current().id, 'start');
	L.note('held'); // done early: counts, but Start is still the step to do
	assert.equal(L.current().id, 'start');
	assert.ok(!L.canClose(), 'Got it waits for the steps that must not be missed');
	L.note('start'); L.note('wrist');
	assert.ok(L.canClose());
	assert.equal(L.current().id, 'inside');
	go('in');
	assert.equal(L.place, 'walk', 'inside: the next lesson');
	assert.equal(L.current().id, 'arc');
	L.note('arc'); L.note('teleport'); L.note('turn');
	assert.equal(L.place, 'walk', 'the last step has no gesture: it waits for Got it');
	assert.ok(L.canClose());
	L.finish();
	assert.equal(L.place, null);
});
