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
	x.fan.meter.m.units = 'cm'; // (whatever this machine's region: the meter's checks read metres)
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

test('the pause with no tip left (§1, revised): a steady place is the plain fade\'s short dark; an unsteady one shows the void, the rings and the place\'s name past 0.3 s, and fades in at 3 s', async () => {
	const { x, frame: step } = await setup();
	const { PAUSE } = await import('../js/pause.js');
	let clock = 0; // (the cap counts real seconds: here they pass with the frames)
	x.pause.clock = () => clock;
	const frame = (dt = 1 / 72) => { clock += dt; step(dt); };
	frame();
	// Steady: Walk in, then ten even frames after the move and it lifts; nothing shows.
	x.menuAction('in');
	let shown = false, n = 0;
	while (x.layerFx && !x.pause.fx.pause && n++ < 400) frame();
	n = 0;
	while (x.pause.fx?.pause && n++ < 400) { frame(1 / 36); shown ||= x.pause.group.visible; }
	assert.ok(!shown && n <= 11 && x.mode === 'walk', `steady: lifted after ${n} frames, nothing shown`);
	while (x.layerFx) frame();
	// Unsteady (every other frame over 3.5 refreshes): the void and the rings with the room's name, then in at the cap.
	x.menuAction('back');
	n = 0;
	while (x.layerFx && !x.pause.fx.pause && n++ < 400) frame();
	let t = 0, at = null;
	while (x.pause.fx?.pause && t < 10) {
		const dt = (n++ % 2) ? 1 / 16 : 1 / 72; // (every other frame over 3.5 refreshes: never ready)
		frame(dt); t += dt;
		if (at === null && x.pause.group.visible) at = { t, floor: x.pause.floor.visible };
	}
	assert.ok(at && at.t > PAUSE.GAP && at.t < PAUSE.GAP + 0.05 && at.floor, `past the 0.3 s gap: the void and the rings (${JSON.stringify(at)})`);
	assert.ok(Math.abs(t - PAUSE.READY_LIMIT) < 1 / 16 + 1e-6, `the cap: in at 3 s, within a frame (${t.toFixed(2)} s)`);
	assert.equal(x.pause.last.capped, true);
	while (x.layerFx) frame();
	// The cap is real seconds (the audit's S7): a stall of 1.4 s (one frame, its dt capped at 0.1 s) counts as 1.4 s.
	x.menuAction('in');
	n = 0;
	while (x.layerFx && !x.pause.fx.pause && n++ < 400) frame();
	frame(1 / 72); frame(1 / 36);
	clock += 1.4; step(0.1); // (the stall)
	t = 0;
	while (x.pause.fx?.pause && t < 3) { const dt = (n++ % 2) ? 1 / 16 : 1 / 72; frame(dt); t += dt; }
	assert.ok(t < 3 - 1.4 + 0.1, `in by 3 s of real time, the stall counted in full (${(t + 1.4 + 0.1).toFixed(2)} s)`);
	while (x.layerFx) frame();
	x.menuAction('back');
	while (x.layerFx) frame();
	while (x.layerFx) frame();
	assert.equal(x.mode, 'dollhouse');
	// Inside, the name is the room's.
	x.menuAction('in');
	n = 0;
	while (x.layerFx && !x.pause.fx.pause && n++ < 400) frame();
	t = 0;
	while (x.pause.fx?.pause && t < 1) { const dt = (n++ % 2) ? 1 / 16 : 1 / 72; frame(dt); t += dt; }
	assert.ok(x.roomHere() && x.pause.tipLabel.text === x.roomHere() && x.pause.tipLabel.mesh.visible, `Walk in: the room's name where the tip would be ("${x.pause.tipLabel.text}")`);
	while (x.layerFx) frame();
});

test('leaving VR leaves nothing stuck: mid walk-in the gallery\'s scale, an open dial, a Shadows switch still switching on (the audit\'s S5, C1, C2)', async () => {
	const { x, frame, hands } = await setup();
	frame();
	// Mid walk-in: the tunnel zoom scales the gallery up; the session ends.
	x.menuAction('in');
	for (let i = 0; i < 60 && x.stage.scale.x <= 1.05; i++) frame();
	assert.ok(x.stage.scale.x > 1.05, `the tunnel scales the gallery (${x.stage.scale.x.toFixed(2)})`);
	x.handleEnd();
	assert.equal(x.stage.scale.x, 1, 'back to its size');
	// A dial open (and its label), Shadows switching on: the session ends.
	const { x: y, frame: f2 } = await setup();
	f2();
	y.tools.take(y.fan.camera, y.input.hands.right);
	y.dial.step(y.fan.camera);
	assert.ok(y.dial.group.visible && y.dial.label.mesh.visible, 'the dial and its label shown');
	y.lighting ??= { shadows: false, time: 'morning', setShadows(v) { this.shadows = v; }, refresh() {}, setTime() {}, nextTime() {} }; // (no lighting in these tests: a stand-in)
	y.menuAction('shadows');
	assert.equal(y.shadowsBusy, true, 'Shadows switching on');
	y.handleEnd();
	assert.ok(!y.dial.open && !y.dial.group.visible && !y.dial.label.mesh.visible, 'the dial is gone from the 2D page');
	assert.equal(y.shadowsBusy, false, 'the switch is free again');
});

test('the settings wing: the same three tabs at both layers (How to move, View, General), no Close key (the foot says how to close), every target big enough to touch, 34 cm tall', async () => {
	const { x } = await setup();
	for (const p of Object.values(x.menus)) {
		assert.deepEqual(p.tabs.map((t) => t.label), ['How to move', 'View', 'General']);
		assert.deepEqual(p.tabs.map((t) => t.id), ['move', 'view', 'general']);
		assert.equal(p.lead, undefined, 'no How to move key: it is a tab');
		assert.deepEqual(shape(p.tabs[0].rows), ['guide:drawn:'], 'How to move: the guide alone');
		assert.deepEqual(shape(p.tabs[1].rows), ['light:choice:Time of day:Morning:Noon:Sunset:Night', 'shadows:switch:Shadows',
			'depth:switch:Depth shading', 'view:switch:Passthrough', 'seethrough:switch:Transparent walls']);
		assert.deepEqual(shape(p.tabs[2].rows), ['height:choice:Height:Yours:1.4 m:1.7 m:2.0 m', 'mainHand:choice:Main hand:Right:Left',
			'sound:switch:Sound'], 'General: Height, Main hand, Sound (New visitor went: build 215, B4)');
		assert.ok(!p.get('lens'), 'the camera\'s lens is on its dial, not on the wing');
		assert.ok(p.size.h / p.size.w * p.mesh.geometry.parameters.width <= 0.34 + 1e-6, `34 cm tall at most (harmony conflict 13): ${(p.size.h / p.size.w * p.mesh.geometry.parameters.width * 100).toFixed(1)} cm`);
		assert.equal(p.actions, undefined, 'no action rows on the board: the doors are on the wrist');
		assert.ok(!p.rects().some((r) => /close/i.test(r.id)) && /outside: close$/.test(p.hint), 'no Close key: the close line says how (build 120, M1)');
		// The close line fits beside the title at 18 px or more, both forms (about 0.55 em a character for the title's 28 px, the line's 18 px).
		const { CLOSE_HINT } = await import('../js/xr-menus.js'), { HINT_PX } = await import('../js/panel.js');
		for (const hint of Object.values(CLOSE_HINT)) assert.ok(p.title.length * 28 * 0.55 + 32 + hint.length * HINT_PX.min * 0.55 <= p.size.w - 2 * 16, `${p.title} + "${hint}" fit at ${HINT_PX.min} px`);
		assert.ok(!p.get('levels'), 'Levels is not on the board: a stack of keys beside the doors');
		// Touch targets: at least 4 cm (the wing is 40 cm wide).
		const m = p.mesh.geometry.parameters.width / p.size.w;
		for (const r of p.rects()) assert.ok(Math.min(r.w, r.h) * m >= 0.04 - 1e-9, `${r.id} ${r.value ?? ''}: ${(Math.min(r.w, r.h) * m * 100).toFixed(1)} cm`);
	}
	assert.equal(x.menus.dollhouse.title, 'Settings', 'one title at both layers');
	assert.equal(x.menus.walk.title, 'Settings');
	// Scale-model settings are greyed out inside; the boards are the same size whatever the tab.
	assert.ok(Object.values(x.menus).every((p) => !p.get('figure') && !p.get('photo') && !p.get('recentre') && !p.get('exit')), 'no figure, Photo, Recentre or Exit VR');
	const h = x.menus.dollhouse.size.h;
	for (const tab of ['general', 'move']) { x.menus.dollhouse.setTab(tab); assert.equal(x.menus.dollhouse.size.h, h, tab); }
	x.menus.dollhouse.setTab('view');
});

test('the wrist menu: two keys, the same at both layers: ← Back on the left (round, held 0.6 s), Settings on the right; Walk in → is on the plinth only', async () => {
	const { keysFor, BACK_HOLD } = await import('../js/wrist-menu.js');
	const doll = keysFor('dollhouse'), inside = keysFor('walk');
	assert.deepEqual(Object.fromEntries(Object.entries(doll).map(([k, v]) => [k, [v.id, v.look, v.label, v.caption ?? '', v.hold ?? 0]])), {
		left: ['back', 'outline', '\u2190 Back', 'Leave VR', BACK_HOLD], right: ['settings', 'plain', 'Settings', 'and help', 0],
	});
	assert.equal(BACK_HOLD, 0.6);
	assert.deepEqual([inside.left.id, inside.left.caption, inside.right.id], ['back', 'Scale model', 'settings'], 'inside: the same two keys');
	const { x } = await setup();
	assert.ok(x.ui.wrist.keys.left.round && !x.ui.wrist.keys.right.round, '← Back is round: the shape itself says "hold"');
});
test('B / Y with nothing open: a light tick on the press; held 0.6 s it is ← Back (the ring fills round the orb); a short press does nothing; let go early, the ring drains', async () => {
	const { x, press, frame, settle, go, ended } = await setup();
	go('in');
	const felt = [], play = x.haptics.play.bind(x.haptics);
	x.haptics.play = (c, name) => { felt.push(name); return play(c, name); };
	press('right', 'b'); frame();
	assert.deepEqual(felt, ['tick'], 'the press: a light tick at once (the hold has begun: the UX review\'s S4)');
	for (let i = 0; i < 9; i++) frame(); press('right', 'b', false); frame();
	assert.ok(x.mode === 'walk' && !x.layerFx, 'a short press: nothing');
	press('right', 'b'); for (let i = 0; i < 25; i++) frame();
	assert.ok(x.ui.wrist.backRing.group.visible && x.ui.wrist.backRing.shown > 0.4, 'the ring fills round the orb');
	assert.equal('#' + x.ui.wrist.backRing.fill.material.color.getHexString(), '#ffffff', 'in the light colour, over the room (the UX review\'s C3)');
	press('right', 'b', false); frame();
	for (let i = 0; i < 20; i++) frame();
	assert.ok(x.mode === 'walk' && x.ui.wrist.backRing.shown === 0, 'let go early: it drains back, nothing happens');
	press('right', 'b'); for (let i = 0; i < 50; i++) frame(); press('right', 'b', false); frame(); settle();
	assert.equal(x.mode, 'dollhouse', 'held 0.6 s: back to the scale model');
	press('right', 'b'); for (let i = 0; i < 50; i++) frame(); press('right', 'b', false); frame(); settle();
	assert.equal(ended(), 1, 'at the scale model, held: it leaves VR (one key, one behaviour)');
});

test('the held ← Back key fills from the first contact (the asks 3.2; the UX review\'s C2): a tip resting on its face, never pushed in, presses it at 0.6 s', async () => {
	const { x, frame, hands, ended } = await setup();
	const { TOUCH } = await import('../js/touch.js');
	hands.left.grip.visible = hands.right.grip.visible = true;
	frame();
	x.ui.wrist.show({ pinned: true });
	for (let i = 0; i < 30; i++) frame(); // (the keys spring out)
	const k = x.ui.wrist.keys.left;
	const put = (depth) => { // (the left controller's tip `depth` in front of the key's face: negative is pushed in)
		k.group.updateMatrixWorld(true);
		const at = k.group.localToWorld(new THREE.Vector3(0, 0, 0.006 + TOUCH.RADIUS + depth));
		const c = hands.left;
		c.grip.updateMatrixWorld(true);
		const tip = c.touch.tip.clone();
		c.grip.position.add(x.rig.worldToLocal(at.clone()).sub(x.rig.worldToLocal(tip)));
	};
	put(0.03); frame(); put(0.03); frame();
	for (let d = 0.03; d > 0.002; d -= 0.004) { put(d); frame(); } // (coming in from the front)
	let n = 0;
	for (; n < 72 && !x.layerFx && !ended(); n++) { put(-0.002); frame(); } // (resting on it: in contact, never past the 8 mm click)
	assert.ok(x.layerFx || ended(), `pressed after ${(n / 72).toFixed(2)} s in contact`);
	assert.ok(n / 72 >= 0.55 && n / 72 <= 0.7, `about 0.6 s (${(n / 72).toFixed(2)} s)`);
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
	// Along the arc, as seen: ← Back, then Settings; 50° apart on a 14 cm radius, 7 cm keys (Settings 11 cm long).
	const at = (slot) => w.keys[slot].group.position;
	const ang = (slot) => Math.round(THREE.MathUtils.radToDeg(Math.atan2(at(slot).y, at(slot).x)));
	assert.deepEqual(['left', 'right'].map(ang), [100, 50]);
	for (const slot of ['left', 'right']) assert.ok(Math.abs(at(slot).length() - 0.14) < 0.003, slot);
	assert.equal(WRIST.key, 0.07);
	assert.ok(['left', 'right'].every((s) => at(s).y > -0.03), 'the orb\'s underside stays clear');
	assert.ok(['left', 'right'].every((s) => at(s).distanceTo(new THREE.Vector3()) > 0.1), 'no key over the orb');
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
	assert.ok(Math.abs(key(0).group.position.x + 0.30) < 1e-9 && Math.abs(inn.group.position.x - 0.065) < 1e-9, 'the stack 30 cm left (within 45° of neck turn: the Designer, 26 Nov), Walk in where it was');
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
	const { TIPS } = await import('../js/xr-menus.js'), { gestureAt } = await import('../js/tip-demo.js');
	assert.deepEqual(Object.values(TIPS).flat().map((t) => t.demo), ['door', 'pinch', 'flick', 'touch', 'grab'], 'every tip has its looping demonstration');
	assert.ok(gestureAt('grab', 1.5).k === 1 && gestureAt('grab', 1.5).turn > 0.5 && gestureAt('grab', 2.95).k === 0, 'grab: the hand closes, turns, opens');
	assert.ok(gestureAt('touch', 1.8).disc === 1 && gestureAt('touch', 0.2).disc === 0, 'touch: the disc opens where the fingertip arrives');
	assert.ok(Math.abs(gestureAt('flick', 1.1).turn - 0.6) < 1e-9 && gestureAt('flick', 2).turn === 0, 'flick: aside and back');
	const all = newRecord(), ids = Array.from({ length: 6 }, () => nextTip('in', all, 'hands', { all: true }).id);
	assert.deepEqual(ids, ['walkin', 'teleport', 'turn', 'portal', 'grab', 'walkin'], '?tips: every tip in turn, never retired');
	// Ready (§1, revised 27 Nov): steady, not fast. Ten frames each at most 3.5 refreshes (49 ms at 72 Hz), none 100 ms or more.
	assert.ok(!isReady([0.01, 0.01]) && isReady(Array(10).fill(1 / 72)), 'ten even frames at 72 Hz: ready');
	const fps36 = Array(10).fill(1 / 36);
	assert.ok(isReady(fps36), 'an even 36 fps counts as ready after 10 frames (slow but steady)');
	const spiked = [...fps36, 0.1]; // (a 150 ms spike reads 0.1: the frame clock caps a frame there)
	assert.ok(!isReady(spiked), 'a 150 ms spike: not ready');
	const after = [...spiked];
	for (let i = 1; i <= 10; i++) { after.push(1 / 36); assert.equal(isReady(after), i >= 10, `the spike restarts the count: ${i} steady frames after it`); }
	assert.ok(isReady([1, 2, 1, 1, 2, 1, 2, 1, 1, 2].map((k) => k / 72)), 'one- and two-refresh frames mixed (a home between 36 and 72 fps): ready (the audit\'s S6)');
	assert.ok(isReady(Array(10).fill(3 / 72)) && !isReady(Array(10).fill(4 / 72)), 'three refreshes are steady, four are not');
	assert.ok(isReady(Array(10).fill(2 / 90), 1 / 90) && !isReady(Array(10).fill(4 / 90), 1 / 90), 'at 90 Hz, its own interval');
	assert.ok(!isReady(Array(10).fill(0.2)), 'an even 5 fps is never ready: the cap ends it');
	assert.equal(PAUSE.READY_LIMIT, 3, 'never stuck: 3 s from the first draw at most');
	// The tip at its size (the UX review's S7): capitals 1.2° at 1.4 m, 60 cm wide at most; the looping hand 8° or more under its lower edge.
	const { DEMO } = await import('../js/tip-demo.js');
	const deg = (r) => r * 180 / Math.PI, edge = PAUSE.BELOW + deg(Math.atan(PAUSE.TIP_H / 2 / PAUSE.AHEAD));
	assert.ok(DEMO.BELOW - edge >= 8, `the hand ${(DEMO.BELOW - edge).toFixed(1)}° under the tip's lower edge`);
	assert.ok(Math.abs(PAUSE.TIP_H * 768 / 112 - 0.6) < 0.001, 'the label can widen to 60 cm, no further');
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
	assert.ok(P.fx.pause && !P.fx.pause.tip && x.veil.amount('layer') === 1 && !P.group.visible, 'Enter VR: the dark from the first frame, no tip before the head has a pose (the audit\'s B1)');
	frame(); frame();
	assert.ok(!P.fx.pause.tip, 'still no pose: still choosing');
	x.camera.position.set(3, 1.6, 2); x.camera.rotation.set(0, 1, 0); x.camera.updateMatrix(); // (the head somewhere else, turned)
	x.viewerMatrix = () => x.camera.matrix.clone(); // (the headset's pose now)
	frame(); frame();
	assert.ok(P.fx.pause?.tip.id === 'walkin' && P.fx.pause.kind === 'controllers', 'the walk-in tip, in the controllers\' words');
	const ahead = P.group.position.clone().sub(x.camera.position).setY(0);
	assert.ok(Math.abs(ahead.length() - 1.4) < 0.15 && ahead.normalize().dot(new THREE.Vector3(-Math.sin(1), 0, -Math.cos(1))) > 0.99, `placed 1.4 m in front of the head (${ahead.length().toFixed(2)} m)`);
	x.camera.position.set(0, 1.6, 0); x.camera.rotation.set(0, 0, 0); x.camera.updateMatrix();
	press('right', 'trigger'); frame(); press('right', 'trigger', false); frame();
	assert.ok(!P.fx.pause.ending, 'too soon to skip');
	for (let i = 0; i < 72; i++) frame();
	press('right', 'trigger'); frame(); press('right', 'trigger', false); frame();
	assert.ok(P.fx.pause.ending && !P.fx.pause.ending.learnt, 'after 0.8 s: skipped, seen, not learnt');
	for (let i = 0; i < 200 && P.fx; i++) frame();
	assert.ok(!P.fx && x.veil.amount('layer') === 0, 'the room fades in');
});
test('one option per tool, on one dial: the stick steps it (the dial shows 1.5 s), a touch on the control part opens it, a stop chooses; a quiet ring on each control part, pulsing on the first take', async () => {
	const { x, frame, press, hands } = await setup();
	const { stopAngles, DIAL } = await import('../js/tool-dial.js');
	const a = stopAngles(4), gap = DIAL.RADIUS * (a[0] - a[1]);
	assert.ok(Math.abs(gap - (DIAL.STOP + DIAL.GAP)) < 1e-9 && Math.abs((a[0] + a[3]) / 2 - Math.PI / 2) < 1e-9, '22 mm stops, 12 mm apart, centred on the top');
	const cam = x.fan.camera, dial = x.dial;
	hands.right.grip.visible = hands.left.grip.visible = true;
	frame();
	x.tools.take(cam, hands.right);
	frame();
	const cue = dial.cues.get(cam);
	assert.ok(cue && cue.pulse > 0, 'the lens carries its quiet ring, pulsing on the first take');
	// Where each is seen in the hand (the UX review's S5): 2.5 mm, depth-tested; the camera's a flat ring facing up on its top's back edge,
	// the marker's a ring on its cap's end facing along the axis, the meter's a ring at its blade facing you.
	for (let i = 0; i < 3; i++) frame();
	const { CONTROL_CUE } = await import('../js/theme.js');
	const cues = Object.fromEntries([...dial.cues].map(([t, c]) => [t.name, c]));
	assert.ok(CONTROL_CUE.width === 0.0025 && Object.values(cues).every((c) => c.mesh.material.depthTest), '2.5 mm, depth-tested');
	const camN = new THREE.Vector3(0, 0, 1).applyQuaternion(cues.camera.mesh.quaternion), camG = cues.camera.mesh.geometry;
	camG.computeBoundingBox();
	assert.ok(camG.type === 'RingGeometry' && cues.camera.mesh.parent === cam.object && !cues.camera.faces && camG.boundingBox.max.y - camG.boundingBox.min.y < 1e-6 && cam.option.part === 'control', 'the camera: a flat ring facing up on its top edge, the touch zone there too (the Designer, 3.6)');
	assert.ok(cues.marker.mesh.geometry.type === 'RingGeometry' && cues.marker.mesh.parent === x.fan.marker.object && cues.marker.mesh.position.z > 0.082 && !cues.marker.faces, 'the marker: a ring on the cap\'s end, along the axis');
	assert.ok(cues.meter.faces, 'the meter: a ring at its blade, facing you');
	const lens0 = x.cameraLens;
	press('right', 'stick'); frame(); press('right', 'stick', false); frame();
	const { LENSES } = await import('../js/street-camera.js');
	assert.deepEqual(cam.option.stops.map((s) => [s.value, s.label]), [[24, 'Wide angle'], [50, 'Medium lens'], [75, 'Zoom lens']], 'three lenses, named (build 215, B3)');
	assert.ok(x.cameraLens !== lens0 && dial.open?.stepped && dial.label.mesh.visible && dial.label.text === LENSES.find((l) => l.mm === x.cameraLens).name, 'the stick: the next lens, the dial and its label');
	for (let i = 0; i < 120; i++) frame();
	assert.ok(!dial.open, 'stepped: it shows 1.5 s');
	// The other hand's tip on the lens: the dial opens; a stop chosen closes it.
	const lensAt = dial.partAt(cam).clone();
	hands.left.grip.position.copy(x.rig.worldToLocal(lensAt.clone().add(new THREE.Vector3(0, 0.01, 0.045))));
	frame(); frame();
	assert.ok(dial.open && !dial.open.stepped, 'touched: the dial opens');
	frame();
	assert.equal(dial.cues.get(cam).mesh.material.opacity, 1, 'while its dial is open, the part\'s quiet ring shows full');
	assert.equal(x.aimBlock(hands.left, lensAt), 'dial', 'while open it owns the other hand');
	// A controller's trigger too (the audit's S1): claimed before the place reads it, so a pull is never also a walk-in.
	const left = x.input.controllers[0];
	hands.left.ray.position.set(0, 1.3, 0); hands.left.ray.lookAt(new THREE.Vector3(0, 0.9, -x.plinthDistance)); hands.left.ray.updateMatrixWorld(true); // (its laser across the model)
	press('left', 'trigger'); frame();
	assert.ok(left.claim.trigger !== null && x.mode === 'dollhouse' && !x.layerFx, `the open dial owns the other trigger (the press outside closes it): no walk-in (claim ${left.claim.trigger})`);
	press('left', 'trigger', false); frame();
	assert.ok(!x.layerFx && x.mode === 'dollhouse', 'nor on release');
	dial.show(cam);
	const stop = dial.pad.keys.get('stop0');
	dial.choose(cam, cam.option.stops[0].value); dial.close();
	assert.equal(x.cameraLens, 24, 'a stop chosen: 24 mm');
	hands.left.grip.position.set(-0.4, 1.0, 0);
	x.tools.putBack();
	frame();
	assert.ok(stop && !dial.open);
	x.store.start();
});

test('the dial, the orb and the holding hand (the audit\'s S8; the Designer, §5.8): it floats 3 cm towards the eyes and 10 cm up, never within 0.30 m of them; stops 10 cm or more from the orb; nothing of the holding controller within 2 cm behind a stop (Quest 2, 3, Pro); a bare holding hand 4 cm or more from every stop; while open, the orb yields and its stops are live keys', async () => {
	const { x, frame, hands } = await setup();
	const { DIAL } = await import('../js/tool-dial.js');
	const { sceneOf } = await import('./glb-scene.js');
	const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
	const { HAND_POSES } = await import('../js/hand-poses.js'), { mirrorPose } = await import('../js/hand-model.js');
	// The grip in the target-ray space, as iwer gives it for the Quest 2, 3 and Pro (the same matrix, to 1e-7, for all three).
	const GRIP_OFFSET = {
		left: new THREE.Matrix4().fromArray([0.9925461411476135, 2.0823669899527886e-8, -0.12186937034130096, 0, 0.08617465198040009, 0.7071067094802856, 0.701836109161377, 0, 0.08617466688156128, -0.7071067690849304, 0.7018360495567322, 0, -0.003979838453233242, -0.015857907012104988, 0.04964181408286095, 1]),
		right: new THREE.Matrix4().fromArray([0.9925461411476135, -8.329467959811154e-8, 0.12186941504478455, 0, -0.08617465943098068, 0.7071066498756409, 0.7018361687660217, 0, -0.08617471158504486, -0.7071068286895752, 0.7018359303474426, 0, 0.003979798872023821, -0.015857888385653496, 0.049641866236925125, 1]),
	};
	const controller = (profile, hand) => { // (a real controller's surface, in its grip space)
		const scene = sceneOf(path.resolve(import.meta.dirname, `../vendor/controllers/${profile}/${hand}.glb`)), geos = [];
		scene.updateMatrixWorld(true);
		scene.traverse((o) => { if (o.isMesh) geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed()); });
		for (const g of geos) for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
		return new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
	};
	const stops = () => [...x.dial.pad.keys.values()].filter((k) => k.group.visible);
	const R = DIAL.STOP / 2, ray = new THREE.Raycaster(), rows = [];
	const OPEN = new Set(); // (names a case logged but not asserted; none: every check passes)
	hands.left.grip.visible = hands.right.grip.visible = true;
	for (const main of ['right', 'left']) {
		x.menuAction({ id: 'mainHand', value: main });
		const c = hands[main], side = main === 'right' ? 1 : -1;
		hands[main === 'right' ? 'left' : 'right'].grip.position.set(-0.45 * side, 0.9, 0.05);
		// Controllers: held in front at the chest, pointing a little down. The tool rides the target ray; the grip is the ray
		// times the device's grip offset, so the controller sits where it really does.
		c.ray.position.set(0.2 * side, 1.15, -0.35); c.ray.rotation.set(-0.3, 0, 0); c.ray.updateMatrix();
		c.grip.matrix.copy(c.ray.matrix).multiply(GRIP_OFFSET[main]); c.grip.matrix.decompose(c.grip.position, c.grip.quaternion, c.grip.scale);
		const ctls = Object.fromEntries(['oculus-touch-v3', 'meta-quest-touch-plus', 'meta-quest-touch-pro'].map((p) => [p, controller(p, main)]));
		for (const tool of [x.fan.camera, x.fan.meter, x.fan.marker]) {
			x.tools.take(tool, c);
			frame(); frame();
			x.dial.show(tool);
			x.scene.updateMatrixWorld(true);
			const orb = x.ui.wrist.orb.group.getWorldPosition(new THREE.Vector3());
			const least = Math.min(...stops().map((k) => k.group.getWorldPosition(new THREE.Vector3()).distanceTo(orb)));
			assert.ok(least >= 0.10, `${main} hand, ${tool.name}: the nearest stop ${(least * 100).toFixed(1)} cm from the orb (10 cm or more)`);
			// Behind each stop's face, along its normal: the 8 mm press plus 12 mm. Five lines (the middle and four edge points) per stop.
			const behind = {};
			for (const [profile, ctl] of Object.entries(ctls)) {
				ctl.matrix.copy(c.grip.matrixWorld); ctl.matrixAutoUpdate = false; ctl.matrixWorldNeedsUpdate = true; ctl.updateMatrixWorld(true);
				let worst = Infinity;
				for (const k of stops()) {
					const p = k.face.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(0, 0, -1).transformDirection(k.face.matrixWorld);
					for (const [dx, dy] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) {
						ray.set(k.face.localToWorld(new THREE.Vector3(dx, dy, 0)), n); ray.far = 0.02;
						const h = ray.intersectObject(ctl, false)[0];
						if (h) worst = Math.min(worst, h.distance);
					}
					void p;
				}
				behind[profile] = worst;
				if (!OPEN.has(`${main} ${tool.name}`)) assert.ok(worst === Infinity, `${main} hand, ${tool.name}, ${profile}: the controller ${(worst * 100).toFixed(1)} cm behind a stop's face (none within 2 cm)`);
			}
			// While open: the orb yields, and its stops are live keys (for the orb's sight and the touch guard).
			frame();
			assert.ok(x.ui.wrist.orbYield && x.liveKeys().length >= tool.option.stops.length, 'the orb yields; the stops are live keys');
			const stop = stops()[0].group.getWorldPosition(new THREE.Vector3());
			assert.ok(x.nearKey(stop.clone().add(new THREE.Vector3(0, 0, 0.05)), 0.15), 'a fingertip near a stop is near a live key');
			rows.push(`${main} ${tool.name}: ${(least * 100).toFixed(1)} cm from the orb; behind a stop: ${Object.entries(behind).map(([k, v]) => `${k.replace('meta-quest-touch-', '').replace('oculus-touch-v3', 'quest2')} ${v === Infinity ? 'clear' : (v * 100).toFixed(1) + ' cm'}`).join(', ')}`);
			x.dial.close();
			x.tools.putBack();
		}
		// Bare hands: the hand closed on the tool (iwer's fist preset), the tool at its wrist as the fan attaches it. Every stop
		// 4 cm or more from the hand's surface (each joint's sphere), in every direction: fingers are what collide.
		const pose = main === 'left' ? HAND_POSES.fist : mirrorPose(HAND_POSES.fist);
		const wristM = new THREE.Matrix4().fromArray(pose.wrist.m), handSpace = new THREE.Matrix4();
		Object.assign(c, { isHand: true, isController: false });
		c.wrist.position.set(0.2 * side, 1.1, -0.3); c.wrist.rotation.set(-0.3, 0, 0); c.wrist.updateMatrixWorld(true);
		handSpace.copy(c.wrist.matrixWorld).multiply(wristM.clone().invert());
		const joints = Object.values(pose).map((j) => ({ p: new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(j.m).premultiply(handSpace)), r: j.r }));
		for (const tool of [x.fan.camera, x.fan.meter, x.fan.marker]) {
			x.tools.take(tool, c);
			frame();
			Object.assign(c, { isHand: true, isController: false });
			c.wrist.position.set(0.2 * side, 1.1, -0.3); c.wrist.rotation.set(-0.3, 0, 0);
			x.dial.show(tool);
			x.scene.updateMatrixWorld(true);
			const gap = Math.min(...stops().flatMap((k) => { const p = k.group.getWorldPosition(new THREE.Vector3()); return joints.map((j) => p.distanceTo(j.p) - j.r - R); }));
			rows.push(`${main} ${tool.name}, bare hand: ${(gap * 100).toFixed(1)} cm from the hand`);
			if (!OPEN.has('bare hands')) assert.ok(gap >= 0.04, `${main} hand, ${tool.name}, bare hand: the nearest stop ${(gap * 100).toFixed(1)} cm from the holding hand (4 cm or more)`);
			x.dial.close();
			x.tools.putBack();
		}
		Object.assign(c, { isHand: false, isController: true });
	}
	console.log(`# the dial: ${rows.join('; ')}`);
	// Brought to the face: never nearer the eyes than 0.30 m, pushed out along the line from them.
	const c = hands.right, eye = x.headWorld().clone();
	x.menuAction({ id: 'mainHand', value: 'right' });
	c.ray.position.copy(x.rig.worldToLocal(eye.clone().add(new THREE.Vector3(0.02, -0.12, -0.12)))); c.ray.rotation.set(-0.3, 0, 0); c.ray.updateMatrix();
	x.tools.take(x.fan.meter, c);
	frame(); frame();
	x.dial.show(x.fan.meter);
	x.scene.updateMatrixWorld(true);
	const near = x.dial.group.getWorldPosition(new THREE.Vector3()).distanceTo(x.headWorld());
	assert.ok(near >= 0.30 - 1e-6, `never nearer the eyes than 0.30 m (${near.toFixed(3)} m)`);
	x.dial.close(); x.tools.putBack();
});

test('the framing guide: while the camera is held, a red frame where the photo\'s edges fall (its depth 0.3-8 m), 3:2 for the lens; hidden while the shutter fires; never in photos', async () => {
	const { x, frame, hands } = await setup();
	const { frameAt, GUIDE } = await import('../js/framing-guide.js');
	const { lensFov } = await import('../js/street-camera.js');
	const cam = x.fan.camera, g = cam.guide;
	hands.right.grip.visible = true;
	frame();
	assert.ok(!g.group.visible, 'not while the camera rests in the fan');
	x.tools.take(cam, hands.right);
	for (let i = 0; i < 30; i++) frame();
	assert.ok(g.group.visible && g.alpha === 1, 'held: the frame shows');
	assert.ok(g.dist >= GUIDE.NEAR && g.dist <= GUIDE.FAR, `its depth ${g.dist.toFixed(2)} m`);
	const pos = g.outline.geometry.attributes.position.array, xs = [], ys = [];
	for (let i = 0; i < pos.length; i += 3) { xs.push(pos[i]); ys.push(pos[i + 1]); }
	const { hw, hh } = frameAt(g.dist, lensFov(cam.mm));
	assert.ok(Math.abs(Math.max(...xs) - hw) < 1e-6 && Math.abs(Math.max(...ys) - hh) < 1e-6 && Math.abs(hw / hh - 1.5) < 1e-9, 'the photo\'s 3:2 frame at that depth');
	assert.ok(x.photoHidden.has(g.group), 'never in a photo');
	assert.ok(GUIDE.WIDTH === 0.003 && g.group.children.length === 1 && !g.lines, 'the outline alone, 3 mm at 1 m: no lines from the lens (the UX review\'s C5)');
	let shotFrom = null;
	x.capturePhoto = ({ eye }) => { shotFrom = eye; };
	cam.shoot();
	assert.ok(shotFrom && shotFrom.equals(g.poseMatrix()), 'the photo is shot from the frame\'s own smoothed pose');
	for (let i = 0; i < 20; i++) frame();
	assert.ok(g.alpha === 0, 'hidden while the shutter fires and the print pops');
	for (let i = 0; i < 40; i++) frame();
	assert.ok(g.alpha === 1, 'back after 0.4 s');
	x.tools.putBack();
	for (let i = 0; i < 30; i++) frame();
	assert.ok(!g.group.visible, 'put back: gone');
});

test('Shadows switched on says it works ("Shadows …") before the pause, then settles; off at once', async () => {
	const { x, frame } = await setup();
	x.lighting = { shadows: false, time: 'morning', setShadows(v) { this.shadows = v; }, fit() {}, refresh() {} };
	frame();
	x.menuAction('shadows');
	const cell = () => x.menus.dollhouse.get('shadows');
	assert.ok(x.shadowsBusy && cell().label === 'Shadows \u2026' && !x.lighting.shadows, 'first the busy label, shadows not yet on');
	for (let i = 0; i < 20; i++) frame();
	assert.ok(!x.shadowsBusy && x.lighting.shadows && cell().label === 'Shadows' && cell().value === true, 'then on, the label settled');
	x.menuAction('shadows');
	assert.ok(!x.lighting.shadows && cell().value === false, 'off: at once');
	x.lighting = null;
});

test('shared headsets: Height is per session (never stored, "Yours" at every Enter VR); no New visitor (build 215, B4: leaving VR and entering again starts over)', async () => {
	const { x, frame } = await setup();
	const { readSetting, writeSetting, SETTINGS } = await import('../js/settings.js');
	assert.equal(SETTINGS.height.scope, 'session');
	assert.ok(Object.entries(SETTINGS).every(([k, v]) => k === 'height' || !v.scope), 'every other setting is remembered');
	writeSetting('height', 1.7);
	assert.equal(readSetting('height'), 0, 'never stored: always "Yours" on reading');
	frame();
	assert.ok(!x.menus.walk.get('newVisitor') && !x.menus.dollhouse.get('newVisitor') && !x.newVisitor, 'New visitor is gone (the user\'s decision)');
	assert.equal(x.ui.doneLabel, undefined, 'and its done line');
});

test('which tab the wing opens on (the next-build asks 3.3): How to move the first time at each place in a session, then the last other tab used there (View at first)', async () => {
	const { x, go } = await setup();
	x.ui.openMenu();
	assert.equal(x.menu.tab, 'move', 'the scale model, first opening: How to move');
	x.ui.closeMenu(); x.ui.openMenu();
	assert.equal(x.menu.tab, 'view', 'then View');
	x.menu.setTab('general'); x.ui.closeMenu(); x.ui.openMenu();
	assert.equal(x.menu.tab, 'general', 'then the tab last used here');
	x.menu.setTab('move'); x.ui.closeMenu(); x.ui.openMenu();
	assert.equal(x.menu.tab, 'general', 'How to move is not "a settings tab used": still General');
	x.ui.closeMenu();
	go('in');
	x.ui.openMenu();
	assert.equal(x.menu, x.menus.walk);
	assert.equal(x.menu.tab, 'move', 'inside, first opening: How to move');
	x.ui.closeMenu(); x.ui.openMenu();
	assert.equal(x.menu.tab, 'view', 'inside keeps its own last tab');
	x.ui.closeMenu();
	go('back');
	x.ui.openMenu();
	assert.equal(x.menu.tab, 'general', 'back at the scale model: its own');
	x.ui.closeMenu();
	x.store.start(); // (a new session: Enter VR)
	x.ui.openMenu();
	assert.equal(x.menu.tab, 'move');
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

test('Sound: one switch (on: the effects)', async () => {
	const { x } = await setup();
	x.menuAction({ id: 'sound', value: false });
	assert.equal(x.soundLevel, 'off');
	assert.equal(x.sound.level, 'off');
	assert.equal(x.menus.walk.get('sound').value, false, 'the switch shows off');
	x.menuAction('sound'); // (pressed: it flips)
	assert.equal(x.sound.level, 'effects');
	assert.equal(x.menus.dollhouse.get('sound').value, true);
	x.menuAction({ id: 'sound', value: 'off' }); // (an old value still works)
	assert.equal(x.soundLevel, 'off');
	x.menuAction({ id: 'sound', value: true });
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
	x.menuAction('back'); // (← Back while the fade is under way: B is held 0.6 s now, longer than the fade)
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

test('How to move: the first tab, for the input in hand, here, with the build at its foot; at most four lines a guide, in the 355 px tab', async () => {
	const { x, frame } = await setup();
	frame();
	x.menuAction('settings');
	assert.ok(x.menu?.mesh.visible && x.menu.tab === 'move', 'Settings opens on How to move the first time');
	const cell = x.menu.cells.get('guide');
	assert.equal(cell.kind, 'dollhouse-controllers');
	assert.match(cell.foot, /^Build /);
	assert.equal(cell.h, 355);
	const { GUIDES, GUIDE_MAX_LINES } = await import('../js/xr-menus.js'), { LINES } = await import('../js/guide.js');
	for (const [kind, g] of Object.entries(GUIDES)) {
		assert.ok(g.lines.length <= GUIDE_MAX_LINES, `${kind}: ${g.lines.length} lines`);
		assert.ok(!g.lines.some((l) => /close/i.test(l)), `${kind}: no close line (the wing's header says it)`);
	}
	// Four lines fit: 128 px frames (the 548 px inner width / 4, less the gaps), 84 px to the first line, 34 px apart, the foot below.
	const size = Math.min((x.menu.size.w - 2 * 16 - 3 * 12) / 4, cell.h * 0.42);
	assert.ok(size + LINES.below + (GUIDE_MAX_LINES - 1) * LINES.step + 34 <= cell.h, `four lines: ${size + LINES.below + 3 * LINES.step + 34} px <= ${cell.h}`);
	assert.ok(LINES.px === 24 && LINES.min === 20, 'lines at 24 px, never under 20');
	assert.equal(GUIDES['dollhouse-hands'].frames[3], 'Let go: walk in');
	assert.ok(!JSON.stringify(GUIDES).includes('step inside') && !JSON.stringify((await import('../js/xr-menus.js')).TIPS).includes('step inside'), 'one verb: walk in (the UX review\'s S2)');
	x.menuAction('settings');
	assert.equal(x.menu, null, 'Settings again: closed');
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

test('the wrist key opens the one wing and closes it; no second wing', async () => {
	const { x } = await setup();
	x.menuAction('settings');
	assert.ok(x.menu && x.ui.openPanels().length === 1, 'one wing');
	assert.equal(x.ui.guide, undefined, 'no How to move wing');
	x.menuAction('settings');
	assert.ok(!x.menu && x.ui.openPanels().length === 0, 'again: closed');
	assert.ok(!x.scene.getObjectByName('guide-wing'), 'no second wing in the scene');
});

test('the wing: on the main hand\'s side, 30° or more off straight ahead', async () => {
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
		const s = angle(x.menu), side = main === 'right' ? -1 : 1;
		assert.ok(Math.sign(s) === side && Math.abs(s) >= 30, `${main}: settings ${s.toFixed(0)}`);
		x.ui.closeAll();
	}
	x.menuAction({ id: 'mainHand', value: 'right' });
});

test('the orb, or A, with a wing open closes everything', async () => {
	const { x, frame } = await setup();
	frame();
	x.menuAction('settings');
	assert.ok(x.menu);
	const wearer = x.ui.wrist.wearer;
	assert.ok(wearer, 'the orb is worn');
	wearer.state.down.a = true;
	x.ui.buttons();
	wearer.state.down.a = false;
	assert.ok(!x.menu && !x.ui.wrist.open, 'A: the wing and the arc');
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
	x.capturePhoto = (o) => { shots++; assert.ok(o.width / o.height === 1.5 && Math.abs(o.fov - 53.1) < 0.1, '3:2, 24 mm (wide angle, the default)'); };
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
		if (k % 5 === 0) marker.option.set(marker.option.stops[(marker.ink + 1) % marker.option.stops.length].value);
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
	// Within reach (0.25 m, let go at 0.35 m): the orb ignores touches (fanBusy follows the reach), and the tools are live keys for its line of
	// sight, so it never hides the tool you reach for; it no longer shrinks for the reach itself (the Designer, after the audit).
	assert.ok(fan.fanBusy, 'fanBusy is the reach');
	assert.ok(x.liveKeys().filter((k) => Math.abs(k.r - 0.06) < 1e-9).length === fan.slots.filter((s) => !s.held).length, 'the tools are live keys for the orb\'s sight');
	assert.equal(x.ui.wrist.orbYield, x.ui.wrist.keyYield || x.ui.wrist.sightYield, 'the orb makes room only for a key or by sight');
	hands.right.grip.position.set(0.4, 0.8, 0.1);
	for (let i = 0; i < 72; i++) frame();
	assert.ok(!fan.reach && fan.mode === 'home' && fan.group.position.distanceTo(fan._anchor) < 0.02, 'the hand gone: home again');
});

test('a tool touched and held still ticks once, not like an alarm; touched again after a second, once more (build 215, A7)', async () => {
	const { x, frame, hands } = await setup();
	const fan = x.fan, ticks = [];
	const play = x.sound.play.bind(x.sound);
	x.sound.play = (name, ...a) => { if (name === 'tick') ticks.push(fan.t); return play(name, ...a); };
	if (x.soundLevel === 'off') x.menuAction({ id: 'sound', value: true });
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.right.grip.position.set(0.4, 0.8, 0.1);
	hands.left.grip.position.set(-0.45, 1.2, -0.3);
	for (let i = 0; i < 40; i++) frame();
	// The right tip held still 3 cm from where the meter (the middle) rests, under it (the lift goes up, away from the tip).
	const meter = fan.slots.findIndex((s) => s.name === 'meter');
	const at = fan.restWorld(meter).add(new THREE.Vector3(0, -0.03, 0));
	for (let i = 0; i < 3; i++) { hands.right.grip.position.add(x.rig.worldToLocal(at.clone()).sub(x.rig.worldToLocal(hands.right.touch.tip.clone()))); frame(); }
	for (let i = 0; i < 72 * 3; i++) frame(); // (3 s, the tools bobbing)
	assert.equal(ticks.length, 1, `one tick in 3 s (${ticks.length})`);
	assert.equal(fan.hot?.name, 'meter', 'the meter stays touched');
	// Away and back: one more tick; away and back again at once (within a second of it): none.
	const back = () => { for (let i = 0; i < 3; i++) { hands.right.grip.position.add(x.rig.worldToLocal(fan.restWorld(meter).add(new THREE.Vector3(0, -0.03, 0))).sub(x.rig.worldToLocal(hands.right.touch.tip.clone()))); frame(); } };
	hands.right.grip.position.set(0.4, 0.8, 0.1); for (let i = 0; i < 10; i++) frame();
	back();
	assert.equal(ticks.length, 2, 'a new approach: one more');
	hands.right.grip.position.set(0.4, 0.8, 0.1); for (let i = 0; i < 10; i++) frame();
	back();
	assert.equal(ticks.length, 2, 'back again within a second of it: none');
	x.sound.play = play;
});

test('the orb never hides a live key: resting over the Walk in door it goes small and faint (touch unchanged); clear again it grows back after 0.4 s; near the eyes it still yields; touched while yielded it opens', async () => {
	const { x, frame, hands } = await setup();
	const w = x.ui.wrist;
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.left.grip.position.set(-0.6, 0.8, 0.2); // (out of the way, far from the level keys)
	frame();
	const door = x.modes.dollhouse.doors.keys.get('in').face.getWorldPosition(new THREE.Vector3()), eye = x.headWorld();
	// The right wrist resting so its orb sits on the line from the eyes to the door.
	const want = eye.clone().lerp(door, 0.5); // (about 0.35 m from the eyes: resting, not raised to look; its tip clear of the door's 15 cm)
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
	// Close to the eyes on the line (0.32-0.39 m, as measured in use), looking at the door: it still yields (no "on purpose" exception).
	const d = door.distanceTo(eye), near = eye.clone().lerp(door, 0.35 / d);
	for (let i = 0; i < 3; i++) { const o = w.orb.group.getWorldPosition(new THREE.Vector3()); hands.right.grip.position.add(x.rig.worldToLocal(near.clone()).sub(x.rig.worldToLocal(o))); frame(); }
	for (let i = 0; i < 20; i++) frame();
	assert.ok(w.sightYield, 'at 0.35 m on the line: it yields');
	// Touch still works on the yielded orb: a tip within 3.5 cm of its centre opens the menu.
	const orbAt = w.orb.group.getWorldPosition(new THREE.Vector3());
	hands.left.grip.position.copy(x.rig.worldToLocal(orbAt.clone().add(new THREE.Vector3(0, 0.01, 0.045))));
	for (let i = 0; i < 4; i++) frame();
	assert.ok(w.open, 'touched while yielded: the wrist menu opens');
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

test('going home turns the model back to its heading on the plinth, the short way (build 215, A6)', async () => {
	const { homeYaw } = await import('../js/xr-dollhouse.js');
	const q = Math.PI / 2, near = (a, b) => Math.abs(a - b) < 1e-9;
	assert.ok(near(homeYaw(q, 0), 0) && near(Math.cos(homeYaw(Math.PI, 0)), 1), 'a quarter or half turn in the air: undone');
	assert.ok(near(homeYaw(0.3, 0), 0) && near(homeYaw(-0.3, 0), 0), 'a small turn: undone too');
	assert.ok(near(homeYaw(2 * Math.PI + 0.2, 0), 2 * Math.PI), 'never the long way round: a whole turn more is the same heading');
	assert.ok(near(homeYaw(1.0, 0.4), 0.4), 'turned on the plinth first (the stick): back to that heading');
	// In a session: taken from the plinth turned 0.4, turned a quarter in the air, let go: it glides home at 0.4.
	const { x, frame } = await setup();
	frame();
	const d = x.modes.dollhouse;
	d.doll.yaw = 0.4;
	const c = x.input.hands.right;
	d.startGrab(c);
	d.doll.yaw = 0.4 + q; d.grab = null; d.floating = { wait: 0, going: null };
	d.goHome();
	for (let i = 0; i < 200; i++) frame();
	assert.ok(near(((d.doll.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 0.4), `home at its plinth heading (${d.doll.yaw.toFixed(3)})`);
});

test('a laser on a wing hovers its cell', async () => {
	const { x, frame, hands } = await setup();
	hands.right.grip.visible = true;
	frame();
	x.ui.openMenu(undefined, 'view');
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

test('a press at empty space closes the wing (build 120, M1): a pull at the sky closes it and stays used up until let go; at the model, or with a tool in hand, nothing closes; a quick pinch the same', async () => {
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
	assert.ok(x.menu, 'at the model: nothing closes');
	letGo();
	aim = { from: head.clone(), dir: new THREE.Vector3(0, 1, 0) };
	pull();
	assert.ok(!x.menu, 'at the sky: the wing closes');
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
	assert.ok(!x.menu);
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
	assert.ok(!x.fan.fanBusy && w.orbYield === w.keyYield);
});


test('harmony, conflict 5: at the scale model a bare hand steps inside on letting go once the ray has shown 0.3 s, at the landing from 0.1 s before; a quicker pinch-and-open moves nothing', async () => {
	const { x } = await setup();
	const d = x.modes.dollhouse, spot = { model: new THREE.Vector3(1, 0, 1) }, other = { model: new THREE.Vector3(5, 0, 5) };
	const a = { age: 0, past: [], spot: null };
	for (let t = 0; t < 0.4; t += 1 / 72) { a.age += 1 / 72; a.spot = a.age > 0.38 ? other : spot; a.past.push({ age: a.age, spot: a.spot }); while (a.past.length > 2 && a.age - a.past[1].age > 0.1) a.past.shift(); }
	assert.equal(d.spotBefore(a, 0.1), spot, 'the landing from 0.1 s before the release (not the flick at the end)');
});

test('harmony, conflict 13: no wing corner within 5° of the house as seen (its covered rooms and what stands on them, not the lawn; 2° at the very least, once every other limit is spent) nor above +10°, every wing within 0.62 m with bare hands; with controllers 15° below the eyes, within 0.75 m, rising only past it, its row text 0.7° or more (build 215, B5); for the three homes, on the one plinth, with either main hand', async () => {
	const W = await import('../js/wings.js');
	const { PLINTH_HEIGHT } = await import('../js/xr-scene.js');
	const caps = [];
	for (const name of ['example-home', 'pond-house', 'apartment']) for (const input of ['controllers', 'hands']) {
		const { x, frame } = await setup({ file: path.resolve(import.meta.dirname, `../examples/${name}.sh3d`) });
		if (input === 'hands') x.input.controllers.forEach((c) => { c.source = null; }); // (no controller in use: the wing within a fingertip's reach)
		frame();
		for (const h of [PLINTH_HEIGHT]) {
			for (const main of ['right', 'left']) {
				x.menuAction({ id: 'mainHand', value: main });
				x.ui.closeAll();
				x.menuAction('settings');
				x.scene.updateMatrixWorld(true);
				const head = x.headWorld(), yaw = x.ui.wingYaw, hull = W.zoneHull(W.zoneOf(x.modes.dollhouse.houseBox(), head, yaw));
				for (const panel of x.ui.openPanels()) {
					const g = panel.mesh.geometry.parameters, far = panel.mesh.position.distanceTo(x.rig.worldToLocal(head.clone()));
					if (input === 'hands') assert.ok(far <= 0.62 + 1e-6, `${name}, plinth ${h} m, ${panel.title}: within a fingertip's reach (${JSON.stringify(panel.placed)})`);
					else {
						// Controllers (build 215's B5): 15° below the eyes, cleared by distance up to 0.75 m; only past that cap does it rise.
						const rose = panel.placed.el > -W.WING.drop + 1e-9;
						assert.ok(far <= W.WING.laserDist + 1e-6 && (!rose || panel.placed.dist >= W.WING.laserDist - 1e-6), `${name}, ${panel.title}, controllers: within ${W.WING.laserDist} m, rising only past it (${JSON.stringify(panel.placed)})`);
						// Its row labels 15% larger, so their text keeps at least 0.7° (the handbook's body size; 32 px read 0.88° at 0.55 m, the Designer's figure).
						const deg = 0.88 * (panel.labelPx / 32) * (0.55 / far);
						assert.ok(panel.labelPx === Math.round(32 * 1.15) && deg >= 0.7, `${name}, controllers: row text ${deg.toFixed(2)}° at ${far.toFixed(2)} m`);
						caps.push(`${name}${main === 'left' ? ' (left main hand)' : ''}: ${far.toFixed(2)} m, ${(panel.placed.el * 180 / Math.PI).toFixed(0)}° from the eyes${rose ? ', rose' : ''}`);
					}
					for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
						const p = panel.mesh.localToWorld(new THREE.Vector3(sx * g.width / 2, sy * g.height / 2, 0));
						const a = W.angleOf(p, head, yaw);
						// (5° wherever the other limits suffice; the margin gives way last, never below 2°.)
						const spent = Math.abs(Math.abs(panel.placed.az) - W.WING.maxSide) < 1e-6 && panel.placed.dist >= (input === 'hands' ? W.WING.maxDist : W.WING.laserDist) - 1e-6;
						assert.ok(panel.placed.margin >= W.WING.minMargin - 1e-9 && (panel.placed.margin >= W.WING.margin - 1e-9 || spent), `${name}, plinth ${h} m, ${panel.title}: the margin ${(panel.placed.margin * 180 / Math.PI).toFixed(1)}° only once every other limit is spent`);
						assert.ok(!W.inZone(a, hull, panel.placed.margin), `${name}, plinth ${h} m, ${main} hand, ${panel.title}: a corner at az ${(a.az * 180 / Math.PI).toFixed(1)}°, el ${(a.el * 180 / Math.PI).toFixed(1)}°; placed ${JSON.stringify(panel.placed)}`);
						assert.ok(a.el <= W.WING.ceiling + 1e-6, `${name}, plinth ${h} m, ${main} hand, ${panel.title}: a corner ${(a.el * 180 / Math.PI).toFixed(1)}° above the eyes (ceiling +10°)`);
					}
				}
			}
		}
		x.menuAction({ id: 'mainHand', value: 'right' });
	}
	console.log(`The controllers' wing at the scale model: ${caps.join('; ')}`);
});

test('the plinth keys (step 1.2; the Designer\'s fix, 26 Nov): within laser reach, at most 60° below the eye line and 45° of neck turn, and at least 2° under the line to the model\'s near edge, in all three homes', async () => {
	for (const name of ['example-home', 'pond-house', 'apartment']) {
		const { x, frame } = await setup({ file: path.resolve(import.meta.dirname, `../examples/${name}.sh3d`) });
		for (let i = 0; i < 4; i++) frame();
		const d = x.modes.dollhouse, eye = x.headWorld().clone();
		x.scene.updateMatrixWorld(true);
		const keys = [...d.doors.keys].filter(([, k]) => k.group.visible);
		assert.ok(keys.some(([s]) => s === 'in') && (name !== 'pond-house' || keys.some(([s]) => s.startsWith('level'))), `${name}: the doors and the level keys (${keys.map(([s]) => s)})`);
		const rows = [];
		for (const [slot, k] of keys) {
			const p = k.group.getWorldPosition(new THREE.Vector3()), to = p.clone().sub(eye);
			const below = THREE.MathUtils.radToDeg(Math.atan2(-to.y, Math.hypot(to.x, to.z))), side = THREE.MathUtils.radToDeg(Math.atan2(to.x, -to.z));
			rows.push(`${slot} ${to.length().toFixed(2)} m, ${below.toFixed(0)}° down, ${side.toFixed(0)}° across`);
			assert.ok(to.length() < 1.5, `${name} ${slot}: ${to.length().toFixed(2)} m from the eyes, well inside the 5 m laser`);
			assert.ok(below <= 60.5 && Math.abs(side) <= 45, `${name} ${slot}: within the handbook's limits (${rows.at(-1)})`);
			// The model's near edge, seen from the eyes straight towards the key: the key stays at least 2° below it.
			const box = d.houseBox(), dir = new THREE.Vector3(to.x, 0, to.z).normalize();
			const ray = new THREE.Ray(new THREE.Vector3(eye.x, box.min.y + 1e-4, eye.z), dir), hit = ray.intersectBox(box, new THREE.Vector3());
			if (hit) {
				const edge = THREE.MathUtils.radToDeg(Math.atan2(eye.y - box.min.y, Math.hypot(hit.x - eye.x, hit.z - eye.z)));
				rows[rows.length - 1] += ` (the model's near edge ${edge.toFixed(1)}° down)`;
				assert.ok(below >= edge + 2, `${name} ${slot}: under the line to the model's near edge (${rows.at(-1)})`);
			}
		}
		console.log(`# ${name}: ${rows.join('; ')}`);
	}
});

test('the waiting tools never park on the levels stack (the UX review\'s S1): Pond House, the left hand over the model', async () => {
	const { x, frame, hands } = await setup({ file: path.resolve(import.meta.dirname, '../examples/pond-house.sh3d') });
	const { yawTo, angleDiff } = await import('../js/zones.js');
	hands.left.grip.visible = hands.right.grip.visible = true;
	hands.right.grip.position.set(0.4, 0.8, 0.1);
	hands.left.grip.position.set(0, 1.25, -0.6); // (over the model: the tools go and wait at the edge)
	for (let i = 0; i < 90; i++) frame();
	const fan = x.fan, head = x.headWorld(), c = x.areas.centre;
	assert.equal(fan.mode, 'edge');
	const keys = x.modes.dollhouse.keyPoints(), keysLeft = Math.max(...keys.map((p) => angleDiff(c.ahead, yawTo(head, p))));
	const toolsAt = angleDiff(c.ahead, yawTo(head, fan.group.position));
	assert.ok(toolsAt > keysLeft + THREE.MathUtils.degToRad(1), `the tools ${THREE.MathUtils.radToDeg(toolsAt).toFixed(1)}° left, the levels' edge ${THREE.MathUtils.radToDeg(keysLeft).toFixed(1)}°`);
});

test('a wall the arc meets under 0.6 m from you: red, nothing happens; further, the floor at its foot (the UX review\'s S3)', async () => {
	const { x, go } = await setup();
	go('in');
	const w = x.modes.walk, t = x.targets(), head = x.headWorld().clone();
	// The nearest wall round you, at chest height.
	let best = null;
	for (let k = 0; k < 16; k++) {
		const a = (k / 16) * Math.PI * 2, dir = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
		x.raycaster.set(head.clone().setY(head.y - 0.4), dir); x.raycaster.far = 6;
		const h = x.raycaster.intersectObjects(x.model.layers.walls.children, false)[0];
		if (h && (!best || h.distance < best.d)) best = { d: h.distance, dir };
	}
	assert.ok(best, 'a wall near you');
	const at = (gap) => { // (stand `gap` from that wall, and throw a short arc segment into it from the hand)
		x.rig.position.addScaledVector(best.dir, (best.d - gap)); x.rig.updateMatrixWorld(true);
		const h0 = x.headWorld(), from = h0.clone().setY(h0.y - 0.4).addScaledVector(best.dir, 0.1);
		const r = w.hitSegment(from, from.clone().addScaledVector(best.dir, gap + 0.2), t);
		x.rig.position.addScaledVector(best.dir, -(best.d - gap)); x.rig.updateMatrixWorld(true);
		return r;
	};
	const near = at(0.4), far = at(1.0);
	assert.ok(near?.wall && !near.valid && !near.land, `0.4 m from the wall: red (${JSON.stringify({ wall: near?.wall, valid: near?.valid })})`);
	assert.ok(far?.wall && far.valid && far.land, '1.0 m from it: the floor at its foot');
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

test('a home without a Sweet Home 3D visitor walks in at the clear middle of the room nearest its middle (build 215, D)', async () => {
	const { roomAt, edgeDistance } = await import('../js/rooms.js');
	const { x, frame } = await setup();
	frame();
	const plan = x.model.plan;
	assert.ok(plan?.rooms?.length, 'the example home has rooms');
	x.model.observer = null;
	const { modelPt, yaw } = x.modes.walk.walkInPoint();
	const room = roomAt(plan, modelPt.x, modelPt.y, modelPt.z);
	assert.ok(room?.name, `in a named room (${room?.name ?? 'none'})`);
	assert.ok(edgeDistance(modelPt.x, modelPt.z, room.points) >= 0.35, 'clear of its walls');
	assert.ok(Number.isFinite(yaw), 'facing along it');
});
