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
	const renderer = { xr: { getController: () => new THREE.Group(), getControllerGrip: () => new THREE.Group() } };
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
	return { x, ended: () => ended, press, frame, hands: x.input.hands };
}

const shape = (rows) => rows.map((r) => r.map((c) => [c.id, c.type, c.label, ...(c.options ?? []).map((o) => o.label)].join(':')).join(' | '));

test('the menus: the same tabs in both modes, the actions under them', async () => {
	const { x } = await setup();
	for (const p of Object.values(x.menus)) {
		assert.deepEqual(p.tabs.map((t) => t.label), ['View', 'Walk', 'Sound']);
		assert.deepEqual(shape(p.tabs[0].rows), ['light:choice:Time of day:Morning:Noon:Sunset:Night', 'shadows:switch:Shadows | depth:switch:Depth shading',
			'ceilings:switch:Ceilings | view:switch:Passthrough', 'seethrough:slider:See-through', `levels:dropdown:Levels${p === x.menus.dollhouse ? ':All levels (2):Up to Ground floor' : ''}`]);
		assert.deepEqual(shape(p.tabs[1].rows), ['turn:choice:Turn:15°:30°:45°', 'height:choice:Height:Yours:1.4 m:1.7 m:2.0 m', 'solid:switch:Solid walls']);
		assert.deepEqual(shape(p.tabs[2].rows), ['sound:choice:Sound:Off:Effects']);
	}
	assert.deepEqual(shape(x.menus.dollhouse.actions), ['walk:button:Walk in | recentre:button:Recentre | photo:button:Photo', 'exit:button:Exit VR']);
	assert.deepEqual(shape(x.menus.walk.actions), ['photo:button:Photo | dollhouse:button:Back to the scale model | exit:button:Exit VR']);
	assert.ok(x.menus.dollhouse.get('exit').primary && x.menus.walk.get('exit').primary);
	assert.equal(x.menus.dollhouse.title, 'Scale model');
	assert.equal(x.menus.walk.title, 'Walking');
	// Scale-model settings are greyed out while walking; the menus are the same size whatever the tab.
	assert.ok(x.menus.walk.get('levels').disabled && /scale model/i.test(x.menus.walk.get('levels').note));
	// The scale figure and its switch are gone (the landing markers show a person's size).
	assert.ok(Object.values(x.menus).every((p) => !p.get('figure')) && !('figure' in x) && !('figureOn' in x));
	const h = x.menus.dollhouse.size.h;
	x.menus.dollhouse.setTab('sound');
	assert.equal(x.menus.dollhouse.size.h, h);
	assert.ok(x.menus.dollhouse.rects().some((r) => r.id === 'exit') && !x.menus.dollhouse.rects().some((r) => r.id === 'light'), 'actions on every tab; other tabs\' cells not clickable');
	x.menus.dollhouse.setTab('view');
});

test('the tab you left a menu on is the one the other menu opens on', async () => {
	const { x } = await setup();
	x.ui.openMenu();
	x.menu.setTab('walk');
	x.ui.closeMenu();
	x.menuAction('walk');
	x.ui.openMenu();
	assert.equal(x.menu, x.menus.walk);
	assert.equal(x.menu.tab, 'walk');
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

test('the menu closes on Walk in, Recentre, Photo, Back and Exit only', async () => {
	const { x, ended } = await setup();
	const closes = (id, value) => { x.ui.openMenu(); x.menuAction(value === undefined ? id : { id, value }); return x.menu === null; };
	for (const [id, v] of [['light', 'noon'], ['shadows'], ['depth'], ['ceilings'], ['ceilings'], ['seethrough', 0.5], ['seethrough', 0], ['levels', 0], ['levels', 1], ['view', 'ar']]) {
		assert.equal(closes(id, v), false, id);
	}
	assert.equal(closes('recentre'), true);
	assert.equal(closes('photo'), true);
	assert.ok(x.photoPending, 'the photo is taken next frame, once the menu is gone');
	x.photoPending = false;
	assert.ok(closes('walk') && x.mode === 'walk');
	for (const [id, v] of [['turn', 45], ['turn', 30], ['height', 1.7], ['height', 0], ['solid'], ['solid']]) assert.equal(closes(id, v), false, id);
	assert.ok(closes('dollhouse') && x.mode === 'dollhouse');
	assert.ok(closes('exit') && x.mode === null && ended() === 1);
});

test('the interface is never in a photo; what the tools make is', async () => {
	const { x } = await setup();
	const hidden = x.photoHidden;
	for (const o of [...Object.values(x.menus).map((p) => p.mesh), x.ui.welcome.mesh, x.ui.flash, x.ui.photoNote.mesh, x.modes.walk.fadeMesh, x.modes.walk.arc.dots, x.modes.walk.arc.ring,
		...x.modes.dollhouse.markers, ...x.input.controllers.flatMap((c) => [c.ray, c.grip])]) assert.ok(hidden.has(o), o.name || o.type);
	assert.ok(!hidden.has(x.tools.annotations) && x.tools.annotations.parent === x.centerer, 'measurements and drawings live in model space and show in photos');
});

test('leaving VR in the middle of a walk leaves nothing behind', async () => {
	const { x, ended } = await setup();
	x.menuAction('walk');
	x.ui.openMenu();
	x.ui.setWelcome(true);
	const c = x.input.controllers[0];
	x.ui.placeOrbs();
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
	assert.ok(x.ui.orbs.every((o) => !o.group.parent && !o.holder));
	assert.equal(x.rig.position.length() + x.anchor.position.length() + x.lift, 0);
	assert.ok(x.model.layers.ground.visible && ended() === 1);
	assert.equal(x.tools.annotations.children.length, 0, 'measurements and drawings are cleared');
});

test('going back to the dollhouse while a teleport fades drops the teleport', async () => {
	const { x, press, frame, hands } = await setup();
	x.menuAction('walk');
	let jumped = false;
	x.modes.walk.fade = { t: 0, action: () => { jumped = true; } };
	frame();
	assert.ok(x.modes.walk.fadeMesh.visible, 'fading out');
	press('right', 'b'); frame(); press('right', 'b', false); frame();
	assert.equal(x.mode, 'dollhouse');
	assert.ok(!x.modes.walk.fadeMesh.visible && x.modes.walk.fade === null, 'the view is not left half dark');
	x.menuAction('walk');
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
	assert.equal(x.menu, null, 'A belongs to the tool, not the menu');
	press('right', 'a');
	for (let t = 0; t < HOLD + 0.1; t += 0.05) frame(0.05);
	press('right', 'a', false); frame();
	assert.deepEqual(got.splice(0), ['A press', 'A hold']);
	// X (the left hand's A) still opens the menu.
	press('left', 'a'); frame(); press('left', 'a', false); frame();
	assert.ok(x.menu, 'X opens the menu');
	assert.equal(hands.left.claim.trigger, null);
	x.ui.closeMenu();
	// Leaving VR puts it back and clears what it made.
	x.end();
	assert.deepEqual(got, ['back', 'clear']);
	assert.equal(x.tools.held, null);
});

test('mirrored: a tool in the left hand has Y as its second button', async () => {
	const { x, press, frame, hands } = await setup();
	const got = [];
	// (Y already held down when the tool is taken: that press is not the tool's.)
	press('left', 'b'); frame();
	x.tools.take({ secondary: (c, e) => got.push(e), controls: ['stickPress', 'nonsense'] }, hands.left);
	frame(); press('left', 'b', false); frame();
	assert.deepEqual(got, [], 'a press already under way when taking a tool does nothing');
	press('left', 'b'); frame(); press('left', 'b', false); frame();
	assert.deepEqual(got, ['press']);
	assert.equal(hands.left.claim.stickPress, 'tool', 'the marker owns its stick press');
	x.menuAction('walk');
	x.ui.openMenu();
	frame();
	assert.ok(!hands.left.line.visible && hands.right.line.visible, 'walking with the menu open: still no laser on the tool hand');
	x.ui.closeMenu();
	assert.equal(hands.left.claim.b, 'tool');
	press('right', 'a'); frame(); press('right', 'a', false); frame();
	assert.ok(x.menu, 'A opens the menu');
});
