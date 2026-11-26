// CasaWalk: app entry point.
// 2D page (home screen) with an orbit-controlled dollhouse preview, file
// loading, and the order the page's parts start in. The page's parts live in
// js/page/ (the files card, Send to my Quest, Enter VR, the welcome, updates:
// split by job in stage B2); the XR modes in xr.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';
import { UserError, checkDecoders } from './formats.js';
import { modelStats } from './optimise.js';
import { ModelService } from './model-service.js';
import { DEV } from './dev.js';
import { DEVICE } from './device.js';
import { SIMPLIFY } from './simplify.js';
import { workerObjParser } from './obj-worker-client.js';
import { XRExperience } from './xr.js';
import { Lighting } from './lighting.js';
import { DepthShading } from './depth.js';
import { checkLink } from './links.js';
import { readSetting, writeSetting } from './settings.js';
import { getRecent, addRecent, setLastLink, addPhoto } from './storage.js';
import { sampleById } from './samples.js';
// The page's parts, each by its job (stage B2): main.js keeps the view, loading and the order things start in.
import { initPhotos, initFilesCard, renderRecents, renderPhotos } from './page/files-card.js';
import { init as initSend, initReceive, setFiles, passOn, takePending, sendable, links } from './page/send.js';
import { initEnterVR, updateXRButtons } from './page/enter-vr.js';
import { initWelcome, initDrop, setCollapsed } from './page/welcome.js';
import { initBuildLabel, registerOffline } from './page/updates.js';

const $ = (id) => document.getElementById(id);

/** True in a headset's own browser (Meta Quest Browser), where "Send to my Quest" and dropping files make no sense. */
const ON_HEADSET = DEVICE.headset;

/** What the page's parts (js/page/) share with this file: read when used, so the order of definitions doesn't matter. */
const page = {
	setStatus: (...a) => setStatus(...a),
	load: (...a) => load(...a),
	loadUrl: (...a) => loadUrl(...a),
	sendable: () => sendable(),
	get current() { return models.current; },
	get loading() { return models.loading; },
	get xr() { return xr; },
	get renderer() { return renderer; },
	get controls() { return controls; },
};
initSend(page);

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------

// alpha: AR shows the camera passthrough behind the model.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: DEV.test });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
$('viewport').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6ec);

// The rig carries the camera and controllers; walk mode moves it.
const rig = new THREE.Group();
rig.name = 'rig';
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 500);
camera.position.set(8, 8, 8);
rig.add(camera);
scene.add(rig);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495; // stay above the ground

// The 2D page only redraws when something changed (the camera moved, a model
// or texture arrived, the light changed), so an idle page does not keep the
// headset's GPU busy. A slow heartbeat covers anything that forgot to ask.
let dirty = true, lastDraw = 0;
const invalidate = () => { dirty = true; };
const IDLE_REDRAW_MS = 500;
controls.addEventListener('change', invalidate);

// One hemisphere light and one sun; time of day and optional shadows (lighting.js).
const lighting = new Lighting(scene, renderer);
// (Remembered settings: js/settings.js.)
const savedTime = readSetting('light');
if (savedTime) lighting.setTime(savedTime);
if (readSetting('shadows')) lighting.setShadows(true);

// anchor: dollhouse placement in XR (identity on the 2D page and at 1:1).
// centerer: puts the model's bottom-centre at the anchor's origin.
const anchor = new THREE.Group();
anchor.name = 'anchor';
const centerer = new THREE.Group();
centerer.name = 'centerer';
anchor.add(centerer);
scene.add(anchor);

// The model service (js/model-service.js, stage B1): reads, merges, supersedes and frees models; it holds the one shown (models.current).
const models = new ModelService({ config: CONFIG, onStatus: (text, isError) => setStatus(text, isError), onFree: () => centerer.clear() });

// Depth shading (corner gradients) for the headset; prepared in the background.
const depth = new DepthShading();
depth.setEnabled(readSetting('depth'));

let newPhotos = 0; // taken in the VR session that is running (or just ended)
const xr = new XRExperience({ renderer, scene, camera, rig, anchor, centerer, lighting, depth, onEnd: () => {
	controls.enabled = true;
	scene.background = lighting.background();
	lighting.fit();
	frame('iso');
	invalidate();
	// The safety net (js/safety.js): what went wrong in VR, said on the page.
	const failed = vrTrouble();
	if (failed) setStatus(failed, true);
	// Photos taken in VR wait here, to be saved to Downloads.
	renderPhotos().then(() => {
		if (!newPhotos) return;
		if (failed) { $('panel').classList.remove('collapsed'); newPhotos = 0; return; } // (the error stays in the status line; the photos are below)
		setStatus(newPhotos === 1 ? 'You took a photo in VR. Save it below.' : `You took ${newPhotos} photos in VR. Save them below.`);
		$('panel').classList.remove('collapsed');
		$('photos-section').scrollIntoView({ block: 'nearest' });
		newPhotos = 0;
	});
	// A model that arrived from the computer while in VR opens now.
	const m = takePending();
	if (m) load(m.files, m.name, { type: 'sent' }).catch(() => {});
}, onPhoto: async (blob, name) => {
	// Kept, not downloaded: the browser's download prompt would end the VR session.
	const kept = await addPhoto(blob, name);
	if (kept) newPhotos++;
	return kept;
} });

// When the light changes (here or from the headset menu): remember it and update the views.
lighting.onChange = () => {
	writeSetting('light', lighting.time);
	writeSetting('shadows', lighting.shadows);
	if (!renderer.xr.isPresenting) scene.background = lighting.background();
	document.body.classList.toggle('dark-sky', lighting.time === 'night'); // light text over the night sky
	xr.updateSky();
	xr.updateLabels();
	for (const b of $('time').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === lighting.time));
	$('shadows').checked = lighting.shadows;
	invalidate();
};
lighting.onChange();

// Depth shading: remember the switch, and say how far the preparation is.
depth.onChange = () => {
	writeSetting('depth', depth.enabled);
	$('depth').checked = depth.enabled;
	$('depth-note').textContent = !depth.enabled || depth.state === 'idle' ? 'in VR only'
		: depth.state === 'baking' ? `preparing… ${Math.round(depth.progress * 100)}%` : 'ready for VR';
	xr.updateLabels();
	if (depth.state === 'ready') { showStats(); invalidate(); }
};
depth.onChange();

window.addEventListener('resize', () => {
	if (renderer.xr.isPresenting) return;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	invalidate();
});

// The safety net, on the page's side (js/safety.js).
// The headset can take the graphics memory back (the graphics context is
// lost): three.js then draws nothing, so VR ends with a message.
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
	e.preventDefault(); // (lets the browser give the context back; three.js then restores its state)
	contextLost = true;
	console.warn('The graphics context was lost');
	if (xr.session) xr.end();
	else setStatus('The headset took back the graphics memory for a moment. If the view stays empty, reload the page.', true);
});
// The browser gives it back: three.js restores its state and the page draws again (tested in
// headless Chromium: the model comes back with its colours, no reload needed).
renderer.domElement.addEventListener('webglcontextrestored', () => {
	if ($('status').textContent.includes('graphics memory')) setStatus('');
	invalidate();
});
// Errors anywhere in the page while in VR count as the headset's errors (the card, then the way out).
window.addEventListener('error', (e) => { if (xr.session) xr.safety.fail(e.error ?? e.message, 'page'); });
window.addEventListener('unhandledrejection', (e) => { if (xr.session) xr.safety.fail(e.reason, 'page'); });

/** What went wrong in the VR session that just ended, as a status line, or ''. */
function vrTrouble() {
	if (contextLost) { contextLost = false; return 'VR closed: the headset took back the graphics memory. Enter VR again (reload the page if the view stays empty).'; }
	const s = xr.safety;
	if (s.failed) return `VR closed after an error (${s.lastError.message}). Reload the page to try again.`;
	if (s.errors) return `Something went wrong in VR (${s.lastError.message}). It went on; if anything looks wrong, reload the page.`;
	return '';
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
	timer.update(time);
	const dt = Math.min(timer.getDelta(), 0.1);
	if (renderer.xr.isPresenting) {
		// (Inside the safety net: an error shows a calm card instead of freezing the view.)
		xr.frame(dt, () => depth.tick(4)); // (a little depth bake per frame, so the headset stays smooth)
		renderer.render(scene, camera);
		return;
	}
	depth.tick(12);
	controls.update(); // fires "change" while the camera is still moving
	if (!dirty && time - lastDraw < IDLE_REDRAW_MS) return;
	dirty = false;
	lastDraw = time;
	renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setStatus(text, isError = false) {
	$('status').textContent = text;
	$('status').classList.toggle('error', isError);
}

function showStats() {
	if (!models.current) { $('stats').textContent = ''; return; }
	const { triangles, drawCalls } = modelStats(models.current.root);
	const s = models.current.stats;
	const fmt = (n) => n.toLocaleString('en-GB');
	const lines = [`${fmt(triangles)} triangles · ${fmt(drawCalls)} draw calls${models.current.merged ? ` (merged from ${fmt(models.current.merged.sourceMeshes)} meshes)` : ''}`];
	if (models.current.kind === 'sh3d') {
		lines.push(`${s.walls} walls · ${s.rooms} rooms · ${s.pieces} pieces · ${s.openings} openings${s.levels > 1 ? ` · ${s.levels} levels` : ''}`);
		if (s.missingModels) lines.push(`${s.missingModels} model(s) could not be read (shown as boxes)`);
	} else if (models.current.unit) {
		lines.push(`Units: ${models.current.unit}`);
	}
	// Built as text nodes, never as HTML: file names come from outside.
	const row = (text, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; return d; };
	const rows = [row(models.current.label || '', 'name'), ...lines.map((l) => row(l))];
	// Said, never hidden: the page says when a home was simplified, and by how much.
	if (models.current.simplified) rows.push(row(`Simplified for the Quest: ${fmt(Math.round(models.current.simplified.before))} → about ${fmt(Math.round(models.current.simplified.after))} triangles (${models.current.simplified.models} heavy model${models.current.simplified.models === 1 ? '' : 's'}; sizes kept exact). A computer shows the original.`, 'warn'));
	if (triangles > CONFIG.triangleWarning) rows.push(row(`Heavy model: over ${fmt(CONFIG.triangleWarning)} triangles may run slowly on Quest 2.`, 'warn'));
	$('stats').replaceChildren(...rows);
	return { triangles, drawCalls };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Loads [{ name, bytes }] and shows it: the model service (js/model-service.js,
 * stage B1) reads, merges and frees; this shows the result.
 * source: { type: 'link', url } | { type: 'file' } | { type: 'recent', url?, id } (not re-saved; url = the link it first came from; id = its entry under Recent)
 */
async function load(files, label, source = { type: 'file' }) {
	// If another model is opened before this one finishes, this one is dropped (the service answers null).
	let seq = 0;
	// In the headset, the old home goes first (heavy homes, step 4): the memory's peak is then the
	// new home alone, not both. Not inside VR, where it is on view; not on a computer, where a
	// failed open should leave the home you had.
	const freeFirst = DEVICE.headset && !xr.session;
	let previous = null; // the home freed to make room: offered back if this open fails
	try {
		const model = await models.open(files, label, source, {
			read: { units: $('units').value, triangleLimit: DEVICE.headset ? CONFIG.triangleLimit : Infinity, simplifyAbove: DEVICE.headset ? SIMPLIFY.above : Infinity, objParser: DEV.worker ? workerObjParser() : null },
			nomerge: DEV.nomerge, fold: !DEV.nofold, freeFirst,
			onStart: () => {
				seq = models.seq;
				updateXRButtons(); // no Enter VR while a model is being swapped in
				const c = models.current;
				if (c && freeFirst) previous = { label: c.label, recentId: c.recentId ?? (c.source?.type === 'recent' ? c.source.id : null) };
			},
			onFreed: () => { setFiles(null); showStats(); invalidate(); },
		});
		if (!model) return; // (superseded)
		const result = model, merged = { stats: model.merged };
		// On a computer, keep the opened files: Send to my Quest can pass them on.
		setFiles(ON_HEADSET ? null : files);
		passOn(files, label); // linked to the headset: it gets this one too
		centerer.add(model.root);
		// Bottom-centre of the model (without the ground) at the origin.
		const b = model.bounds;
		centerer.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
		anchor.updateMatrixWorld(true);
		// More than one level (distinct elevations): walk mode lets you stand on
		// anything, so stairs work. One level: you stay on the floor.
		const elevations = new Set([...(result.home?.levels.values() ?? [])].filter((l) => l.viewable).map((l) => l.elevation));
		// Bulbs of the home's lamps: they glow at sunset and at night.
		const lamps = merged.stats ? lighting.setLamps(result.lamps) : lighting.setLamps(null);
		if (lamps) model.root.add(lamps);
		if (merged.stats) lighting.liftCeilings(model.layers.ceilings); // (ceilings read muddy at eye level: a small lift of their own)
		xr.setModel({ group: model.root, layers: model.layers, lamps, storeys: result.storeys ?? 1, storeyNames: result.storeyNames ?? [], bounds: model.bounds, observer: model.observer, skyColor: result.home?.skyColor, multiLevel: elevations.size > 1, plan: result.plan ?? null });
		depth.setModel(merged.stats ? model.layers : null); // (not in the ?nomerge debug view)
		prepareTextures(model.root);
		lighting.setHome({ compass: result.home?.compass, skyColor: result.home?.skyColor });
		lighting.setSubject(centerer, model.bounds);
		frame('iso');
		invalidate();
		// Links to other websites written inside a model are never followed.
		const blocked = model.store?.blockedLinks() ?? 0;
		const notes = model.store?.allNotes() ?? [];
		// Small windows: get the files card out of the way of the model.
		if (window.matchMedia('(max-width: 720px), (max-height: 520px)').matches) setCollapsed(true);
		setStatus(`Loaded ${label}.${blocked ? ` ${blocked} link${blocked > 1 ? 's' : ''} to other websites inside the file ${blocked > 1 ? 'were' : 'was'} ignored.` : ''}${notes.map((n) => ` ${n}`).join('')}`);
		showStats();
		// Once the textures have arrived: shrink any oversized ones and free
		// the unpacked files, which the scene no longer needs.
		const store = model.store;
		store?.whenIdle().then(() => {
			if (models.current?.store !== store) return;
			prepareTextures(model.root);
			store.dispose();
			invalidate();
		});
		document.title = `${label} · CasaWalk VR`;
		// Remember it for one-tap reopening (only once it opened successfully).
		if (source.type !== 'recent') addRecent({ name: label, files, source }).then((id) => {
			renderRecents();
			if (id === 'too large' && models.current?.label === label) setStatus(`${$('status').textContent} It is too large to keep under Recent.`);
			else if (id && models.current?.label === label) models.current.recentId = id; // (offered back if the next open fails)
		});
	} catch (e) {
		console.error(e);
		if (models.isLatest(seq)) {
			setStatus(e instanceof UserError ? e.message : `Could not open ${label}: ${e.message}`, true);
			if (previous && !models.current) offerPrevious(previous);
		}
		throw e;
	} finally {
		updateXRButtons();
	}
}

/**
 * After a failed open in the headset, where the home you had was freed to make
 * room: says so, and offers it back from Recent with one key (or, if it was too
 * large to keep there, says to open it again from its file or link).
 */
function offerPrevious(previous) {
	const status = $('status');
	const line = document.createElement('div');
	if (!previous.recentId) {
		line.textContent = `${previous.label} was closed to make room: open it again from its file or link.`;
		status.append(line);
		return;
	}
	line.textContent = `${previous.label} was closed to make room. `;
	const again = document.createElement('button');
	again.type = 'button';
	again.className = 'outline';
	again.textContent = `Open ${previous.label} again`;
	again.addEventListener('click', async () => {
		const rec = await getRecent(previous.recentId);
		if (!rec) { setStatus('That saved copy is no longer available.', true); renderRecents(); return; }
		load(rec.files, rec.name, { type: 'recent', url: rec.source.url, id: previous.recentId }).catch(() => {});
	});
	line.append(again);
	status.append(line);
}


/**
 * Textures: sharper filtering at grazing angles (floors) without any
 * flicker, and nothing larger than CONFIG.maxTextureSize, because a few
 * 4K images are enough to exhaust a Quest 2's memory. Images that have not
 * arrived yet are handled on the second call, once loading is idle.
 */
function prepareTextures(root) {
	const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
	const max = CONFIG.maxTextureSize;
	const seen = new Set();
	root.traverse((o) => {
		for (const m of [].concat(o.material || [])) {
			const t = m.map;
			if (!t || seen.has(t)) continue;
			seen.add(t);
			const img = t.image;
			const w = img?.naturalWidth || img?.width || 0, h = img?.naturalHeight || img?.height || 0;
			let changed = false;
			if (img?.data) {
				// Raw pixel data (TGA images, the KTX2 stand-in): it can't be
				// drawn onto a canvas, so it is left as it is.
			} else if (w && h && Math.max(w, h) > max) {
				const k = max / Math.max(w, h);
				const c = document.createElement('canvas');
				c.width = Math.max(1, Math.round(w * k));
				c.height = Math.max(1, Math.round(h * k));
				c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
				t.image = c;
				changed = true;
			}
			if (t.anisotropy !== aniso) { t.anisotropy = aniso; changed = true; }
			if (changed && w && h) t.needsUpdate = true; // an image still loading uploads itself later
		}
	});
}

/** Fits the camera to the model. view: 'iso' | 'ne' | 'nw' | 'se' | 'sw' | 'top'. */
function frame(view = 'iso') {
	if (!models.current) return;
	// After an XR session the camera carries the headset's projection: reset it.
	camera.fov = 50;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.quaternion.identity();
	const box = (models.current.bounds && !models.current.bounds.isEmpty() ? models.current.bounds.clone() : new THREE.Box3().setFromObject(models.current.root)).translate(centerer.position);
	const center = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const radius = Math.max(size.x, size.z, size.y) * 0.5 + 0.5;
	const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9;
	const dirs = {
		iso: [1, 1.1, 1.25], se: [1, 1.1, 1], sw: [-1, 1.1, 1], ne: [1, 1.1, -1], nw: [-1, 1.1, -1], top: [0, 1, 0.0001],
	};
	const d = new THREE.Vector3(...(dirs[view] || dirs.iso)).normalize();
	camera.position.copy(center).addScaledVector(d, dist);
	camera.near = Math.max(0.01, dist / 200);
	camera.far = dist * 20;
	camera.updateProjectionMatrix();
	controls.target.copy(center);
	controls.update();
}

/** What to do when a link cannot be downloaded from here (said on the device in hand). */
const linkWayRound = () => (ON_HEADSET
	? 'Instead: open the link in a browser tab here, download the file, then press Open file and pick it from Downloads.'
	: 'Instead: download the file, open it here, then use Send to my Quest.');

/** Opens a link's model: the model service checks and downloads it (saying what is wrong), then load() shows it. */
async function loadUrl(url, { remember = true } = {}) {
	const { name, bytes } = await models.fetchLink(url, { base: location.href, wayRound: linkWayRound });
	url = url.trim();
	if (remember) { setLastLink(url); $('link-input').value = url; }
	return load([{ name, bytes }], name, { type: 'link', url });
}

// The photos taken in VR, kept until saved to Downloads (js/page/files-card.js).
initPhotos(page);

// Enter VR, with Send to my Quest beside it on computers (js/page/enter-vr.js, js/page/send.js).
initEnterVR(page);

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const filesCard = initFilesCard(page); // Open file, the samples, the link box (js/page/files-card.js)
$('time').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.value; if (v) lighting.setTime(v); });
$('shadows').addEventListener('change', (e) => lighting.setShadows(e.target.checked));
$('depth').addEventListener('change', (e) => depth.setEnabled(e.target.checked));
filesCard.wireLinkBox(); // (the link box and Recent, after the options, as before)

// The welcome over the empty view, the files card folding away, and dropping files on the page (js/page/welcome.js).
initWelcome(page);
initDrop();

// Which build is running (with Reload when the site has a newer one), and offline use (js/page/updates.js).
initBuildLabel(xr);
registerOffline();

// ?pair=<name>: Receive, on the headset (js/page/send.js).
initReceive();

// ?model=<url> opens a model straight away (also used by the screenshot tests).
const params = new URLSearchParams(location.search);
const initial = params.get('model');
const sample = sampleById(params.get('sample')); // ?sample=pond-house: one of ours (only listed ids)
let ready = Promise.resolve(true);
if (sample && !initial) {
	ready = loadUrl(sample.file, { remember: false }).then(() => true, () => false);
} else if (initial) {
	// Only models on this site open by themselves. A link to somewhere else
	// could have been put in the address by anyone, so it waits for a click.
	const link = checkLink(initial, location.href);
	if (link.ok && link.sameOrigin) {
		ready = loadUrl(initial, { remember: false }).then(() => true, () => false);
	} else if (link.ok) {
		$('link-input').value = initial;
		$('open-link').classList.add('primary'); // the next step, e.g. after "Send to my Quest"
		setStatus(`This page was opened with a link to a model on ${link.host}. Press “Load” if you trust it.`);
	} else {
		setStatus(link.error, true);
	}
} else {
	setStatus('Open a Sweet Home 3D file to start.');
}

// Test hooks for the browser tests (scripts/screenshots.js, scripts/xr-test.js): only with ?test.
if (DEV.test) window.__casawalk = {
	lighting,
	open: (url) => loadUrl(url, { remember: false }), // (opens a model on this site: the example home for the headset test)
	get sharer() { return links.sharer; },
	get joiner() { return links.joiner; },
	depth,
	ready,
	invalidate,
	frame: (view) => { frame(view); controls.update(); renderer.render(scene, camera); },
	look: (pos, target) => { camera.position.set(...pos); controls.target.set(...target); controls.update(); renderer.render(scene, camera); },
	stats: () => ({ ...(models.current?.stats || {}), ...modelStats(models.current?.root || new THREE.Group()), merged: models.current?.merged }),
	decoders: checkDecoders,
	scene,
	xr,
	renderer,
	get current() { return models.current; },
};

