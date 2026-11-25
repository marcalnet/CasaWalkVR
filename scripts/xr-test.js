// Scripted VR session in headless Chromium using Meta's WebXR emulator (IWER):
// enter VR, point at the model, rotate/zoom, grab, orbs (point and touch) and
// menu, VR/passthrough switch, jump in at 1:1, walk, snap turn, teleport,
// pull with the trigger, turn and height options, solid walls, see-through,
// exit, and re-enter from another spot. Screenshots go to test-output/xr-*.png.
//   npm run xr-test             (the example home that ships with the repository)
//   npm run xr-test -- tests/fixtures/SweetHome3DExample.sh3d
//   npm run xr-test -- private  (your own file in tests/fixtures/private/: only when asked for)
// It also records a "fingerprint" of the headset scene at fixed moments
// (what is shown and where, both menus cell by cell, draw calls) into
// test-output/xr-fingerprint-<device>.json. To prove a change is invisible:
//   XR_STEADY=1 XR_OUT=test-output/before npm run xr-test -- examples/example-home.sh3d
//   (change the code)
//   XR_STEADY=1 XR_OUT=test-output/after XR_BASELINE=test-output/before/xr-fingerprint-metaQuest2.json npm run xr-test -- examples/example-home.sh3d
//   node scripts/xr-compare.js test-output/before test-output/after
// XR_STEADY hides the breathing orbs in screenshots and fixes the model's
// turn and zoom after the stick steps, so two runs give the same pictures.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const root = path.resolve(import.meta.dirname, '..');
const privateDir = path.join(root, 'tests/fixtures/private');
// The model to test with: the one named on the command line, else the example
// home that ships with the repository. A private home (tests/fixtures/private/)
// only with the word "private" (code audit, A2: the default run's pictures must
// be safe for anyone to look at).
const own = fs.existsSync(privateDir) ? fs.readdirSync(privateDir).find((f) => f.endsWith('.sh3d')) : null;
if (process.argv[2] === 'private' && !own) { console.error('No .sh3d file in tests/fixtures/private/'); process.exit(1); }
const fixture = process.argv[2] === 'private' ? `tests/fixtures/private/${own}` : process.argv[2] || 'examples/example-home.sh3d';
const out = path.resolve(root, process.env.XR_OUT || 'test-output');
const STEADY = !!process.env.XR_STEADY;
fs.mkdirSync(out, { recursive: true });

// XR_PORT: another port, so two sessions can run this at once (default 8129).
const PORT = Number(process.env.XR_PORT) || 8129;
const server = await startServer(PORT);
// (--disable-audio-output: sound goes to a stand-in output; headless Chromium
// cannot wake a real one after the app pauses it.)
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-audio-output'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Install the emulated headset before the app runs: a Quest 2 by default, or
// XR_DEVICE=oculusQuest1 | metaQuest3 | metaQuestPro to check the others'
// controller layouts (this says nothing about their speed).
const DEVICE = process.env.XR_DEVICE || 'metaQuest2';
await page.addInitScript({ path: path.join(root, 'node_modules/iwer/build/iwer.min.js') });
await page.addInitScript((name) => {
	if (!IWER[name]) throw new Error(`Unknown device ${name}`);
	const d = new IWER.XRDevice(IWER[name]);
	d.stereoEnabled = false; // one view, so screenshots are easy to read
	d.installRuntime({ forceInstall: true });
	window.__device = d;
}, DEVICE);

let step = 0;
const results = [];
const check = (name, ok, detail = '') => {
	const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`;
	results.push(line);
	if (!ok) console.error(`(as it happens) ${line}`); // (shown even if a later step crashes)
};
const shot = async (name) => {
	await page.waitForTimeout(250);
	const orbs = (v) => page.evaluate((v) => { const o = window.__casawalk?.xr.ui.wrist.orb; if (o) o.body.visible = v; }, v);
	if (STEADY) { await orbs(false); await page.waitForTimeout(60); }
	await page.screenshot({ path: path.join(out, `xr-${String(++step).padStart(2, '0')}-${name}.png`) });
	if (STEADY) await orbs(true);
};
const THREE_deg = (r) => r * 180 / Math.PI;
const frames = (n = 10) => page.waitForTimeout(n * 20);

/** Points a controller from `from` at `to` (world metres, local-floor space). */
const aim = (hand, from, to) => page.evaluate(async ({ hand, from, to }) => {
	const THREE = await import('three');
	const c = window.__device.controllers[hand];
	const dir = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
	const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
	c.position.set(...from);
	c.quaternion.set(q.x, q.y, q.z, q.w);
}, { hand, from, to });
const button = (hand, id, v) => page.evaluate(({ hand, id, v }) => window.__device.controllers[hand].updateButtonValue(id, v), { hand, id, v });
// Which of the app's button states (js/xr-input.js) each emulated button sets.
const STATE_KEY = { trigger: 'trigger', squeeze: 'grip', 'a-button': 'a', 'x-button': 'a', 'b-button': 'b', 'y-button': 'b', thumbstick: 'stickPress' };
/** Waits (up to 1 s) until the app has read a button as pressed or released, so no click falls between two frames. */
const appSees = (hand, id, v) => page.waitForFunction(({ hand, key, v }) => { const c = window.__casawalk.xr.input.hands[hand]; return !c || !window.__casawalk.xr.session || c.state[key] === v; },
	{ hand, key: STATE_KEY[id], v }, { timeout: 1000, polling: 5 }).catch(() => {});
const click = async (hand, id) => { await button(hand, id, 1); await frames(4); await appSees(hand, id, true); await button(hand, id, 0); await frames(4); await appSees(hand, id, false); };
/**
 * Moves an emulated hand ('hand') or controller so its touch tip (the index
 * fingertip, or the controller's tip nub) passes through world points, a few
 * frames each (the app reads the tip once a frame).
 */
const tipPath = async (kind, side, points, wait = 3) => {
	for (const p of points) {
		for (let k = 0; k < 2; k++) { // (twice: the second pass corrects what one frame of lag left)
			await page.evaluate(({ kind, side, p }) => {
				const x = window.__casawalk.xr, d = window.__device, V = x.rig.position.constructor;
				const c = x.input.controllers.find((c) => c.handedness === side);
				x.rig.updateMatrixWorld(true);
				const want = x.rig.worldToLocal(new V(...p)), have = x.rig.worldToLocal(c.touch.tip.clone());
				const dev = kind === 'hand' ? d.hands[side] : d.controllers[side];
				dev.position.set(dev.position.x + want.x - have.x, dev.position.y + want.y - have.y, dev.position.z + want.z - have.z);
			}, { kind, side, p });
			await frames(wait);
		}
	}
};
/**
 * Presses a menu key by touch, straight along the panel's normal: the tip's
 * centre from `from` in front of the face to `to` (negative: pushed in), then
 * back out to 8 cm. hold: stay pushed in; backOnly: only come back out.
 */
const pressKey = async (kind, side, menu, id, { from = 0.06, to = -0.006, hold = false, backOnly = false } = {}) => {
	const pts = await page.evaluate(({ menu, id, from, to }) => {
		const x = window.__casawalk.xr, p = x.menus[menu], tab = p.tabOf?.(id);
		if (tab && tab !== p.tab) p.setTab(tab); // (the board opens on How to move: show the cell's tab first)
		const r = p.rects().find((r) => r.id === id);
		const g = p.mesh.geometry.parameters, V = x.rig.position.constructor;
		const lx = ((r.x + r.w / 2) / p.size.w - 0.5) * g.width, ly = (0.5 - (r.y + r.h / 2) / p.size.h) * g.height;
		p.mesh.updateMatrixWorld(true);
		const at = (z) => p.mesh.localToWorld(new V(lx, ly, z)).toArray();
		const steps = 12;
		return { path: Array.from({ length: steps + 1 }, (_, i) => at(from + (to - from) * i / steps)), out: at(0.08) };
	}, { menu, id, from, to });
	if (!backOnly) await tipPath(kind, side, pts.path, 2);
	if (!hold) await tipPath(kind, side, [pts.out], 3);
};
/** Presses a wrist-menu key by touch, straight along the cross's normal (as pressKey). */
const pressWristKey = async (kind, side, slot, { from = 0.06, to = -0.006 } = {}) => {
	await page.waitForFunction((slot) => window.__casawalk.xr.ui.wrist.keys[slot].out, slot, { timeout: 2000 }).catch(() => {});
	const pts = await page.evaluate(({ slot, from, to }) => {
		const x = window.__casawalk.xr, k = x.ui.wrist.keys[slot], V = x.rig.position.constructor;
		k.group.updateMatrixWorld(true);
		const at = (z) => k.group.localToWorld(new V(0, 0, 0.006 + z)).toArray();
		const steps = 12;
		return { path: Array.from({ length: steps + 1 }, (_, i) => at(from + (to - from) * i / steps)), out: at(0.12) };
	}, { slot, from, to });
	await tipPath(kind, side, pts.path, 2);
	await tipPath(kind, side, [pts.out], 3);
};
const stick = (hand, x, y) => page.evaluate(({ hand, x, y }) => window.__device.controllers[hand].updateAxes('thumbstick', x, y), { hand, x, y });
const state = () => page.evaluate(() => {
	const x = window.__casawalk.xr;
	const head = x.mode ? x.headWorld().toArray() : null;
	return { mode: x.mode, presenting: window.__casawalk.renderer.xr.isPresenting, session: x.sessionMode, view: x.view,
		showroom: x.showroom.visible, walkSky: x.walkSky.visible, yaw: x.modes.dollhouse.doll.yaw, zoom: x.modes.dollhouse.doll.zoom, pos: x.modes.dollhouse.doll.pos.toArray(),
		marker: x.modes.dollhouse.markers.some((m) => m.visible), rig: x.rig.position.toArray(), rigYaw: x.rig.rotation.y, head, lift: x.lift,
		ceilings: x.model?.layers.ceilings.visible, menu: x.menu ? Object.keys(x.menus).find((k) => x.menus[k] === x.menu) : null,
		hover: x.menu?.hover ?? null, anchorScale: x.anchor.scale.x, orb: x.ui.wrist.orb.holder?.handedness ?? null, wrist: x.ui.wrist.open,
		orbGlow: x.ui.wrist.orb.glow, snap: x.snapAngle, height: x.personHeight, layerFx: !!x.layerFx,
		arc: x.modes.walk.arc.dots.visible, ring: x.modes.walk.arc.ring.visible ? x.modes.walk.arc.ring.position.toArray() : null, valid: x.modes.walk.tele?.result?.valid ?? null,
		stage: [...x.stage.position.toArray(), x.stage.rotation.y] };
});
/**
 * World position of a target on the open menu: a button or switch (id), a
 * choice's option (id, value) or a point along a slider (id, 0..1).
 */
const menuPoint = (id, value) => page.evaluate(async ({ id, value }) => {
	const THREE = await import('three');
	const p = window.__casawalk.xr.menu;
	// (Since 25 Nov the board opens on How to move: a cell on another tab is shown first, as a person would.)
	const tab = p.tabOf?.(id);
	if (tab && tab !== p.tab) p.setTab(tab);
	const r = p.rects().find((b) => b.id === id && (b.slider || value === undefined || b.value === value));
	if (!r) throw new Error(`no menu target ${id} ${value ?? ''}`);
	const x = r.slider ? r.track.x + r.track.w * (value ?? 0) : r.x + r.w / 2;
	const u = x / p.size.w, v = 1 - (r.y + r.h / 2) / p.size.h;
	const g = p.mesh.geometry.parameters;
	p.mesh.updateMatrixWorld(true);
	return p.mesh.localToWorld(new THREE.Vector3((u - 0.5) * g.width, (v - 0.5) * g.height, 0)).toArray();
}, { id, value });
/** A menu cell's current state: { value, label, disabled, note }. */
const cell = (menu, id) => page.evaluate(({ menu, id }) => { const c = window.__casawalk.xr.menus[menu].get(id); return { value: c.value, label: c.label, disabled: !!c.disabled, note: c.note ?? null }; }, { menu, id });
/** World position of the wrist menu's orb (on the right wrist by default). */
const orbPoint = () => page.evaluate(async () => {
	const THREE = await import('three');
	return window.__casawalk.xr.ui.wrist.orb.group.getWorldPosition(new THREE.Vector3()).toArray();
});
/** World position of a wrist-menu key's face ('up', 'right', 'down', 'left'), once the cross is open and its keys are out. */
const keyPoint = async (slot) => {
	await page.waitForFunction((slot) => window.__casawalk.xr.ui.wrist.keys[slot].out, slot, { timeout: 2000 }).catch(() => {});
	return page.evaluate(async (slot) => {
		const THREE = await import('three'), k = window.__casawalk.xr.ui.wrist.keys[slot];
		k.face.updateMatrixWorld(true);
		return k.face.getWorldPosition(new THREE.Vector3()).toArray();
	}, slot);
};
/** A point 30 cm straight in front of a wrist-menu key (world), to aim a laser at it head-on: from the side it would cross a neighbouring key first. */
const keyFront = (slot) => page.evaluate(async (slot) => {
	const THREE = await import('three'), k = window.__casawalk.xr.ui.wrist.keys[slot];
	k.face.updateMatrixWorld(true);
	const n = new THREE.Vector3(0, 0, 1).transformDirection(k.face.matrixWorld);
	return k.face.getWorldPosition(new THREE.Vector3()).addScaledVector(n, 0.3).toArray();
}, slot);
/** Waits until a move between layers (the dive or surface transition) is over. */
const settled = () => page.waitForFunction(() => !window.__casawalk.xr.layerFx, null, { timeout: 5000 }).catch(() => {});
/**
 * Presses a wrist-menu key with the left controller's laser (the menu is on
 * the right wrist, which can't press its own keys): opens the cross with A
 * first if it is closed, then waits for any move between layers.
 */
const pressWrist = async (slot) => {
	if (!(await state()).wrist) { await click('right', 'a-button'); await frames(3); }
	const at = await keyPoint(slot), from = await toLocal(await keyFront(slot));
	await aim('left', from, await toLocal(at)); await frames(5);
	await click('left', 'trigger');
	await restLeft(); await frames(3);
	await settled();
};
/** Opens the settings board: A, then the Settings key. */
const openBoard = () => pressWrist('up');
/** Converts a world point to tracking space (where IWER poses live). */
const toLocal = (p) => page.evaluate((p) => { const x = window.__casawalk.xr; x.rig.updateMatrixWorld(true); return x.rig.worldToLocal(new (x.rig.position.constructor)(...p)).toArray(); }, p);
/** Aims from a tracking-space point at a world point. */
const aimW = async (hand, from, world) => aim(hand, from, await toLocal(world));
const lookDown = (a = -0.45) => page.evaluate((a) => { window.__device.quaternion.set(Math.sin(a / 2), 0, 0, Math.cos(a / 2)); }, a);
const lookAhead = () => page.evaluate(() => window.__device.quaternion.set(0, 0, 0, 1));
const R = [0.25, 1.1, -0.25], L = [-0.25, 1.0, -0.2];
const restRight = () => aim('right', R, [0.6, 1.1, -1.5]); // pointing at nothing
const restLeft = () => aim('left', L, [-0.6, 1.0, -1.5]);
/** Clicks a menu target with the right laser; first its tab, if it is on another one. */
const clickMenu = async (id, value) => {
	const tab = await page.evaluate((id) => { const p = window.__casawalk.xr.menu, t = p.tabOf(id); return t && t !== p.tab ? t : null; }, id);
	if (tab) { await aimW('right', R, await menuPoint('#tab', tab)); await frames(5); await click('right', 'trigger'); }
	await aimW('right', R, await menuPoint(id, value)); await frames(5); await click('right', 'trigger');
};
/** The kept photos (the page's roll), newest first. */
const photos = () => page.evaluate(async () => (await import('/js/storage.js')).listPhotos());
/** World point on top of the model (plinth centre, slightly forward). */
const modelTop = () => page.evaluate(async () => {
	const x = window.__casawalk.xr, V = x.modes.dollhouse.doll.pos.constructor;
	const p = x.stage.localToWorld(x.modes.dollhouse.doll.pos.clone().add(new V(0.05, 0.02, 0.25)));
	if (x.mode !== 'dollhouse' || x.findFloor(p.clone(), 0.5)) return p.toArray();
	// (No floor there, e.g. a pond, which is never a landing: aim at the middle of the largest room instead.)
	const { roomLanding, area } = await import('/js/rooms.js');
	const rooms = (x.model.plan?.rooms ?? []).filter((r) => r.name).sort((a, b) => area(b.points) - area(a.points));
	for (const r of rooms) {
		const l = roomLanding(r);
		if (!l) continue;
		const q = x.centerer.localToWorld(new V(l.x, r.floorY, l.z));
		if (x.findFloor(q.clone(), 0.5)) return q.toArray();
	}
	return p.toArray();
});
const waitXR = () => page.waitForFunction(() => { const x = window.__casawalk.xr; return x.mode && !x.pendingRecentre && x.ui.wrist.orb.holder; }, null, { timeout: 8000 }).catch(() => {});
/** What a session leaves on the 2D page: should be nothing. Returns the names of what was left. */
const leftovers = () => page.evaluate(() => {
	const S = window.__casawalk, x = S.xr, bad = [], want = (n, ok) => ok || bad.push(n);
	want('session', x.session === null && x.mode === null);
	want('grab/tele/fade/drag', !x.modes.dollhouse.grab && !x.modes.walk.tele && !x.modes.walk.fade && !x.ui.drag && !x.pendingRecentre);
	want('menu', x.menu === null && Object.values(x.menus).every((p) => !p.mesh.visible && !p.open) && !x.ui.wrist.open && !x.ui.wrist.cross.visible);
	want('layers', !x.layerFx && !(x.veil.amount('layer') > 0) && !x.arrival.mesh.visible);
	want('welcome', !x.ui.welcome.mesh.visible && !x.ui.welcomeOn);
	want('hands note', !x.ui.handsNote.mesh.visible);
	want('photo', !x.photoPending && !x.ui.photoFx && !x.veil.mesh.visible && !x.ui.photoNote.mesh.visible);
	want('arc', !x.modes.walk.arc.dots.visible && !x.modes.walk.arc.ring.visible);
	want('orb', !x.ui.wrist.orb.group.parent && !x.ui.wrist.orb.holder);
	want('hands', x.handViews.every((v) => !v.group.visible));
	want('controllers', x.input.controllers.every((c) => !c.ray.visible && !c.grip.visible));
	want('rooms', !x.showroom.visible && !x.stage.visible && !x.walkSky.visible && x.modes.dollhouse.markers.every((m) => !m.visible));
	want('rig', x.rig.position.lengthSq() === 0 && x.rig.rotation.y === 0 && x.lift === 0);
	want('anchor', x.anchor.position.lengthSq() === 0 && x.anchor.rotation.y === 0 && x.anchor.scale.x === 1);
	want('ground', x.model.layers.ground.visible);
	want('storeys', [...Object.values(x.model.layers), x.model.lamps].every((g) => (g?.children ?? []).every((m) => m.visible)));
	want('see-through', x.seeThrough.amount === 0);
	want('background/depth', S.scene.background !== null && S.depth.uniform.value === 0);
	return bad;
});
/** A fresh dollhouse (head at 1.6 m, hands at rest): returns what is wrong. */
const entry = () => page.evaluate(() => {
	const x = window.__casawalk.xr, bad = [], want = (n, ok) => ok || bad.push(n);
	want('dollhouse', x.mode === 'dollhouse' && x.menu === null && x.ui.welcome.mesh.visible && x.ui.welcomeOn);
	want('gallery', x.showroom.visible && x.stage.visible && x.gallery.visible && x.pedestal.visible && !x.walkSky.visible && !x.model.layers.ground.visible);
	want('model reset', x.modes.dollhouse.doll.yaw === 0 && x.modes.dollhouse.doll.zoom === 1 && Math.abs(x.anchor.scale.x - x.baseScale) < 1e-9);
	want('idle', !x.modes.dollhouse.grab && !x.modes.walk.tele && !x.modes.walk.fade && !x.ui.drag && !x.modes.walk.arc.dots.visible && !(x.veil.amount('teleport') > 0) && x.modes.dollhouse.markers.every((m) => !m.visible));
	want('orb on the right grip', x.ui.wrist.orb.holder?.handedness === 'right' && x.ui.wrist.orb.group.parent === x.ui.wrist.orb.holder.grip && !x.ui.wrist.open);
	want('lasers', x.input.active().length === 2 && x.input.active().every((c) => c.line.visible));
	want('eyes 1.89', Math.abs(x.headWorld().y - 1.89) < 0.005);
	return bad;
});
const lasers = () => page.evaluate(() => window.__casawalk.xr.input.active().map((c) => `${c.handedness}:${c.line.visible ? 'on' : 'off'}`).sort().join(' '));
/** Angle (radians) between the welcome card's face and the direction to the eyes. */
const facing = () => page.evaluate(() => {
	const x = window.__casawalk.xr, V = x.rig.position.constructor, card = x.ui.welcome.mesh;
	const to = x.camera.getWorldPosition(new V()).sub(card.getWorldPosition(new V())).normalize();
	return Math.acos(Math.min(1, new V(0, 0, 1).transformDirection(card.matrixWorld).dot(to)));
});
/** World point at (u, v) on the open menu (0..1 across, 0..1 up). */
const panelPoint = (u, v) => page.evaluate(async ({ u, v }) => {
	const THREE = await import('three'), p = window.__casawalk.xr.menu, g = p.mesh.geometry.parameters;
	p.mesh.updateMatrixWorld(true);
	return p.mesh.localToWorld(new THREE.Vector3((u - 0.5) * g.width, (v - 0.5) * g.height, 0)).toArray();
}, { u, v });

/**
 * Fingerprint of the headset scene (runs in the page): what is shown and
 * where, both menus cell by cell, the hands, draw calls and triangles after
 * two fresh frames, visible meshes counted by path, the saved settings.
 */
const FINGERPRINT = async () => {
	const S = window.__casawalk, x = S.xr, r = S.renderer;
	for (let i = 0; i < 2; i++) { const f = r.info.render.frame; S.invalidate(); for (let t = 0; r.info.render.frame === f && t < 100; t++) await new Promise((ok) => setTimeout(ok, 10)); }
	const n = (v) => Math.round(v * 1e4) / 1e4, v3 = (v) => v.toArray().map(n), vis = (o) => o.visible;
	const where = (o) => { const p = []; for (let a = o; a && a !== S.scene; a = a.parent) p.unshift(a.name || a.type); return p.join('/'); };
	const census = {};
	S.scene.traverseVisible((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.material?.visible !== false) census[where(o)] = (census[where(o)] ?? 0) + 1; });
	const menu = (p) => ({ title: p.title, size: [p.size.w, p.size.h], shown: p.mesh.visible, list: p.open,
		rows: p.rows.map((row) => row.map((c) => [c.id, c.type, c.label, c.value ?? null, !!c.disabled, c.note ?? null, !!c.primary, (c.options ?? []).map((o) => `${o.value}=${o.label}`).join(',')].join('|'))) });
	const KEYS = ['casawalk.snapAngle', 'casawalk.height', 'casawalk.view', 'casawalk.solidWalls', 'casawalk.seeThrough', 'casawalk.light', 'casawalk.shadows', 'casawalk.depth', 'casawalk.toolFan'];
	return {
		mode: x.mode, session: x.sessionMode, view: x.view, menu: x.menu?.title ?? null, welcome: [vis(x.ui.welcome.mesh), x.ui.welcomeOn],
		busy: [!!x.modes.dollhouse.grab, !!x.modes.walk.tele, !!x.modes.walk.fade, !!x.ui.drag, !!x.pendingRecentre, !!x.photoPending],
		shown: { ...Object.fromEntries(['showroom', 'stage', 'gallery', 'pedestal', 'walkSky'].map((k) => [k, vis(x[k])])), fadeMesh: x.veil.amount('teleport') > 0, flash: x.veil.amount('flash') > 0 }, // (one veil since A5: the same facts as the old spheres' visibility)
		layers: Object.fromEntries(Object.entries(x.model.layers).map(([k, g]) => [k, [g.visible, g.children.filter(vis).length]])), maxStorey: x.maxStorey,
		markers: x.modes.dollhouse.markers.map(vis), arc: [vis(x.modes.walk.arc.dots), vis(x.modes.walk.arc.ring)], note: vis(x.ui.photoNote.mesh),
		rig: [...v3(x.rig.position), n(x.rig.rotation.y), n(x.lift), n(x.modes.dollhouse.dollLift)], stage: [...v3(x.stage.position), n(x.stage.rotation.y)],
		anchor: [...v3(x.anchor.position), n(x.anchor.rotation.y), n(x.anchor.scale.x)], doll: [...v3(x.modes.dollhouse.doll.pos), n(x.modes.dollhouse.doll.yaw), n(x.modes.dollhouse.doll.zoom)],
		plinth: [n(x.plinthSize.W), n(x.plinthSize.D), n(x.plinthDistance), n(x.baseScale)], welcomeAt: v3(x.ui.welcome.mesh.position),
		clip: [x.camera.near, x.camera.far], background: S.scene.background?.getHex?.() ?? S.scene.background,
		hands: x.input.controllers.map((c) => [c.handedness, vis(c.ray), vis(c.grip), vis(c.line), vis(c.dot), x.ui.wrist.orb.group.parent === c.grip]),
		wrist: [x.ui.wrist.side, x.ui.wrist.open, false], // (the third: Help's card, gone since 25 Nov; kept false so old fingerprints still compare)
		menus: { dollhouse: menu(x.menus.dollhouse), walk: menu(x.menus.walk) },
		settings: [x.snapAngle, x.personHeight, x.solid, x.seeThroughAmount, S.lighting.time, S.lighting.shadows, S.depth.enabled],
		draw: [r.info.render.calls, r.info.render.triangles, r.info.memory.geometries, r.info.memory.textures],
		census, children: [S.scene.children.length, x.rig.children.length, x.stage.children.length, x.centerer.children.length],
		storage: Object.fromEntries(KEYS.map((k) => [k, localStorage.getItem(k)])),
	};
};
/** Differences between two fingerprints (numbers within 0.001 count as equal). */
const diffs = (a, b, p = '') => {
	if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-3 ? [] : [`${p} ${a} → ${b}`];
	if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffs(a[k], b[k], `${p}.${k}`));
	return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${p} ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
};
const baseline = process.env.XR_BASELINE ? JSON.parse(fs.readFileSync(path.resolve(root, process.env.XR_BASELINE), 'utf8')) : null;
const prints = {};
/** Records the fingerprint at a named moment; with XR_BASELINE, checks it against the recorded one. */
const fingerprint = async (label) => {
	const fp = prints[label] = await page.evaluate(FINGERPRINT);
	if (baseline) { const d = diffs(baseline.prints[label], fp); check(`fingerprint "${label}" unchanged`, d.length === 0, d.slice(0, 4).join('; ')); }
	return fp;
};
let bad;

console.log(`Fixture: ${fixture}   Device: ${DEVICE}`);
// The empty page: two welcome notes by the cards; they go once a model is open.
await page.goto(`http://localhost:${PORT}/?test`);
await page.waitForFunction(() => !document.getElementById('welcome').hidden, null, { timeout: 5000 }).catch(() => {});
const welcome = () => page.evaluate(() => {
	const r = (el) => el.getBoundingClientRect(), w = document.getElementById('welcome');
	if (w.hidden) return { shown: false };
	const over = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
	const cards = [r(document.getElementById('panel')), r(document.getElementById('view'))];
	const notes = [...w.querySelectorAll('.step')];
	const texts = [...w.querySelectorAll('.num, .text')].map(r);
	return { shown: true, layout: w.dataset.layout, notes: notes.length, clear: !texts.some((t) => cards.some((c) => over(t, c))), inside: texts.every((t) => t.top >= 0 && t.bottom <= innerHeight),
		under: Math.abs(r(notes[0]).left - cards[0].left) < 2 && r(notes[0]).top > cards[0].bottom && Math.abs(r(notes[1]).left - cards[1].left) < 2 && r(notes[1]).top > cards[1].bottom,
		formats: /\.sh3d.*\.zip.*\.obj.*\.glb/.test(notes[0].textContent) && !/\.sh3d/.test(document.getElementById('panel').textContent) };
});
let wl = await welcome();
check('welcome notes sit under the two cards on the empty page', wl.shown && wl.notes === 2 && wl.layout === 'below' && wl.under && wl.clear && wl.inside && wl.formats, JSON.stringify(wl));
await shot('welcome');
await page.goto(`http://localhost:${PORT}/?test&model=${encodeURIComponent(fixture)}${process.env.XR_QUERY ? `&${process.env.XR_QUERY}` : ''}`); // (XR_QUERY=hands: the bare-hand readout in the shots)
check('model loads', await page.evaluate(() => window.__casawalk.ready));
// The first-time cards (lessons, welcome card) are off for now (the user's call, 25 Nov 2026).
// Switched on here so their checks below keep the code working.
check('the first-time cards are off by default', await page.evaluate(async () => (await import('/js/lessons.js')).FIRST_TIME_CARDS.on === false));
await page.evaluate(async () => { (await import('/js/lessons.js')).FIRST_TIME_CARDS.on = true; });
{
	await frames(10);
	const b = await page.evaluate(() => { const el = document.getElementById('build'), r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, bottom: innerHeight - r.bottom, button: !!el.querySelector('button') }; });
	// A newer build on the site (the check asks the site, never the cache): the Reload button appears; nothing reloads by itself.
	await page.route('**/js/version.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export const BUILD = { number: 999999, date: \'2030-01-01T00:00:00Z\' };' }));
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await page.waitForFunction(() => !!document.querySelector('#build button'), null, { timeout: 5000 }).catch(() => {});
	const nb = await page.evaluate(() => ({ button: document.querySelector('#build button')?.textContent ?? null, xr: window.__casawalk.xr.newerBuild ?? null }));
	await page.unroute('**/js/version.js');
	check('a newer build on the site: "A newer version is available · Reload", and the headset knows', nb.button === 'A newer version is available · Reload' && nb.xr === 999999, JSON.stringify(nb));
	check('the page shows its build, small, in the bottom-left corner (no Reload: it is the latest)', /^Build \d+ · \d{1,2} [A-Z][a-z]{2} \d{4} \d\d:\d\d$/.test(b.text) && b.left < 40 && b.bottom < 40 && !b.button, JSON.stringify(b));
}
await frames(5);
check('welcome notes go once a model is open', (await welcome()).shown === false);
const enterVR = page.locator('#xr-buttons button', { hasText: 'Enter VR' });
check('one Enter VR button', await enterVR.count() === 1 && await page.locator('#xr-buttons button.xr').count() === 1);
// "Send to my Quest" is for computers and phones: in a headset's own browser (which the emulator says it is) it is not offered.
{
	const ua = await page.evaluate(() => navigator.userAgent);
	const onHeadset = /OculusBrowser|\bQuest\b/i.test(ua);
	check('Send to my Quest is offered on computers only', await page.locator('#send-quest').count() === (onHeadset ? 0 : 1), `headset browser: ${onHeadset}`);
}

// Head 1.6 m up, looking slightly down at the plinth.
// The first-time lessons (C0.5) are marked done for the whole run (they would stand
// in front of the other checks); their own checks clear them below.
const LESSON_KEYS = ['casawalk.welcome.scale.hands', 'casawalk.welcome.scale.controllers', 'casawalk.welcome.walk.hands', 'casawalk.welcome.walk.controllers', 'casawalk.toolsIntro'];
await page.evaluate((keys) => { for (const k of keys) localStorage.setItem(k, '1'); }, LESSON_KEYS);
await page.evaluate(() => window.__device.position.set(0, 1.6, 0));
await lookDown();
await restRight();
await restLeft();
await enterVR.click();
// Wait until the session is up: the orb is on the right wrist and the plinth was placed.
await waitXR();
await frames(10);
let s = await state();
check('enters the VR dollhouse', s.presenting && s.mode === 'dollhouse' && s.showroom, JSON.stringify({ mode: s.mode, session: s.session }));
check('dollhouse: eyes where a 2 m person\'s would be (1.89 m)', Math.abs(s.head[1] - 1.89) < 0.005 && Math.abs(s.rig[1] - 0.29) < 0.005, `eyes ${s.head[1].toFixed(3)} m, raised ${s.rig[1].toFixed(3)} m`);
check('the menu\'s orb is on the right wrist (the tool fan takes the left)', s.orb === 'right' && !s.wrist);
{
	// No two large surfaces at the same height: the model's floor is clear of the plinth top. (The plate standing on the plinth is not its top.)
	const gap = await page.evaluate(() => { const x = window.__casawalk.xr, V = x.rig.position.constructor; const floor = x.centerer.localToWorld(new V(0, x.model.bounds.min.y, 0)).y;
		const top = Math.max(...x.pedestal.children.filter((m) => m !== x.plate.mesh).map((m) => m.getWorldPosition(new V()).y + m.geometry.parameters.height / 2)); return { gap: floor - top, near: x.camera.near, far: x.camera.far }; });
	check('the model\'s floor is clear of the plinth top (no flicker)', gap.gap > 0.003 && gap.gap < 0.006 && gap.near === 0.05 && gap.far === 300, JSON.stringify(gap));
}
check('no scale figure by the scale model (the landing markers show a person\'s size)', await page.evaluate(() => !window.__casawalk.xr.scene.getObjectByName('scale-figure') && !window.__casawalk.xr.menus.dollhouse.get('figure')));
/** Where the wrist menu's keys are, as seen: the right key on your right, Settings above. */
const crossSeen = () => page.evaluate(() => {
	const x = window.__casawalk.xr, w = x.ui.wrist, V = x.rig.position.constructor;
	x.camera.updateMatrixWorld(true);
	const seen = (slot) => w.keys[slot].face.getWorldPosition(new V()).applyMatrix4(x.camera.matrixWorldInverse);
	const [up, right, down, left] = ['up', 'right', 'down', 'left'].map(seen);
	const centre = w.cross.getWorldPosition(new V());
	const face = new V(0, 0, 1).transformDirection(w.cross.matrixWorld);
	const toEye = x.camera.getWorldPosition(new V()).sub(centre).normalize();
	const fwd = new V(0, 0, -1).transformDirection(x.camera.matrixWorld), eye = x.camera.getWorldPosition(new V());
	return { out: +w.outT.toFixed(2), seenAt: +(fwd.angleTo(w.orb.group.getWorldPosition(new V()).sub(eye)) * 180 / Math.PI).toFixed(1), open: w.open, rightOnRight: right.x > left.x + 0.08, upAbove: up.y > down.y + 0.08, spacing: +(right.distanceTo(left) / 2).toFixed(3),
		facing: +(Math.acos(Math.min(1, face.dot(toEye))) * 180 / Math.PI).toFixed(1), ids: ['up', 'right', 'down', 'left'].map((k) => w.keys[k].spec?.id ?? null) };
});
{
	// A welcome card above the model says how to open the menu (it no longer opens by itself).
	const w = await page.evaluate(() => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, card = x.ui.welcome.mesh;
		const p = card.getWorldPosition(new V()), top = x.centerer.localToWorld(new V(0, x.model.bounds.max.y, 0)).y;
		const head = x.headWorld(), plinth = x.stage.localToWorld(new V(0, 0, -x.plinthDistance));
		return { shown: card.visible && card.parent === x.stage, above: +(p.y - top).toFixed(2), menu: x.menu !== null, title: x.ui.welcome.title, first: x.ui.welcome.lines[0].text,
			away: +Math.hypot(p.x - head.x, p.z - head.z).toFixed(2), model: +Math.hypot(plinth.x - head.x, plinth.z - head.z).toFixed(2) };
	});
	check('welcome card as far as the model, floating above it, menu closed', w.shown && w.above > 0.3 && w.away >= w.model && !w.menu && /right wrist/i.test(w.first), JSON.stringify(w));
	check('the welcome card faces you', THREE_deg(await facing()) < 1, `${THREE_deg(await facing()).toFixed(2)}°`);
	await fingerprint('doll-entry');
	await shot('welcome-card');
	// Raise the right wrist into view; the left controller touches its orb: the wrist menu opens and the card goes.
	await aim('right', [0.12, 1.2, -0.4], [-0.1, 0.9, -1.2]); await frames(3);
	const orb = await toLocal(await orbPoint());
	await aim('left', orb, [orb[0], orb[1], orb[2] - 1]); await frames(5);
	s = await state();
	const gone = await page.evaluate(() => !window.__casawalk.xr.ui.welcome.mesh.visible);
	check('the left controller touching the orb opens the wrist menu, and the welcome card goes', s.wrist && gone && s.menu === null, JSON.stringify({ wrist: s.wrist, gone }));
	await aim('left', [-0.35, 1.0, -0.2], [-0.6, 1.0, -1.5]); await frames(3); // (away from the orb, so the cross doesn't hold still)
	await page.waitForFunction(() => Object.values(window.__casawalk.xr.ui.wrist.keys).every((k) => k.out), null, { timeout: 2000 }).catch(() => {});
	const cs = await crossSeen();
	check('the wrist menu: Settings above, Help below, ← Back on the left, Walk in → on the right, as you see it', cs.open && cs.rightOnRight && cs.upAbove && Math.abs(cs.spacing - 0.105) < 0.006 && cs.facing < 3
		&& JSON.stringify(cs.ids) === JSON.stringify(['settings', 'in', 'help', 'back']), JSON.stringify(cs));
	await shot('wrist-menu');
	await click('right', 'b-button');
	check('B closes the wrist menu', !(await state()).wrist);
	await restRight(); await restLeft(); await frames(3);
}
{
	// Settings on the wrist menu opens the board, within reach and 45° to the left of where you look.
	await openBoard();
	s = await state();
	const m = await page.evaluate(() => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor;
		const head = x.headWorld(), menu = x.menu.mesh.getWorldPosition(new V());
		const fwd = new V(0, 0, -1).transformDirection(x.camera.matrixWorld).setY(0).normalize();
		const to = menu.clone().sub(head).setY(0);
		const angle = Math.atan2(fwd.clone().cross(to.clone().normalize()).y, fwd.dot(to.clone().normalize())) * 180 / Math.PI; // + = left
		return { angle: +angle.toFixed(1), distance: +to.length().toFixed(2), below: +(head.y - menu.y).toFixed(2), wrist: x.ui.wrist.open, title: x.menu.title };
	});
	check('Settings opens the board within reach (40 cm), 30° to the left of the model (the wrist menu closes)', s.menu === 'dollhouse' && Math.abs(m.angle - 30) < 3 && Math.abs(m.distance - 0.4) < 0.02 && Math.abs(m.below - 0.3) < 0.02 && !m.wrist && /Scale model/.test(m.title), JSON.stringify(m));
	// The board: switches for on/off, options with every one shown, a stepper; no buttons.
	const kinds = await page.evaluate(() => {
		const x = window.__casawalk.xr, kinds = (p) => Object.fromEntries([...p.cells.values()].map((c) => [c.id, c.type]));
		const g = (p) => p.mesh.geometry.parameters;
		return { doll: kinds(x.menus.dollhouse), walk: kinds(x.menus.walk), heights: Object.values(x.menus).map((p) => +g(p).height.toFixed(2)), width: g(x.menus.walk).width };
	});
	const want = { shadows: 'switch', depth: 'switch', ceilings: 'switch', light: 'choice', view: 'switch', seethrough: 'switch', levels: 'choice', toolFan: 'choice', sound: 'choice', solid: 'switch', height: 'choice' };
	const ok = Object.entries(want).every(([id, t]) => kinds.doll[id] === t && kinds.walk[id] === t) && !Object.values(kinds.doll).includes('button');
	check('the board: switches, options and a stepper, 52 cm wide, within reach', ok && Math.abs(kinds.width - 0.52) < 1e-6 && Math.max(...kinds.heights) < 0.5, JSON.stringify({ heights: kinds.heights, width: kinds.width }));
}
await shot('dollhouse-board');
await click('right', 'b-button');
check('B closes the board', (await state()).menu === null);
await shot('dollhouse');

// Point at the model: marker appears.
await aimW('right', R, await modelTop());
await frames(10);
s = await state();
check('marker shows when pointing at the model', s.marker);
await shot('pointing');

// Thumbstick right rotates, forward zooms in.
const yaw0 = s.yaw;
await stick('right', 1, 0); await frames(25); await stick('right', 0, 0); await frames(3);
s = await state();
check('thumbstick rotates', Math.abs(s.yaw - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)} -> ${s.yaw.toFixed(2)}`);
if (STEADY) await page.evaluate(() => { window.__casawalk.xr.modes.dollhouse.doll.yaw = -0.8; }); // (the stick's timing varies a little from run to run)
await stick('right', 0, -1); await frames(25); await stick('right', 0, 0); await frames(3);
s = await state();
check('thumbstick zooms', s.zoom > 1.2 && s.zoom <= 4, `zoom ${s.zoom.toFixed(2)}`);
if (STEADY) await page.evaluate(() => { window.__casawalk.xr.modes.dollhouse.doll.zoom = 1.8; });
await shot('rotated-zoomed');
await stick('right', 0, 1); await frames(25); await stick('right', 0, 0); await frames(3);
if (STEADY) await page.evaluate(() => { window.__casawalk.xr.modes.dollhouse.doll.zoom = 1; });

// Grip and move the controller: the model follows.
const pos0 = (await state()).pos;
await aim('left', [-0.2, 1.0, -0.4], [-0.2, 0.8, -1.4]);
await frames(3);
await button('left', 'squeeze', 1); await frames(4);
await aim('left', [0.1, 1.15, -0.4], [0.1, 0.95, -1.4]); await frames(8);
await button('left', 'squeeze', 0); await frames(4);
s = await state();
check('grip moves the model', Math.hypot(s.pos[0] - pos0[0], s.pos[1] - pos0[1]) > 0.2, `${pos0.map((v) => v.toFixed(2))} -> ${s.pos.map((v) => v.toFixed(2))}`);
await shot('moved');

// Pushing it down stops just above the plinth top (0.6 m): never exactly on
// it, or the floor and the plinth flicker through each other.
await aim('left', [-0.2, 1.0, -0.4], [-0.2, 0.8, -1.4]); await frames(3);
await button('left', 'squeeze', 1); await frames(4);
await aim('left', [-0.2, 0.3, -0.4], [-0.2, 0.1, -1.4]); await frames(8);
s = await state();
await button('left', 'squeeze', 0); await frames(4);
check('model stays on top of the plinth, a few millimetres clear of it', s.pos[1] > 0.6 + 0.003 && s.pos[1] < 0.6 + 0.006, `y ${s.pos[1].toFixed(4)}`);
// (Recentre left the menu: the headset's own recentre, the Meta button, moves the plinth. Put the model back for what follows.)
await page.evaluate(() => { const d = window.__casawalk.xr.modes.dollhouse; d.doll.pos.set(0, d.doll.pos.y, 0); d.doll.yaw = 0; d.doll.zoom = 1; });
await page.evaluate(() => window.__casawalk.xr.modes.dollhouse.recentre());
await frames(3);

// The orb (right wrist raised into view): the left laser makes it glow; a pull opens the wrist menu, pinned.
await aim('right', [0.12, 1.2, -0.4], [-0.1, 0.9, -1.2]);
await frames(3);
await aimW('left', L, await orbPoint());
await page.waitForFunction(() => window.__casawalk.xr.ui.wrist.orb.glow > 0.5, null, { timeout: 2000 }).catch(() => {});
s = await state();
check('laser makes the orb glow', s.orbGlow > 0.5, `glow ${s.orbGlow.toFixed(2)}`);
await shot('orb-hover');
await click('left', 'trigger');
s = await state();
check('the left laser on the orb opens the wrist menu, pinned', s.wrist && await page.evaluate(() => window.__casawalk.xr.ui.wrist.pinned));
await shot('wrist-menu-laser');
// Settings by laser; then the board's own settings.
await pressWrist('up');
s = await state();
check('Settings by laser opens the board', s.menu === 'dollhouse' && !s.wrist);
await restRight(); await frames(3);
await fingerprint('doll-menu');
const c0 = (await state()).ceilings;
await aimW('right', R, await menuPoint('ceilings')); await frames(5);
s = await state();
check('laser hovers the board', s.hover?.startsWith('ceilings|'), `hover=${s.hover}`);
await clickMenu('ceilings');
s = await state();
check('Ceilings toggles and the board stays open', s.ceilings === !c0 && s.menu === 'dollhouse' && (await cell('dollhouse', 'ceilings')).value === !c0);
await clickMenu('ceilings'); // back on

// Light: pick an option; shadows: a switch.
const t0 = await page.evaluate(() => window.__casawalk.lighting.time);
const pick = t0 === 'sunset' ? 'noon' : 'sunset';
await clickMenu('light', pick);
const t1 = await page.evaluate(() => window.__casawalk.lighting.time);
check('Time of day: one click picks an option', t1 === pick && (await cell('dollhouse', 'light')).value === pick, `${t0} -> ${t1}`);
await shot('dollhouse-menu-sunset');
await clickMenu('light', t0);
await clickMenu('shadows');
s = await page.evaluate(() => ({ on: window.__casawalk.lighting.shadows, map: window.__casawalk.renderer.shadowMap.enabled, time: window.__casawalk.lighting.time }));
check('Shadows switch turns them on', s.on && s.map && s.time === t0 && (await cell('dollhouse', 'shadows')).value === true, JSON.stringify(s));

// See-through: one switch, 75%; walls and furniture fade, floors don't.
/** Switches See-through on or off (a switch: clicked only when it must change). */
const seeThrough = async (on) => { if ((await cell(await page.evaluate(() => (window.__casawalk.xr.mode === 'walk' ? 'walk' : 'dollhouse')), 'seethrough')).value !== on) await clickMenu('seethrough'); };
const glass = () => page.evaluate(() => {
	const x = window.__casawalk.xr, op = (layer) => x.model.layers[layer].children.map((m) => [].concat(m.material)[0]).filter((m) => m.userData.cwBase && !m.userData.cwBase.transparent);
	const wall = op('walls')[0], piece = op('main')[0], floor = x.model.layers.floors.children[0]?.material;
	return { amount: x.seeThroughAmount, wall: wall?.opacity, wallDepthWrite: wall?.depthWrite, piece: piece?.opacity, floor: floor?.opacity, floorTransparent: floor?.transparent, cast: x.model.layers.walls.children.some((m) => m.castShadow) };
});
await seeThrough(true);
let g = await glass();
const fade = 1 - 0.85 * g.amount;
check('See-through on (75%): walls and furniture fade', g.amount === 0.75 && Math.abs(g.wall - fade) < 1e-6 && Math.abs(g.piece - fade) < 1e-6 && !g.wallDepthWrite && !g.cast && g.floor === 1 && !g.floorTransparent && (await state()).menu === 'dollhouse', JSON.stringify(g));
await restRight(); await frames(5);
await shot('dollhouse-see-through');
{
	// The walls' depth pass (one per wall mesh) only while faded: it adds one draw call per wall mesh, and the example home stays under 150.
	const calls = () => page.evaluate(async () => { const S = window.__casawalk, r = S.renderer; for (let k = 0; k < 2; k++) { const f = r.info.render.frame; for (let t = 0; r.info.render.frame === f && t < 100; t++) await new Promise((ok) => setTimeout(ok, 10)); } return r.info.render.calls; });
	await restRight(); await frames(5);
	const dc = await page.evaluate(() => { const x = window.__casawalk.xr, depth = x.seeThrough.depthMeshes; return { depth: depth.length, shown: depth.every((d) => d.visible), sofa: x.model.layers.main.children.some((m) => [].concat(m.material).some((mat) => mat.transparent && mat.depthWrite)) }; });
	dc.on = await calls();
	await seeThrough(false); await restRight(); await frames(5);
	dc.off = await calls();
	await seeThrough(true); await restRight(); await frames(5); // (back on for the next steps)
	const example = /example-home/.test(fixture);
	check('see-through on: the walls\' depth pass is on (one draw call per storey), furniture keeps its depth', dc.depth > 0 && dc.shown && dc.sofa && dc.on - dc.off <= 2 * dc.depth + 4 && /* (the on-demand shadow map may redraw in that frame too) */ (!example || dc.on < 150), JSON.stringify(dc));
}
await seeThrough(false);
g = await glass();
check('See-through back to Off restores the model', g.amount === 0 && g.wall === 1 && g.piece === 1 && g.wallDepthWrite && g.cast && (await cell('dollhouse', 'seethrough')).value === false, JSON.stringify(g));
await restRight(); await frames(5);
await shot('dollhouse-shadows');
s = await state();
if (s.session === 'ar') {
	// Only the background changes: the model stays exactly where it was in front of you.
	const fromHead = () => page.evaluate(() => { const x = window.__casawalk.xr; return x.anchor.getWorldPosition(new (x.rig.position.constructor)()).sub(x.headWorld()).toArray(); });
	const before = await fromHead();
	await clickMenu('view');
	s = await state();
	const after = await fromHead();
	const moved = Math.hypot(...after.map((v, i) => v - before[i]));
	check('Passthrough: only the background changes, the model stays put', s.view === 'ar' && !s.showroom && Math.abs(s.rig[1] - 0.29) < 0.005 && moved < 1e-4, `moved ${moved.toFixed(4)} m`);
	await fingerprint('doll-passthrough');
	await shot('passthrough');
	await clickMenu('view');
	s = await state();
	check('Passthrough off: back to the VR view', s.view === 'vr' && s.showroom && Math.abs(s.rig[1] - 0.29) < 0.005);
} else {
	check('View switch (needs an AR session)', false, `session ${s.session}`);
}
await restRight(); await frames(3);
await click('right', 'trigger');
s = await state();
check('a pull elsewhere does nothing: the board stays open, no step inside', s.menu === 'dollhouse' && s.mode === 'dollhouse');
await click('right', 'b-button');
check('B closes the board', (await state()).menu === null);

// Bare hands (milestones C0.1, C0.2): the Quest turns a pinch into a select of
// a hand source. Put the controllers down, aim the right hand at the model
// and pinch: nothing may happen (no step inside, no menu). The app asks for
// hand tracking, so the hands have joints: they are drawn, wear the orb, and
// press the menu's keys by touch (the "Pick up your controllers" note is only
// for hands without joints). Then pick the controllers up again: all as before.
{
	const top = await toLocal(await modelTop());
	await page.evaluate(async (top) => {
		const THREE = await import('three');
		const x = window.__casawalk.xr, d = window.__device;
		x.__selects = 0;
		x.session.addEventListener('select', (e) => { if (e.inputSource.hand || !e.inputSource.gamepad?.axes.length) x.__selects++; });
		d.primaryInputMode = 'hand';
		const h = d.hands.right, from = new THREE.Vector3(0.2, 1.3, -0.3);
		const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...top).sub(from).normalize());
		h.position.set(from.x, from.y, from.z);
		h.quaternion.set(q.x, q.y, q.z, q.w);
	}, top);
	await frames(8);
	const before = await page.evaluate(() => window.__casawalk.xr.input.handsOnly());
	for (let i = 0; i < 2; i++) {
		await page.evaluate(() => window.__device.hands.right.updatePinchValue(1)); await frames(6);
		await page.evaluate(() => window.__device.hands.right.updatePinchValue(0)); await frames(6);
	}
	const h = await page.evaluate(() => {
		const x = window.__casawalk.xr, c = x.input.controllers;
		return { selects: x.__selects, mode: x.mode, menu: !!x.menu, note: x.ui.handsNote.mesh.visible, active: x.input.active().length,
			hands: c.filter((c) => c.isHand).length, lasers: c.some((c) => c.line.visible), bodies: c.some((c) => c.body.visible && c.isHand),
			marker: x.modes.dollhouse.markers.some((m) => m.visible), zoom: x.modes.dollhouse.doll.zoom };
	});
	await shot('hands-note');
	check('bare hands: a pinch reaches the app as a select', h.selects >= 2, JSON.stringify(h));
	check('bare hands: pinches do nothing (no step inside, no menu, no laser)', !before && h.mode === 'dollhouse' && !h.menu && h.active === 0 && h.hands === 2 && !h.lasers && !h.bodies && !h.marker, JSON.stringify(h));
	const drawn = await page.evaluate(() => { const x = window.__casawalk.xr; return { views: x.handViews.map((v) => v.group.visible && (v.model ? v.model.userData.colour.visible : v.colourMesh.visible) && v.alpha === 1), orb: [x.ui.wrist.orb.holder?.handedness, x.ui.wrist.orb.holder?.isHand && x.ui.wrist.orb.group.parent === x.ui.wrist.orb.holder.wrist] }; });
	check('bare hands with joints: drawn, the orb on the right wrist, no "Pick up your controllers" note', !h.note && drawn.views.every(Boolean) && drawn.orb[0] === 'right' && drawn.orb[1], JSON.stringify(drawn));
	// Touch groundwork (C0): the hands' poke points and pinches are read (nothing uses them yet).
	const touch = () => page.evaluate(() => window.__casawalk.xr.input.controllers.map((c) => ({ side: c.handedness, kind: c.touch.kind, tracked: c.touch.tracked,
		tip: c.touch.tip.toArray(), radius: c.touch.radius, held: c.touch.select.held, value: c.touch.select.value, lost: c.touch.select.lost,
		index: c.isHand ? window.__casawalk.xr.input.joint(c, 'index-finger-tip')?.toArray() : null })));
	const right = (list) => list.find((t) => t.side === 'right');
	const t0 = await touch();
	check('touch: both hands are tracked, with a poke point at the index tip', t0.every((t) => t.kind === 'hand' && t.tracked && t.index && Math.hypot(...t.tip.map((v, i) => v - t.index[i])) < 1e-6 && t.radius > 0 && t.radius < 0.03), JSON.stringify(t0.map((t) => [t.kind, t.tracked, t.radius])));
	await page.evaluate(() => { window.__device.hands.right.position.x += 0.1; }); await frames(6);
	const moved = Math.hypot(...right(await touch()).tip.map((v, i) => v - right(t0).tip[i]));
	check('touch: the poke point follows the hand', Math.abs(moved - 0.1) < 0.005, `${moved.toFixed(4)} m`);
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(1));
	const pinched = await page.waitForFunction(() => window.__casawalk.xr.input.hands && window.__casawalk.xr.input.controllers.find((c) => c.handedness === 'right')?.touch.select.held, null, { timeout: 2000, polling: 'raf' }).then(() => true).catch(() => false);
	const tp = right(await touch());
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(0));
	const opened = await page.waitForFunction(() => !window.__casawalk.xr.input.controllers.find((c) => c.handedness === 'right')?.touch.select.held, null, { timeout: 2000, polling: 'raf' }).then(() => true).catch(() => false);
	check('touch: a pinch is detected, and let go', pinched && opened && tp.value === 1 && !tp.lost, JSON.stringify({ pinched, opened, value: tp.value }));
	// Tracking lost mid-pinch: the pinch ends without a click, nothing breaks.
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(1)); await frames(6);
	await page.evaluate(() => { window.__device.hands.right.connected = false; }); await frames(8);
	const tl = right(await touch()), lostState = await state();
	check('touch: losing a hand mid-pinch ends it safely (no click, nothing moves)', !tl.tracked && !tl.held && tl.lost && lostState.mode === 'dollhouse' && !lostState.menu, JSON.stringify({ tracked: tl.tracked, held: tl.held, lost: tl.lost, mode: lostState.mode }));
	await page.evaluate(() => { window.__device.hands.right.updatePinchValue(0); window.__device.hands.right.connected = true; }); await frames(8);
	const back2 = right(await touch());
	check('touch: the hand comes back, tracked and not pinching', back2.kind === 'hand' && back2.tracked && !back2.held, JSON.stringify(back2));
	// Lost while pinching, found again still pinching: not a new press, until the pinch has been seen open.
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(1)); await frames(6);
	await page.evaluate(() => { window.__device.hands.right.connected = false; }); await frames(8);
	await page.evaluate(() => { window.__device.hands.right.connected = true; }); await frames(8);
	const stillPinched = right(await touch());
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(0)); await frames(6);
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(1)); await frames(6);
	const again = right(await touch());
	await page.evaluate(() => window.__device.hands.right.updatePinchValue(0)); await frames(6);
	check('touch: a hand found again mid-pinch is no new press; open and pinch again is', stillPinched.tracked && !stillPinched.held && again.held, JSON.stringify({ still: stillPinched.held, again: again.held }));

	// Touch keys (C0.2, C0.3). Raise the right hand into view; the left index touches the orb on its wrist: the wrist menu opens.
	await page.evaluate(() => { const h = window.__device.hands.right; h.position.set(0.1, 1.3, -0.4); h.quaternion.set(0, 0, 0, 1); });
	await frames(6);
	const orbR = await orbPoint();
	await tipPath('hand', 'left', [orbR.map((v, i) => v + [-0.08, 0.04, 0.04][i]), orbR]);
	await tipPath('hand', 'left', [orbR.map((v, i) => v + [-0.14, 0.02, 0.08][i])]);
	await page.waitForFunction(() => Object.values(window.__casawalk.xr.ui.wrist.keys).every((k) => k.out), null, { timeout: 2000 }).catch(() => {});
	const hs = await crossSeen();
	check('the left index touching the orb opens the wrist menu over the right wrist, laid out as seen', hs.open && hs.rightOnRight && hs.upAbove && !(await page.evaluate(() => window.__casawalk.xr.ui.wrist.pinned)), JSON.stringify(hs));
	await shot('hands-wrist-menu');
	// Settings, pressed with the left index: the board opens within reach.
	await pressWristKey('hand', 'left', 'up');
	const nm = await page.evaluate(() => {
		const x = window.__casawalk.xr, p = x.menu?.mesh, V = x.rig.position.constructor;
		if (!p) return { open: false, wrist: x.ui.wrist.open };
		const at = p.getWorldPosition(new V()), head = x.headWorld();
		return { open: x.menu === x.menus.dollhouse, ahead: +Math.hypot(at.x - head.x, at.z - head.z).toFixed(3), below: +(head.y - at.y).toFixed(3), wrist: x.ui.wrist.open };
	});
	check('Settings pressed with a fingertip opens the board within reach', nm.open && Math.abs(nm.ahead - 0.4) < 0.02 && Math.abs(nm.below - 0.3) < 0.02 && !nm.wrist, JSON.stringify(nm));
	const ceilings = () => page.evaluate(() => window.__casawalk.xr.menus.dollhouse.get('ceilings').value);
	const c0v = await ceilings();
	await pressKey('hand', 'right', 'dollhouse', 'ceilings', { hold: true });
	await shot('hands-press');
	await pressKey('hand', 'right', 'dollhouse', 'ceilings', { backOnly: true });
	const c1v = await ceilings();
	await pressKey('hand', 'right', 'dollhouse', 'ceilings');
	const c2v = await ceilings();
	check('a fingertip from the front presses a key once, and again after letting go', c1v === !c0v && c2v === c0v, JSON.stringify({ c0v, c1v, c2v }));
	// From behind (the tip appears inside the key) and pinches over a key: nothing.
	await pressKey('hand', 'right', 'dollhouse', 'ceilings', { from: -0.004, to: -0.012 });
	await pressKey('hand', 'right', 'dollhouse', 'ceilings', { from: -0.004, to: 0.08 });
	const c3v = await ceilings();
	await pressKey('hand', 'right', 'dollhouse', 'ceilings', { from: 0.06, to: 0.025, hold: true });
	for (let i = 0; i < 2; i++) {
		await page.evaluate(() => window.__device.hands.right.updatePinchValue(1)); await frames(5);
		await page.evaluate(() => window.__device.hands.right.updatePinchValue(0)); await frames(5);
	}
	await pressKey('hand', 'right', 'dollhouse', 'ceilings', { backOnly: true });
	const c4v = await ceilings(), still = await state();
	check('a fingertip from behind, and pinches over a key, click nothing', c3v === c0v && c4v === c0v && still.menu === 'dollhouse' && still.mode === 'dollhouse', JSON.stringify({ c3v, c4v, menu: still.menu }));
	await pressKey('hand', 'right', 'dollhouse', 'close');
	check('the board\'s Close key, pressed with a fingertip, closes it', (await state()).menu === null);

	// Moving with bare hands (C0.4). The gestures themselves are read from the joints
	// (js/gestures.js, its Node tests); here scripted gesture events drive the app:
	// each hand's reader is replaced by a queue of events.
	// The Quest 2 gesture (pinch held, palm down) aims through the pinch point: here,
	// the wrist joint stands in for it (handAimAt places the wrist on the aim line).
	await page.evaluate(() => {
		const x = window.__casawalk.xr;
		window.__gq = { left: { events: [] }, right: { events: [] } };
		for (const c of x.input.controllers) if (c.gesture) c.gesture.step = () => {
			const q = window.__gq[c.handedness], w = x.input.joint(c, 'wrist');
			c.gesture.shape = w ? { pinchAt: w, normal: new (w.constructor)(0, -1, 0), pinch: 0.01 } : null;
			return q.events.splice(0);
		};
	});
	const gesture = (side, ...events) => page.evaluate(({ side, events }) => { window.__gq[side].events.push(...events); }, { side, events });
	/** Puts the right hand where its aim (shoulder through wrist) points at a world point. */
	const handAimAt = (target) => page.evaluate((t) => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, d = window.__device;
		const head = x.headWorld(), right = x.viewAxes().right;
		const shoulder = head.clone().addScaledVector(right, 0.18); shoulder.y -= 0.15;
		const wrist = shoulder.clone().addScaledVector(new V(...t).sub(shoulder).normalize(), 0.35);
		// The device's hand position is not exactly its wrist joint: move it by the difference.
		x.rig.updateMatrixWorld(true);
		const c = x.input.controllers.find((c) => c.handedness === 'right');
		const now = x.input.joint(c, 'wrist');
		const hp = d.hands.right.position, dev = x.rig.localToWorld(new V(hp.x, hp.y, hp.z));
		const off = now ? now.clone().sub(dev) : new V();
		const to = x.rig.worldToLocal(wrist.clone().sub(off));
		hp.set(to.x, to.y, to.z);
	}, target);
	// Stepping inside by pointing: pinch and hold, point at a room, let go.
	// Aim at a room's middle (a room hotspot), or the box's middle for a model without rooms (not the pond: water is no landing).
	const roomPt = await page.evaluate(() => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, room = x.modes.walk.spots().find((s) => s.kind === 'room');
		if (room) return x.centerer.localToWorld(new V(room.x, room.y + 0.01, room.z)).toArray();
		const b = x.modes.dollhouse.modelBox(); return b.getCenter(new V()).setY(b.min.y + 0.02).toArray();
	});
	await handAimAt(roomPt); await frames(4); await handAimAt(roomPt); await frames(4);
	await gesture('right', { type: 'pinch' }); await frames(8);
	await handAimAt(roomPt); await frames(8);
	const pointing = await page.evaluate(() => { const x = window.__casawalk.xr, d = x.modes.dollhouse, c = x.input.controllers.find((c) => c.handedness === 'right');
		return { aim: !!d.handAim, ray: d.handRays.some((l) => l.visible), marker: d.markers.some((m) => m.visible), spot: !!d.handAim?.spot, block: x.aimBlock(c, c.gesture?.shape?.pinchAt) }; });
	check('bare hands at the scale model: a pinch held aims a ray at the model, the marker shows', pointing.aim && pointing.ray && pointing.marker && pointing.spot, JSON.stringify(pointing));
	await shot('hands-point-inside');
	await gesture('right', { type: 'open' }); await frames(4);
	const cancelled = await page.evaluate(() => { const d = window.__casawalk.xr.modes.dollhouse; return !d.handAim && d.handRays.every((l) => !l.visible); });
	check('bare hands: turning the palm up cancels the aim', cancelled);
	await gesture('right', { type: 'pinch' }); await frames(4); await handAimAt(roomPt); await frames(8);
	await page.waitForFunction(() => (window.__casawalk.xr.modes.dollhouse.handAim?.steady ?? 0) >= 0.3, null, { timeout: 8000, polling: 'raf' }).catch(() => {});
	await gesture('right', { type: 'pinchEnd' }); await frames(4); await settled(); await frames(4);
	const inside = await state();
	check('bare hands: opening the pinch on a steady landing steps inside', inside.mode === 'walk' && inside.anchorScale === 1, JSON.stringify({ mode: inside.mode }));
	// Walking: pinch and hold, the arc; it settles (white, then blue); let go: go.
	// A floor to aim at: the hotspots 1.2-3.5 m away (room middles, doorways), nearest first.
	const targets = await page.evaluate(() => {
		const x = window.__casawalk.xr, h = x.headWorld(), V = h.constructor;
		return x.modes.walk.spots().map((s) => x.centerer.localToWorld(new V(s.x, s.y, s.z))).map((p) => [p, Math.hypot(p.x - h.x, p.z - h.z)])
			.filter(([, d]) => d > 1.2 && d < 3.5).sort((a, b) => a[1] - b[1]).map(([p]) => p.toArray());
	});
	await gesture('right', { type: 'pinch' }); await frames(2);
	let floorAhead = targets[0];
	for (const t of targets) {
		await handAimAt(t); await frames(3); await handAimAt(t); await frames(3);
		if (await page.evaluate(() => !!window.__casawalk.xr.modes.walk.tele?.result?.valid)) { floorAhead = t; break; }
	}
	await handAimAt(floorAhead); await frames(2);
	const settling = await page.evaluate(() => { const x = window.__casawalk.xr, w = x.modes.walk, c = x.input.controllers.find((c) => c.handedness === 'right');
		return { via: w.tele?.via, dots: w.arc.dots.visible, colour: w.arc.dots.material.color.getHexString(), block: x.aimBlock(c, c.gesture?.shape?.pinchAt) }; });
	await handAimAt(floorAhead); await frames(10);
	// (Steady is 0.3 s of the app's own time: a slow emulator needs more real time.)
	await page.waitForFunction(() => (window.__casawalk.xr.modes.walk.tele?.steady ?? 0) >= 0.3, null, { timeout: 8000, polling: 'raf' }).catch(() => {});
	const steady = await page.evaluate(() => { const w = window.__casawalk.xr.modes.walk; return { steady: w.tele?.steady ?? 0, valid: !!w.tele?.result?.valid, colour: w.arc.dots.material.color.getHexString(), discs: w.discs.count }; });
	check('bare hands walking: a pinch held shows the arc from the hand, white while it settles, blue once steady', settling.via === 'hand' && settling.dots && settling.colour === 'ffffff' && steady.valid && steady.colour === '3d8bfd', JSON.stringify({ settling, steady, targets: targets.length }));
	await shot('hands-teleport-aim');
	const head0 = await page.evaluate(() => window.__casawalk.xr.headWorld().toArray());
	await gesture('right', { type: 'pinchEnd' }); await frames(4);
	await page.waitForFunction(() => { const w = window.__casawalk.xr.modes.walk; return !w.fade && !w.tele; }, null, { timeout: 8000, polling: 'raf' }).catch(() => {}); // (the fade does the move: a slow emulator needs time)
	const after = await page.evaluate(() => ({ head: window.__casawalk.xr.headWorld().toArray(), tele: !!window.__casawalk.xr.modes.walk.tele }));
	const jumped = Math.hypot(after.head[0] - head0[0], after.head[2] - head0[2]);
	check('bare hands walking: opening the pinch on blue teleports', !after.tele && jumped > 0.5, JSON.stringify({ jumped: +jumped.toFixed(2) }));
	// Turning: a wrist flick while aiming turns 30°; the arc stays. Letting go before blue: nothing.
	await gesture('right', { type: 'pinch' }); await frames(3);
	const yaw0 = await page.evaluate(() => window.__casawalk.xr.rig.rotation.y);
	await gesture('right', { type: 'turn', dir: 1 }); await frames(4);
	const t1 = await page.evaluate(() => ({ yaw: window.__casawalk.xr.rig.rotation.y, aiming: window.__casawalk.xr.modes.walk.tele?.via === 'hand' }));
	check('bare hands: a wrist flick to the right while aiming turns right by 30°, the arc stays', Math.abs((yaw0 - t1.yaw) - Math.PI / 6) < 1e-3 && t1.aiming, JSON.stringify({ turned: +((yaw0 - t1.yaw) * 180 / Math.PI).toFixed(1), aiming: t1.aiming }));
	const s0 = await page.evaluate(() => window.__casawalk.xr.headWorld().toArray());
	await page.evaluate(() => { const t = window.__casawalk.xr.modes.walk.tele; if (t) t.steady = 0; }); // (white again: a slip)
	await gesture('right', { type: 'pinchEnd' }); await frames(10);
	const s1 = await page.evaluate(() => ({ head: window.__casawalk.xr.headWorld().toArray(), tele: !!window.__casawalk.xr.modes.walk.tele, fade: !!window.__casawalk.xr.modes.walk.fade }));
	const slid = Math.hypot(s1.head[0] - s0[0], s1.head[2] - s0[2]);
	check('bare hands: opening the pinch before the ring is blue moves nothing; the arc goes', slid < 0.01 && !s1.tele && !s1.fade, JSON.stringify({ moved: +slid.toFixed(3), ...s1 }));
	// Help inside: the board on How to move, for bare hands.
	await page.evaluate(() => window.__casawalk.xr.menuAction('help'));
	await frames(3);
	const guide = await page.evaluate(() => { const x = window.__casawalk.xr, m = x.menu; return { tab: m?.tab, kind: m?.cells.get('guide')?.kind, shown: !!m?.mesh.visible }; });
	check('inside, Help opens the board on How to move, for bare hands', guide.shown && guide.tab === 'move' && guide.kind === 'walk-hands', JSON.stringify(guide));
	await shot('hands-guide');
	await page.evaluate(() => window.__casawalk.xr.ui.closeAll()); await frames(4);
	// Back to the scale model; hold it with a closed hand, let go in the air: it floats, then goes home.
	if ((await state()).mode === 'walk') {
		// (Turned away first: the plinth must still come back in front of you, the model level.)
		const q0 = await page.evaluate(() => { const q = window.__device.quaternion; const was = [q.x, q.y, q.z, q.w]; q.set(0, Math.sin(1.2), 0, Math.cos(1.2)); return was; }); // (turned 137° to the left)
		await frames(4);
		await page.evaluate(() => window.__casawalk.xr.menuAction('back')); await settled(); await frames(6);
		const back = await page.evaluate(() => {
			const x = window.__casawalk.xr, d = x.modes.dollhouse, m = x.camera.matrixWorld.elements;
			const headYaw = Math.atan2(m[8], m[10]); // (the head's forward is -Z)
			const diff = Math.abs(((headYaw - x.stage.rotation.y + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
			return { diff: +diff.toFixed(3), level: d.level(), onPlinth: Math.abs(d.doll.pos.z + x.plinthDistance) < 1e-3 };
		});
		check('back from inside, turned away: the plinth in front of where you look, the model level on it', back.diff < 0.05 && back.level && back.onPlinth, JSON.stringify(back));
		await page.evaluate((q) => window.__device.quaternion.set(...q), q0); await frames(2); // (the head as it was)
		await page.evaluate(() => window.__casawalk.xr.recentreHere()); await frames(4); // (the plinth in front of it again, for what follows)
	}
	const grabAt = await page.evaluate(() => {
		const x = window.__casawalk.xr, d = window.__device, b = x.modes.dollhouse.modelBox(), V = x.rig.position.constructor;
		const top = b.getCenter(new V()).setY(b.max.y + 0.02);
		x.rig.updateMatrixWorld(true);
		const palm = x.modes.dollhouse.holdPoint(x.input.controllers.find((c) => c.handedness === 'right')); // (the palm's centre)
		const hp = d.hands.right.position;
		const off = palm ? palm.clone().sub(x.rig.localToWorld(new V(hp.x, hp.y, hp.z))) : new V();
		const to = x.rig.worldToLocal(top.clone().sub(off));
		hp.set(to.x, to.y, to.z);
		return top.toArray();
	});
	await frames(4);
	await gesture('right', { type: 'fist' }); await frames(4);
	const held = await page.evaluate(() => window.__casawalk.xr.modes.dollhouse.grab?.kind ?? null);
	await page.evaluate(() => { window.__device.hands.right.position.y += 0.3; }); await frames(20);
	await gesture('right', { type: 'fistEnd' }); await frames(4);
	const floating = await page.evaluate(() => { const d = window.__casawalk.xr.modes.dollhouse; return { floating: !!d.floating, line: d.dropLine.visible, lifted: d.doll.pos.y > 0.7 }; });
	check('bare hands: a closed hand on the model holds it; let go in the air it floats', held === 'hand' && floating.floating && floating.line && floating.lifted, JSON.stringify({ held, ...floating, at: grabAt.map((v) => +v.toFixed(2)) }));
	await shot('hands-floating');
	await page.evaluate(() => { window.__device.hands.right.position.set(0.5, 1.0, 0.3); window.__device.hands.left.position.set(-0.5, 1.0, 0.3); });
	// (4 s of the app's own time, then the glide: a heavy home runs the emulator slowly, so allow plenty of real time.)
	await page.waitForFunction(() => !window.__casawalk.xr.modes.dollhouse.floating, null, { timeout: 30000, polling: 'raf' }).catch(() => {});
	const homeAgain = await page.evaluate(() => { const x = window.__casawalk.xr, d = x.modes.dollhouse, V = x.rig.position.constructor, b = d.modelBox();
		return { floating: !!d.floating, wait: d.floating?.wait, going: !!d.floating?.going, grab: !!d.grab, level: d.level(), y: +d.doll.pos.y.toFixed(3),
			near: x.input.controllers.map((c) => { const p = d.holdPoint(c, new V()); return [c.handedness, c.isHand, c.isController, c.touch.tracked, p ? +b.distanceToPoint(p).toFixed(2) : null]; }) }; });
	check('with hands away, the floating model goes home by itself and settles, level', !homeAgain.floating && homeAgain.level && Math.abs(homeAgain.y - 0.604) < 0.002, JSON.stringify(homeAgain));
	// The lesson with bare hands: the looping 3D hand shows the gesture of the current step (here: holding the model).
	await page.evaluate(() => { localStorage.removeItem('casawalk.welcome.scale.hands'); const L = window.__casawalk.xr.lessons; L.start('scale'); L.note('start'); L.note('wrist'); L.note('fan'); });
	await page.waitForFunction(() => !!window.__casawalk.xr.lessons.demo, null, { timeout: 5000 }).catch(() => {});
	await frames(6);
	const demo = await page.evaluate(() => { const L = window.__casawalk.xr.lessons; return { kind: L.kind, step: L.current()?.id, demo: !!L.demo && Object.values(L.demo).some((d) => d.visible), loaded: !!L.demo }; });
	check('the lesson with bare hands: a looping 3D hand shows the step\'s gesture', demo.kind === 'hands' && demo.step === 'hold' && demo.demo, JSON.stringify(demo));
	await shot('lesson-hands-demo');
	// The safety net (A1): an error shows the calm card in front of you; the app goes on.
	const safe = await page.evaluate(() => {
		const x = window.__casawalk.xr;
		x.safety.log = () => {};
		x.safety.fail(new Error('a test error'), 'page');
		return { card: x.ui.errorNote.mesh.visible, session: !!x.session, message: x.safety.lastError.message };
	});
	await frames(3);
	check('the safety net: an error shows the calm card, and VR goes on', safe.card && safe.session && safe.message === 'a test error', JSON.stringify(safe));
	await shot('safety-card');
	// The interface's layer (A5): both eyes see it; the street camera's viewfinder and a photo's camera don't.
	const lay = await page.evaluate(async () => {
		const x = window.__casawalk.xr, { INTERFACE_LAYER: L } = await import('/js/photo.js');
		const eyes = x.renderer.xr.getCamera().cameras.map((c) => c.layers.isEnabled(L));
		const THREE = await import('three');
		return { eyes, view: x.fan.camera.view.layers.isEnabled(L), photo: new THREE.PerspectiveCamera().layers.isEnabled(L), board: x.menus.dollhouse.mesh.layers.isEnabled(L) && !x.menus.dollhouse.mesh.layers.isEnabled(0) };
	});
	check('the interface layer: both eyes show it; the viewfinder and a photo\'s camera leave it out', lay.eyes.length === 2 && lay.eyes.every(Boolean) && !lay.view && !lay.photo && lay.board, JSON.stringify(lay));
	await page.evaluate(() => { const x = window.__casawalk.xr; x.ui.hideError(); x.safety.begin(); delete x.safety.lastError; x.safety.log = (e) => console.error(e); });
	await page.evaluate(() => window.__casawalk.xr.lessons.finish()); await frames(2);
	// The hands are drawn with the hand model (the generic hand), once loaded.
	const model = await page.evaluate(() => window.__casawalk.xr.handViews.map((v) => ({ side: v.c.handedness, model: !!v.model, capsules: v.colourMesh.visible })));
	check('bare hands are drawn with the hand model (the capsules are the fallback)', model.every((m) => m.model && !m.capsules), JSON.stringify(model));
	// Real gestures again for the rest of the run.
	await page.evaluate(() => { const x = window.__casawalk.xr; for (const c of x.input.controllers) if (c.gesture) delete c.gesture.step; });
	await page.evaluate(() => { window.__device.primaryInputMode = 'controller'; });
	await waitXR(); await frames(8);
	{
		// A controller has a poke point too, just in front of it, and the trigger is its select.
		const c0 = await touch();
		await button('right', 'trigger', 1); await frames(4); await appSees('right', 'trigger', true);
		const c1 = right(await touch());
		await button('right', 'trigger', 0); await frames(4); await appSees('right', 'trigger', false);
		const grips = await page.evaluate(() => window.__casawalk.xr.input.controllers.map((c) => { c.grip.updateMatrixWorld(true); return new (c.grip.position.constructor)().setFromMatrixPosition(c.grip.matrixWorld).toArray(); }));
		const near = c0.every((t, i) => { const d = Math.hypot(...t.tip.map((v, k) => v - grips[i][k])); return d > 0.03 && d < 0.06; });
		check('touch: controllers have a poke point in front, and the trigger selects', c0.every((t) => t.kind === 'controller' && t.tracked) && near && c1.held && c1.value === 1, JSON.stringify({ kinds: c0.map((t) => t.kind), near, held: c1.held }));
		// The controller's tip nub presses keys by touch too.
		await openBoard();
		const v0 = await page.evaluate(() => window.__casawalk.xr.menus.dollhouse.get('ceilings').value);
		await pressKey('controller', 'right', 'dollhouse', 'ceilings');
		const v1 = await page.evaluate(() => window.__casawalk.xr.menus.dollhouse.get('ceilings').value);
		const nub = await page.evaluate(() => window.__casawalk.xr.input.active().every((c) => c.body.children.length === 2 && c.body.visible));
		check('a controller\'s tip nub presses a key by touch', v1 === !v0 && nub, JSON.stringify({ v0, v1, nub }));
		await pressKey('controller', 'right', 'dollhouse', 'ceilings');
		await click('right', 'b-button');
	}
	const back = await page.evaluate(() => { const x = window.__casawalk.xr; return { note: x.ui.handsNote.mesh.visible, active: x.input.active().length, lasers: x.input.active().every((c) => c.line.visible && c.body.visible) }; });
	check('controllers again: the note goes, lasers back', !back.note && back.active === 2 && back.lasers, JSON.stringify(back));
	await restRight(); await restLeft(); await frames(5);
}

// Trigger on the model: jump in at 1:1.
await aimW('right', R, await modelTop()); await frames(6);
const mark = await page.evaluate(() => { const x = window.__casawalk.xr, m = x.modes.dollhouse.markers[x.input.hands.right.index]; return m.visible ? m.position.toArray() : null; });
await click('right', 'trigger');
await settled();
s = await state();
check('trigger on model enters 1:1 (through the dive)', s.mode === 'walk' && s.anchorScale === 1, JSON.stringify(s.rig.map((v) => +v.toFixed(2))));
{
	const arr = await page.evaluate(() => { const x = window.__casawalk.xr; return { shown: x.arrival.mesh.visible, text: x.arrival.text, curtain: x.veil.amount('layer') > 0 }; });
	check('arriving inside: the room\'s name floats in front of you, the view uncovered', arr.shown && arr.text.length > 0 && !arr.curtain, JSON.stringify(arr));
}
{
	const at = await page.evaluate((p) => { const x = window.__casawalk.xr, V = x.rig.position.constructor, w = x.centerer.localToWorld(new V(...p)), h = x.headWorld();
		return { d: Math.hypot(h.x - w.x, h.z - w.z), feet: x.rig.position.y - x.lift - w.y }; }, mark ?? [0, 0, 0]);
	check('stepping inside lands where the marker stood', mark && at.d < 0.01 && Math.abs(at.feet) < 0.02, JSON.stringify(at));
}
await lookAhead();
await restRight();
await frames(10);
await shot('walk-trigger');
await click('left', 'y-button');
await settled();
s = await state();
check('Y: ← Back to the scale model (one layer up)', s.mode === 'dollhouse');
check('arriving back: "Scale model 1:…" floats in front of you', await page.evaluate(() => { const x = window.__casawalk.xr; return x.arrival.mesh.visible && /^Scale model 1:\d+$/.test(x.arrival.text); }));
await click('right', 'b-button');
check('at the scale model, B never leaves VR', (await state()).presenting && (await state()).mode === 'dollhouse');

// The doors on the plinth: always there; the laser on Walk in → goes inside (where the wrist menu's Walk in lands).
{
	const doors = await page.evaluate(async () => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, d = x.modes.dollhouse.doors;
		const w = (slot) => d.keys.get(slot).face.getWorldPosition(new V());
		const head = x.headWorld(), back = w('back'), inn = w('in');
		const size = (slot) => { const g = d.keys.get(slot).face.geometry; g.computeBoundingBox(); const b = g.boundingBox; return +(b.max.x - b.min.x).toFixed(3); };
		const bw = size('back'), iw = size('in'), gap = +((inn.x - iw / 2) - (back.x + bw / 2)).toFixed(3);
		// Under the line from the eyes to the model: the doors' top edge is further below the horizon than any corner of the model.
		const down = (p) => Math.atan2(head.y - p.y, Math.hypot(p.x - head.x, p.z - head.z)) * 180 / Math.PI;
		const top = d.keys.get('in').face.localToWorld(new V(0, d.keys.get('in').h / 2, 0));
		const B = x.model.bounds, corners = [];
		for (const cx of [B.min.x, B.max.x]) for (const cy of [B.min.y, B.max.y]) for (const cz of [B.min.z, B.max.z]) corners.push(down(x.centerer.localToWorld(new V(cx, cy, cz))));
		return { back: back.toArray(), in: inn.toArray(), bw, iw, gap, shown: x.modes.dollhouse.doorGroup.visible && x.stage.visible,
			ahead: +Math.hypot(inn.x - head.x, inn.z - head.z).toFixed(2), below: +(head.y - inn.y).toFixed(2), topDown: +down(top).toFixed(1), modelDown: +Math.max(...corners).toFixed(1) };
	});
	check('the doors at the scale model: a big Walk in →, a small ← Back to its left, at waist height within reach, under the line to the model, shown without opening a menu',
		doors.shown && doors.iw > 0.25 && doors.bw <= doors.iw / 2 && doors.gap >= 0.02 && doors.ahead < 0.45 && doors.below > 0.55 && doors.below < 0.75 && doors.topDown > doors.modelDown, JSON.stringify(doors));
	// Seated: the doors stay at waist height (65 cm below the eyes).
	await page.evaluate(() => window.__device.position.set(0, 1.1, 0)); await frames(10);
	await page.waitForFunction(() => { const x = window.__casawalk.xr, d = x.modes.dollhouse; return Math.abs(x.stage.worldToLocal(x.headWorld()).y - d.doorEyes) < 0.08; }, null, { timeout: 5000, polling: 'raf' }).catch(() => {});
	const seatedInfo = await page.evaluate(() => { const x = window.__casawalk.xr, V = x.rig.position.constructor, d = x.modes.dollhouse; return { seated: +(x.headWorld().y - d.doors.keys.get('in').face.getWorldPosition(new V()).y).toFixed(2), eye: +x.stage.worldToLocal(x.headWorld()).y.toFixed(2), doorEyes: +d.doorEyes.toFixed(2), hot: d.doors.list.filter((k) => k.hot).map((k) => k.slot), rings: d.doors.rings.map((r) => !!r?.visible) }; });
	const seated = seatedInfo.seated;
	check('seated, the doors are still at waist height', seated > 0.55 && seated < 0.75, JSON.stringify(seatedInfo));
	await page.evaluate(() => window.__device.position.set(0, 1.6, 0)); await frames(10);
	await lookDown(-0.85); await frames(3);
	await shot('plinth-doors');
	await lookDown(); await frames(3);
	await aimW('right', R, doors.in); await frames(20); // (the laser rests on it first)
	await click('right', 'trigger'); await settled();
	s = await state();
	check('Walk in → on the plinth goes inside', s.mode === 'walk' && s.anchorScale === 1, JSON.stringify({ mode: s.mode }));
	await click('left', 'y-button'); await settled(); await restRight(); await frames(3);
}
// Walk in → (the observer camera) from the wrist menu.
await lookDown();
await pressWrist('right');
s = await state();
check('Walk in enters 1:1', s.mode === 'walk' && s.anchorScale === 1 && s.walkSky, JSON.stringify({ rig: s.rig.map((v) => +v.toFixed(2)) }));
{
	const ob = await page.evaluate(() => { const x = window.__casawalk.xr, V = x.rig.position.constructor, o = x.model.observer; if (!o) return null;
		const p = x.centerer.localToWorld(new V(o.x / 100, 0, o.y / 100)), h = x.headWorld(), e = x.rig.rotation.y - (Math.PI - o.yaw);
		return { d: Math.hypot(h.x - p.x, h.z - p.z), yaw: Math.atan2(Math.sin(e), Math.cos(e)), menu: x.menu !== null }; });
	check('Walk in: at the observer, facing its way, menu closed', !ob || (ob.d < 0.01 && Math.abs(ob.yaw) < 1e-3 && !ob.menu), JSON.stringify(ob));
	await fingerprint('walk-observer');
}
await lookAhead();
await restRight();
await frames(10);
await shot('walk-in-observer');

// Right stick forward: teleport arc to the floor ahead; release to go there.
let h0;
await aim('right', R, [0.25, 0, -1.0]); // steeply down: lands about 1 m ahead
await lookDown(-0.6);
await stick('right', 0, -1); await frames(8);
s = await state();
check('teleport arc shows a valid landing', s.arc && s.ring && s.valid === true, JSON.stringify({ arc: s.arc, ring: s.ring, valid: s.valid }));
await shot('teleport-arc');
const land = s.ring;
await stick('right', 0, 0); await frames(25);
s = await state();
check('teleport moves you to the ring', s.head && Math.hypot(s.head[0] - land[0], s.head[2] - land[2]) < 0.05 && Math.abs(s.rig[1] - land[1]) < 0.05,
	`landed ${land.map((v) => v.toFixed(2))}, head ${s.head.map((v) => v.toFixed(2))}, feet ${s.rig[1].toFixed(2)}`);
check('arc hides after teleport', !s.arc);
await lookAhead();
await restRight();
await frames(5);
await shot('teleported');

// Hold a trigger, aim behind you (where you came from), release: teleport.
await aim('right', R, [0.25, 0, 0.8]); await frames(3);
h0 = (await state()).head;
await button('right', 'trigger', 1); await frames(8);
s = await state();
check('trigger shows the teleport arc', s.arc && s.valid === true, JSON.stringify({ arc: s.arc, ring: s.ring, valid: s.valid }));
const land2 = s.ring;
await button('right', 'trigger', 0); await frames(25);
s = await state();
check('trigger release teleports', land2 && Math.hypot(s.head[0] - land2[0], s.head[2] - land2[2]) < 0.05, `moved ${Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]).toFixed(2)} m`);
await restRight(); await frames(3);

// Aimed steeply up, the arc stays under door height (1.85 m above the feet), so it fits through doorways.
await aim('right', R, [0.25, 3.5, -1.2]); await frames(3);
await button('right', 'trigger', 1); await frames(6);
s = await page.evaluate(() => { const x = window.__casawalk.xr; return { top: Math.max(...x.modes.walk.arc.points.map((p) => p.y)) - (x.rig.position.y - x.lift), reach: x.modes.walk.arc.points.length }; });
await page.evaluate(() => { const x = window.__casawalk.xr; x.modes.walk.tele = null; x.modes.walk.arc.hide(); }); // cancel: no jump
await button('right', 'trigger', 0); await frames(5);
check('teleport arc stays under door height when aimed up', s.top < 1.86 && s.top > 1.5, `highest ${s.top.toFixed(2)} m above the feet`);
await restRight(); await frames(3);

// Furniture is not a floor: find a furniture top, check the arc flies
// through it to the floor below, and that standing there uses that floor.
s = await page.evaluate(async () => {
	const THREE = await import('three');
	const x = window.__casawalk.xr, b = x.model.bounds;
	// The one-level rule, whatever the test model is (restored below).
	const was = x.model.multiLevel;
	x.model.multiLevel = false;
	x._targets = null;
	const t = x.targets();
	const restore = (v) => { x.model.multiLevel = was; x._targets = null; return v; };
	const ray = new THREE.Raycaster();
	for (let i = 0; i < 400; i++) {
		const p = new THREE.Vector3(b.min.x + (i % 20 + 0.5) / 20 * (b.max.x - b.min.x), 0, b.min.z + (Math.floor(i / 20) + 0.5) / 20 * (b.max.z - b.min.z));
		x.centerer.localToWorld(p);
		ray.set(p.clone().setY(1.5), new THREE.Vector3(0, -1, 0));
		const h = ray.intersectObjects([...x.model.layers.main.children, ...x.model.layers.walls.children], false)[0];
		if (!h || !x.model.layers.main.children.includes(h.object) || h.point.y < 0.3 || h.point.y > 1.2) continue;
		if (h.face.normal.clone().transformDirection(h.object.matrixWorld).y < 0.9) continue;
		// Skip windows and anything else standing on a wall (walls do stop the arc).
		if (ray.intersectObjects(x.model.layers.walls.children, false).length) continue;
		const seg = x.modes.walk.hitSegment(h.point.clone().setY(h.point.y + 0.5), h.point.clone().setY(-0.05), t); // from above the top down past the floor
		const under = new THREE.Raycaster(h.point.clone().setY(h.point.y + 0.1), new THREE.Vector3(0, -1, 0)).intersectObjects([...t.walkable], false)[0];
		return restore({ top: +h.point.y.toFixed(2), topPoint: h.point.toArray(), arcLands: seg ? +seg.point.y.toFixed(2) : null, arcValid: seg?.valid, floorBelow: under ? +under.point.y.toFixed(2) : null });
	}
	return restore(null);
});
check('one level: arc goes through furniture to the floor', s && s.arcValid === true && s.floorBelow !== null && s.floorBelow < s.top - 0.25 && Math.abs(s.arcLands - s.floorBelow) < 0.01, JSON.stringify(s));

// More than one level: furniture (and so stairs) can be stood on.
s = await page.evaluate(async (top) => {
	const THREE = await import('three');
	const x = window.__casawalk.xr;
	const was = x.model.multiLevel;
	x.model.multiLevel = true;
	x._targets = null; // the mesh sets are cached per model
	const t = x.targets(), p = new THREE.Vector3(...top);
	const seg = x.modes.walk.hitSegment(p.clone().setY(p.y + 0.5), p.clone().setY(-0.05), t);
	x.model.multiLevel = was;
	x._targets = null;
	return { arcLands: seg ? +seg.point.y.toFixed(2) : null, arcValid: seg?.valid };
}, s.topPoint);
check('several levels: you can stand on furniture', s.arcValid === true && s.arcLands > 0.25, JSON.stringify(s));

// Left stick forward: walk at about 0.75 m/s where the head looks.
h0 = (await state()).head;
await stick('left', 0, -1); await frames(40); await stick('left', 0, 0); await frames(3);
s = await state();
const walked = Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]);
check('left stick walks (about 0.75 m/s)', walked > 0.2 && walked < 1.0, `${walked.toFixed(2)} m`);

// Hold a grip and pull the hand back: you move forward.
h0 = s.head;
await aim('right', [0.2, 1.1, -0.5], [0.2, 1.1, -1.5]); await frames(3);
await button('right', 'squeeze', 1); await frames(3);
for (let i = 1; i <= 5; i++) { await aim('right', [0.2, 1.1, -0.5 + i * 0.06], [0.2, 1.1, -1.5]); await frames(2); }
await button('right', 'squeeze', 0); await frames(3);
s = await state();
const pulled = Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]);
check('grip pull moves you', pulled > 0.2 && pulled < 0.4, `${pulled.toFixed(2)} m`);
await restRight();

// Right stick right: one snap turn.
const ry0 = s.rigYaw;
h0 = s.head;
await stick('right', 1, 0); await frames(15); await stick('right', 0, 0); await frames(5);
s = await state();
const turned = THREE_deg(ry0 - s.rigYaw);
check(`right stick snap-turns ${s.snap}°`, Math.abs(turned - s.snap) < 0.5 && Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]) < 1e-3, `${turned.toFixed(1)}°`);

// Inside: the wrist menu has ← Back on the left and a flat "Inside" plate on the right (no Exit VR); Settings opens the inside board.
await click('right', 'a-button');
await page.waitForFunction(() => Object.values(window.__casawalk.xr.ui.wrist.keys).every((k) => k.out), null, { timeout: 2000 }).catch(() => {});
{
	const cs = await crossSeen();
	const plate = await page.evaluate(() => { const k = window.__casawalk.xr.ui.wrist.keys; return { right: [k.right.spec.look, k.right.spec.label], back: k.left.spec.caption }; });
	check('inside, the wrist menu: ← Back (to the scale model) on the left, a flat "Inside" plate on the right, no Exit VR', cs.rightOnRight && JSON.stringify(cs.ids) === JSON.stringify(['settings', null, 'help', 'back'])
		&& plate.right[0] === 'flat' && plate.right[1] === 'Inside' && plate.back === 'Scale model', JSON.stringify({ ids: cs.ids, plate }));
	await lookDown(); await aim('right', [0.12, 1.2, -0.4], [-0.1, 0.9, -1.2]); await frames(5);
	await shot('walk-wrist-menu');
	await lookAhead(); await restRight(); await frames(3);
}
await pressWrist('up');
s = await state();
check('Settings opens the inside board', s.menu === 'walk' && await page.evaluate(() => /Inside/.test(window.__casawalk.xr.menu.title)));
await shot('walk-menu');
check('the Walk tab: Height and Solid walls (Turn left the board: 30° turns)', s.snap === 30 && await page.evaluate(() => { const p = window.__casawalk.xr.menus.walk; return !p.get('turn') && p.tabs.find((t) => t.id === 'walk').rows.flat().map((c) => c.id).join() === 'height,solid'; }));
const feet = (await state()).rig[1] - (await state()).lift;
await clickMenu('height', 1.4);
s = await state();
check('Height 1.4 m puts the eyes at 1.29 m', s.height === 1.4 && Math.abs(s.head[1] - feet - 1.29) < 0.01, `eyes ${(s.head[1] - feet).toFixed(2)} m`);
await shot('height-1.4');
await clickMenu('height', 0);
s = await state();
check('Height back to your own', s.height === 0 && Math.abs(s.head[1] - feet - 1.6) < 0.01);

/**
 * Holds the left stick forward until pred(head) is true for the app (checked on
 * every animation frame, so a slow machine only takes longer: the app's time,
 * not the clock's), then lets go. Returns whether it got there in time.
 */
const walkUntil = async (pred, arg, timeout = 15000) => {
	await page.evaluate(() => { window.__walk = { last: null, still: 0 }; });
	await stick('left', 0, -1);
	const ok = await page.waitForFunction(pred, arg, { timeout, polling: 'raf' }).then(() => true, () => false);
	await stick('left', 0, 0); await frames(3);
	return ok;
};
// Solid walls: on, walking at a wall stops a body's width in front of it; off, you walk through.
{
	const wallAt = (a) => page.evaluate(async (a) => {
		const THREE = await import('three');
		const x = window.__casawalk.xr, head = x.headWorld(), feet = x.rig.position.y - x.lift;
		const ray = new THREE.Raycaster();
		// side: start that far to the right of the head (metres), looking the same way.
		const look = (ang, side = 0) => {
			const o = new THREE.Vector3(head.x + Math.cos(ang) * side, feet + 1.0, head.z - Math.sin(ang) * side);
			ray.set(o, new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang)));
			return ray.intersectObjects(x.model.layers.walls.children, false)[0]?.distance ?? null;
		};
		if (a !== null) return { a, d: look(a), head: head.toArray() };
		// The nearest flat stretch of wall (0.8 m wide, square to you) 0.5-2 m
		// away, so you walk straight at it: the end of a short wall would let
		// you slide round it, as it should.
		const flat = (ang, d) => [-0.4, 0.4].every((s) => { const e = look(ang, s); return e !== null && Math.abs(e - d) < 0.03; });
		let best = null;
		for (let i = 0; i < 144; i++) { const ang = i / 144 * Math.PI * 2, d = look(ang); if (d && d > 0.5 && d < 2 && (!best || d < best.d) && flat(ang, d)) best = { a: ang, d }; }
		return best && { ...best, head: head.toArray() };
	}, a);
	let w = await wallAt(null);
	// None near the walk-in spot (e.g. a glass pavilion): stand in each room's middle in turn until one is.
	const rooms = await page.evaluate(() => (window.__casawalk.xr.model.plan?.rooms ?? []).length);
	for (let i = 0; !w && i < rooms; i++) {
		const moved = await page.evaluate(async (i) => {
			const x = window.__casawalk.xr, r = x.model.plan.rooms[i], { roomLanding } = await import('/js/rooms.js');
			const l = roomLanding(r);
			if (!l) return false;
			x.modes.walk.placeUser(x.centerer.localToWorld(new (x.rig.position.constructor)(l.x, r.floorY, l.z)), null);
			x.modes.walk.body = null;
			return true;
		}, i);
		if (moved) { await frames(5); w = await wallAt(null); }
	}
	if (!w) {
		check('Solid walls (needs a flat wall 0.5-2 m away)', false);
	} else {
		await clickMenu('solid');
		check('Solid walls switch turns on', (await cell('walk', 'solid')).value === true && await page.evaluate(() => window.__casawalk.xr.solid));
		await click('right', 'b-button');
		await page.evaluate((a) => { // face the wall
			const x = window.__casawalk.xr, V = x.rig.position.constructor;
			x.rig.updateMatrixWorld(true);
			const f = new V(0, 0, -1).transformDirection(x.camera.matrixWorld);
			x.turn(a - Math.atan2(-f.x, -f.z));
		}, w.a);
		// Walk until stopped: at least as far as the wall less a body's width, then no movement for 15 frames.
		await walkUntil(({ start, need }) => {
			const h = window.__casawalk.xr.headWorld(), k = window.__walk;
			const moved = k.last ? Math.hypot(h.x - k.last[0], h.z - k.last[2]) : 1;
			k.still = moved < 0.001 ? k.still + 1 : 0;
			k.last = [h.x, h.y, h.z];
			return Math.hypot(h.x - start[0], h.z - start[2]) > need && k.still >= 15;
		}, { start: w.head, need: w.d - 0.35 });
		const stopped = await wallAt(w.a);
		const walked = Math.hypot(stopped.head[0] - w.head[0], stopped.head[2] - w.head[2]);
		check('Solid walls: you stop a body\'s width in front of a wall', stopped.d !== null && stopped.d > 0.17 && stopped.d < 0.3 && walked > w.d - 0.35, `wall was ${w.d.toFixed(2)} m away; walked ${walked.toFixed(2)} m, now ${stopped.d?.toFixed(2)} m from it`);
		await shot('walk-solid-wall');
		await page.evaluate(() => window.__casawalk.xr.menuAction('solid')); // off
		await walkUntil(({ start, a, d }) => {
			const h = window.__casawalk.xr.headWorld();
			return (h.x - start[0]) * -Math.sin(a) + (h.z - start[2]) * -Math.cos(a) > d + 0.05;
		}, { start: w.head, a: w.a, d: w.d }, 10000);
		const through = await wallAt(w.a);
		const along = (through.head[0] - w.head[0]) * -Math.sin(w.a) + (through.head[2] - w.head[2]) * -Math.cos(w.a);
		check('Solid walls off: you walk through it', along > w.d + 0.05, `${along.toFixed(2)} m along, the wall at ${w.d.toFixed(2)} m`);
	}
}
if ((await state()).menu) { await click('right', 'b-button'); await frames(3); } // (the board, if still open; with nothing open, B inside is Back)
await pressWrist('left');
s = await state();
check('← Back on the wrist menu returns to the scale model', s.mode === 'dollhouse' && s.rig[0] === 0 && s.rig[2] === 0 && s.menu === null);
check('back from walking: eyes at 1.89 m again, gallery shown, lasers on', Math.abs(s.head[1] - 1.89) < 0.005 && s.showroom && !s.walkSky && (await lasers()) === 'left:on right:on', `eyes ${s.head[1].toFixed(3)}, lasers ${await lasers()}`);

// The tool fan (milestone C): raise the left controller in front of you, look at it: the tools.
{
	await page.evaluate(() => { const d = window.__device; d.controllers.left.position.set(-0.08, 1.35, -0.42); d.controllers.left.quaternion.set(0, 0, 0, 1); });
	await page.evaluate(() => window.__device.quaternion.set(Math.sin(-0.3 / 2), 0, 0, Math.cos(-0.3 / 2)));
	await frames(20);
	const f0 = await page.evaluate(() => { const f = window.__casawalk.xr.fan; return { shown: f.group.visible, alpha: f.alpha, tools: f.slots.map((s) => s.name) }; });
	check('the tool fan opens over the raised left controller, in view: camera, meter, marker', f0.shown && f0.alpha === 1 && f0.tools.join() === 'camera,meter,marker', JSON.stringify(f0));
	await shot('tool-fan');
	/** Puts the right controller's tip on a tool in the fan (corrected for where its tip really is). */
	const tipOn = async (name) => {
		for (let i = 0; i < 3; i++) {
			await page.evaluate((name) => {
				const x = window.__casawalk.xr, d = window.__device, V = x.rig.position.constructor, f = x.fan, c = x.input.hands.right;
				const at = f.slots.find((s) => s.name === name).home.getWorldPosition(new V());
				const p = d.controllers.right.position;
				const off = c.touch.tip.clone().sub(x.rig.localToWorld(new V(p.x, p.y, p.z)));
				const to = x.rig.worldToLocal(at.sub(off));
				d.controllers.right.quaternion.set(0, 0, 0, 1);
				p.set(to.x, to.y, to.z);
			}, name);
			await frames(4);
		}
	};
	await tipOn('meter');
	const hot = await page.evaluate(() => window.__casawalk.xr.fan.hot?.name ?? null);
	await click('right', 'squeeze'); await frames(10);
	const held = await page.evaluate(() => { const x = window.__casawalk.xr; return { tool: x.tools.held?.tool.name ?? null, grab: !!x.modes.dollhouse.grab, laser: x.input.hands.right.line.visible }; });
	check('the right tip touches the meter, the grip takes it (not the model); its laser goes', hot === 'meter' && held.tool === 'meter' && !held.grab && !held.laser, JSON.stringify({ hot, ...held }));
	await shot('tool-held');
	// The laser meter (milestone E): its beam and dot on the model, the reading on its screen; two triggers: a line.
	{
		const aimMeter = (to) => page.evaluate((to) => {
			const x = window.__casawalk.xr, d = window.__device.controllers.right, V = x.rig.position.constructor;
			const p = d.position, from = x.rig.localToWorld(new V(p.x, p.y, p.z));
			// (The meter's laser runs along its tip's +Z; the controller's -Z points the same way in its hand.)
			const dir = new V(...to).sub(from).normalize();
			const q = new (x.rig.quaternion.constructor)().setFromUnitVectors(new V(0, 0, -1), dir);
			d.quaternion.set(q.x, q.y, q.z, q.w);
		}, to);
		const box = await page.evaluate(() => { const b = window.__casawalk.xr.modes.dollhouse.modelBox(); return [b.min.toArray(), b.max.toArray()]; });
		const mid = (fx, fz) => [box[0][0] + (box[1][0] - box[0][0]) * fx, box[1][1], box[0][2] + (box[1][2] - box[0][2]) * fz];
		await aimMeter(mid(0.3, 0.5)); await frames(8);
		const m0 = await page.evaluate(() => { const m = window.__casawalk.xr.fan.meter; return { beam: m.beam.visible, dot: m.dot.visible, hit: !!m.hit }; });
		await click('right', 'trigger'); await frames(4);
		await aimMeter(mid(0.7, 0.5)); await frames(8);
		await click('right', 'trigger'); await frames(6);
		const m1 = await page.evaluate(() => { const m = window.__casawalk.xr.fan.meter; return { lines: m.m.lines.length, label: m.m.lines[0]?.label ?? null, marks: m.marks.length }; });
		check('the laser meter: a beam and dot on the model; two triggers measure a line with its label', m0.beam && m0.dot && m0.hit && m1.lines === 1 && m1.marks === 1 && /\d/.test(m1.label ?? ''), JSON.stringify({ m0, m1 }));
		await shot('meter-line');
		await page.evaluate(() => window.__casawalk.xr.fan.meter.clear());
	}
	// The marker (milestone F): take it, hold the trigger and move: a stroke; the stick press: the next colour.
	{
		await tipOn('marker');
		await click('right', 'squeeze'); await frames(6);
		const held = await page.evaluate(() => window.__casawalk.xr.tools.held?.tool.name);
		await page.evaluate(() => { const d = window.__device.controllers.right; d.position.set(0.15, 1.3, -0.35); d.quaternion.set(0, 0, 0, 1); }); await frames(4);
		await button('right', 'trigger', 1); await frames(3);
		for (let i = 0; i < 12; i++) { await page.evaluate(() => { window.__device.controllers.right.position.x -= 0.02; }); await frames(2); }
		await button('right', 'trigger', 0); await frames(4);
		await click('right', 'thumbstick'); await frames(4);
		const mk = await page.evaluate(() => { const m = window.__casawalk.xr.fan.marker; return { strokes: m.strokes.length, points: m.strokes[0]?.n ?? 0, ink: m.ink }; });
		check('the marker: holding the trigger draws a stroke; the stick press changes colour', held === 'marker' && mk.strokes === 1 && mk.points > 5 && mk.ink === 1, JSON.stringify({ held, ...mk }));
		await shot('marker-stroke');
		await page.evaluate(() => window.__casawalk.xr.fan.marker.clear());
	}
	// The street camera (milestone D): taken like the others (it swaps the meter back); its back screen shows the view.
	await tipOn('camera');
	await click('right', 'squeeze'); await frames(6);
	await page.evaluate(() => { const d = window.__device.controllers.right; d.position.set(0.05, 1.35, -0.3); d.quaternion.set(0, 0, 0, 1); }); await frames(30);
	const cam = await page.evaluate(() => { const x = window.__casawalk.xr, c = x.fan.camera; return { tool: x.tools.held?.tool.name, meterBack: !x.fan.slots[1].held, frames: c.frames ?? 0, lens: c.mm }; });
	check('the street camera is taken (the meter goes back); its viewfinder shows the view through the lens', cam.tool === 'camera' && cam.meterBack && cam.frames > 0 && cam.lens === 28, JSON.stringify(cam));
	await shot('camera-held');
	// The shutter: a 3:2 photo from the lens, kept for the page. (Called directly: from inside the
	// emulator's XR frame, saving to IndexedDB stalls in headless Chromium.)
	await page.evaluate(() => {
		const cam = window.__casawalk.xr.fan.camera, print = cam.print.bind(cam);
		window.__shot = null;
		cam.print = (blob) => { createImageBitmap(blob).then((b) => { window.__shot = [b.width, b.height]; }); print(blob); };
		cam.shoot();
	});
	await page.waitForFunction(() => window.__shot, null, { timeout: 30000 }).catch(() => {});
	const shot3 = await page.evaluate(() => window.__shot);
	check('the shutter takes a 3:2 photo (1920 x 1280) from the lens (kept for the page: checked after VR)', Array.isArray(shot3) && shot3[0] === 1920 && shot3[1] === 1280, JSON.stringify(shot3));
	await frames(6);
	const pr = await page.evaluate(() => { const c = window.__casawalk.xr.fan.camera; return { warmed: !!c.warmed, far: c.view.far, print: c.prints[0] ? [c.prints[0].bmp.width, c.prints[0].bmp.height] : null }; });
	check('the camera is warmed up behind the start; the viewfinder sees 15 m; the print is a small picture (240 x 160)', pr.warmed && pr.far === 15 && (!pr.print || (pr.print[0] === 240 && pr.print[1] === 160)), JSON.stringify(pr));
	await frames(14);
	await shot('camera-print');
	await restRight(); await frames(4);
	await click('right', 'squeeze'); await frames(6);
	check('a squeeze away from the fan puts the tool back', await page.evaluate(() => window.__casawalk.xr.tools.held === null));
	await restLeft(); await lookDown(); await frames(20);
	check('the fan closes when the hand is lowered', await page.evaluate(() => !window.__casawalk.xr.fan.group.visible));
}

// The tools' first-time introduction (C3): large in front of you, then they fly to the fan's wrist; the lesson follows.
{
	await page.evaluate(() => { localStorage.removeItem('casawalk.toolsIntro'); const x = window.__casawalk.xr; x.lessons.stop(); x.toolsIntro.start(); });
	await frames(10);
	const i0 = await page.evaluate(() => { const t = window.__casawalk.xr.toolsIntro, V = window.__casawalk.xr.rig.position.constructor, h = window.__casawalk.xr.headWorld(); return { playing: t.playing, shown: t.group.visible, away: +t.group.getWorldPosition(new V()).distanceTo(h).toFixed(2), names: t.items.map((i) => i.name) }; });
	check('the tools\' introduction: the three tools large, about 1.5 m in front of you, named', i0.playing && i0.shown && Math.abs(i0.away - 1.5) < 0.1 && i0.names.join() === 'Street camera,Meter,Marker', JSON.stringify(i0));
	await shot('tools-intro');
	await page.waitForFunction(() => !window.__casawalk.xr.toolsIntro.playing, null, { timeout: 30000, polling: 'raf' }).catch(() => {});
	const i1 = await page.evaluate(() => ({ playing: window.__casawalk.xr.toolsIntro.playing, remembered: localStorage.getItem('casawalk.toolsIntro') }));
	check('after a few seconds they fly to the wrist and it is remembered', !i1.playing && i1.remembered === '1', JSON.stringify(i1));
}

// The first-time lessons (C0.5), with controllers: the scale model's, then inside.
{
	await page.evaluate((keys) => { for (const k of keys) localStorage.removeItem(k); }, LESSON_KEYS.filter((k) => k.endsWith('controllers')));
	const lesson = () => page.evaluate(() => { const L = window.__casawalk.xr.lessons; return { place: L.place, kind: L.kind, shown: L.group.visible, step: L.current()?.id ?? null, got: L.canClose(), target: L.target.visible, welcome: window.__casawalk.xr.ui.welcome.mesh.visible }; });
	await page.evaluate(() => { const x = window.__casawalk.xr; x.lessons.start('scale'); x.ui.setWelcome(x.ui.welcomeOn); });
	await frames(3);
	const l0 = await lesson();
	check('the scale model\'s lesson: a card of steps in front of you, Start first, the welcome card gone', l0.place === 'scale' && l0.kind === 'controllers' && l0.shown && l0.step === 'start' && !l0.got && !l0.welcome, JSON.stringify(l0));
	await shot('lesson-scale');
	// Start (pressed with the laser), then the wrist menu with A, then holding the model with a grip.
	const startKey = await page.evaluate(() => { const k = window.__casawalk.xr.lessons.keys.keys.get('start'); k.face.updateMatrixWorld(true); return k.face.getWorldPosition(new (k.face.position.constructor)()).toArray(); });
	await aimW('right', R, startKey); await frames(4);
	await click('right', 'trigger'); await frames(4);
	const l1 = await lesson();
	await click('right', 'a-button'); await frames(4); await click('right', 'a-button'); await frames(4);
	const l2 = await lesson();
	await page.evaluate(() => window.__casawalk.xr.lessons.note('fan')); await frames(2); // (the fan itself is checked below)
	const l2b = await lesson();
	await restRight(); await frames(3);
	await button('right', 'squeeze', 1); await frames(6); await button('right', 'squeeze', 0); await frames(6);
	const l3 = await lesson();
	check('steps tick off as you do them: Start, the wrist menu, the tools, holding the model (Got it once the musts are done)', l1.step === 'menu' && l2.step === 'tools' && !l2.got && l2b.step === 'hold' && l2b.got && l3.step === 'inside', JSON.stringify({ l1: l1.step, l2: l2.step, l2b: l2b.step, got: l2b.got, l3: l3.step }));
	// Stepping inside ends it (remembered) and starts the lesson inside, with the orange target.
	await page.evaluate(() => { window.__casawalk.xr.menuAction('in'); }); await settled(); await frames(6);
	const l4 = await lesson();
	const remembered = await page.evaluate(() => localStorage.getItem('casawalk.welcome.scale.controllers'));
	check('stepping inside finishes the scale model\'s lesson (remembered) and starts the one inside, with a target ring ahead', remembered === '1' && l4.place === 'walk' && l4.step === 'arc' && l4.shown && l4.target, JSON.stringify({ remembered, ...l4 }));
	await shot('lesson-walk');
	await page.evaluate(() => window.__casawalk.xr.lessons.finish()); await frames(2);
	check('Got it (or the last step) puts it away for good', (await lesson()).place === null && await page.evaluate(() => localStorage.getItem('casawalk.welcome.walk.controllers')) === '1');
	await page.evaluate(() => window.__casawalk.xr.menuAction('back')); await settled(); await frames(6);
	await restRight(); await restLeft(); await lookDown(); await frames(4);
}

// ← Back at the scale model leaves VR (a fade to white, then the page).
await lookDown();
await pressWrist('left');
await frames(10);
s = await state();
check('← Back at the scale model leaves VR (the wrist menu\'s: one press)', !s.presenting);
bad = await leftovers();
check('leaving the dollhouse leaves nothing behind', !bad.length, bad.join(', '));
await fingerprint('2d-after-exit');
await shot('back-to-2d');

// Re-enter from another spot, facing another way: the room and plinth come to you.
await page.evaluate(() => {
	const d = window.__device;
	d.position.set(1.2, 1.15, 0.8); // sitting down this time
	const yaw = 0.9, a = -0.45;
	const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], qx = [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
	const q = [qy[3] * qx[0] + qy[0] * qx[3] + qy[1] * qx[2] - qy[2] * qx[1], qy[3] * qx[1] - qy[0] * qx[2] + qy[1] * qx[3] + qy[2] * qx[0], qy[3] * qx[2] + qy[0] * qx[1] - qy[1] * qx[0] + qy[2] * qx[3], qy[3] * qx[3] - qy[0] * qx[0] - qy[1] * qx[1] - qy[2] * qx[2]];
	d.quaternion.set(...q);
});
await enterVR.click();
await frames(30);
s = await state();
check('re-entering puts the plinth in front of you', Math.abs(s.stage[0] - 1.2) < 0.02 && Math.abs(s.stage[2] - 0.8) < 0.02 && Math.abs(s.stage[3] - 0.9) < 0.02,
	`stage ${s.stage.map((v) => v.toFixed(2))}`);
check('menu does not open by itself on re-entry; the welcome card is back', s.menu === null && await page.evaluate(() => window.__casawalk.xr.ui.welcome.mesh.visible));
check('sitting down: the eyes are still at 1.89 m', Math.abs(s.head[1] - 1.89) < 0.005 && Math.abs(s.rig[1] - 0.74) < 0.005, `eyes ${s.head[1].toFixed(3)} m, raised ${s.rig[1].toFixed(3)} m`);
// Stand up and recentre with the headset (the Meta button): measured again.
await page.evaluate(() => window.__device.position.set(1.2, 1.75, 0.8));
await frames(5);
await page.evaluate(() => { window.__casawalk.xr.pendingRecentre = true; });
await frames(5);
s = await state();
check('recentring measures the height again', Math.abs(s.head[1] - 1.89) < 0.005 && Math.abs(s.rig[1] - 0.14) < 0.005, `eyes ${s.head[1].toFixed(3)} m, raised ${s.rig[1].toFixed(3)} m`);
await fingerprint('reentered');
await shot('reentered');
await page.evaluate(() => window.__casawalk.xr.end());
await frames(5);

// The sample homes: "Try a sample home" shows a card per home; one tap opens it.
{
	await page.click('#open-sample');
	const cards = await page.evaluate(() => [...document.querySelectorAll('#samples button')].map((b) => ({ id: b.dataset.sample, name: b.querySelector('b').textContent, pic: b.querySelector('img').complete && b.querySelector('img').naturalWidth > 0 })));
	await page.click('#samples button[data-sample="pond-house"]');
	await page.waitForFunction(() => /Loaded pond-house/.test(document.getElementById('status').textContent), null, { timeout: 20000 }).catch(() => {});
	const ph = await page.evaluate(() => ({ status: document.getElementById('status').textContent, hidden: document.getElementById('samples').hidden }));
	check('Try a sample home: a card for Pond House, with its picture; one tap opens it', cards.length >= 1 && cards[0].id === 'pond-house' && cards[0].name === 'Pond House' && cards[0].pic && /Loaded pond-house/.test(ph.status) && ph.hidden, JSON.stringify({ cards, ...ph }));
}
// The example home (two storeys, lamps): level picker, lamps at night. (The tests' small fixture: opened directly.)
await page.evaluate(() => window.__casawalk.open('examples/example-home.sh3d'));
await page.waitForFunction(() => /Loaded example-home/.test(document.getElementById('status').textContent), null, { timeout: 20000 });
await page.evaluate(() => window.__device.position.set(0, 1.6, 0));
await lookDown();
await restRight();
await restLeft();
await enterVR.click();
await waitXR();
await frames(10);
const storeys = () => page.evaluate(() => {
	const x = window.__casawalk.xr, shown = new Set(), hidden = new Set();
	for (const g of [...Object.values(x.model.layers), x.model.lamps]) for (const m of g?.children ?? []) (m.visible ? shown : hidden).add(m.userData.storey ?? 0);
	const topCeilings = x.model.layers.ceilings.children.filter((m) => m.visible).map((m) => m.userData.storey);
	return { count: x.model.storeys, shown: [...shown].sort(), hidden: [...hidden].sort(), topCeilings, level: x.menus.dollhouse.get('levels').value, levelOptions: x.menus.dollhouse.get('levels').options.map((o) => o.label).join(' '),
		pointable: x.targets().pointable.every((m) => m.visible), lamps: x.model.lamps?.children.length ?? 0, lampsOn: !!x.model.lamps?.visible, multi: x.model.multiLevel };
});
let lv = await storeys();
await fingerprint('example-entry');
check('example home: two storeys, all shown', lv.count === 2 && lv.multi && lv.hidden.length === 0 && lv.level === 1 && lv.levelOptions === 'All levels (2) Up to Ground floor', JSON.stringify(lv));
{
	// Milestone B. Words: the scale model, never "dollhouse", on any headset text.
	const words = await page.evaluate(() => {
		const x = window.__casawalk.xr, texts = [];
		for (const p of Object.values(x.menus)) {
			texts.push(p.title, p.hint, ...p.tabs.map((t) => t.label));
			for (const c of p.cells.values()) texts.push(c.label, c.note ?? '', ...(c.options ?? []).map((o) => o.label));
		}
		for (const w of [x.ui.welcome, x.ui.photoNote]) texts.push(w.title, ...w.lines.map((l) => l.text));
		for (const k of Object.values(x.ui.wrist.keys)) texts.push(k.spec?.label ?? '', k.spec?.caption ?? '');
		return { bad: texts.filter((t) => /dollhouse/i.test(t)), exit: texts.filter((t) => /exit vr/i.test(t)), titles: Object.values(x.menus).map((p) => p.title), tabs: x.menus.dollhouse.tabs.map((t) => t.label) };
	});
	check('the words: "scale model", never "dollhouse", no "Exit VR"; boards titled by layer; tabs How to move, View, Walk, Tools, General', !words.bad.length && !words.exit.length && words.titles.join() === 'Settings \u00b7 Scale model,Settings \u00b7 Inside' && words.tabs.join() === 'How to move,View,Walk,Tools,General', JSON.stringify(words));
	check('the page says "scale model" too', !/dollhouse/i.test(await page.evaluate(() => document.querySelector('meta[name=description]').content + document.body.innerText)));
	// The plinth stands 60 cm in front of you, and its plate shows the true scale.
	const pl = await page.evaluate(() => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, head = x.headWorld();
		const front = x.stage.localToWorld(new V(0, 0, -x.plinthDistance + x.plinthSize.D / 2));
		return { gap: Math.hypot(front.x - head.x, front.z - head.z), plate: x.plate.text, ratio: 1 / x.anchor.scale.x, onPlinth: x.plate.mesh.parent === x.pedestal && x.plate.mesh.visible };
	});
	check('the plinth\'s front edge is 60 cm in front of you; its plate shows the scale', Math.abs(pl.gap - 0.6) < 0.01 && pl.plate === `1:${Math.round(pl.ratio)}` && pl.onPlinth, JSON.stringify(pl));
	// Pointing at a room: the marker hops to its clear middle, with its name; you land there facing along the room.
	const room = await page.evaluate(async () => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, { roomLanding } = await import('/js/rooms.js');
		const r = x.model.plan.rooms.find((r) => r.name === 'Living room'), l = roomLanding(r, (a, b) => x.modes.dollhouse.isClear(a, r.floorY, b));
		const aim = x.centerer.localToWorld(new V(l.x + 0.4, r.floorY, l.z + 0.3));
		return { spot: [l.x, r.floorY, l.z], aim: aim.toArray(), above: aim.clone().setY(aim.y + 0.3).toArray() };
	});
	await aim('right', await toLocal(room.above), await toLocal(room.aim)); await frames(8); // (from straight above the room)
	const mk = await page.evaluate(() => { const x = window.__casawalk.xr, d = x.modes.dollhouse, i = x.input.hands.right.index, m = d.markers[i];
		return { shown: m.visible, at: m.position.toArray(), yaw: m.rotation.y, label: d.labels[i].text, labelShown: d.labels[i].mesh.visible, clear: d.isClear(m.position.x, m.position.y, m.position.z) }; });
	check('pointing at a room: the marker hops to its clear middle, named', mk.shown && Math.hypot(mk.at[0] - room.spot[0], mk.at[2] - room.spot[2]) < 1e-6 && mk.label === 'Living room' && mk.labelShown && mk.clear, JSON.stringify(mk));
	await shot('example-landing');
	await click('right', 'trigger'); await settled(); await frames(5);
	s = await state();
	const landed = await page.evaluate((spot) => { const x = window.__casawalk.xr, V = x.rig.position.constructor, h = x.headWorld(), f = new V(0, 0, -1).transformDirection(x.camera.matrixWorld), p = x.centerer.localToWorld(new V(...spot));
		return { d: Math.hypot(h.x - p.x, h.z - p.z), heading: Math.atan2(-f.x, -f.z) }; }, room.spot);
	const dYaw = Math.atan2(Math.sin(landed.heading - mk.yaw), Math.cos(landed.heading - mk.yaw));
	check('stepping inside: you stand there, facing the way the marker showed', s.mode === 'walk' && landed.d < 0.02 && Math.abs(dYaw) < 0.05, JSON.stringify({ ...landed, markerYaw: mk.yaw }));
	await lookAhead(); await restRight(); await frames(5);
	await shot('example-landed');
	await lookDown(); await click('right', 'b-button'); await settled(); await frames(5);
	// Zooming near a standard scale (1:N) settles exactly on it.
	const target = await page.evaluate(() => { const x = window.__casawalk.xr, base = x.baseScale;
		const S = [10, 20, 25, 50].find((n) => { const z = 1 / (base * n); return z > 0.6 && z < 3.5; });
		x.modes.dollhouse.doll.zoom = 1 / (base * S * 1.04); return S; });
	await stick('right', 0, -0.3); await frames(3); await stick('right', 0, 0);
	await page.waitForFunction(() => !window.__casawalk.xr.modes.dollhouse.settling && !window.__casawalk.xr.modes.dollhouse.zoomHand, null, { timeout: 5000 }).catch(() => {});
	await frames(3);
	const zs = await page.evaluate(() => { const x = window.__casawalk.xr; return { ratio: 1 / (x.baseScale * x.modes.dollhouse.doll.zoom), plate: x.plate.text }; });
	check(`zoom settles on a standard scale (1:${target})`, Math.abs(zs.ratio - target) < 1e-6 && zs.plate === `1:${target}`, JSON.stringify(zs));
	await shot('example-scale-plate');
	await page.evaluate(() => window.__casawalk.xr.modes.dollhouse.recentre()); await frames(5);
}
await openBoard();
await shot('example-menu');
check('Levels: a ‹ › stepper showing "All levels (2)"', await page.evaluate(() => { const c = window.__casawalk.xr.menu.get('levels'); return c.stepper && c.value === 1 && !c.disabled; }));
await clickMenu('levels', 0); // the › arrow: down to the ground floor
await frames(5);
lv = await storeys();
check('Levels shows the ground floor only, without its ceilings', lv.shown.join() === '0' && lv.hidden.includes(1) && lv.topCeilings.length === 0 && lv.level === 0 && lv.pointable, JSON.stringify(lv));
await fingerprint('example-ground-floor');
await page.evaluate(() => window.__casawalk.lighting.setTime('night'));
await frames(5);
lv = await storeys();
check('lamps glow at night', lv.lamps > 0 && lv.lampsOn, JSON.stringify(lv));
await click('right', 'b-button');
await shot('example-ground-floor-night');
await page.evaluate(() => window.__casawalk.lighting.setTime('morning'));
await openBoard();
await clickMenu('levels', 1); // the ‹ arrow: all levels again
await frames(5);
lv = await storeys();
check('Levels: All shows every storey again', lv.hidden.length === 0 && lv.level === 1 && !lv.lampsOn, JSON.stringify(lv));
{
	// Photos (the street camera brings them back in milestone D; the code
	// stays): the picture is kept for the page; nothing is downloaded in VR
	// (the Quest Browser's download prompt ends the session).
	await click('right', 'b-button'); await frames(3);
	let downloaded = false;
	const watch = () => { downloaded = true; };
	page.on('download', watch);
	const n0 = (await photos()).length;
	// (Called directly: there is no Photo key until the street camera. Triggered
	// from inside the emulator's XR frame, saving to IndexedDB stalls in headless
	// Chromium; milestone D checks the camera's own path on the headset.)
	await page.evaluate(() => window.__casawalk.xr.capturePhoto());
	await page.waitForFunction(async (n0) => (await (await import('/js/storage.js')).listPhotos()).length > n0, n0, { timeout: 20000 }).catch(() => {});
	await page.waitForTimeout(1000);
	page.off('download', watch);
	const kept = await photos();
	const fx = await page.evaluate(() => ({ busy: window.__casawalk.xr.photoBusy, menu: window.__casawalk.xr.menu !== null, note: window.__casawalk.xr.ui.photoNote.mesh.visible, title: window.__casawalk.xr.ui.photoNote.title, line: window.__casawalk.xr.ui.photoNote.lines[0].text }));
	check('a photo is kept for the page, nothing downloaded in VR, and the note says so', kept.length === n0 + 1 && !downloaded && /^CasaWalk \d{4}-\d\d-\d\d [\d.]+\.jpg$/.test(kept[0].name) && fx.note && fx.title === 'Nice shot!' && /page/.test(fx.line),
		JSON.stringify({ kept: kept.length, downloaded, name: kept[0]?.name, ...fx }));
	await openBoard();
}
// Depth shading: switched on from the menu, prepared in the background, headset only.
const depth = () => page.evaluate(() => { const d = window.__casawalk.depth, x = window.__casawalk.xr; return { on: d.enabled, state: d.state, uniform: d.uniform.value, label: x.menus.dollhouse.get('depth').label, switched: x.menus.dollhouse.get('depth').value }; });
check('Depth starts off', (await depth()).switched === false && (await depth()).uniform === 0);
await clickMenu('depth');
await page.waitForFunction(() => window.__casawalk.depth.state === 'ready', null, { timeout: 300000 }).catch(() => {}); // (the bake is time-sliced: slow on a loaded machine)
await frames(5);
let dp = await depth();
check('Depth shading is prepared and shown in the headset', dp.on && dp.state === 'ready' && dp.uniform === 1 && dp.switched === true && dp.label === 'Depth shading', JSON.stringify(dp));
await clickMenu('levels', 0); // ground floor only, then walk in: every storey comes back
await click('right', 'b-button'); await frames(3);
await pressWrist('right');
await frames(15);
lv = await storeys();
s = await state();
check('walking shows every storey', s.mode === 'walk' && lv.hidden.length === 0, JSON.stringify({ mode: s.mode, hidden: lv.hidden }));
await fingerprint('example-walk');
{
	// Several levels: furniture stops the arc (stairs can be stood on), but doors and windows don't.
	const o = await page.evaluate(() => {
		const x = window.__casawalk.xr, t = x.targets(), main = x.model.layers.main.children;
		const openings = main.filter((m) => m.userData.opening);
		return { openings: openings.length, inSolid: openings.filter((m) => t.solid.includes(m)).length, furnitureSolid: t.solid.some((m) => main.includes(m) && !m.userData.opening) };
	});
	check('several levels: the arc passes doors and windows, not other furniture', o.openings > 0 && o.inSolid === 0 && o.furnitureSolid, JSON.stringify(o));
}
await shot('example-walk-depth');
await page.evaluate(() => window.__casawalk.xr.end());
await frames(5);
bad = await leftovers();
check('leaving from walk mode leaves nothing behind', !bad.length, bad.join(', '));
{
	// After VR, the page offers the photos taken there; Save all downloads them as JPEGs (1920 x 1080).
	await page.waitForFunction(() => !document.getElementById('photos-section').hidden, null, { timeout: 5000 }).catch(() => {});
	const pg = await page.evaluate(() => ({ shown: !document.getElementById('photos-section').hidden, rows: document.querySelectorAll('#photos li').length, status: document.getElementById('status').textContent }));
	const download = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
	await page.click('#photos-save');
	const d = await download;
	const file = path.join(out, 'xr-photo.jpg');
	if (d) await d.saveAs(file);
	const jpeg = d ? fs.readFileSync(file) : null;
	let size = null; // width x height from the JPEG's frame header
	for (let i = 2; jpeg && i < jpeg.length - 9; i++) if (jpeg[i] === 0xff && jpeg[i + 1] >= 0xc0 && jpeg[i + 1] <= 0xc2) { size = [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)]; break; }
	check('after VR: the page offers the photos, and Save all downloads a JPEG (1920 x 1080 from the head, 1920 x 1280 from the camera)', pg.shown && pg.rows >= 1 && /photo/i.test(pg.status) && d && /^CasaWalk \d{4}-\d\d-\d\d [\d.]+\.jpg$/.test(d.suggestedFilename()) && ['1920x1080', '1920x1280'].includes(size?.join('x')) && jpeg.length > 30000,
		JSON.stringify({ ...pg, name: d?.suggestedFilename(), size, bytes: jpeg?.length }));
	await page.waitForTimeout(1500); // (the rest download one at a time)
	await page.evaluate(async () => { const s = await import('/js/storage.js'); for (const p of await s.listPhotos()) await s.removePhoto(p.id); });
}
await fingerprint('2d-after-walk-exit');
dp = await depth();
check('Depth shading is not applied on the 2D page', dp.on && dp.uniform === 0, JSON.stringify(dp));
check('the page switch follows the headset menu', await page.isChecked('#depth') && /ready/.test(await page.textContent('#depth-note')));
await page.click('label.switch:has(#depth)'); // back off, as the next run expects

// ---------------------------------------------------------------------------
// Across sessions and modes: a clean re-entry, trigger ownership, the photo's
// hidden interface, lasers, snap turn, two-hand pull, the fade, leaving in
// the middle of an action, and the headset's own re-centre. (After the last
// screenshot, so the screenshots keep their numbers.)
// ---------------------------------------------------------------------------
await page.evaluate(() => window.__device.position.set(0, 1.6, 0)); await lookDown(); await restRight(); await restLeft();
await enterVR.click(); await waitXR(); await frames(10);
bad = await entry();
check('re-entering after leaving from walk mode: a clean dollhouse', !bad.length, bad.join(', '));
const fpA = await fingerprint('reentry-after-walk');
const lv0 = await page.evaluate(() => window.__casawalk.xr.maxStorey); // (the level picked in the last session stays)

// Welcome card: follows your head, waits while you walk, is back in the dollhouse.
await page.evaluate(() => window.__device.position.set(0.4, 1.6, 0.1));
await page.waitForFunction(() => { // (until the card has turned, or 3 s)
	const x = window.__casawalk.xr, V = x.rig.position.constructor, card = x.ui.welcome.mesh;
	const to = x.camera.getWorldPosition(new V()).sub(card.getWorldPosition(new V())).normalize();
	return new V(0, 0, 1).transformDirection(card.matrixWorld).dot(to) > Math.cos(Math.PI / 180);
}, null, { timeout: 3000 }).catch(() => {});
const faceAngle = THREE_deg(await facing());
await page.evaluate(() => window.__device.position.set(0, 1.6, 0)); await frames(5);
check('the welcome card turns to face you as you move', faceAngle < 1, `${faceAngle.toFixed(2)}°`);
await aimW('right', R, await modelTop()); await frames(6); await click('right', 'trigger'); await settled();
// (Shown: visible, and every parent too.)
const welcomeShown = () => page.evaluate(() => { for (let a = window.__casawalk.xr.ui.welcome.mesh; a; a = a.parent) if (!a.visible) return false; return true; });
const wk = { mode: (await state()).mode, shown: await welcomeShown(), on: await page.evaluate(() => window.__casawalk.xr.ui.welcomeOn) };
await restRight(); await click('right', 'b-button'); await settled(); await frames(3);
s = await state();
const back = { shown: await welcomeShown(), lasers: await lasers() };
check('welcome card hides while walking and is back in the dollhouse; lasers on', wk.mode === 'walk' && !wk.shown && wk.on && s.mode === 'dollhouse' && back.shown && back.lasers === 'left:on right:on' && Math.abs(s.head[1] - 1.89) < 0.005, JSON.stringify({ wk, back }));

// Trigger ownership, and A closing what it opened.
await click('right', 'a-button');
const opened = (await state()).wrist;
await aimW('right', R, await modelTop()); await frames(5); await click('right', 'trigger');
s = await state();
check('wrist menu open: a pull on the model only closes it', opened && !s.wrist && s.mode === 'dollhouse', JSON.stringify({ opened, wrist: s.wrist, mode: s.mode }));
await restRight(); await frames(3); await click('right', 'a-button'); await click('right', 'a-button');
check('A closes the wrist menu it opened', !(await state()).wrist);

// Help: the board on How to move, for controllers, with the build at its foot; B closes it.
await pressWrist('down');
{
	await frames(3);
	const hp = await page.evaluate(() => { const x = window.__casawalk.xr, m = x.menu, c = m?.cells.get('guide'); return { tab: m?.tab, kind: c?.kind, foot: c?.foot ?? '', wrist: x.ui.wrist.open, doors: x.modes.dollhouse.doorGroup.visible }; });
	await shot('dollhouse-help');
	check('Help shows the build at the foot of How to move, and that a newer version waits (reload after VR)', /^Build \d+/.test(hp.foot) && /Newer version: reload after VR$/.test(hp.foot), JSON.stringify(hp));
	await click('right', 'b-button');
	check('Help: the board on How to move, for controllers; the plinth doors gone while it is open; B closes it', hp.tab === 'move' && hp.kind === 'dollhouse-controllers' && !hp.wrist && !hp.doors && !(await state()).menu, JSON.stringify(hp));
}

// Photo: nothing of the interface in the picture, all of it back afterwards.
await openBoard();
await aimW('left', L, await modelTop()); await frames(6); // a marker under the left laser
await page.evaluate(() => { const x = window.__casawalk.xr; x.lessons.stop(); x.toolsIntro.stop(); x.ui.setWelcome(true); }); // (Help replayed the lesson above: it would hide the welcome card)
const seen = page.evaluate(() => new Promise((done) => {
	const S = window.__casawalk, x = S.xr, r = S.renderer, render = r.render;
	const ui = { menu: Object.values(x.menus).map((p) => p.mesh), welcome: [x.ui.welcome.mesh], feedback: [x.veil.mesh, x.ui.photoNote.mesh], arc: [x.modes.walk.arc.dots, x.modes.walk.arc.ring],
		markers: x.modes.dollhouse.markers, orbs: [x.ui.wrist.orb.group, x.ui.wrist.cross], hands: x.input.controllers.flatMap((c) => [c.ray, c.grip]) };
	const shown = (o) => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
	// (Since A5 nothing is hidden for a photo: the interface is on its own layer, which the photo's camera doesn't show.)
	const showing = (camera = x.camera) => Object.keys(ui).filter((k) => ui[k].some((o) => { let seen = false; o.traverse((c) => { if (c.isMesh || c.isLine || c.isPoints) seen ||= c.layers.test(camera.layers); }); return shown(o) && seen; }));
	const before = showing();
	setTimeout(() => done({ before, timeout: true }), 15000);
	r.render = function (...args) {
		if (!r.xr.enabled && args[0] === S.scene) { r.render = render; const during = showing(args[1]); setTimeout(() => done({ before, during, after: showing() }), 0); } // the photo's draw
		return render.apply(this, args);
	};
}));
const nKept = (await photos()).length;
page.evaluate(() => window.__casawalk.xr.capturePhoto()); // (the street camera's job from milestone D; not awaited: the check watches the draw)
const ph = await seen;
await page.waitForFunction(async (n) => (await (await import('/js/storage.js')).listPhotos()).length > n, nKept, { timeout: 20000 }).catch(() => {});
// (The note stays 2.5 s of the app's time, which runs slower than the clock in the emulator.)
await page.waitForFunction(() => !window.__casawalk.xr.ui.photoFx, null, { timeout: 10000 }).catch(() => {});
await frames(3);
const pfx = await page.evaluate(() => { const x = window.__casawalk.xr; return { flash: x.veil.amount('flash') > 0, note: x.ui.photoNote.mesh.visible, fx: x.ui.photoFx }; });
check('Photo: no menu, laser, controller, orb, arc, marker, welcome card, flash or note in it; all back after',
	ph.during?.length === 0 && ph.before.join() === 'menu,welcome,markers,orbs,hands' && ph.after.join() === 'menu,welcome,markers,orbs,hands', JSON.stringify(ph));
await click('right', 'b-button');
check('Photo: the flash and the note go again', !pfx.flash && !pfx.note && pfx.fx === null, JSON.stringify(pfx));
await page.evaluate(() => window.__casawalk.xr.ui.setWelcome(false)); await restLeft();

// Walking: lasers, the inside board, B, trigger ownership, snap, two-hand pull, fade.
await lookDown(); await pressWrist('right');
await lookAhead(); await restRight(); await restLeft(); await frames(5);
const l0 = await lasers(); await click('right', 'a-button'); await frames(3); const l1 = await lasers();
check('walking: lasers hidden, shown while the wrist menu is open', l0 === 'left:off right:off' && l1 === 'left:on right:on', `${l0} / ${l1}`);
await click('right', 'b-button');
await openBoard();
const wm = await page.evaluate(() => { const x = window.__casawalk.xr, V = x.rig.position.constructor, head = x.headWorld(), p = x.menu.mesh.getWorldPosition(new V());
	const nrm = new V(0, 0, 1).transformDirection(x.menu.mesh.matrixWorld).setY(0).normalize(), to = head.clone().sub(p).setY(0).normalize();
	return { dist: Math.hypot(p.x - head.x, p.z - head.z), drop: head.y - p.y, facing: Math.acos(Math.min(1, nrm.dot(to))) * 180 / Math.PI }; });
check('the inside board: 0.4 m straight ahead, 30 cm below the eyes, facing you', Math.abs(wm.dist - 0.4) < 0.01 && Math.abs(wm.drop - 0.3) < 0.005 && wm.facing < 1, JSON.stringify(wm));
{
	const stays = [];
	for (const [id, v] of [['height', 1.7], ['height', 0], ['solid'], ['solid'], ['ceilings']]) { await clickMenu(id, v); if ((await state()).menu !== 'walk') stays.push(id); }
	const agree = await page.evaluate(() => { const { dollhouse: d, walk: k } = window.__casawalk.xr.menus;
		return ['light', 'shadows', 'depth', 'ceilings', 'seethrough', 'view'].filter((id) => d.get(id).value !== k.get(id).value || !!d.get(id).disabled !== !!k.get(id).disabled); });
	await clickMenu('ceilings');
	check('the inside board stays open for switches and options; both boards agree', !stays.length && !agree.length, `closed on ${stays}; differ ${agree}`);
}
if ((await state()).session === 'ar') {
	await clickMenu('view');
	const pt = await page.evaluate(() => { const x = window.__casawalk.xr; return { sky: x.walkSky.visible, ground: x.model.layers.ground.visible, menu: !!x.menu }; });
	await clickMenu('view');
	check('walking in passthrough: no sky and no ground', !pt.sky && !pt.ground && pt.menu && (await state()).walkSky, JSON.stringify(pt));
}
await click('right', 'b-button'); s = await state();
check('B with the board open closes it, and you keep walking', s.menu === null && s.mode === 'walk');
await aim('right', R, [0.25, 0, -1.0]); await frames(3);
h0 = (await state()).head;
await button('right', 'trigger', 1); await frames(6);
const aiming = (await state()).arc;
await click('right', 'a-button'); await button('right', 'trigger', 0); await frames(20); s = await state();
check('A while aiming opens the wrist menu and cancels the teleport', aiming && s.wrist && !s.arc && Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]) < 1e-3, JSON.stringify({ aiming, wrist: s.wrist, arc: s.arc }));
await click('right', 'trigger'); await frames(20); s = await state(); // the laser is on the floor, not the menu
check('wrist menu open: a pull on the floor only closes it', !s.wrist && !s.arc && Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]) < 1e-3);
{
	const y0 = (await state()).rigYaw;
	await stick('right', 0, -1); await frames(6); await stick('right', 0.9, -0.5); await frames(6);
	const mid = (await state()).rigYaw;
	await stick('right', 0, 0); await frames(25);
	const y1 = (await state()).rigYaw;
	for (let i = 0; i < 2; i++) { await stick('right', 1, 0); await frames(8); await stick('right', 0, 0); await frames(5); }
	s = await state();
	const two = THREE_deg(y1 - s.rigYaw);
	for (let i = 0; i < 2; i++) { await stick('right', -1, 0); await frames(8); await stick('right', 0, 0); await frames(5); }
	check('no snap turn while the stick aims; snap re-arms when the stick centres', Math.abs(mid - y0) < 1e-6 && Math.abs(y1 - y0) < 1e-6 && Math.abs(two - 2 * s.snap) < 0.5, `aiming ${THREE_deg(mid - y0).toFixed(1)}°, two snaps ${two.toFixed(1)}°`);
}
{
	const pull = async (dr, dl) => {
		await aim('right', [0.2, 1.1, -0.5], [0.2, 1.1, -1.5]); await aim('left', [-0.2, 1.1, -0.5], [-0.2, 1.1, -1.5]); await frames(3);
		const a = (await state()).head;
		await button('right', 'squeeze', 1); await button('left', 'squeeze', 1); await frames(3);
		for (let i = 1; i <= 5; i++) { await aim('right', [0.2, 1.1, -0.5 + i * dr / 5], [0.2, 1.1, -1.5]); await aim('left', [-0.2, 1.1, -0.5 + i * dl / 5], [-0.2, 1.1, -1.5]); await frames(2); }
		await button('right', 'squeeze', 0); await button('left', 'squeeze', 0); await frames(3);
		const b = (await state()).head;
		return Math.hypot(b[0] - a[0], b[2] - a[2]);
	};
	const one = await pull(0.3, 0), both = await pull(0.3, 0.3);
	check('grip pull: two hands average', Math.abs(one - 0.15) < 0.04 && Math.abs(both - 0.3) < 0.05, `one hand ${one.toFixed(2)} m, both ${both.toFixed(2)} m`);
}
{
	await restLeft(); await aim('right', R, [0.25, 0, -1.0]); await frames(3);
	await button('right', 'trigger', 1); await frames(6);
	const valid = (await state()).valid;
	await button('right', 'trigger', 0);
	const dark = await page.waitForFunction(() => window.__casawalk.xr.veil.amount('teleport') > 0, null, { timeout: 1000, polling: 5 }).then(() => true, () => false);
	await frames(20);
	const fd = await page.evaluate(() => { const x = window.__casawalk.xr; return { fade: x.modes.walk.fade !== null, shown: x.veil.amount('teleport') > 0, opacity: x.veil.amount('teleport') }; });
	check('a teleport fades out and back in', valid && dark && !fd.fade && !fd.shown && fd.opacity === 0, JSON.stringify({ valid, dark, ...fd }));
}

// Leave in the middle of a teleport and a pull, with see-through on; come back.
await openBoard(); await seeThrough(true); await click('right', 'b-button');
await aim('right', R, [0.25, 0, -1.0]); await frames(3);
await button('right', 'trigger', 1); await button('left', 'squeeze', 1); await frames(6);
const busy = await page.evaluate(() => ({ tele: !!window.__casawalk.xr.modes.walk.tele, arc: window.__casawalk.xr.modes.walk.arc.dots.visible }));
await page.evaluate(() => window.__casawalk.xr.end()); await frames(10);
await button('right', 'trigger', 0); await button('left', 'squeeze', 0); await frames(3);
bad = await leftovers();
const glassOff = await page.evaluate(() => window.__casawalk.xr.seeThrough.meshes.every((m) => [].concat(m.material).every((mat) => mat.opacity === mat.userData.cwBase.opacity && mat.depthWrite === mat.userData.cwBase.depthWrite)));
check('leaving mid-teleport with see-through on: nothing left over, 2D shows the model as modelled', busy.tele && busy.arc && !bad.length && glassOff, `${JSON.stringify(busy)} ${bad.join(', ')} glass ${glassOff}`);
await page.evaluate(() => window.__device.position.set(0, 1.6, 0)); await lookDown(); await restRight(); await restLeft();
await enterVR.click(); await waitXR(); await frames(10);
{
	bad = await entry();
	const see = await page.evaluate(() => { const x = window.__casawalk.xr, m = x.seeThrough.meshes.flatMap((k) => [].concat(k.material)).find((mat) => !mat.userData.cwBase.transparent);
		return { amount: x.seeThroughAmount, keep: m.opacity / m.userData.cwBase.opacity, cell: x.menus.walk.get('seethrough').value }; });
	const sameAsBefore = diffs(fpA, await fingerprint('reentry-after-mid-teleport')).filter((d) => !/^\.(settings|menus|storage)\.|^\.draw\.[0-3] |see-through-depth/.test(d)); // (see-through is on now: the walls' depth pass adds draw calls; GPU memory counts vary)
	check('re-entering again: the same clean dollhouse; see-through remembered', !bad.length && see.amount === 0.75 && Math.abs(see.keep - (1 - 0.85 * 0.75)) < 1e-6 && see.cell === true && !sameAsBefore.length,
		`${bad} ${JSON.stringify(see)} ${sameAsBefore.slice(0, 3).join('; ')}`);
	await page.evaluate(() => window.__casawalk.xr.menuAction({ id: 'seethrough', value: false }));
}

// The headset's own re-centre (holding the Meta button): the plinth comes back
// in front of you in the dollhouse, and stays put while walking. (Last: it
// moves the emulator's origin.)
await page.evaluate(() => { const d = window.__device; d.position.set(0.7, 1.6, -0.2); d.quaternion.set(0, Math.sin(0.25), 0, Math.cos(0.25)); }); await frames(3);
await page.evaluate(() => window.__casawalk.xr.modes.dollhouse.recentre()); await frames(3);
{
	const st0 = (await state()).stage;
	await page.evaluate(() => window.__device.recenter()); await frames(10); // IWER fires 'reset' on the reference space
	s = await state();
	check('re-centring the headset brings the plinth back in front', Math.hypot(st0[0], st0[2]) > 0.5 && Math.hypot(s.stage[0], s.stage[2]) < 0.02 && Math.abs(s.stage[3]) < 0.02 && Math.abs(s.head[1] - 1.89) < 0.005, `${st0.map((v) => v.toFixed(2))} → ${s.stage.map((v) => v.toFixed(2))}`);
	await page.evaluate(() => window.__casawalk.xr.menuAction('in')); await settled(); await frames(5);
	const st1 = (await state()).stage;
	await page.evaluate(() => window.__device.recenter()); await frames(5);
	s = await state();
	check('re-centring while walking leaves the plinth alone', s.mode === 'walk' && s.stage.every((v, i) => Math.abs(v - st1[i]) < 1e-9) && !(await page.evaluate(() => window.__casawalk.xr.pendingRecentre)));
}

// The feel kit (js/tween.js, js/haptics.js, js/sound.js; used from milestone C):
// vibration reaches the controller, tweens run on the frame clock, sound is
// unlocked by Enter VR and pauses when quiet, and every sound renders short,
// audible and below full scale.
{
	await page.evaluate(() => {
		const x = window.__casawalk.xr, c = x.input.hands.right, motor = c.source.gamepad.hapticActuators?.[0];
		window.__pulses = [];
		if (motor) { window.__realPulse = motor.pulse; motor.pulse = (s, ms) => { window.__pulses.push([s, ms]); return Promise.resolve(true); }; }
		x.haptics.play(c, 'shutter');
		window.__tweenDone = 0;
		x.tweens.start({ duration: 0.2, done: () => window.__tweenDone++ });
	});
	await page.waitForFunction(() => window.__pulses.length >= 2 && window.__tweenDone, null, { timeout: 5000 }).catch(() => {});
	// Quiet for 3 s of the app's time: the audio context pauses (the clock runs slower in the emulator).
	await page.waitForFunction(() => window.__casawalk.xr.sound.ctx?.state === 'suspended', null, { timeout: 15000 }).catch(() => {});
	const idle = await page.evaluate(() => window.__casawalk.xr.sound.ctx?.state ?? null);
	await page.evaluate(() => window.__casawalk.xr.sound.play('tick'));
	await page.waitForFunction(() => window.__casawalk.xr.sound.ctx?.state === 'running', null, { timeout: 3000 }).catch(() => {});
	const fk = await page.evaluate(async () => {
		const x = window.__casawalk.xr, motor = x.input.hands.right.source.gamepad.hapticActuators?.[0];
		if (motor) motor.pulse = window.__realPulse;
		const { RECIPES, schedule, recipeLength } = await import('/js/sound.js');
		const sounds = {};
		for (const [name, r] of Object.entries(RECIPES)) {
			const rate = 22050, len = recipeLength(r), end = Math.ceil((len + 0.02) * rate);
			const ctx = new OfflineAudioContext(1, Math.ceil((len + 0.1) * rate), rate);
			schedule(ctx, r, ctx.destination, 0);
			const data = (await ctx.startRendering()).getChannelData(0);
			let peak = 0, sum = 0, tail = 0;
			for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (i < end) { peak = Math.max(peak, v); sum += v * v; } else tail = Math.max(tail, v); }
			sounds[name] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / end).toFixed(4), tail: +tail.toFixed(5) };
		}
		return { pulses: window.__pulses, tween: window.__tweenDone, woke: x.sound.ctx?.state ?? null, sounds };
	});
	check('feel kit: vibration reaches the controller (the shutter\'s two pulses)', JSON.stringify(fk.pulses) === '[[0.6,18],[0.35,25]]', JSON.stringify(fk.pulses));
	check('feel kit: a tween runs on the frame clock and ends once', fk.tween === 1);
	check('feel kit: sound unlocked by Enter VR, paused when quiet, woken by a sound', idle === 'suspended' && fk.woke === 'running', `${idle} → ${fk.woke}`);
	check('feel kit: every sound is short, audible and never clips', Object.values(fk.sounds).every((v) => v.peak > 0.01 && v.peak < 1 && v.rms > 0.002 && v.tail < 1e-3), JSON.stringify(fk.sounds));
}
await page.evaluate(() => window.__casawalk.xr.end()); await frames(5);
check('leaving VR pauses the sound', await page.evaluate(() => new Promise((ok) => setTimeout(() => ok(window.__casawalk.xr.sound.ctx?.state), 200))) === 'suspended');

fs.writeFileSync(path.join(out, `xr-fingerprint-${DEVICE}.json`), JSON.stringify({ fixture: fixture.includes('/private/') ? 'private' : fixture, device: DEVICE, prints }, null, 1));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
server.close();
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0;
