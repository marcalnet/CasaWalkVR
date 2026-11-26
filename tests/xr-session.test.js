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
import { XRExperience } from '../js/xr.js';
import { HOLD } from '../js/xr-tools.js';

const FILE = path.resolve(import.meta.dirname, '../examples/example-home.sh3d');

/** An XRExperience with the example home, a pretend session and two pretend controllers. nomerge: the model as loaded (?nomerge). */
async function setup({ nomerge = false, file = FILE } = {}) {
	const entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
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
	x.pause.tipsOn = false; // (no tips but in the pause's own tests: they would hold every move)
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
	const settle = () => { for (let i = 0; i < 240 && x.layerFx; i++) frame(); }; // (the tunnel zoom takes 1.6 s, then the fade lifts)
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

test('the settings boards: the same tabs at both layers, no Close key (the foot says how to close), every target big enough to touch', async () => {
	const { x } = await setup();
	for (const p of Object.values(x.menus)) {
		assert.deepEqual(p.tabs.map((t) => t.label), ['View', 'Walk', 'Tools', 'General']);
		assert.equal(p.lead.label, '? How to move', 'the How to move key at the tabs\' left end');
		assert.deepEqual(shape(p.tabs[0].rows), ['light:choice:Time of day:Morning:Noon:Sunset:Night', 'shadows:switch:Shadows',
			'depth:switch:Depth shading', 'view:switch:Passthrough', 'seethrough:switch:Transparent walls']);
		assert.deepEqual(shape(p.tabs[1].rows), ['height:choice:Height:Yours:1.4 m:1.7 m:2.0 m']);
		assert.deepEqual(shape(p.tabs[2].rows), ['lens:choice:Camera lens:24 mm:28 mm:35 mm:50 mm']);
		assert.deepEqual(shape(p.tabs[3].rows), ['mainHand:choice:Main hand:Right:Left', 'sound:choice:Sound:Off:Effects']);
		assert.equal(p.actions, undefined, 'no action rows on the board: the doors are on the wrist');
		assert.ok(!p.rects().some((r) => /close/i.test(r.id)) && /outside to close$/.test(p.hint), 'no Close key: the foot says how to close (build 120, M1)');
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
	const d = x.modes.dollhouse, key = (i) => d.doors.keys.get(`level${i}`), inn = d.doors.keys.get('in');
	assert.equal(d.levelCount, 2, 'the example home has two levels');
	assert.deepEqual([0, 1].map((i) => [key(i).spec.id, key(i).spec.look, key(i).spec.label, key(i).group.visible]), [['level:0', 'plain', 'Ground floor', true], ['level:1', 'chosen', 'First floor', true]], 'the top key means all levels');
	assert.ok(key(0).group.position.y < key(1).group.position.y, 'ground at the bottom');
	assert.ok(key(0).group.position.x < inn.group.position.x - inn.w / 2 - 0.1 && Math.abs(key(0).group.position.x - key(1).group.position.x) < 1e-9, 'a stack to the left of Walk in, where it was');
	assert.ok(Math.abs(key(0).group.position.x + 0.345) < 1e-9 && Math.abs(inn.group.position.x - 0.065) < 1e-9, 'the stack and Walk in where they were beside the old ← Back');
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

test('the pause, pure: which tip (in order, once a session, per input kind), ready, the practice arc', async () => {
	const { nextTip, tipKey, isReady, practiceArc, PAUSE } = await import('../js/pause.js');
	const { SessionStore } = await import('../js/session-store.js');
	const newRecord = () => new SessionStore();
	const { loopAt } = await import('../js/tip-demo.js');
	assert.deepEqual([0, 0.6, 1.5, 2.0, 2.4, 2.9].map((t) => { const m = loopAt(t); return [+m.pinch.toFixed(1), +m.arc.toFixed(1), m.blue]; }),
		[[0, 0, false], [0.2, 0, false], [1, 0.8, false], [1, 1, true], [0.3, 0.3, false], [0, 0, false]], 'the demonstration\'s loop: pinch, arc grows, ring blue, hand opens');
	const r = newRecord();
	assert.equal(nextTip('in', r, 'hands').id, 'teleport', 'Walk in: the teleport first');
	r.tips.seen.add(tipKey('teleport', 'hands'));
	assert.equal(nextTip('in', r, 'hands').id, 'turn', 'each tip at most once a session: then the turn');
	r.tips.learnt.add(tipKey('turn', 'hands'));
	assert.equal(nextTip('in', r, 'hands').id, 'portal', 'a learnt tip is never shown');
	r.tips.seen.add(tipKey('portal', 'hands'));
	assert.equal(nextTip('in', r, 'hands'), null, 'none left: a plain fade');
	assert.equal(nextTip('in', r, 'controllers').id, 'teleport', 'learnt with hands: still shown once for controllers');
	assert.equal(nextTip('enter', newRecord(), 'hands').id, 'walkin');
	assert.equal(nextTip('back', newRecord(), 'controllers').id, 'grab');
	assert.equal(nextTip('out', newRecord(), 'hands'), null, 'leaving VR: never a tip');
	const all = newRecord(), ids = Array.from({ length: 6 }, () => nextTip('in', all, 'hands', { all: true }).id);
	assert.deepEqual(ids, ['walkin', 'teleport', 'turn', 'portal', 'grab', 'walkin'], '?tips: every tip in turn, never retired');
	assert.ok(!isReady([0.01, 0.01]) && isReady(Array(10).fill(1 / 72)) && !isReady([...Array(9).fill(1 / 72), 0.03]), 'ready: 10 smooth frames (under 1.5x the budget)');
	assert.equal(PAUSE.READY_LIMIT, 10, 'never stuck: 10 s at most');
	const { land } = practiceArc(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0, -0.3, -1), 0);
	assert.ok(land && Math.abs(land.y) < 1e-9 && land.z < -1, `the practice arc lands ahead on the floor (${land?.z.toFixed(2)} m)`);
});

test('the pause: Walk in with a tip (the dark, the floor ring, the room\'s name, the tip, the hand); 3.5 s shown; ← Back: the grab tip; none left: a plain fade', async () => {
	const { x, frame } = await setup();
	const P = x.pause, { PAUSE } = await import('../js/pause.js');
	P.tipsOn = true;
	frame();
	x.menuAction('in');
	let n = 0;
	for (; n < 400 && !P.fx?.pause; n++) frame();
	const p = P.fx?.pause;
	assert.ok(p && x.mode === 'walk', 'after the tunnel: inside, in the pause');
	assert.equal(p.tip.id, 'teleport');
	assert.ok(P.group.visible && P.floor.visible && x.veil.amount('layer') === 1, 'the dark, the tip and the floor ring');
	assert.ok(P.demo.playing || !P.demo.hands, 'the looping demonstration');
	const t0 = n;
	for (; n < 1400 && P.fx?.pause && !P.fx.pause.ending; n++) frame();
	const shown = (n - t0) / 72;
	assert.ok(shown >= PAUSE.TIP_IN + PAUSE.SHOWN - 0.05 && shown < PAUSE.TIP_IN + PAUSE.SHOWN + 0.2, `shown ${shown.toFixed(2)} s (fade in, then 3.5 s)`);
	for (let i = 0; i < 200 && P.fx; i++) frame();
	assert.ok(!P.fx && x.veil.amount('layer') === 0 && !P.group.visible && !P.floor.visible, 'then the room fades in');
	assert.ok(P.target.visible, 'the first time inside: the first-target ring ahead');
	x.menuAction('back');
	for (let i = 0; i < 100 && !P.fx?.pause; i++) frame();
	assert.equal(P.fx?.pause?.tip.id, 'grab', '← Back: the grab tip (unseen, unlearnt)');
	for (let i = 0; i < 600 && P.fx; i++) frame();
	assert.ok(!P.target.visible && x.mode === 'dollhouse', 'at the scale model: no target ring');
	x.menuAction('in');
	for (let i = 0; i < 400 && !P.fx?.pause; i++) frame();
	assert.equal(P.fx?.pause?.tip.id, 'turn', 'the next Walk in: the next tip');
});

test('the pause: practising the teleport (hold the trigger, an arc onto the floor ring, let go) ends it at once and learns it; a quick pull after 0.8 s only skips', async () => {
	const { x, frame, press } = await setup();
	const P = x.pause;
	P.tipsOn = true;
	frame();
	x.menuAction('in');
	for (let n = 0; n < 400 && !P.fx?.pause; n++) frame();
	for (let i = 0; i < 72; i++) frame(); // (1 s in)
	const hands = x.input.hands;
	hands.right.ray.position.set(0.2, 1.3, -0.2);
	hands.right.ray.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4); // (pointing down ahead)
	hands.right.ray.updateMatrixWorld(true);
	press('right', 'trigger'); for (let i = 0; i < 36; i++) frame(); // 0.5 s
	assert.ok(P.arc.visible, 'the practice arc onto the floor');
	press('right', 'trigger', false); frame();
	assert.ok(P.fx?.pause?.ending?.learnt, 'let go: the tip ends at once, learnt');
	assert.ok(P.record.tips.learnt.has('teleport:controllers'));
	for (let i = 0; i < 200 && P.fx; i++) frame();
	// Enter VR: the dark from the first frame, the walk-in tip; a quick pull before 0.8 s does nothing, after it skips.
	x.store.start(); P.enter(); // (as Enter VR does: a fresh session)
	assert.ok(P.fx.pause?.tip.id === 'walkin' && x.veil.amount('layer') === 1, 'Enter VR: the pause from the first frame');
	press('right', 'trigger'); frame(); press('right', 'trigger', false); frame();
	assert.ok(!P.fx.pause.ending, 'too soon to skip');
	for (let i = 0; i < 72; i++) frame();
	press('right', 'trigger'); frame(); press('right', 'trigger', false); frame();
	assert.ok(P.fx.pause.ending && !P.fx.pause.ending.learnt, 'after 0.8 s: skipped, seen, not learnt');
	for (let i = 0; i < 200 && P.fx; i++) frame();
	assert.ok(!P.fx && x.veil.amount('layer') === 0, 'the room fades in');
});
test('shared headsets: Height is per session (never stored, "Yours" at every Enter VR); New visitor starts the session over (tips, first tab, height, the target ring), what you see stays', async () => {
	const { x, frame } = await setup();
	const { readSetting, writeSetting, SETTINGS } = await import('../js/settings.js');
	assert.equal(SETTINGS.height.scope, 'session');
	assert.ok(Object.entries(SETTINGS).every(([k, v]) => k === 'height' || !v.scope), 'every other setting is remembered');
	writeSetting('height', 1.7);
	assert.equal(readSetting('height'), 0, 'never stored: always "Yours" on reading');
	frame();
	x.menuAction({ id: 'height', value: 1.7 });
	x.menuAction({ id: 'light', value: 'sunset' });
	x.store.tips.seen.add('teleport:controllers'); x.store.target = true; x.ui.tab = 'general';
	x.menuAction('newVisitor');
	assert.ok(x.personHeight === 0 && x.store.tips.seen.size === 0 && !x.store.target && x.ui.tab === null, 'the next person: height "Yours", every tip, the first tab, the target ring');
	assert.equal(x.lighting?.time ?? 'sunset', 'sunset', 'what you see stays');
	assert.ok(x.guides.walk.get('newVisitor') && x.guides.dollhouse.get('newVisitor'), 'the key at How to move\'s foot');
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

test('Main hand: the wrist menu and the tool fan flip together, remembered', async () => {
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
	for (const [id, v] of [['light', 'noon'], ['shadows'], ['depth'], ['seethrough'], ['seethrough'], ['levels', 0], ['levels', 1], ['view', 'ar'], ['sound', 'effects']]) {
		assert.equal(stays(id, v), true, id);
	}
	assert.equal(x.seeThroughAmount, 0);
	x.menuAction('seethrough');
	assert.equal(x.seeThroughAmount, 0.75, 'See-through is one switch: on is 75%');
	x.menuAction('seethrough');
	assert.equal(x.seeThroughAmount, 0);
	x.ui.closeMenu();
	assert.equal(x.menu, null);
	// In: the scale model → inside (the board closes).
	x.ui.openMenu();
	go('in');
	assert.ok(x.mode === 'walk' && x.menu === null && !x.layerFx);
	for (const [id, v] of [['height', 1.7], ['height', 0]]) assert.equal(stays(id, v), true, id);
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
	for (const o of [...Object.values(x.menus).map((p) => p.mesh), x.ui.wrist.cross, x.veil.mesh, x.arrival.mesh, x.ui.photoNote.mesh, x.modes.walk.arc.dots, x.modes.walk.arc.ring,
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
	const c = x.input.controllers[0];
	frame();
	assert.ok(x.ui.wrist.orb.holder, 'the orb is on a wrist');
	const walk = x.modes.walk;
	Object.assign(walk, { tele: { c, via: 'trigger' }, fade: { t: 0, action: () => { throw new Error('a stale teleport ran'); } } });
	walk.arc.dots.visible = true;
	x.veil.set('teleport', 1);
	x.photoPending = true;
	x.tools.annotations.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
	x.end();
	assert.deepEqual([x.mode, x.menu, walk.tele, walk.fade, x.modes.dollhouse.grab, x.pendingRecentre, x.photoPending], [null, null, null, null, null, false, false]);
	const shown = [walk.arc.dots, walk.arc.ring, x.veil.mesh, x.ui.photoNote.mesh, x.walkSky, x.showroom, x.stage, ...x.modes.dollhouse.markers, ...Object.values(x.menus).map((p) => p.mesh)].filter((o) => o.visible);
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

test('back from inside: the plinth in front of where you now stand and look, the model level on it, its turn kept', async () => {
	const { x, frame, go } = await setup();
	const d = x.modes.dollhouse;
	d.doll.yaw = 0.7; d.apply();
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
	assert.ok(d.doll.zoom === 1 && Math.abs(d.doll.yaw - 0.7) < 1e-6, 'its turn kept, its scale the visit\'s one');
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

test('the door at the scale model: one big Walk in → (no ← Back since 26 Nov 2026); Walk in goes inside', async () => {
	const { x, go, frame, settle } = await setup();
	const d = x.modes.dollhouse.doors;
	const inn = d.keys.get('in');
	assert.ok(!d.keys.has('back'), 'no ← Back door: leaving is the wrist\'s ← Back, or the Meta button');
	assert.deepEqual([inn.spec.id, inn.spec.look], ['in', 'filled']);
	assert.ok(Math.min(inn.w, inn.h) >= 0.07, 'big enough to touch');
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
	x.menuAction('guideKey');
	assert.ok(x.ui.guide && x.ui.guide.mesh.visible && !x.menu, 'the left wing, How to move; Settings stays shut');
	const cell = x.ui.guide.cells.get('guide');
	assert.equal(cell.kind, 'dollhouse-controllers');
	assert.match(cell.foot, /^Build /);
	x.menuAction('guideKey');
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

test('a new home loaded while the doors are faded: they come back whole (build 120, B1)', async () => {
	const { x, frame } = await setup();
	const d = x.modes.dollhouse;
	frame();
	const base = new Map();
	d.doorGroup.traverse((o) => { for (const m of [].concat(o.material ?? [])) base.set(m, m.opacity); });
	x.ui.openMenu();
	for (let i = 0; i < 20; i++) frame();
	assert.equal(d.doorAlpha, 0, 'faded');
	d.setModel(); // (the page opened another home: the levels are built again)
	x.ui.closeAll();
	for (let i = 0; i < 20; i++) frame();
	d.doorGroup.traverse((o) => { for (const m of [].concat(o.material ?? [])) if (base.has(m)) assert.equal(m.opacity, base.get(m), `${o.name}: back to its own opacity`); });
	x.ui.openMenu(); for (let i = 0; i < 20; i++) frame();
	d.begin(); // (a new session with the doors faded)
	assert.ok(d.doorAlpha === 1 && d.doorGroup.visible, 'a new session shows them at once');
	x.ui.closeAll();
});

test('a controller put down while a bare hand is tracked rests: no laser, no orb, not active, until it moves (build 120, B3)', async () => {
	const { x, hands } = await setup();
	const input = x.input, c = input.controllers.find((e) => e.isController);
	c.grip.visible = true;
	const hand = { isHand: true, touch: { tracked: true } }; // (a tracked bare hand)
	const step = (n) => { for (let i = 0; i < n; i++) { c.grip.updateMatrixWorld(true); input.updateResting(c); } };
	const realNow = performance.now.bind(performance);
	let t = realNow();
	performance.now = () => t;
	try {
		input.controllers.push(hand);
		step(1); t += 1000; step(1);
		assert.ok(!c.resting, 'still for 1 s: not yet');
		t += 600; step(1);
		assert.ok(c.resting && !input.active().includes(c) && !input.wearers().includes(c) && !c.line.visible, 'still for 1.6 s: put down');
		c.grip.position.x += 0.01; step(1);
		assert.ok(!c.resting && input.active().includes(c), 'picked up: at once');
		input.controllers.pop();
		t += 5000; step(1);
		assert.ok(!c.resting, 'no hand tracked: a still controller is never put down');
	} finally { performance.now = realNow; if (input.controllers.at(-1) === hand) input.controllers.pop(); }
});

test('a bare hand\'s teleport lands where the ring was 0.1 s before the release (build 120, B6)', async () => {
	const { x } = await setup();
	const w = x.modes.walk, P = (z) => new THREE.Vector3(0, 0, z);
	const tele = { age: 1, past: [{ age: 0.85, valid: true, point: P(-3) }, { age: 0.9, valid: true, point: P(-3.1) }, { age: 0.95, valid: false, point: P(-6) }, { age: 1, valid: false, point: P(-7) }] };
	const r = w.landingBefore(tele, 0.1);
	assert.ok(r.valid && r.point.z === -3.1, 'the landing from before the fingers opened, not the flick');
	assert.equal(w.landingBefore({ age: 0.05, past: [{ age: 0.05, valid: true, point: P(-1) }] }, 0.1).point.z, -1, 'a young aim: its oldest');
});

test('bare hands: an empty hand between the eyes and the model shows a faint aim and the marker before any pinch (build 120, item 5)', async () => {
	const { x, frame } = await setup();
	frame();
	const d = x.modes.dollhouse, c = x.input.hands.right, left = x.input.hands.left, leftSource = left.source;
	c.isHand = true; c.isController = false;
	left.source = null; // (bare hands only: no controller in use)
	c.touch.tracked = true;
	const head = x.headWorld(), box = d.modelBox(), mid = box.getCenter(new THREE.Vector3());
	const through = head.clone().lerp(mid, 0.4);
	c.gesture = { shape: { pinchAt: through } };
	c.gestures = [];
	x.input._gh = [c];
	const spots = [];
	d.handMoves(1 / 72, spots);
	assert.ok(!d.handRays[c.index].visible, 'one frame: not yet');
	d.handMoves(1 / 72, spots);
	const ray = d.handRays[c.index];
	assert.ok(ray.visible && ray.material.opacity < 0.5, 'two frames: a faint ray at once, no pinch');
	assert.equal(d.handAim, null, 'not an aim yet');
	// The hand leaves the zone: gone 0.2 s later.
	c.gesture.shape.pinchAt = head.clone().add(new THREE.Vector3(0.6, -0.2, 0));
	for (let i = 0; i < 10; i++) d.handMoves(1 / 72, []);
	assert.ok(ray.visible, 'lingers a moment');
	for (let i = 0; i < 10; i++) d.handMoves(1 / 72, []);
	assert.ok(!ray.visible, 'then goes');
	x.input._gh = null; c.isHand = false; c.isController = true; left.source = leftSource;
});

test('the tunnel zoom (on, subtle: build 120, M2): the room and the model scale x1.4 about the spot with a soft start and stop, the view goes black from 1.25 s, then inside; the scale model as it was', async () => {
	const { WALK_IN_ZOOM } = await import('../js/pause.js');
	assert.equal(WALK_IN_ZOOM, true, 'on since the user\'s word (26 Nov 2026)');
	const { x, frame } = await setup();
	frame();
	const spot = x.centerer.localToWorld(x.model.bounds.getCenter(new THREE.Vector3()));
	const stage0 = x.stage.position.clone(), scale0 = x.anchor.scale.x;
	let went = 0, maxScale = 0, blackAt = null;
	const scales = [];
	const P = x.pause;
	P.fx = { dir: 'in', t: 0, done: false, go: () => { went++; }, tunnel: { at: spot, stage: stage0.clone(), anchor: x.anchor.position.clone(), scale: scale0 } };
	for (let i = 0; i < 72 * 1.8 && P.fx?.tunnel; i++) {
		P.fx.t += 1 / 72; P.runTunnel(P.fx);
		if (x.veil.amount('layer') > 0 && blackAt === null) blackAt = P.fx.t;
		maxScale = Math.max(maxScale, x.stage.scale.x); scales.push(x.stage.scale.x);
	}
	assert.ok(Math.abs(maxScale - 1.4) < 0.005 && went === 1, `scaled to x${maxScale.toFixed(3)}, then inside`);
	assert.ok(blackAt > 1.24 && blackAt < 1.28, `the fade to black from ${blackAt?.toFixed(2)} s`);
	// Smootherstep: the first and last steps of the zoom are tiny (no jolt at either end).
	const steps = scales.slice(1).map((v, i) => v - scales[i]).filter((d) => d > 0);
	assert.ok(steps[0] < 1e-4 && steps.at(-1) < 1e-4 && Math.max(...steps) > 0.005, `steps ${steps[0].toExponential(1)} … ${steps.at(-1).toExponential(1)}`);
	assert.ok(x.stage.scale.x === 1 && x.stage.position.distanceTo(stage0) < 1e-9, 'the room back as it was');
	P.fx = null; x.veil.clear();
});

test('the wrist key opens both wings and closes both; the How to move key closes and reopens How to move alone; the tab you left is kept', async () => {
	const { x } = await setup();
	x.menuAction('settings');
	assert.ok(x.menu && x.ui.guide, 'Settings, and help: both wings');
	assert.equal(x.menu.tab, 'view');
	x.menu.setTab('walk'); x.menuAction('settings');
	assert.ok(!x.menu && !x.ui.guide, 'again: both close');
	x.menuAction('settings');
	assert.ok(x.menu && x.ui.guide, 'and both again (build 120: help closed alone was never found again)');
	assert.equal(x.menu.tab, 'walk', 'the tab you left');
	for (let i = 0; i < 3; i++) {
		x.menuAction('guideKey');
		assert.ok(x.menu && !x.ui.guide && !x.menu.lead.on, 'the How to move key closes How to move alone (build 120, M1)');
		x.menuAction('guideKey');
		assert.ok(x.ui.guide && x.ui.guide.mesh.visible && x.menu.lead.on, 'and opens it again, every time, filled while open');
	}
	x.ui.closeAll();
});

test('the wings: Settings on the main hand\'s side, How to move on the other, both 30° or more off straight ahead; the second shares the first\'s front (B8)', async () => {
	const { x, frame } = await setup();
	frame();
	const angle = (panel) => { // degrees, + to the left of straight ahead (the rig looks along -Z)
		const p = panel.mesh.position, h = new THREE.Vector3().setFromMatrixPosition(x.camera.matrix);
		return THREE.MathUtils.radToDeg(Math.atan2(-(p.x - h.x), -(p.z - h.z)));
	};
	for (const main of ['right', 'left']) {
		x.menuAction({ id: 'mainHand', value: main });
		x.ui.closeAll();
		x.menuAction('settings');
		const s = angle(x.menu), g = angle(x.ui.guide), side = main === 'right' ? -1 : 1;
		assert.ok(Math.sign(s) === side && Math.abs(s) >= 30 && Math.sign(g) === -side && Math.abs(g) >= 30, `${main}: settings ${s.toFixed(0)}, guide ${g.toFixed(0)}`);
		// Turn the head 45° towards Settings, then reopen How to move: it keeps the pair's front.
		x.ui.closeGuide();
		x.camera.rotation.y = THREE.MathUtils.degToRad(45 * side); x.camera.updateMatrix();
		x.menuAction('guideKey');
		assert.ok(Math.abs(angle(x.ui.guide) - g) < 1, `${main}: How to move back where it was (${angle(x.ui.guide).toFixed(0)}), not in front`);
		x.camera.rotation.y = 0; x.camera.updateMatrix();
		x.ui.closeAll();
	}
	x.menuAction({ id: 'mainHand', value: 'right' });
});

test('the orb, or A, with a wing open closes everything', async () => {
	const { x, frame } = await setup();
	frame();
	x.menuAction('settings');
	assert.ok(x.menu && x.ui.guide);
	const wearer = x.ui.wrist.wearer;
	assert.ok(wearer, 'the orb is worn');
	wearer.state.down.a = true;
	x.ui.buttons();
	wearer.state.down.a = false;
	assert.ok(!x.menu && !x.ui.guide && !x.ui.wrist.open, 'A: both wings and the arc');
});

test('holding the model: it follows the grip, level (turned only about the vertical); let go in the air it floats, then goes home by itself', async () => {
	const { x, press, frame, hands } = await setup();
	const d = x.modes.dollhouse;
	const home = new THREE.Vector3(0, d.doll.pos.y, -x.plinthDistance); // (the middle of the plinth)
	const grip = hands.right.grip;
	hands.left.grip.visible = grip.visible = true; // (tracked)
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
	// A controller near it (within 30 cm) keeps it waiting (held: never perfectly still).
	for (let i = 0; i < 72 * 5; i++) { grip.position.x += i % 2 ? 0.004 : -0.004; frame(); }
	assert.ok(d.floating && !d.floating.going, 'a hand near it: it waits');
	// Hands away: 4 s, then the glide home (1.6 s), level again.
	grip.position.set(2, 0, 2);
	hands.left.grip.position.set(-2, 0, 2);
	for (let i = 0; i < 72 * 3.5; i++) frame();
	assert.ok(d.floating && !d.floating.going, 'still counting down');
	for (let i = 0; i < 72 * 1.5; i++) frame();
	assert.ok(d.floating?.going, 'gliding home: it takes its time (1.6 s, not cut to 0.3 s)');
	for (let i = 0; i < 72 * 1.5; i++) frame();
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

test('a held key (the held-key code kept for the wrist\'s round ← Back, next build step 5): pressed once held 0.6 s; let go early, nothing', async () => {
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
	// (No door is held today: Walk in → is made a held key for this test.)
	const spec = d.doors.keys.get('in').spec;
	d.doors.setSpec('in', { ...spec, hold: 0.6 });
	for (let i = 0; i < 15; i++) frame(); // (the laser rests on it first: a laser only passing over never presses)
	aimAt('in');
	for (let i = 0; i < 15; i++) frame();
	press('right', 'trigger'); for (let i = 0; i < 25; i++) frame(); // 0.35 s
	press('right', 'trigger', false); for (let i = 0; i < 10; i++) frame();
	assert.ok(x.mode === 'dollhouse' && !x.layerFx, 'let go early: nothing');
	press('right', 'trigger'); for (let i = 0; i < 50; i++) frame(); // 0.7 s
	assert.ok(x.layerFx?.dir === 'in', 'held 0.6 s: pressed');
	press('right', 'trigger', false); settle();
	assert.equal(x.mode, 'walk');
	d.doors.setSpec('in', spec);
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

test('the fan shows the camera from the front, the meter and the marker from the side, each with a name tag', async () => {
	const { x } = await setup();
	const by = Object.fromEntries(x.fan.slots.map((s) => [s.name, s]));
	assert.equal(by.camera.pose.rotation.y, Math.PI, 'camera: lens towards you');
	assert.equal(by.meter.pose.rotation.y, Math.PI / 2, 'meter: side on');
	assert.equal(by.marker.pose.rotation.y, Math.PI / 2, 'marker: side on');
	assert.deepEqual(x.fan.slots.map((s) => s.label.text), ['Camera', 'Meter', 'Marker']);
	assert.ok(x.fan.slots.every((s) => s.label.mesh.parent === s.home && s.object.parent === s.pose), 'tags beside the tools, tools in their pose');
});

test('the tool fan: floats over the tracked left hand, wherever it is; the right tip touches a tool, the grip takes it, swaps, puts back', async () => {
	const { x, press, frame, hands } = await setup();
	const fan = x.fan;
	// The left controller held up in front of you, the right one down at your side.
	hands.left.grip.visible = hands.right.grip.visible = true; // (tracked)
	hands.left.grip.position.set(-0.1, 1.3, -0.45);
	hands.right.grip.position.set(0.3, 0.8, 0);
	for (let i = 0; i < 20; i++) frame();
	assert.ok(fan.group.visible && fan.alpha === 1, 'over the left hand');
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
	// Hand lowered: the tools stay over it (no raise, no watch pose since the next build's step 1).
	hands.left.grip.position.set(-0.3, 0.7, 0);
	for (let i = 0; i < 30; i++) frame();
	const anchor = hands.left.grip.getWorldPosition(new THREE.Vector3());
	assert.ok(fan.group.visible && fan.alpha === 1 && fan.group.position.y > anchor.y, 'still over the hand, lowered');
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

test('Vision Pro look-and-pinch: a pinch on a room steps inside; inside, on the floor, teleports; never presses a held key', async () => {
	const { act } = await import('../js/transient-pointer.js');
	const { x, ended, frame, settle } = await setup();
	frame();
	const head = x.headWorld();
	// A held key needs its hold: a single pinch on it does nothing (Walk in → made one for this check).
	const doors = x.modes.dollhouse.doors, spec = doors.keys.get('in').spec;
	doors.setSpec('in', { ...spec, hold: 0.6 });
	const door = doors.keys.get('in').face.getWorldPosition(new THREE.Vector3());
	assert.equal(act(x, head, door.clone().sub(head)), null);
	assert.equal(ended(), 0);
	doors.setSpec('in', spec);
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

test('round scales only, one per visit: the plate and the model rest on 1:5, 1:10, 1:15 ... never 1:23 or 1:8; the stick turns, never zooms', async () => {
	const { roundScale, roundScaleUp, ROUND_SCALES } = await import('../js/xr-dollhouse.js');
	assert.equal(roundScale(23), 25); assert.equal(roundScale(8), 10); assert.equal(roundScale(12), 10); assert.equal(roundScale(13), 15);
	assert.equal(roundScaleUp(23.4), 25, 'the fit scale rounds up, so the model still fits'); assert.equal(roundScaleUp(25), 25);
	const { x, frame } = await setup();
	frame();
	const d = x.modes.dollhouse, ratio = () => 1 / (x.baseScale * d.doll.zoom);
	assert.ok(ROUND_SCALES.includes(Math.round(ratio())) && Math.abs(ratio() - Math.round(ratio())) < 1e-6, `on entry: 1:${ratio()}`);
	assert.equal(x.plate.text, `1:${Math.round(ratio())}`);
	// The stick up and down does nothing (zoom went on 26 Nov 2026); left and right turn the model.
	const pad = x.input.controllers[1].source.gamepad, before = ratio(), plate = x.plate.text, yaw = d.doll.yaw;
	pad.axes[3] = -1;
	for (let i = 0; i < 40; i++) frame();
	pad.axes[3] = 0;
	assert.ok(Math.abs(ratio() - before) < 1e-9 && x.plate.text === plate && d.doll.yaw === yaw, 'stick up: nothing');
	pad.axes[2] = 1;
	for (let i = 0; i < 10; i++) frame();
	pad.axes[2] = 0;
	assert.ok(d.doll.yaw !== yaw && Math.abs(ratio() - before) < 1e-9, 'stick right: it turns, at the same scale');
});

test('bare hands teleport with either empty hand; while one aims, the other\'s pinch does nothing (the first one wins)', async () => {
	const { momentBefore } = await import('../js/gestures.js');
	assert.equal(momentBefore([{ age: 0.85 }, { age: 0.9 }, { age: 1 }], 1, 0.1).age, 0.9, 'the moment 0.1 s before');
	assert.equal(momentBefore([], 1, 0.1), null);
	const { x, go } = await setup();
	go('in');
	const L = x.input.hands.left, R = x.input.hands.right;
	for (const [c, xPos] of [[L, -0.25], [R, 0.25]]) {
		c.isHand = true; c.isController = false; c.touch.tracked = true;
		c.gesture = { shape: { pinchAt: new THREE.Vector3(xPos, 1.15, -0.35) } };
		c.gestures = [];
	}
	x.input._gh = [L, R];
	assert.ok(x.emptyHand(L) && x.emptyHand(R), 'both empty: both may teleport');
	x.tools.held = { c: R, tool: {} };
	assert.ok(x.emptyHand(L) && !x.emptyHand(R), 'a hand holding a tool does not');
	x.tools.held = null;
	// The left hand pinches first: it aims; the right's pinch then does nothing.
	L.gestures = [{ type: 'pinch' }];
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele?.c, L, 'the left (not the main) hand aims');
	L.gestures = []; R.gestures = [{ type: 'pinch' }];
	x.modes.walk.handMoves(1 / 72);
	assert.equal(x.modes.walk.tele?.c, L, 'the right\'s pinch while the left aims: nothing');
	x.input._gh = null;
});

test('the areas: the tools home over the left hand in the left area; the hand over the model: they wait at the left edge; within reach of the other hand, they never slide away', async () => {
	const { x, frame, hands } = await setup();
	const fan = x.fan, deg = THREE.MathUtils.radToDeg;
	const { yawTo, angleDiff } = await import('../js/zones.js');
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.right.grip.position.set(0.4, 0.8, 0.1); // (the right hand at your side)
	hands.left.grip.position.set(-0.45, 1.2, -0.3); // (out to the left)
	for (let i = 0; i < 30; i++) frame();
	const L = x.input.controllers.indexOf(hands.left);
	assert.equal(x.areas.hands[L], 'left', 'the left hand in the left area');
	assert.equal(fan.mode, 'home');
	const home = fan.group.position.clone(), wrist = x.input.wristOf(hands.left).getWorldPosition(new THREE.Vector3());
	assert.ok(home.y > wrist.y + 0.1, 'home: above the hand');
	// The left hand over the model: they glide to the left edge and wait there, outside the centre.
	hands.left.grip.position.set(0, 1.2, -0.6);
	for (let i = 0; i < 72; i++) frame();
	assert.equal(x.areas.hands[L], 'centre');
	assert.equal(fan.mode, 'edge');
	const head = x.headWorld(), c = x.areas.centre, at = deg(angleDiff(c.left, yawTo(head, fan.group.position)));
	assert.ok(at > 2 && at < 4, `at the edge, 3° inside the left area (${at.toFixed(1)}°)`);
	const d = fan.group.position.distanceTo(head);
	assert.ok(d >= 0.4 - 1e-3 && d <= 0.6 + 1e-3, `0.40-0.60 m away (${d.toFixed(2)})`);
	// The right hand reaches for them: the left hand goes back home meanwhile, but they stay put.
	const waiting = fan.group.position.clone();
	hands.right.grip.position.copy(x.rig.worldToLocal(waiting.clone().add(new THREE.Vector3(0.05, 0, 0.12))));
	frame();
	hands.left.grip.position.set(-0.45, 1.2, -0.3);
	for (let i = 0; i < 30; i++) frame();
	assert.ok(fan.reach && fan.group.position.distanceTo(waiting) < 0.01, 'within reach: they stay where the hand reaches');
	hands.right.grip.position.set(0.4, 0.8, 0.1);
	for (let i = 0; i < 72; i++) frame();
	assert.ok(!fan.reach && fan.mode === 'home' && fan.group.position.distanceTo(fan._anchor) < 0.02, 'the hand gone: home again');
});

test('the orb never hides a live key: resting over the Walk in door it goes small and faint (touch unchanged); clear again it grows back after 0.4 s; looked at on purpose it stays full size', async () => {
	const { x, frame, hands } = await setup();
	const w = x.ui.wrist;
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.left.grip.position.set(-0.6, 0.8, 0.2); // (out of the way, far from the level keys)
	frame();
	const door = x.modes.dollhouse.doors.keys.get('in').face.getWorldPosition(new THREE.Vector3()), eye = x.headWorld();
	// The right wrist resting so its orb sits on the line from the eyes to the door.
	const want = eye.clone().lerp(door, 0.6); // (0.43 m from the eyes: resting, not raised to look; its tip well clear of the door)
	for (let i = 0; i < 3; i++) { const o = w.orb.group.getWorldPosition(new THREE.Vector3()); hands.right.grip.position.add(x.rig.worldToLocal(want.clone()).sub(x.rig.worldToLocal(o))); frame(); }
	for (let i = 0; i < 30; i++) frame();
	assert.ok(w.sightYield && w.orb.yieldK > 0.9 && !w.keyYield, `over the door: it yields (by sight, not by touch) ${JSON.stringify({ sight: w.sightYield, key: w.keyYield, k: w.orb.yieldK })}`);
	assert.ok(!w.orb.ringMat.depthWrite && w.orb.target.scale.x < 1, 'no depth while yielded; its laser target shrinks to its body');
	// Away: it grows back only after 0.4 s clear.
	hands.right.grip.position.set(0.5, 1.0, 0.1);
	for (let i = 0; i < 14; i++) frame(); // (0.19 s)
	assert.ok(w.sightYield, 'not at once');
	for (let i = 0; i < 30; i++) frame();
	assert.ok(!w.sightYield, 'after 0.4 s clear');
	// Raised to the eyes to look at it: never yields to sight.
	hands.right.grip.position.copy(x.rig.worldToLocal(eye.clone().lerp(door, 0.25)));
	for (let i = 0; i < 20; i++) frame();
	assert.ok(!w.sightYield, 'looked at on purpose (within 0.40 m): full size');
});

test('the fan: over the left controller however it is turned; the orb\'s own hand reaching into the fan: the orb yields', async () => {
	const { x, frame, hands } = await setup();
	const fan = x.fan;
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.left.grip.position.set(-0.1, 1.3, -0.45);
	hands.right.grip.position.set(0.3, 0.8, 0);
	hands.left.grip.rotation.set(0, 0, Math.PI / 2);
	for (let i = 0; i < 20; i++) frame();
	assert.ok(fan.group.visible && fan.alpha === 1, 'turned any way: the tools float over it');
	const p = new THREE.Vector3(), meter = fan.slots.find((s) => s.name === 'meter');
	// The orb's own hand reaching into the fan: no push; the orb shrinks and fades instead.
	meter.home.getWorldPosition(p);
	hands.right.grip.position.copy(x.rig.worldToLocal(p.clone().add(new THREE.Vector3(0.05, 0, 0.05))));
	for (let i = 0; i < 60; i++) frame();
	assert.ok(x.ui.wrist.orbYield && x.ui.wrist.orb.yieldK > 0.9, 'the orb yields');
	assert.ok(x.ui.wrist.orb.body.scale.x < 0.7 && x.ui.wrist.orb.shellMat.opacity < 0.3, 'half size, a third of the strength');
});

test('the plinth: one height, 1.24 m, for controllers and bare hands, 30 cm of table each side; it never moves by itself', async () => {
	const { x, frame } = await setup();
	const { PLINTH_HEIGHT: H, PLINTH_MARGIN } = await import('../js/xr-scene.js');
	const d = x.modes.dollhouse;
	frame();
	assert.equal(H, 1.24);
	assert.equal(x.plinthH, H, 'controllers: 1.24 m');
	const slabTop = () => new THREE.Box3().setFromObject(x.pedestal.children[0]).max.y; // (the top slab)
	const box = new THREE.Box3().setFromObject(x.pedestal.children[0]);
	assert.ok(Math.abs(slabTop() - H) < 1e-6, 'its top at 1.24 m');
	assert.ok(Math.abs(box.max.x - box.min.x - x.plinthSize.W) < 1e-6 && PLINTH_MARGIN === 0.3, '30 cm of table each side');
	assert.ok(Math.abs(d.doll.pos.y - H - 0.004) < 1e-6, 'the model on it');
	// The controllers put down: only bare hands. Nothing moves.
	x.input.controllers.forEach((c) => { c.source = null; });
	const handEntry = x.input.controllers[0], realTouch = x.input.updateTouch;
	x.input.updateTouch = function (c) { realTouch.call(this, c); if (c === handEntry && !c.source) { c.isHand = true; c.touch.tracked = true; } };
	for (let i = 0; i < 200; i++) frame();
	assert.ok(x.plinthH === H && Math.abs(slabTop() - H) < 1e-6, 'bare hands: the same plinth');
	x.input.updateTouch = realTouch;
});

test('going home turns the model square to the plinth (unless you turned it with the stick)', async () => {
	const { squareYaw } = await import('../js/xr-dollhouse.js');
	const q = Math.PI / 2;
	assert.ok(Math.abs(squareYaw(0.3) - 0) < 1e-9 && Math.abs(squareYaw(1.3) - q) < 1e-9 && Math.abs(squareYaw(-2.8) + Math.PI) < 1e-9);
});

test('a laser on a wing hovers its cell', async () => {
	const { x, frame, hands } = await setup();
	hands.right.grip.visible = true;
	frame();
	x.ui.openMenu();
	frame();
	const p = x.menu, r = p.rects().find((t) => t.id === 'seethrough');
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
	assert.ok(x.menu.hover?.startsWith('seethrough|'), `hover=${x.menu.hover} hit=${hit?.distance} claim=${c.claim.trigger} active=${x.input.active().length} panels=${x.ui.openPanels().length} vis=${p.mesh.visible}`);
});

test('a press at empty space closes the wings (build 120, M1): a pull at the sky closes both and stays used up until let go; at the model, or with a tool in hand, nothing closes; a quick pinch the same', async () => {
	const { x, frame, press } = await setup();
	frame();
	const c = x.input.controllers[1], orig = x.input.setRaycaster.bind(x.input);
	let aim = null;
	x.input.setRaycaster = (cc, rc) => { if (cc === c && aim) { rc.set(aim.from, aim.dir); rc.far = 5; } else orig(cc, rc); };
	const head = x.headWorld().clone();
	const pull = () => { press('right', 'trigger'); frame(); };
	const letGo = () => { press('right', 'trigger', false); frame(); };
	x.menuAction('settings');
	aim = { from: head.clone(), dir: x.modes.dollhouse.modelBox().getCenter(new THREE.Vector3()).sub(head).normalize() };
	pull();
	assert.ok(x.menu && x.ui.guide, 'at the model: nothing closes');
	letGo();
	aim = { from: head.clone(), dir: new THREE.Vector3(0, 1, 0) };
	pull();
	assert.ok(!x.menu && !x.ui.guide, 'at the sky: both wings close');
	frame();
	assert.equal(c.claim.trigger, 'ui', 'the pull is used up while held (never also an aim)');
	letGo(); frame();
	assert.notEqual(c.claim.trigger, 'ui', 'let go: free again');
	// Bare hands: a quick pinch (gestures' tap) along the hand's aim ray.
	x.menuAction('settings');
	const h = x.input.controllers[0], saved = { isHand: h.isHand, gesture: h.gesture, gestures: h.gestures };
	const tap = (at) => { Object.assign(h, { isHand: true, gesture: { fist: false, shape: { pinchAt: at } }, gestures: [{ type: 'tap' }] }); return x.ui.handTaps(); };
	assert.equal(tap(head.clone().add(new THREE.Vector3(0.1, -0.9, -0.3))), false, 'below the waist: nothing');
	assert.ok(x.menu, '(still open)');
	assert.equal(tap(head.clone().add(new THREE.Vector3(0, -0.05, -0.3))), true, 'in front, aimed over the model at nothing: closes');
	assert.ok(!x.menu && !x.ui.guide);
	Object.assign(h, saved);
});

test('harmony, live keys only (rule 4; conflicts 2 and 11): the wrist arc fades the doors to 30% and they guard nothing; the orb makes room for a tip at a live key, claimed at 15 cm, let go at 25 cm', async () => {
	const { CLAIM } = await import('../js/xr-targets.js');
	assert.deepEqual(CLAIM, { near: 0.15, clear: 0.25 }, 'one place for every claim');
	const { x, frame, hands } = await setup();
	hands.left.grip.visible = hands.right.grip.visible = true; // (tracked)
	frame();
	const d = x.modes.dollhouse, w = x.ui.wrist;
	const walkIn = d.doors.keys.get('in') ?? [...d.doors.keys.values()][0];
	const doorAt = walkIn.group.getWorldPosition(new THREE.Vector3());
	assert.ok(d.doorsLive && x.nearKey(doorAt, CLAIM.near), 'live: a key');
	w.show({ pinned: true });
	for (let i = 0; i < 20; i++) frame();
	assert.ok(w.open && !d.doorsLive && Math.abs(d.doorAlpha - 0.3) < 1e-9 && d.doorGroup.visible, `the arc open: the doors at 30%, taking no presses (${d.doorAlpha})`);
	assert.ok(!x.nearKey(doorAt, CLAIM.near), 'faded: they guard nothing');
	w.close();
	for (let i = 0; i < 20; i++) frame();
	assert.ok(d.doorsLive && d.doorAlpha === 1, 'back once it closes');
	// The left controller's tip at Walk in →, then 20 cm away (still claimed), then 40 cm (let go).
	const put = (offset) => { const tip = doorAt.clone().add(offset); hands.left.grip.position.copy(x.rig.worldToLocal(tip.sub(new THREE.Vector3(0, 0, -0.045)))); frame(); return w.keyYield; };
	assert.equal(put(new THREE.Vector3(0, 0.05, 0)), true, 'a tip at a live key: the orb yields');
	assert.equal(put(new THREE.Vector3(0, 0.2, 0)), true, '20 cm: still (released at 25 cm)');
	assert.equal(put(new THREE.Vector3(0, 0.4, 0)), false, '40 cm: the orb is back');
	assert.ok(!w.fanYield && w.orbYield === w.keyYield);
});


test('harmony, conflict 8: the two Walk-in keys are one key (the waist door and the wrist key look, read and do the same)', async () => {
	const { x, frame } = await setup();
	frame();
	const door = x.modes.dollhouse.doors.keys.get('in').spec, wrist = x.ui.wrist;
	wrist.redraw();
	const key = wrist.pad.keys.get('right').spec;
	for (const k of ['id', 'look', 'icon', 'label', 'caption']) assert.equal(key[k], door[k], `the same ${k}`);
});
test('harmony, conflict 5: at the scale model a bare hand steps inside on letting go once the ray has shown 0.3 s, at the landing from 0.1 s before; a quicker pinch-and-open moves nothing', async () => {
	const { x } = await setup();
	const d = x.modes.dollhouse, spot = { model: new THREE.Vector3(1, 0, 1) }, other = { model: new THREE.Vector3(5, 0, 5) };
	const a = { age: 0, past: [], spot: null };
	for (let t = 0; t < 0.4; t += 1 / 72) { a.age += 1 / 72; a.spot = a.age > 0.38 ? other : spot; a.past.push({ age: a.age, spot: a.spot }); while (a.past.length > 2 && a.age - a.past[1].age > 0.1) a.past.shift(); }
	assert.equal(d.spotBefore(a, 0.1), spot, 'the landing from 0.1 s before the release (not the flick at the end)');
});

test('harmony, conflict 13: no wing corner within 5° of the house as seen (its covered rooms and what stands on them, not the lawn; 2° at the very least, once every other limit is spent) nor above +10°, every wing within 0.62 m, for Pond House and the Apartment, on the one plinth, with either main hand', async () => {
	const W = await import('../js/wings.js');
	const { PLINTH_HEIGHT } = await import('../js/xr-scene.js');
	for (const name of ['pond-house', 'apartment']) {
		const { x, frame } = await setup({ file: path.resolve(import.meta.dirname, `../examples/${name}.sh3d`) });
		frame();
		for (const h of [PLINTH_HEIGHT]) {
			for (const main of ['right', 'left']) {
				x.menuAction({ id: 'mainHand', value: main });
				x.ui.closeAll();
				x.menuAction('settings');
				x.scene.updateMatrixWorld(true);
				const head = x.headWorld(), yaw = x.ui.wingYaw, hull = W.zoneHull(W.zoneOf(x.modes.dollhouse.houseBox(), head, yaw));
				for (const panel of x.ui.openPanels()) {
					const g = panel.mesh.geometry.parameters;
					assert.ok(panel.mesh.position.distanceTo(x.rig.worldToLocal(head.clone())) <= 0.62 + 1e-6, `${name}, plinth ${h} m, ${panel.title}: within a fingertip's reach (${JSON.stringify(panel.placed)})`);
					for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
						const p = panel.mesh.localToWorld(new THREE.Vector3(sx * g.width / 2, sy * g.height / 2, 0));
						const a = W.angleOf(p, head, yaw);
						// (5° wherever the other limits suffice; the margin gives way last, never below 2°.)
						const spent = Math.abs(Math.abs(panel.placed.az) - W.WING.maxSide) < 1e-6 && panel.placed.dist >= W.WING.maxDist - 1e-6;
						assert.ok(panel.placed.margin >= W.WING.minMargin - 1e-9 && (panel.placed.margin >= W.WING.margin - 1e-9 || spent), `${name}, plinth ${h} m, ${panel.title}: the margin ${(panel.placed.margin * 180 / Math.PI).toFixed(1)}° only once every other limit is spent`);
						assert.ok(!W.inZone(a, hull, panel.placed.margin), `${name}, plinth ${h} m, ${main} hand, ${panel.title}: a corner at az ${(a.az * 180 / Math.PI).toFixed(1)}°, el ${(a.el * 180 / Math.PI).toFixed(1)}°; placed ${JSON.stringify(panel.placed)}`);
						assert.ok(a.el <= W.WING.ceiling + 1e-6, `${name}, plinth ${h} m, ${main} hand, ${panel.title}: a corner ${(a.el * 180 / Math.PI).toFixed(1)}° above the eyes (ceiling +10°)`);
					}
				}
			}
		}
		x.menuAction({ id: 'mainHand', value: 'right' });
	}
});

test('ladder rule 5: the tools guard the empty-space close only within 15 cm of a tool (they always show); the house box leaves the lawn out', async () => {
	const { x, frame } = await setup();
	frame();
	x.menuAction('settings');
	const c = x.input.controllers[1], head = x.headWorld().clone();
	x.raycaster.set(head, new THREE.Vector3(0, 1, 0)); x.raycaster.far = 5;
	x.fan.group.visible = true; x.fan.alpha = 1;
	x.claims = x.claimSnapshot();
	const tool = x.claims.tools[0];
	assert.ok(tool, 'the tools are in the snapshot');
	assert.equal(x.ui.notEmpty(c, [tool.clone().add(new THREE.Vector3(0, 0.1, 0))]), 'fan', 'a press 10 cm from a tool: the tools\' (never closes the wing)');
	assert.equal(x.ui.notEmpty(c, [tool.clone().add(new THREE.Vector3(0, 0.6, 0))]), null, '60 cm away: empty space, it closes');
	x.fan.alpha = 0; x.fan.group.visible = false; x.claims = null;
	// The house box (example home: no lawn) is within the whole box.
	const d = x.modes.dollhouse, house = d.houseBox(), all = d.modelBox();
	assert.ok(all.containsBox(house.expandByScalar(-1e-6)), 'the house is inside the model');
});
