// Scripted VR session in headless Chromium using Meta's WebXR emulator (IWER):
// enter VR, point at the model, rotate/zoom, grab, orbs (point and touch) and
// menu, VR/passthrough switch, jump in at 1:1, walk, snap turn, teleport,
// pull with the trigger, turn and height options, solid walls, see-through,
// exit, and re-enter from another spot. Screenshots go to test-output/xr-*.png.
//   npm run xr-test             (uses the first private fixture, else userGuideExample)
//   npm run xr-test -- tests/fixtures/SweetHome3DExample.sh3d
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
// The model to test with: the one named on the command line, else your own
// file in tests/fixtures/private/, else a downloaded Sweet Home 3D example
// (npm run fixtures), else the example home that ships with the repository.
const own = fs.existsSync(privateDir) ? fs.readdirSync(privateDir).find((f) => f.endsWith('.sh3d')) : null;
const fixture = process.argv[2] || (own ? `tests/fixtures/private/${own}`
	: fs.existsSync(path.join(root, 'tests/fixtures/userGuideExample.sh3d')) ? 'tests/fixtures/userGuideExample.sh3d' : 'examples/example-home.sh3d');
const out = path.resolve(root, process.env.XR_OUT || 'test-output');
const STEADY = !!process.env.XR_STEADY;
fs.mkdirSync(out, { recursive: true });

const server = await startServer(8129);
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
	// The Quest Browser reports bare hands (a pinch is a select) even though
	// the app never asks for hand tracking; the emulator only shows hands to
	// a session that asked. So the test asks for it, as an optional feature,
	// on the app's behalf (milestone C0.1's bare-hands check).
	const request = navigator.xr.requestSession.bind(navigator.xr);
	navigator.xr.requestSession = (mode, init = {}) => request(mode, { ...init, optionalFeatures: [...(init.optionalFeatures || []), 'hand-tracking'] });
}, DEVICE);

let step = 0;
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const shot = async (name) => {
	await page.waitForTimeout(250);
	const orbs = (v) => page.evaluate((v) => window.__casawalk?.xr.ui.orbs.forEach((o) => { o.body.visible = v; }), v);
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
const stick = (hand, x, y) => page.evaluate(({ hand, x, y }) => window.__device.controllers[hand].updateAxes('thumbstick', x, y), { hand, x, y });
const state = () => page.evaluate(() => {
	const x = window.__casawalk.xr;
	const head = x.mode ? x.headWorld().toArray() : null;
	return { mode: x.mode, presenting: window.__casawalk.renderer.xr.isPresenting, session: x.sessionMode, view: x.view,
		showroom: x.showroom.visible, walkSky: x.walkSky.visible, yaw: x.modes.dollhouse.doll.yaw, zoom: x.modes.dollhouse.doll.zoom, pos: x.modes.dollhouse.doll.pos.toArray(),
		marker: x.modes.dollhouse.markers.some((m) => m.visible), rig: x.rig.position.toArray(), rigYaw: x.rig.rotation.y, head, lift: x.lift,
		ceilings: x.model?.layers.ceilings.visible, menu: x.menu ? Object.keys(x.menus).find((k) => x.menus[k] === x.menu) : null,
		hover: x.menu?.hover ?? null, anchorScale: x.anchor.scale.x, orbs: x.ui.orbs.filter((o) => o.holder).length,
		orbGlow: Math.max(...x.ui.orbs.map((o) => o.glow)), snap: x.snapAngle, height: x.personHeight,
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
/** World position of the orb on a hand ('left' or 'right'). */
const orbPoint = (hand) => page.evaluate(async (hand) => {
	const THREE = await import('three');
	const o = window.__casawalk.xr.ui.orbs.find((o) => o.holder?.handedness === hand);
	return o.group.getWorldPosition(new THREE.Vector3()).toArray();
}, hand);
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
const modelTop = () => page.evaluate(() => { const x = window.__casawalk.xr; return x.stage.localToWorld(x.modes.dollhouse.doll.pos.clone().add(new (x.modes.dollhouse.doll.pos.constructor)(0.05, 0.02, 0.25))).toArray(); });
const waitXR = () => page.waitForFunction(() => { const x = window.__casawalk.xr; return x.mode && !x.pendingRecentre && x.ui.orbs.every((o) => o.holder); }, null, { timeout: 8000 }).catch(() => {});
/** What a session leaves on the 2D page: should be nothing. Returns the names of what was left. */
const leftovers = () => page.evaluate(() => {
	const S = window.__casawalk, x = S.xr, bad = [], want = (n, ok) => ok || bad.push(n);
	want('session', x.session === null && x.mode === null);
	want('grab/tele/fade/drag', !x.modes.dollhouse.grab && !x.modes.walk.tele && !x.modes.walk.fade && !x.ui.drag && !x.pendingRecentre);
	want('menu', x.menu === null && Object.values(x.menus).every((p) => !p.mesh.visible && !p.open));
	want('welcome', !x.ui.welcome.mesh.visible && !x.ui.welcomeOn);
	want('hands note', !x.ui.handsNote.mesh.visible);
	want('photo', !x.photoPending && !x.ui.photoFx && !x.ui.flash.visible && !x.ui.photoNote.mesh.visible && !x.modes.walk.fadeMesh.visible);
	want('arc', !x.modes.walk.arc.dots.visible && !x.modes.walk.arc.ring.visible);
	want('orbs', x.ui.orbs.every((o) => !o.group.parent && !o.holder));
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
	want('idle', !x.modes.dollhouse.grab && !x.modes.walk.tele && !x.modes.walk.fade && !x.ui.drag && !x.modes.walk.arc.dots.visible && !x.modes.walk.fadeMesh.visible && x.modes.dollhouse.markers.every((m) => !m.visible));
	want('orbs on grips', x.ui.orbs.every((o) => o.holder && o.group.parent === o.holder.grip));
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
	const menu = (p) => ({ title: p.title, size: [p.size.w, p.size.h], shown: p.mesh.visible, list: p.open, card: p.card.mesh.parent === p.mesh,
		rows: p.rows.map((row) => row.map((c) => [c.id, c.type, c.label, c.value ?? null, !!c.disabled, c.note ?? null, !!c.primary, (c.options ?? []).map((o) => `${o.value}=${o.label}`).join(',')].join('|'))) });
	const KEYS = ['casawalk.snapAngle', 'casawalk.height', 'casawalk.view', 'casawalk.solidWalls', 'casawalk.seeThrough', 'casawalk.light', 'casawalk.shadows', 'casawalk.depth'];
	return {
		mode: x.mode, session: x.sessionMode, view: x.view, menu: x.menu?.title ?? null, welcome: [vis(x.ui.welcome.mesh), x.ui.welcomeOn],
		busy: [!!x.modes.dollhouse.grab, !!x.modes.walk.tele, !!x.modes.walk.fade, !!x.ui.drag, !!x.pendingRecentre, !!x.photoPending],
		shown: { ...Object.fromEntries(['showroom', 'stage', 'gallery', 'pedestal', 'walkSky'].map((k) => [k, vis(x[k])])), fadeMesh: vis(x.modes.walk.fadeMesh), flash: vis(x.ui.flash) },
		layers: Object.fromEntries(Object.entries(x.model.layers).map(([k, g]) => [k, [g.visible, g.children.filter(vis).length]])), maxStorey: x.maxStorey,
		markers: x.modes.dollhouse.markers.map(vis), arc: [vis(x.modes.walk.arc.dots), vis(x.modes.walk.arc.ring)], note: vis(x.ui.photoNote.mesh),
		rig: [...v3(x.rig.position), n(x.rig.rotation.y), n(x.lift), n(x.modes.dollhouse.dollLift)], stage: [...v3(x.stage.position), n(x.stage.rotation.y)],
		anchor: [...v3(x.anchor.position), n(x.anchor.rotation.y), n(x.anchor.scale.x)], doll: [...v3(x.modes.dollhouse.doll.pos), n(x.modes.dollhouse.doll.yaw), n(x.modes.dollhouse.doll.zoom)],
		plinth: [n(x.plinthSize.W), n(x.plinthSize.D), n(x.plinthDistance), n(x.baseScale)], welcomeAt: v3(x.ui.welcome.mesh.position),
		clip: [x.camera.near, x.camera.far], background: S.scene.background?.getHex?.() ?? S.scene.background,
		hands: x.input.controllers.map((c) => [c.handedness, vis(c.ray), vis(c.grip), vis(c.line), vis(c.dot), x.ui.orbs.findIndex((o) => o.group.parent === c.grip)]),
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
await page.goto('http://localhost:8129/?test');
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
await page.goto(`http://localhost:8129/?test&model=${encodeURIComponent(fixture)}`);
check('model loads', await page.evaluate(() => window.__casawalk.ready));
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
await page.evaluate(() => window.__device.position.set(0, 1.6, 0));
await lookDown();
await restRight();
await restLeft();
await enterVR.click();
// Wait until the session is up: both controllers have orbs and the plinth was placed.
await page.waitForFunction(() => { const x = window.__casawalk.xr; return x.mode && !x.pendingRecentre && x.ui.orbs.every((o) => o.holder); }, null, { timeout: 8000 }).catch(() => {});
await frames(10);
let s = await state();
check('enters the VR dollhouse', s.presenting && s.mode === 'dollhouse' && s.showroom, JSON.stringify({ mode: s.mode, session: s.session }));
check('dollhouse: eyes where a 2 m person\'s would be (1.89 m)', Math.abs(s.head[1] - 1.89) < 0.005 && Math.abs(s.rig[1] - 0.29) < 0.005, `eyes ${s.head[1].toFixed(3)} m, raised ${s.rig[1].toFixed(3)} m`);
check('an orb on each wrist', s.orbs === 2);
{
	// No two large surfaces at the same height: the model's floor is clear of the plinth top. (The plate standing on the plinth is not its top.)
	const gap = await page.evaluate(() => { const x = window.__casawalk.xr, V = x.rig.position.constructor; const floor = x.centerer.localToWorld(new V(0, x.model.bounds.min.y, 0)).y;
		const top = Math.max(...x.pedestal.children.filter((m) => m !== x.plate.mesh).map((m) => m.getWorldPosition(new V()).y + m.geometry.parameters.height / 2)); return { gap: floor - top, near: x.camera.near, far: x.camera.far }; });
	check('the model\'s floor is clear of the plinth top (no flicker)', gap.gap > 0.003 && gap.gap < 0.006 && gap.near === 0.05 && gap.far === 300, JSON.stringify(gap));
}
check('no scale figure by the scale model (the landing markers show a person\'s size)', await page.evaluate(() => !window.__casawalk.xr.scene.getObjectByName('scale-figure') && !window.__casawalk.xr.menus.dollhouse.get('figure')));
{
	// A welcome card above the model says how to open the menu (it no longer opens by itself).
	const w = await page.evaluate(() => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor, card = x.ui.welcome.mesh;
		const p = card.getWorldPosition(new V()), top = x.centerer.localToWorld(new V(0, x.model.bounds.max.y, 0)).y;
		return { shown: card.visible && card.parent === x.stage, above: +(p.y - top).toFixed(2), menu: x.menu !== null, title: x.ui.welcome.title, first: x.ui.welcome.lines[0].text };
	});
	check('welcome card above the model, menu closed', w.shown && w.above > 0.1 && !w.menu && /wrist/i.test(w.first), JSON.stringify(w));
	check('the welcome card faces you', THREE_deg(await facing()) < 1, `${THREE_deg(await facing()).toFixed(2)}°`);
	await fingerprint('doll-entry');
	await shot('welcome-card');
	// Touch the left wrist with the right controller: the menu opens and the card goes.
	await aim('left', [-0.12, 1.2, -0.4], [0.1, 0.9, -1.2]); await frames(3);
	const wrist = await toLocal(await orbPoint('left'));
	await aim('right', wrist, [wrist[0], wrist[1], wrist[2] - 1]); await frames(5);
	s = await state();
	const gone = await page.evaluate(() => !window.__casawalk.xr.ui.welcome.mesh.visible);
	check('touching a wrist opens the menu and the welcome card goes', s.menu === 'dollhouse' && gone);
	await restRight(); await restLeft(); await frames(3);
}
{
	// The dollhouse menu opens to the left of where you look, out of the model's way.
	const m = await page.evaluate(() => {
		const x = window.__casawalk.xr, V = x.rig.position.constructor;
		const head = x.headWorld(), menu = x.menu.mesh.getWorldPosition(new V());
		const fwd = new V(0, 0, -1).transformDirection(x.camera.matrixWorld).setY(0).normalize();
		const to = menu.clone().sub(head).setY(0);
		const angle = Math.atan2(fwd.clone().cross(to.clone().normalize()).y, fwd.dot(to.clone().normalize())) * 180 / Math.PI; // + = left
		const model = x.anchor.getWorldPosition(new V()).sub(head).setY(0);
		return { angle: +angle.toFixed(1), distance: +to.length().toFixed(2), modelDistance: +model.length().toFixed(2) };
	});
	check('dollhouse menu opens on the left, away from the face', m.angle > 28 && m.angle < 40 && m.distance > 0.9, JSON.stringify(m));
	// The menu: switches for on/off, choices with every option shown, a slider, buttons; not too tall.
	const kinds = await page.evaluate(() => {
		const x = window.__casawalk.xr, kinds = (p) => Object.fromEntries([...p.cells.values()].map((c) => [c.id, c.type]));
		const g = (p) => p.mesh.geometry.parameters;
		return { doll: kinds(x.menus.dollhouse), walk: kinds(x.menus.walk), heights: Object.values(x.menus).map((p) => +g(p).height.toFixed(2)), width: g(x.menus.walk).width };
	});
	const want = { shadows: 'switch', depth: 'switch', ceilings: 'switch', light: 'choice', view: 'switch', seethrough: 'slider', sound: 'choice', exit: 'button' };
	const ok = Object.entries(want).every(([id, t]) => kinds.doll[id] === t && kinds.walk[id] === t)
		&& kinds.doll.levels === 'dropdown' && kinds.doll.photo === 'button' && kinds.walk.photo === 'button' && kinds.walk.solid === 'switch' && kinds.walk.turn === 'choice' && kinds.walk.height === 'choice';
	check('menus use switches, choices, a slider and buttons, and fit in view', ok && Math.max(...kinds.heights) < 0.7, JSON.stringify({ heights: kinds.heights, width: kinds.width }));
}
await shot('dollhouse-menu');
await click('right', 'b-button');
check('B closes the menu', (await state()).menu === null);
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

// Left orb (hand raised into view): the right laser makes it glow, a click opens the menu.
await aim('left', [-0.12, 1.2, -0.4], [0.1, 0.9, -1.2]);
await frames(3);
await aimW('right', R, await orbPoint('left'));
await page.waitForFunction(() => Math.max(...window.__casawalk.xr.ui.orbs.map((o) => o.glow)) > 0.5, null, { timeout: 2000 }).catch(() => {});
s = await state();
check('laser makes the orb glow', s.orbGlow > 0.5, `glow ${s.orbGlow.toFixed(2)}`);
await shot('orb-hover');
await click('right', 'trigger');
s = await state();
check('orb click opens the menu', s.menu === 'dollhouse');
await shot('menu-and-controls');

// Menu: Recentre puts the model back, Ceilings toggles, View switches to passthrough.
await aimW('right', R, await menuPoint('recentre')); await frames(5);
s = await state();
check('laser hovers the menu', s.hover?.startsWith('recentre|'), `hover=${s.hover}`);
await click('right', 'trigger');
s = await state();
check('Recentre resets the model', Math.abs(s.pos[0]) < 1e-6 && Math.abs(s.yaw) < 1e-6 && s.zoom === 1 && s.menu === null);
await click('right', 'a-button');
check('A opens the menu', (await state()).menu === 'dollhouse');
await fingerprint('doll-menu');
const c0 = (await state()).ceilings;
await clickMenu('ceilings');
s = await state();
check('Ceilings toggles and the menu stays open', s.ceilings === !c0 && s.menu === 'dollhouse' && (await cell('dollhouse', 'ceilings')).value === !c0);
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

// See-through: press on the slider, drag, let go; walls and furniture fade, floors don't.
const glass = () => page.evaluate(() => {
	const x = window.__casawalk.xr, op = (layer) => x.model.layers[layer].children.map((m) => [].concat(m.material)[0]).filter((m) => m.userData.cwBase && !m.userData.cwBase.transparent);
	const wall = op('walls')[0], piece = op('main')[0], floor = x.model.layers.floors.children[0]?.material;
	return { amount: x.seeThroughAmount, wall: wall?.opacity, wallDepthWrite: wall?.depthWrite, piece: piece?.opacity, floor: floor?.opacity, floorTransparent: floor?.transparent, cast: x.model.layers.walls.children.some((m) => m.castShadow) };
});
await aimW('right', R, await menuPoint('seethrough', 0.1)); await frames(4);
await button('right', 'trigger', 1); await frames(4);
for (const f of [0.3, 0.5, 0.7]) { await aimW('right', R, await menuPoint('seethrough', f)); await frames(3); }
let g = await glass();
await button('right', 'trigger', 0); await frames(4);
const fade = 1 - 0.85 * g.amount;
check('See-through: dragging the slider fades walls and furniture', Math.abs(g.amount - 0.7) < 0.051 && Math.abs(g.wall - fade) < 1e-6 && Math.abs(g.piece - fade) < 1e-6 && !g.wallDepthWrite && !g.cast && g.floor === 1 && !g.floorTransparent && (await state()).menu === 'dollhouse', JSON.stringify(g));
check('letting go of the trigger ends the slider drag', await page.evaluate(() => window.__casawalk.xr.ui.drag === null));
await restRight(); await frames(5);
await shot('dollhouse-see-through');
await clickMenu('seethrough', 0); // a click at the start of the track: off
g = await glass();
check('See-through back to Off restores the model', g.amount === 0 && g.wall === 1 && g.piece === 1 && g.wallDepthWrite && g.cast && (await cell('dollhouse', 'seethrough')).value === 0, JSON.stringify(g));
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
check('clicking elsewhere closes the menu', (await state()).menu === null);

// Touch the left orb with the right controller: the menu opens.
await aim('left', [-0.12, 1.2, -0.4], [0.1, 0.9, -1.2]); await frames(3);
const orbL = await toLocal(await orbPoint('left'));
await aim('right', orbL, [orbL[0], orbL[1], orbL[2] - 1]); await frames(5);
check('touching an orb opens the menu', (await state()).menu === 'dollhouse');
await restRight(); await restLeft(); await frames(5);
await click('right', 'b-button');

// Bare hands (milestone C0.1): the Quest turns a pinch into a select of a
// hand source. Put the controllers down, aim the right hand at the model and
// pinch: nothing may happen (no step inside, no menu), and the note asks for
// the controllers. Then pick them up again: the note goes, all as before.
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
	check('bare hands: pinches do nothing (no step inside, no menu, no laser)', before && h.mode === 'dollhouse' && !h.menu && h.active === 0 && h.hands === 2 && !h.lasers && !h.bodies && !h.marker, JSON.stringify(h));
	check('bare hands: "Pick up your controllers" in front of you', h.note && await page.evaluate(() => /controllers/.test(window.__casawalk.xr.ui.handsNote.title)));
	await page.evaluate(() => { window.__device.primaryInputMode = 'controller'; });
	await waitXR(); await frames(8);
	const back = await page.evaluate(() => { const x = window.__casawalk.xr; return { note: x.ui.handsNote.mesh.visible, active: x.input.active().length, lasers: x.input.active().every((c) => c.line.visible && c.body.visible) }; });
	check('controllers again: the note goes, lasers back', !back.note && back.active === 2 && back.lasers, JSON.stringify(back));
	await restRight(); await restLeft(); await frames(5);
}

// Trigger on the model: jump in at 1:1.
await aimW('right', R, await modelTop()); await frames(6);
const mark = await page.evaluate(() => { const x = window.__casawalk.xr, m = x.modes.dollhouse.markers[x.input.hands.right.index]; return m.visible ? m.position.toArray() : null; });
await click('right', 'trigger');
s = await state();
check('trigger on model enters 1:1', s.mode === 'walk' && s.anchorScale === 1, JSON.stringify(s.rig.map((v) => +v.toFixed(2))));
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
s = await state();
check('Y returns to dollhouse', s.mode === 'dollhouse');

// Walk in (observer camera) from the menu.
await lookDown();
await click('left', 'x-button');
check('X opens the menu', (await state()).menu === 'dollhouse');
await clickMenu('walk');
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

// Walk-mode menu: Turn and Height are choices, Dollhouse goes back.
await click('right', 'a-button');
s = await state();
check('A opens the walk menu', s.menu === 'walk');
await shot('walk-menu');
const snap0 = s.snap, turns = [];
for (const t of [15, 45, snap0]) { await clickMenu('turn', t); turns.push((await state()).snap); }
check('Turn: 15°, 45° and back, one click each', turns.join() === `15,45,${snap0}` && (await cell('walk', 'turn')).value === snap0, turns.join(' → '));
const feet = (await state()).rig[1] - (await state()).lift;
await clickMenu('height', 1.4);
s = await state();
check('Height 1.4 m puts the eyes at 1.29 m', s.height === 1.4 && Math.abs(s.head[1] - feet - 1.29) < 0.01, `eyes ${(s.head[1] - feet).toFixed(2)} m`);
await shot('height-1.4');
await clickMenu('height', 0);
s = await state();
check('Height back to your own', s.height === 0 && Math.abs(s.head[1] - feet - 1.6) < 0.01);

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
	const w = await wallAt(null);
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
		await stick('left', 0, -1); await frames(200); await stick('left', 0, 0); await frames(3);
		const stopped = await wallAt(w.a);
		const walked = Math.hypot(stopped.head[0] - w.head[0], stopped.head[2] - w.head[2]);
		check('Solid walls: you stop a body\'s width in front of a wall', stopped.d !== null && stopped.d > 0.17 && stopped.d < 0.3 && walked > w.d - 0.35, `wall was ${w.d.toFixed(2)} m away; walked ${walked.toFixed(2)} m, now ${stopped.d?.toFixed(2)} m from it`);
		await shot('walk-solid-wall');
		await page.evaluate(() => window.__casawalk.xr.menuAction('solid')); // off
		await stick('left', 0, -1); await frames(40); await stick('left', 0, 0); await frames(3);
		const through = await wallAt(w.a);
		const along = (through.head[0] - w.head[0]) * -Math.sin(w.a) + (through.head[2] - w.head[2]) * -Math.cos(w.a);
		check('Solid walls off: you walk through it', along > w.d + 0.05, `${along.toFixed(2)} m along, the wall at ${w.d.toFixed(2)} m`);
	}
	await click('right', 'a-button');
}
await clickMenu('dollhouse');
s = await state();
check('Dollhouse returns from walk', s.mode === 'dollhouse' && s.rig[0] === 0 && s.rig[2] === 0 && s.menu === null);
check('back from walking: eyes at 1.89 m again, gallery shown, lasers on', Math.abs(s.head[1] - 1.89) < 0.005 && s.showroom && !s.walkSky && (await lasers()) === 'left:on right:on', `eyes ${s.head[1].toFixed(3)}, lasers ${await lasers()}`);

// Exit from the menu.
await lookDown();
await click('right', 'a-button');
await clickMenu('exit');
await frames(10);
s = await state();
check('Exit ends the session', !s.presenting);
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
// Stand up and press Recentre: measured again.
await page.evaluate(() => window.__device.position.set(1.2, 1.75, 0.8));
await frames(5);
await page.evaluate(() => window.__casawalk.xr.menuAction('recentre'));
await frames(5);
s = await state();
check('Recentre measures the height again', Math.abs(s.head[1] - 1.89) < 0.005 && Math.abs(s.rig[1] - 0.14) < 0.005, `eyes ${s.head[1].toFixed(3)} m, raised ${s.rig[1].toFixed(3)} m`);
await fingerprint('reentered');
await shot('reentered');
await page.evaluate(() => window.__casawalk.xr.end());
await frames(5);

// The example home (two storeys, lamps): level picker, lamps at night.
await page.click('#open-example');
await page.waitForFunction(() => /Loaded example-home/.test(document.getElementById('status').textContent), null, { timeout: 20000 });
await page.evaluate(() => window.__device.position.set(0, 1.6, 0));
await lookDown();
await restRight();
await restLeft();
await enterVR.click();
await page.waitForFunction(() => { const x = window.__casawalk.xr; return x.mode && !x.pendingRecentre && x.ui.orbs.every((o) => o.holder); }, null, { timeout: 8000 }).catch(() => {});
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
			const card = p.card;
			texts.push(card.title, ...Object.values(card.hands).flat().map((h) => `${h.key} ${h.text}`), ...(card.footer?.lines ?? []));
		}
		for (const w of [x.ui.welcome, x.ui.photoNote]) texts.push(w.title, ...w.lines.map((l) => l.text));
		return { bad: texts.filter((t) => /dollhouse/i.test(t)), titles: Object.values(x.menus).map((p) => p.title), tabs: x.menus.dollhouse.tabs.map((t) => t.label) };
	});
	check('the words: "scale model", never "dollhouse", on screen; tabs View, Walk, Sound', !words.bad.length && words.titles.join() === 'Scale model,Walking' && words.tabs.join() === 'View,Walk,Sound', JSON.stringify(words));
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
	await click('right', 'trigger'); await frames(5);
	s = await state();
	const landed = await page.evaluate((spot) => { const x = window.__casawalk.xr, V = x.rig.position.constructor, h = x.headWorld(), f = new V(0, 0, -1).transformDirection(x.camera.matrixWorld), p = x.centerer.localToWorld(new V(...spot));
		return { d: Math.hypot(h.x - p.x, h.z - p.z), heading: Math.atan2(-f.x, -f.z) }; }, room.spot);
	const dYaw = Math.atan2(Math.sin(landed.heading - mk.yaw), Math.cos(landed.heading - mk.yaw));
	check('stepping inside: you stand there, facing the way the marker showed', s.mode === 'walk' && landed.d < 0.02 && Math.abs(dYaw) < 0.05, JSON.stringify({ ...landed, markerYaw: mk.yaw }));
	await lookAhead(); await restRight(); await frames(5);
	await shot('example-landed');
	await lookDown(); await click('right', 'b-button'); await frames(5);
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
	await page.evaluate(() => window.__casawalk.xr.menuAction('recentre')); await frames(5);
}
await click('right', 'a-button');
await shot('example-menu');
await clickMenu('levels'); // opens the list
check('Levels: a click opens the dropdown list', await page.evaluate(() => window.__casawalk.xr.menu?.open === 'levels'));
await shot('example-levels-dropdown');
await clickMenu('levels', 0);
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
await click('right', 'a-button');
await clickMenu('levels');
await clickMenu('levels', 1);
await frames(5);
lv = await storeys();
check('Levels: All shows every storey again', lv.hidden.length === 0 && lv.level === 1 && !lv.lampsOn, JSON.stringify(lv));
{
	// Photo: the menu closes and the picture is kept for the page; nothing is
	// downloaded in VR (the Quest Browser's download prompt ends the session).
	let downloaded = false;
	const watch = () => { downloaded = true; };
	page.on('download', watch);
	const n0 = (await photos()).length;
	await clickMenu('photo');
	await page.waitForFunction(async (n0) => (await (await import('/js/storage.js')).listPhotos()).length > n0, n0, { timeout: 20000 }).catch(() => {});
	await page.waitForTimeout(1000);
	page.off('download', watch);
	const kept = await photos();
	const fx = await page.evaluate(() => ({ menu: window.__casawalk.xr.menu !== null, note: window.__casawalk.xr.ui.photoNote.mesh.visible, title: window.__casawalk.xr.ui.photoNote.title, line: window.__casawalk.xr.ui.photoNote.lines[0].text }));
	check('Photo: kept for the page, nothing downloaded in VR, and the note says so', kept.length === n0 + 1 && !downloaded && /^CasaWalk \d{4}-\d\d-\d\d [\d.]+\.jpg$/.test(kept[0].name) && !fx.menu && fx.note && fx.title === 'Nice shot!' && /page/.test(fx.line),
		JSON.stringify({ kept: kept.length, downloaded, name: kept[0]?.name, ...fx }));
	await click('right', 'a-button');
}
// Depth shading: switched on from the menu, prepared in the background, headset only.
const depth = () => page.evaluate(() => { const d = window.__casawalk.depth, x = window.__casawalk.xr; return { on: d.enabled, state: d.state, uniform: d.uniform.value, label: x.menus.dollhouse.get('depth').label, switched: x.menus.dollhouse.get('depth').value }; });
check('Depth starts off', (await depth()).switched === false && (await depth()).uniform === 0);
await clickMenu('depth');
await page.waitForFunction(() => window.__casawalk.depth.state === 'ready', null, { timeout: 120000 }).catch(() => {});
await frames(5);
let dp = await depth();
check('Depth shading is prepared and shown in the headset', dp.on && dp.state === 'ready' && dp.uniform === 1 && dp.switched === true && dp.label === 'Depth shading', JSON.stringify(dp));
await clickMenu('levels');
await clickMenu('levels', 0); // ground floor only, then walk in: every storey comes back
await clickMenu('walk');
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
	check('after VR: the page offers the photos, and Save all downloads a 1920 x 1080 JPEG', pg.shown && pg.rows >= 1 && /photo/i.test(pg.status) && d && /^CasaWalk \d{4}-\d\d-\d\d [\d.]+\.jpg$/.test(d.suggestedFilename()) && size?.join('x') === '1920x1080' && jpeg.length > 30000,
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
await aimW('right', R, await modelTop()); await frames(6); await click('right', 'trigger');
// (Shown: visible, and every parent too.)
const welcomeShown = () => page.evaluate(() => { for (let a = window.__casawalk.xr.ui.welcome.mesh; a; a = a.parent) if (!a.visible) return false; return true; });
const wk = { mode: (await state()).mode, shown: await welcomeShown(), on: await page.evaluate(() => window.__casawalk.xr.ui.welcomeOn) };
await restRight(); await click('right', 'b-button'); await frames(3);
s = await state();
const back = { shown: await welcomeShown(), lasers: await lasers() };
check('welcome card hides while walking and is back in the dollhouse; lasers on', wk.mode === 'walk' && !wk.shown && wk.on && s.mode === 'dollhouse' && back.shown && back.lasers === 'left:on right:on' && Math.abs(s.head[1] - 1.89) < 0.005, JSON.stringify({ wk, back }));

// Trigger ownership, and A closing what it opened.
await click('right', 'a-button');
const opened = (await state()).menu;
await aimW('right', R, await modelTop()); await frames(5); await click('right', 'trigger');
s = await state();
check('menu open: a click on the model only closes it', opened === 'dollhouse' && s.menu === null && s.mode === 'dollhouse', JSON.stringify({ opened, menu: s.menu, mode: s.mode }));
await restRight(); await frames(3); await click('right', 'a-button'); await click('right', 'a-button');
check('A closes the menu it opened', (await state()).menu === null);

// Dropdown: a click elsewhere on the panel closes the list only; B closes it with the menu.
await click('right', 'a-button'); await clickMenu('levels');
await aimW('right', R, await panelPoint(0.15, 0.95)); await frames(5); await click('right', 'trigger');
const dd = await page.evaluate(() => ({ menu: !!window.__casawalk.xr.menu, list: window.__casawalk.xr.menu?.open ?? null, level: window.__casawalk.xr.maxStorey }));
const menuState = () => page.evaluate(() => window.__casawalk.xr.menu ? window.__casawalk.xr.menu.open ?? 'open' : 'closed');
await clickMenu('levels');
const listed = await menuState();
await click('right', 'b-button');
const closed = await menuState();
await click('right', 'a-button');
const reopened = await menuState();
check('Levels list: a click elsewhere closes the list only; B closes it with the menu', dd.menu && dd.list === null && dd.level === lv0 && listed === 'levels' && closed === 'closed' && reopened === 'open', JSON.stringify({ dd, listed, closed, reopened }));

// Photo: nothing of the interface in the picture, all of it back afterwards.
await aimW('left', L, await modelTop()); await frames(6); // a marker under the left laser
await page.evaluate(() => window.__casawalk.xr.ui.setWelcome(true));
const seen = page.evaluate(() => new Promise((done) => {
	const S = window.__casawalk, x = S.xr, r = S.renderer, render = r.render;
	const ui = { menu: Object.values(x.menus).map((p) => p.mesh), welcome: [x.ui.welcome.mesh], feedback: [x.ui.flash, x.ui.photoNote.mesh, x.modes.walk.fadeMesh], arc: [x.modes.walk.arc.dots, x.modes.walk.arc.ring],
		markers: x.modes.dollhouse.markers, orbs: x.ui.orbs.map((o) => o.group), hands: x.input.controllers.flatMap((c) => [c.ray, c.grip]) };
	const shown = (o) => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
	const showing = () => Object.keys(ui).filter((k) => ui[k].some(shown));
	const before = showing();
	setTimeout(() => done({ before, timeout: true }), 15000);
	r.render = function (...args) {
		if (!r.xr.enabled && args[0] === S.scene) { r.render = render; const during = showing(); setTimeout(() => done({ before, during, after: showing() }), 0); } // the photo's draw
		return render.apply(this, args);
	};
}));
const nKept = (await photos()).length;
await clickMenu('photo');
const ph = await seen;
await page.waitForFunction(async (n) => (await (await import('/js/storage.js')).listPhotos()).length > n, nKept, { timeout: 20000 }).catch(() => {});
// (The note stays 2.5 s of the app's time, which runs slower than the clock in the emulator.)
await page.waitForFunction(() => !window.__casawalk.xr.ui.photoFx, null, { timeout: 10000 }).catch(() => {});
await frames(3);
const pfx = await page.evaluate(() => { const x = window.__casawalk.xr; return { flash: x.ui.flash.visible, note: x.ui.photoNote.mesh.visible, fx: x.ui.photoFx }; });
check('Photo: no menu, laser, controller, orb, arc, marker, welcome card, flash or note in it; all back after',
	ph.during?.length === 0 && ph.before.join() === 'menu,welcome,markers,orbs,hands' && ph.after.join() === 'welcome,markers,orbs,hands', JSON.stringify(ph));
check('Photo: the flash and the note go again', !pfx.flash && !pfx.note && pfx.fx === null, JSON.stringify(pfx));
await page.evaluate(() => window.__casawalk.xr.ui.setWelcome(false)); await restLeft();

// Walking: lasers, the walk menu, B, trigger ownership, snap, two-hand pull, fade.
await lookDown(); await click('right', 'a-button'); await clickMenu('walk');
await lookAhead(); await restRight(); await restLeft(); await frames(5);
const l0 = await lasers(); await click('right', 'a-button'); await frames(3); const l1 = await lasers();
check('walking: lasers hidden, shown while the menu is open', l0 === 'left:off right:off' && l1 === 'left:on right:on', `${l0} / ${l1}`);
const wm = await page.evaluate(() => { const x = window.__casawalk.xr, V = x.rig.position.constructor, head = x.headWorld(), p = x.menu.mesh.getWorldPosition(new V());
	const nrm = new V(0, 0, 1).transformDirection(x.menu.mesh.matrixWorld).setY(0).normalize(), to = head.clone().sub(p).setY(0).normalize();
	return { dist: Math.hypot(p.x - head.x, p.z - head.z), drop: head.y - p.y, facing: Math.acos(Math.min(1, nrm.dot(to))) * 180 / Math.PI }; });
check('walk menu: 0.75 m ahead, 10 cm left and down, facing you', Math.abs(wm.dist - 0.757) < 0.01 && Math.abs(wm.drop - 0.1) < 0.005 && wm.facing < 1, JSON.stringify(wm));
{
	const stays = [];
	for (const [id, v] of [['turn', 45], ['turn', 30], ['height', 1.7], ['height', 0], ['solid'], ['solid'], ['ceilings']]) { await clickMenu(id, v); if ((await state()).menu !== 'walk') stays.push(id); }
	const agree = await page.evaluate(() => { const { dollhouse: d, walk: k } = window.__casawalk.xr.menus;
		return ['light', 'shadows', 'depth', 'ceilings', 'seethrough', 'view'].filter((id) => d.get(id).value !== k.get(id).value || !!d.get(id).disabled !== !!k.get(id).disabled); });
	await clickMenu('ceilings');
	check('walk menu stays open for switches and choices; both menus agree', !stays.length && !agree.length, `closed on ${stays}; differ ${agree}`);
}
if ((await state()).session === 'ar') {
	await clickMenu('view');
	const pt = await page.evaluate(() => { const x = window.__casawalk.xr; return { sky: x.walkSky.visible, ground: x.model.layers.ground.visible, menu: !!x.menu }; });
	await clickMenu('view');
	check('walking in passthrough: no sky and no ground', !pt.sky && !pt.ground && pt.menu && (await state()).walkSky, JSON.stringify(pt));
}
await click('right', 'b-button'); s = await state();
check('B with the walk menu open closes it, and you keep walking', s.menu === null && s.mode === 'walk');
await aim('right', R, [0.25, 0, -1.0]); await frames(3);
h0 = (await state()).head;
await button('right', 'trigger', 1); await frames(6);
const aiming = (await state()).arc;
await click('left', 'x-button'); await button('right', 'trigger', 0); await frames(20); s = await state();
check('X while aiming opens the menu and cancels the teleport', aiming && s.menu === 'walk' && !s.arc && Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]) < 1e-3, JSON.stringify({ aiming, menu: s.menu, arc: s.arc }));
await click('right', 'trigger'); await frames(20); s = await state(); // the laser is on the floor, not the menu
check('menu open: a click on the floor only closes it', s.menu === null && !s.arc && Math.hypot(s.head[0] - h0[0], s.head[2] - h0[2]) < 1e-3);
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
	const dark = await page.waitForFunction(() => window.__casawalk.xr.modes.walk.fadeMesh.visible, null, { timeout: 1000, polling: 5 }).then(() => true, () => false);
	await frames(20);
	const fd = await page.evaluate(() => { const x = window.__casawalk.xr; return { fade: x.modes.walk.fade !== null, shown: x.modes.walk.fadeMesh.visible, opacity: x.modes.walk.fadeMesh.material.opacity }; });
	check('a teleport fades out and back in', valid && dark && !fd.fade && !fd.shown && fd.opacity === 0, JSON.stringify({ valid, dark, ...fd }));
}

// Leave in the middle of a teleport and a pull, with see-through on; come back.
await click('right', 'a-button'); await clickMenu('seethrough', 0.5); await click('right', 'b-button');
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
	const sameAsBefore = diffs(fpA, await fingerprint('reentry-after-mid-teleport')).filter((d) => !/^\.(settings|menus|storage)\.|^\.draw\.[23] /.test(d)); // (see-through is on now; GPU memory counts vary)
	check('re-entering again: the same clean dollhouse; see-through remembered', !bad.length && see.amount === 0.5 && Math.abs(see.keep - 0.575) < 1e-6 && see.cell === 0.5 && !sameAsBefore.length,
		`${bad} ${JSON.stringify(see)} ${sameAsBefore.slice(0, 3).join('; ')}`);
	await page.evaluate(() => window.__casawalk.xr.menuAction({ id: 'seethrough', value: 0 }));
}

// The headset's own re-centre (holding the Meta button): the plinth comes back
// in front of you in the dollhouse, and stays put while walking. (Last: it
// moves the emulator's origin.)
await page.evaluate(() => { const d = window.__device; d.position.set(0.7, 1.6, -0.2); d.quaternion.set(0, Math.sin(0.25), 0, Math.cos(0.25)); }); await frames(3);
await page.evaluate(() => window.__casawalk.xr.menuAction('recentre')); await frames(3);
{
	const st0 = (await state()).stage;
	await page.evaluate(() => window.__device.recenter()); await frames(10); // IWER fires 'reset' on the reference space
	s = await state();
	check('re-centring the headset brings the plinth back in front', Math.hypot(st0[0], st0[2]) > 0.5 && Math.hypot(s.stage[0], s.stage[2]) < 0.02 && Math.abs(s.stage[3]) < 0.02 && Math.abs(s.head[1] - 1.89) < 0.005, `${st0.map((v) => v.toFixed(2))} → ${s.stage.map((v) => v.toFixed(2))}`);
	await page.evaluate(() => window.__casawalk.xr.menuAction('walk')); await frames(5);
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
