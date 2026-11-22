// CasaWalk: app entry point.
// 2D page (home screen) with an orbit-controlled dollhouse preview, file
// loading, and the Enter VR / Enter AR buttons. The XR modes live in xr.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';
import { openFiles, UserError, checkDecoders } from './formats.js';
import { optimiseModel } from './optimise.js';
import { XRExperience } from './xr.js';
import { Lighting } from './lighting.js';
import { DepthShading } from './depth.js';
import { checkLink, fileNameOf, sendToQuestUrl, resolveOneDrive, resolveGoogleDrive, looksLikeWebPage, LinkError } from './links.js';
import { isPairId } from './transfer.js';
import { Sharer, Joiner } from './pairing.js';
import { readSetting, writeSetting } from './settings.js';
import { listRecents, getRecent, addRecent, removeRecent, getLastLink, setLastLink, addPhoto, listPhotos, getPhoto, removePhoto, markPhotoSaved } from './storage.js';
import { saveFile } from './photo.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------

// alpha: AR shows the camera passthrough behind the model.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: new URLSearchParams(location.search).has('test') });
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

let current = null; // result of openFiles(), with root replaced by the merged model

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
	// Photos taken in VR wait here, to be saved to Downloads.
	renderPhotos().then(() => {
		if (!newPhotos) return;
		setStatus(newPhotos === 1 ? 'You took a photo in VR. Save it below.' : `You took ${newPhotos} photos in VR. Save them below.`);
		$('panel').classList.remove('collapsed');
		$('photos-section').scrollIntoView({ block: 'nearest' });
		newPhotos = 0;
	});
	// A model that arrived from the computer while in VR opens now.
	if (pendingModel) { const m = pendingModel; pendingModel = null; load(m.files, m.name, { type: 'sent' }).catch(() => {}); }
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

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
	timer.update(time);
	const dt = Math.min(timer.getDelta(), 0.1);
	if (renderer.xr.isPresenting) {
		xr.update(dt);
		depth.tick(4); // a little per frame, so the headset stays smooth
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

function sceneStats(root) {
	let triangles = 0, drawCalls = 0;
	root.traverse((o) => {
		if (!o.isMesh || !o.visible || o.parent?.name === 'lamps') return; // (lamp glows are not part of the model)
		const g = o.geometry;
		const count = g.index ? g.index.count : g.attributes.position.count;
		triangles += count / 3;
		drawCalls += Array.isArray(o.material) ? Math.max(1, g.groups.length) : 1;
	});
	return { triangles: Math.round(triangles), drawCalls };
}

function showStats() {
	if (!current) { $('stats').textContent = ''; return; }
	const { triangles, drawCalls } = sceneStats(current.root);
	const s = current.stats;
	const fmt = (n) => n.toLocaleString('en-GB');
	const lines = [`${fmt(triangles)} triangles · ${fmt(drawCalls)} draw calls${current.merged ? ` (merged from ${fmt(current.merged.sourceMeshes)} meshes)` : ''}`];
	if (current.kind === 'sh3d') {
		lines.push(`${s.walls} walls · ${s.rooms} rooms · ${s.pieces} pieces · ${s.openings} openings${s.levels > 1 ? ` · ${s.levels} levels` : ''}`);
		if (s.missingModels) lines.push(`${s.missingModels} model(s) could not be read (shown as boxes)`);
	} else if (current.unit) {
		lines.push(`Units: ${current.unit}`);
	}
	// Built as text nodes, never as HTML: file names come from outside.
	const row = (text, cls) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; return d; };
	const rows = [row(current.label || '', 'name'), ...lines.map((l) => row(l))];
	if (triangles > CONFIG.triangleWarning) rows.push(row(`Heavy model: over ${fmt(CONFIG.triangleWarning)} triangles may run slowly on Quest 2.`, 'warn'));
	$('stats').replaceChildren(...rows);
	return { triangles, drawCalls };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function disposeCurrent() {
	if (!current) return;
	current.root.traverse((o) => {
		if (o.geometry) o.geometry.dispose();
		const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
		for (const m of mats) { m.map?.dispose(); m.dispose(); }
	});
	current.store?.dispose();
	centerer.clear();
	current = null;
}

/**
 * Loads [{ name, bytes }] and shows it.
 * source: { type: 'link', url } | { type: 'file' } | { type: 'recent', url? } (not re-saved; url = the link it first came from)
 */
async function load(files, label, source = { type: 'file' }) {
	// If another model is opened before this one finishes, this one is dropped.
	const seq = ++loadSeq;
	const superseded = (result) => { if (seq === loadSeq) return false; result.store?.dispose(); return true; };
	setStatus(`Opening ${label}…`);
	loading++;
	updateXRButtons(); // no Enter VR while a model is being swapped in
	try {
		const result = await openFiles(files, { units: $('units').value, onProgress: (t) => { if (seq === loadSeq) setStatus(t); } });
		if (superseded(result)) return;
		setStatus('Optimising for Quest…');
		await new Promise((r) => setTimeout(r, 0)); // let the status paint
		if (superseded(result)) return;
		// ?nomerge (debugging only): show the scene exactly as loaded.
		const merged = new URLSearchParams(location.search).has('nomerge')
			? { group: result.root, layers: Object.fromEntries(['main', 'walls', 'floors', 'ceilings', 'ground'].map((n) => [n, result.root.getObjectByName(n === 'main' ? 'furniture' : n) || new THREE.Group()])), stats: null }
			: optimiseModel(result.root);
		disposeCurrent();
		current = { ...result, label, source, root: merged.group, layers: merged.layers, merged: merged.stats };
		// On a computer, keep the opened files: Send to my Quest can pass them on.
		currentFiles = ON_HEADSET ? null : files;
		if (sharer?.linked) sharer.send(files, label); // linked to the headset: it gets this one too
		centerer.add(current.root);
		// Bottom-centre of the model (without the ground) at the origin.
		const b = current.bounds;
		centerer.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
		anchor.updateMatrixWorld(true);
		// More than one level (distinct elevations): walk mode lets you stand on
		// anything, so stairs work. One level: you stay on the floor.
		const elevations = new Set([...(result.home?.levels.values() ?? [])].filter((l) => l.viewable).map((l) => l.elevation));
		// Bulbs of the home's lamps: they glow at sunset and at night.
		const lamps = merged.stats ? lighting.setLamps(result.lamps) : lighting.setLamps(null);
		if (lamps) current.root.add(lamps);
		xr.setModel({ group: current.root, layers: current.layers, lamps, storeys: result.storeys ?? 1, storeyNames: result.storeyNames ?? [], bounds: current.bounds, observer: current.observer, skyColor: result.home?.skyColor, multiLevel: elevations.size > 1, plan: result.plan ?? null });
		depth.setModel(merged.stats ? current.layers : null); // (not in the ?nomerge debug view)
		prepareTextures(current.root);
		lighting.setHome({ compass: result.home?.compass, skyColor: result.home?.skyColor });
		lighting.setSubject(centerer, current.bounds);
		frame('iso');
		invalidate();
		// Links to other websites written inside a model are never followed.
		const blocked = current.store?.blockedLinks() ?? 0;
		const notes = current.store?.allNotes() ?? [];
		// Small windows: get the files card out of the way of the model.
		if (window.matchMedia('(max-width: 720px), (max-height: 520px)').matches) setCollapsed(true);
		setStatus(`Loaded ${label}.${blocked ? ` ${blocked} link${blocked > 1 ? 's' : ''} to other websites inside the file ${blocked > 1 ? 'were' : 'was'} ignored.` : ''}${notes.map((n) => ` ${n}`).join('')}`);
		showStats();
		// Once the textures have arrived: shrink any oversized ones and free
		// the unpacked files, which the scene no longer needs.
		const store = current.store;
		store?.whenIdle().then(() => {
			if (current?.store !== store) return;
			prepareTextures(current.root);
			store.dispose();
			invalidate();
		});
		document.title = `${label} · CasaWalk`;
		// Remember it for one-tap reopening (only once it opened successfully).
		if (source.type !== 'recent') addRecent({ name: label, files, source }).then(renderRecents);
	} catch (e) {
		console.error(e);
		if (seq === loadSeq) setStatus(e instanceof UserError ? e.message : `Could not open ${label}: ${e.message}`, true);
		throw e;
	} finally {
		loading--;
		updateXRButtons();
	}
}

let loadSeq = 0; // the newest load() call
let loading = 0; // loads in progress

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
	if (!current) return;
	// After an XR session the camera carries the headset's projection: reset it.
	camera.fov = 50;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.quaternion.identity();
	const box = (current.bounds && !current.bounds.isEmpty() ? current.bounds.clone() : new THREE.Box3().setFromObject(current.root)).translate(centerer.position);
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

/**
 * Downloads a URL into bytes, showing progress in the status line.
 * no-store: after editing the home on the Mac, always get the new version.
 */
async function download(url, name, expectedSize = 0, init = {}) {
	// A size limit, so a wrong or hostile link cannot fill the memory.
	const max = CONFIG.maxDownloadMB * 1048576;
	const tooBig = () => new UserError(`That file is larger than ${CONFIG.maxDownloadMB} MB, which is too large to open here.`);
	if (expectedSize > max) throw tooBig();
	// No cookies and no "where from" header go to the other site (Google Drive
	// is the exception: its key is checked against this site's origin).
	const res = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', ...init, credentials: 'omit' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const total = expectedSize || Number(res.headers.get('Content-Length')) || 0;
	if (total > max) { res.body?.cancel().catch(() => {}); throw tooBig(); }
	if (!res.body) {
		const all = new Uint8Array(await res.arrayBuffer());
		if (all.length > max) throw tooBig();
		return all;
	}
	const reader = res.body.getReader();
	const chunks = [];
	let got = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		got += value.length;
		if (got > max) { reader.cancel().catch(() => {}); throw tooBig(); }
		const mb = (n) => (n / 1048576).toFixed(1);
		setStatus(total ? `Downloading ${name}… ${Math.min(100, Math.round((got / total) * 100))}% of ${mb(total)} MB` : `Downloading ${name}… ${mb(got)} MB`);
	}
	const bytes = new Uint8Array(got);
	let off = 0;
	for (const c of chunks) { bytes.set(c, off); off += c.length; }
	return bytes;
}

/** What to do when a link cannot be downloaded from here (said on the device in hand). */
const linkWayRound = () => (ON_HEADSET
	? 'Instead: open the link in a browser tab here, download the file, then press Open file and pick it from Downloads.'
	: 'Instead: download the file, open it here, then use Send to my Quest.');

async function loadUrl(url, { remember = true } = {}) {
	url = url.trim();
	const link = checkLink(url, location.href);
	if (!link.ok) { setStatus(link.error, true); throw new UserError(link.error); }
	if (link.problem) {
		const text = link.blocked ? `${link.problem} ${linkWayRound()}` : link.problem;
		setStatus(text, true);
		throw new UserError(text);
	}
	const service = link.service;
	if (link.googleDrive && !CONFIG.googleApiKey) {
		const text = `This copy of the viewer is not set up for Google Drive links (config.js has no Google API key). ${linkWayRound()}`;
		setStatus(text, true);
		throw new UserError(text);
	}
	let name = fileNameOf(link.url);
	setStatus(`Downloading ${link.googleDrive || link.oneDrive ? `from ${service}` : name}…`);
	let bytes;
	try {
		let from = link.url;
		let size = 0;
		let init = {};
		if (link.googleDrive) ({ url: from, name, size, init } = await resolveGoogleDrive(link.googleDrive, CONFIG.googleApiKey));
		if (link.oneDrive) ({ url: from, name, size } = await resolveOneDrive(link.oneDrive));
		bytes = await download(from, name, size, init);
		// A private link usually answers with a sign-in page instead of the file.
		if (looksLikeWebPage(bytes)) {
			throw new UserError(service
				? `${service} sent a web page instead of the file: the link is probably not public. Share it with “Anyone with the link” and copy the link again.`
				: 'That link opens a web page, not a model file. Use a link that downloads the file itself.');
		}
	} catch (e) {
		let text;
		if (e instanceof UserError || e instanceof LinkError) text = e.message;
		else if (/^HTTP (401|403|404)/.test(e.message)) text = `${service || 'That site'} would not give the file (${e.message}). Check the link is shared with “Anyone with the link”.`;
		else if (e instanceof TypeError) text = `${service || 'That site'} does not let other websites download this file. ${linkWayRound()}`;
		else text = `Could not download that link (${e.message}).`;
		setStatus(text, true);
		throw e instanceof UserError ? e : new UserError(text);
	}
	if (remember) { setLastLink(url); $('link-input').value = url; }
	return load([{ name, bytes }], name, { type: 'link', url });
}

// ---------------------------------------------------------------------------
// Dropbox Chooser (official drop-in, https://www.dropbox.com/developers/chooser)
// ---------------------------------------------------------------------------
// The Chooser script must come from dropbox.com (it is Dropbox's own UI), so
// it is the one script not vendored. It is only loaded when an app key is set
// in config.js. Direct links are CORS-enabled and expire after 4 hours, which
// is fine: what we open is cached under Recent.

const MODEL_EXTENSIONS = ['.sh3d', '.zip', '.obj', '.mtl', '.glb', '.gltf', '.bin', '.dae', '.3ds', '.jpg', '.jpeg', '.png'];

function setupDropbox() {
	const key = CONFIG.dropboxAppKey;
	if (!key) return;
	const s = document.createElement('script');
	s.src = 'https://www.dropbox.com/static/api/2/dropins.js';
	s.id = 'dropboxjs';
	s.dataset.appKey = key;
	s.onload = () => {
		if (window.Dropbox?.isBrowserSupported?.() === false) return;
		$('open-dropbox').hidden = false;
		$('open-file').classList.remove('primary'); // Dropbox becomes the main way in
	};
	s.onerror = () => console.warn('Dropbox Chooser could not be loaded');
	document.head.appendChild(s);
}

function openFromDropbox() {
	if (!window.Dropbox) { setStatus('Dropbox is not available right now. Paste a link and press Load instead.', true); return; }
	// Must run directly in the click handler, or the browser blocks the popup.
	window.Dropbox.choose({
		linkType: 'direct',
		multiselect: true, // an OBJ can come with its .mtl and textures
		extensions: MODEL_EXTENSIONS,
		success: async (picked) => {
			const label = picked.length === 1 ? picked[0].name : `${picked.length} files`;
			let files;
			try {
				files = [];
				for (const f of picked) files.push({ name: f.name, bytes: await download(f.link, f.name, f.bytes) });
			} catch (e) {
				setStatus(`Could not download from Dropbox (${e.message}).`, true);
				return;
			}
			load(files, label, { type: 'dropbox' }).catch(() => {});
		},
		cancel: () => {},
	});
}

// ---------------------------------------------------------------------------
// Recent models
// ---------------------------------------------------------------------------

function ago(date) {
	const s = (Date.now() - date) / 1000;
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function renderRecents() {
	const list = $('recent');
	const items = await listRecents();
	$('recent-section').hidden = items.length === 0;
	list.replaceChildren(...items.map((r) => {
		const li = document.createElement('li');
		if (r.source.type === 'link') li.className = 'with-refresh';
		const open = document.createElement('button');
		open.className = 'recent-open';
		const mb = (r.size / 1048576).toFixed(r.size < 10485760 ? 1 : 0);
		const kind = { link: 'Link', dropbox: 'Dropbox', file: 'File', sent: 'From computer' }[r.source.type] || 'File';
		const span = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
		open.title = `${r.name}: ${kind.toLowerCase()}, ${mb} MB, ${ago(r.date)}. Opens the saved copy.`;
		open.append(span('recent-name', r.name), span('recent-meta', ago(r.date)));
		open.addEventListener('click', async () => {
			const rec = await getRecent(r.id);
			if (!rec) { setStatus('That saved copy is no longer available.', true); renderRecents(); return; }
			load(rec.files, rec.name, { type: 'recent', url: rec.source.url }).catch(() => {});
		});
		li.append(open);
		if (r.source.type === 'link') {
			const refresh = document.createElement('button');
			refresh.className = 'recent-icon';
			refresh.textContent = '↻';
			refresh.title = 'Download the latest version from the same link';
			refresh.setAttribute('aria-label', `Update ${r.name} from its link`);
			refresh.addEventListener('click', () => loadUrl(r.source.url).catch(() => {}));
			li.append(refresh);
		}
		const del = document.createElement('button');
		del.className = 'recent-icon';
		del.textContent = '×';
		del.title = 'Remove from this list';
		del.setAttribute('aria-label', `Remove ${r.name}`);
		del.addEventListener('click', async () => { await removeRecent(r.id); renderRecents(); });
		li.append(del);
		return li;
	}));
}

// ---------------------------------------------------------------------------
// Photos taken in VR (kept in storage.js until saved to Downloads)
// ---------------------------------------------------------------------------

let photoUrls = []; // thumbnails' object URLs, freed on each redraw

async function renderPhotos() {
	const items = await listPhotos();
	for (const u of photoUrls) URL.revokeObjectURL(u);
	photoUrls = [];
	$('photos-section').hidden = items.length === 0;
	const unsaved = items.filter((p) => !p.saved).length;
	$('photos-title').textContent = `Photos (${items.length})`;
	$('photos-note').textContent = unsaved
		? `Taken in VR and kept here. ${unsaved === items.length ? 'Save them' : `Save the ${unsaved} new ${unsaved === 1 ? 'one' : 'ones'}`} to the headset's Downloads (Files app).`
		: 'All saved to Downloads (Files app on the headset). Delete them here when you like.';
	$('photos-save').hidden = unsaved === 0;
	const rows = await Promise.all(items.map(async (p) => {
		const li = document.createElement('li');
		const img = document.createElement('img');
		img.alt = '';
		img.loading = 'lazy';
		const rec = await getPhoto(p.id);
		if (rec?.blob) { const url = URL.createObjectURL(rec.blob); photoUrls.push(url); img.src = url; }
		const meta = document.createElement('span');
		meta.className = 'photo-meta';
		const when = document.createElement('b');
		when.textContent = ago(p.date);
		meta.append(when, p.saved ? ' · saved' : '');
		meta.title = p.name;
		const save = document.createElement('button');
		save.className = 'recent-icon';
		save.textContent = '↓';
		save.title = 'Save to Downloads';
		save.setAttribute('aria-label', `Save the photo from ${ago(p.date)} to Downloads`);
		save.addEventListener('click', async () => { await savePhoto(p.id); renderPhotos(); });
		const del = document.createElement('button');
		del.className = 'recent-icon';
		del.textContent = '×';
		del.title = 'Delete this photo';
		del.setAttribute('aria-label', `Delete the photo from ${ago(p.date)}`);
		del.addEventListener('click', async () => { await removePhoto(p.id); renderPhotos(); });
		li.append(img, meta, save, del);
		return li;
	}));
	$('photos').replaceChildren(...rows);
}

/** Saves one kept photo to Downloads (on the Quest: the Files app). */
async function savePhoto(id) {
	const p = await getPhoto(id);
	if (!p?.blob) return;
	saveFile(p.blob, p.name);
	await markPhotoSaved(id);
}

$('photos-save').addEventListener('click', async () => {
	const unsaved = (await listPhotos()).filter((p) => !p.saved).reverse(); // oldest first
	for (const [i, p] of unsaved.entries()) {
		await savePhoto(p.id);
		if (i < unsaved.length - 1) await new Promise((r) => setTimeout(r, 400)); // (one at a time)
	}
	setStatus(unsaved.length === 1 ? 'Photo saved to Downloads.' : `${unsaved.length} photos saved to Downloads.`);
	renderPhotos();
});
renderPhotos();

// ---------------------------------------------------------------------------
// Enter VR (shown only when the browser supports it; passthrough is chosen in the headset)
// ---------------------------------------------------------------------------

let xrSupport = { vr: false, ar: false };
let xrChecked = false; // the browser has answered whether it supports VR

function updateXRButtons() {
	layoutWelcomeSoon(); // (called whenever loading starts or ends, or VR support becomes known)
	const box = $('xr-buttons');
	box.replaceChildren();
	// On a computer or phone: a button that opens this viewer on the user's
	// Quest (with the pasted link), so nothing has to be typed in the headset.
	const send = () => {
		const b = document.createElement('button');
		b.id = 'send-quest';
		b.className = xrSupport.vr || xrSupport.ar ? 'outline' : 'xr';
		b.textContent = 'Send to my Quest';
		b.title = 'Opens this viewer on your headset through Meta\u2019s \u201cOpen in VR\u201d page. A link is passed to Meta to do this; a file goes directly from this computer to the headset.';
		b.addEventListener('click', sendToQuest);
		const note = document.createElement('span');
		note.className = 'hint';
		note.id = 'send-note';
		return [b, note];
	};
	if (!xrSupport.vr && !xrSupport.ar) {
		if (xrChecked && !ON_HEADSET) { box.append(...send()); renderSendNote(); }
		else if (xrChecked) { const note = document.createElement('span'); note.className = 'hint'; note.textContent = 'This browser cannot enter VR.'; box.append(note); }
		return;
	}
	// One button: an AR-capable session can switch between VR and passthrough
	// from the in-headset menu.
	const kind = xrSupport.ar ? 'ar' : 'vr';
	const b = document.createElement('button');
	b.className = 'xr';
	// Simple headset glyph, then the label.
	b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4.2l-2.1-2.4a2.3 2.3 0 0 0-3.4 0L8.2 17H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm3.5 3a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zm9 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z"/></svg>';
	b.append('Enter VR');
	b.disabled = !current || loading > 0;
	b.title = current ? '' : 'Open a model first';
	b.addEventListener('click', async () => {
		try {
			controls.enabled = false;
			await xr.start(kind);
		} catch (e) {
			controls.enabled = true;
			console.error(e);
			setStatus(`Could not start VR: ${e.message}`, true);
		}
	});
	box.append(b);
	if (!ON_HEADSET) { box.append(...send()); renderSendNote(); } // e.g. a PC with a headset attached: both ways in
}

/** True in a headset's own browser (Meta Quest Browser), where "Send to my Quest" and dropping files make no sense. */
const ON_HEADSET = /OculusBrowser|\bQuest\b/i.test(navigator.userAgent);

// ---------------------------------------------------------------------------
// Send to my Quest (computers and phones) and Receive (headset)
// ---------------------------------------------------------------------------

let currentFiles = null; // the open model's files, on a computer (Send to my Quest passes them on)
let sharer = null; // computer: the link to the headset (pairing.js), while there is one
let sharerState = null; // its last { phase, text }
let joiner = null; // headset: the link to the computer
let pendingModel = null; // headset: a model received during VR, opened on leaving it

/**
 * What "Send to my Quest" would send right now, and the line under the button
 * that says so:
 *   - a model opened from a link, from Recent with a link, or the example: its
 *     link, through Meta's Web Launch (nothing else involved)
 *   - a model opened from a file on this computer: the file itself, directly
 *     to the headset (Web Launch carries a pairing name; pairing.js)
 *   - no model open: the link in the link box, or just the viewer
 */
function sendable() {
	if (current) {
		const name = `\u201c${current.label}\u201d`;
		if (current.source?.url) return { link: current.source.url, note: `Sends ${name} to your headset: nothing to type there.` };
		if (currentFiles) return { files: currentFiles, note: `Sends ${name} straight to your headset. Keep this page open until it arrives.` };
	}
	const typed = $('link-input').value.trim();
	return typed ? { link: typed, note: 'Sends the link you pasted to your headset: nothing to type there.' }
		: { link: '', note: 'Opens this viewer on your headset. Open a model first to send it too.' };
}

/** The line under Send to my Quest: what it would send, or how the link is doing (with Unlink). */
function renderSendNote() {
	const note = $('send-note');
	if (!note) return;
	if (sharer?.active) {
		const stop = document.createElement('button');
		stop.className = 'link-stop';
		stop.textContent = 'Unlink';
		stop.addEventListener('click', () => { sharer.close(); });
		note.replaceChildren(`${sharerState?.text ?? ''} `, stop);
	} else {
		note.textContent = sharerState && sharerState.phase !== 'linked' && sharerState.phase !== 'sending' && sharerState.phase !== 'waiting'
			? `${sharerState.text} ${sendable().note}` : sendable().note;
	}
}

/** Opens Meta's "Open in VR" page for this viewer, with the open model's link, or a link to send its file directly. */
function sendToQuest() {
	// Already linked (or waiting): send the open model again over the same link.
	if (sharer?.active) {
		if (current && currentFiles) sharer.send(currentFiles, current.label);
		return;
	}
	const s = sendable();
	if (s.files) {
		const sh = new Sharer({ onState: (st) => { sharerState = st; renderSendNote(); if (st.phase === 'error') setStatus(st.text, true); } });
		// (Opened straight away, inside the click: a tab opened later would be blocked.)
		const url = sendToQuestUrl(location.href, { pair: sh.id });
		if (url) {
			window.open(url, '_blank', 'noopener,noreferrer');
			setStatus('Meta\u2019s \u201cOpen in VR\u201d page opened in a new tab. Pick your headset there, then press Receive in the headset. Keep this page open.');
		} else {
			// A local test server (http): Web Launch needs https, so open this address on the other device by hand.
			const local = new URL(location.href);
			local.searchParams.delete('model');
			local.searchParams.set('pair', sh.id);
			window.__casawalk.pairUrl = local.toString();
			setStatus(`Testing locally: open ${local} on the other device and press Receive there.`);
		}
		sharer = sh;
		sh.open();
		sh.send(s.files, current.label);
		return;
	}
	if (s.link) {
		const link = checkLink(s.link, location.href);
		if (!link.ok) { setStatus(link.error, true); return; }
	}
	const url = sendToQuestUrl(location.href, s.link);
	if (!url) { setStatus('Send to my Quest only works from the https address of this page, not from a local test server.', true); return; }
	window.open(url, '_blank', 'noopener,noreferrer');
	setStatus(s.link
		? 'Meta\u2019s \u201cOpen in VR\u201d page opened in a new tab. Pick your headset there: the viewer opens on it with the model\u2019s link ready. If it does not load by itself, press Load.'
		: 'Meta\u2019s \u201cOpen in VR\u201d page opened in a new tab. Pick your headset there to open the viewer on it.');
}

XRExperience.supported().then((s) => { xrSupport = s; xrChecked = true; updateXRButtons(); });

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

$('open-file').addEventListener('click', () => $('file-input').click());
$('open-dropbox').addEventListener('click', openFromDropbox);
setupDropbox();
$('file-input').addEventListener('change', async (ev) => {
	const picked = [...ev.target.files];
	ev.target.value = '';
	if (!picked.length) return;
	// Read every file straight away; never make a blob URL from a picked File
	// (Quest Browser can then fail with ERR_ACCESS_DENIED).
	let files;
	try {
		files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
	} catch (e) {
		setStatus('Quest Browser blocked this file type. Rename it to .zip and try again', true);
		return;
	}
	load(files, picked.length === 1 ? picked[0].name : `${picked.length} files`, { type: 'file' }).catch(() => {});
});

// A small two-storey house made for this viewer (scripts/make-example.js).
$('open-example').addEventListener('click', () => loadUrl('examples/example-home.sh3d', { remember: false }).catch(() => {}));
$('open-link').addEventListener('click', () => {
	const url = $('link-input').value;
	if (url.trim()) loadUrl(url).catch(() => {});
});
$('time').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.value; if (v) lighting.setTime(v); });
$('shadows').addEventListener('change', (e) => lighting.setShadows(e.target.checked));
$('depth').addEventListener('change', (e) => depth.setEnabled(e.target.checked));
$('link-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('open-link').click(); });
$('link-input').addEventListener('input', () => { const n = $('send-note'); if (n) n.textContent = sendable().note; });
$('units').value = CONFIG.defaultObjUnits;
$('link-input').value = getLastLink();
renderRecents();

// ---------------------------------------------------------------------------
// Welcome: three steps with arrows over the empty view, until a model is open
// ---------------------------------------------------------------------------

/**
 * Places the two welcome notes by what they point at: 1 the files card, 2
 * the display card. Three layouts:
 *   below  (preferred) each note sits under its card, with an arrow up to it
 *   side   a card is too tall to leave room beneath it: the notes go between
 *          the cards instead, level with the Open file button and the options
 *   stack  cards stacked (narrow windows): both notes in the gap between them
 */
function layoutWelcome() {
	const w = $('welcome');
	const show = !current && loading === 0;
	w.hidden = !show;
	if (!show) return;
	const p = $('panel').getBoundingClientRect(), v = $('view').getBoundingClientRect();
	const [one, two] = w.querySelectorAll('.step'), note = w.querySelector('.note');
	w.querySelector('.drop').hidden = !CAN_DROP; // "Drop a file here to start": computers only
	const H = window.innerHeight, strip = v.left - p.right;
	const place = (el, left, top, width) => Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
	note.hidden = false;

	if (v.top > p.bottom) {
		// Stacked: the gap between the files card (top) and the display card (bottom).
		w.dataset.layout = 'stack';
		const top = p.bottom + 8, height = v.top - 8 - top;
		for (const el of [one, two, note]) Object.assign(el.style, { left: '', top: '', width: '' });
		Object.assign(w.style, { left: '0px', top: `${top}px`, width: '100%', height: `${Math.max(0, height)}px` });
		w.hidden = height < 60 || w.scrollHeight > height + 1; // no room: better nothing than cut-off notes
		return;
	}
	Object.assign(w.style, { left: '0px', top: '0px', width: '100%', height: `${H}px` });

	// Preferred: each note under its card.
	w.dataset.layout = 'below';
	place(one, p.left, p.bottom + 12, p.width);
	place(two, v.left, v.bottom + 12, v.width);
	let bottom = Math.max(p.bottom + 12 + one.offsetHeight, v.bottom + 12 + two.offsetHeight);
	// The centre lines: in the middle of the space left below the notes.
	const centred = (from) => Math.max(from + 26, (from + H - note.offsetHeight) / 2);
	place(note, 0, 0, window.innerWidth);
	note.style.top = `${centred(bottom)}px`;

	if (bottom > H - 6 && strip >= 240) {
		// No room under a card (a long Recent list, a short window): between the cards.
		w.dataset.layout = 'side';
		const width = Math.min(strip, 350);
		one.style.width = two.style.width = `${width}px`; // (set first: their heights depend on it)
		const centre = (el) => { const r = el.getBoundingClientRect(); return r.height ? (r.top + r.bottom) / 2 : 0; };
		const top1 = Math.max(4, (centre($('open-file')) || centre($('collapse'))) - one.offsetHeight / 2);
		// Note 2 points at the middle of the options; if the strip is too narrow
		// for the notes to pass each other, it moves down below note 1.
		const options = ($('time').getBoundingClientRect().top + document.querySelector('#view .switches').getBoundingClientRect().bottom) / 2;
		let top2 = Math.max(4, options - two.offsetHeight / 2);
		if (strip < 2 * width) top2 = Math.max(top2, top1 + one.offsetHeight + 10);
		place(one, p.right, top1, width);
		place(two, v.left - width, top2, width);
		bottom = Math.max(top1 + one.offsetHeight, top2 + two.offsetHeight);
		place(note, p.right, 0, strip);
		note.style.top = `${centred(bottom)}px`;
	}
	note.hidden = note.offsetTop + note.offsetHeight > H - 6; // (the last line goes first when space runs out)
	w.hidden = bottom > H - 6; // a very short window: no room at all
}
/** True where files can be dragged in with a mouse: computers, not headsets or phones. */
const CAN_DROP = !/OculusBrowser|\bQuest\b/i.test(navigator.userAgent) && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let welcomeQueued = false;
/** Lays the welcome out after the page has settled (several changes in one frame cost one layout). */
function layoutWelcomeSoon() {
	if (welcomeQueued) return;
	welcomeQueued = true;
	requestAnimationFrame(() => { welcomeQueued = false; layoutWelcome(); });
}
window.addEventListener('resize', layoutWelcomeSoon);
document.fonts?.ready.then(layoutWelcomeSoon); // the notes change size when their font arrives
if ('ResizeObserver' in window) { const ro = new ResizeObserver(layoutWelcomeSoon); ro.observe($('panel')); ro.observe($('view')); }

function setCollapsed(c) {
	$('panel').classList.toggle('collapsed', c);
	$('collapse').textContent = c ? '+' : '–';
	$('collapse').setAttribute('aria-expanded', String(!c));
	$('collapse').title = c ? 'Show this panel' : 'Hide this panel';
}
$('collapse').addEventListener('click', () => setCollapsed(!$('panel').classList.contains('collapsed')));

// Narrow windows put the display card at the bottom: the files card and the
// model details stop above it, whatever its height.
const viewHeight = () => document.documentElement.style.setProperty('--view-h', `${$('view').offsetHeight}px`);
if ('ResizeObserver' in window) new ResizeObserver(viewHeight).observe($('view'));
viewHeight();

// Dropping files anywhere on the page opens them (computers). While files are
// dragged over the window a "Drop to open" frame shows; a dragged link goes
// into the link box instead and waits for Load.
const draggingFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragover', (e) => {
	e.preventDefault(); // (also stops the browser from navigating to a dropped file)
	if (draggingFiles(e)) { e.dataTransfer.dropEffect = 'copy'; $('dropzone').hidden = false; }
});
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('dropzone').hidden = true; }); // left the window
window.addEventListener('drop', async (e) => {
	e.preventDefault();
	$('dropzone').hidden = true;
	const picked = [...(e.dataTransfer?.files || [])];
	if (!picked.length) {
		const dropped = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '').split('\n')[0].trim();
		if (/^https?:\/\//i.test(dropped)) {
			setCollapsed(false);
			$('link-input').value = dropped;
			$('open-link').classList.add('primary');
			setStatus('Link dropped. Press Load to open it.');
		}
		return;
	}
	const files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))).catch(() => null);
	if (!files) { setStatus('Those files could not be read.', true); return; }
	load(files, picked.length === 1 ? picked[0].name : `${picked.length} files`, { type: 'file' }).catch(() => {});
});

// Offline use and clean updates (sw.js). Only on the real site (https), or
// with ?sw while developing, so local tests always see the files on disk.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || new URLSearchParams(location.search).has('sw'))) {
	const firstVisit = !navigator.serviceWorker.controller;
	navigator.serviceWorker.register('./sw.js').then(async () => {
		const reg = await navigator.serviceWorker.ready;
		// On the first visit the page loaded before the worker existed: tell it
		// which files were used (and the example home), so they work offline.
		if (firstVisit) {
			const used = performance.getEntriesByType('resource').map((r) => r.name);
			reg.active?.postMessage({ cache: [location.href, new URL('examples/example-home.sh3d', location.href).href, ...used] });
		}
	}).catch((e) => console.warn('Offline support is not available', e));
}

// ?pair=<name>: this page was opened by Send to my Quest on a computer, which
// is waiting to send a model directly. Nothing connects until Receive is
// pressed: like a ?model= link from another site, it could have been put in
// the address by anyone.
{
	const pair = new URLSearchParams(location.search).get('pair');
	if (isPairId(pair)) {
		setCollapsed(false);
		$('pair-box').hidden = false;
		$('pair-receive').addEventListener('click', () => {
			$('pair-receive').hidden = true;
			$('pair-stop').hidden = false;
			// Out of the address bar, so a reload or a bookmark does not try again.
			const clean = new URL(location.href);
			clean.searchParams.delete('pair');
			history.replaceState(null, '', clean);
			joiner = new Joiner({
				maxBytes: CONFIG.maxDownloadMB * 1048576,
				onState: ({ phase, text }) => {
					$('pair-text').textContent = text;
					if (phase === 'closed' || phase === 'error') $('pair-stop').hidden = true;
				},
				onModel: (files, name) => {
					if (renderer.xr.isPresenting) {
						pendingModel = { files, name };
						$('pair-text').textContent = `Received \u201c${name}\u201d: it opens when you leave VR.`;
						return;
					}
					load(files, name, { type: 'sent' }).catch(() => {});
				},
			});
			joiner.join(pair);
		});
		$('pair-stop').addEventListener('click', () => joiner?.close());
	}
}

// ?model=<url> opens a model straight away (also used by the screenshot tests).
const params = new URLSearchParams(location.search);
const initial = params.get('model');
let ready = Promise.resolve(true);
if (initial) {
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

// Test hooks for scripts/screenshots.js
window.__casawalk = {
	lighting,
	get sharer() { return sharer; },
	get joiner() { return joiner; },
	depth,
	ready,
	invalidate,
	frame: (view) => { frame(view); controls.update(); renderer.render(scene, camera); },
	look: (pos, target) => { camera.position.set(...pos); controls.target.set(...target); controls.update(); renderer.render(scene, camera); },
	stats: () => ({ ...(current?.stats || {}), ...sceneStats(current?.root || new THREE.Group()), merged: current?.merged }),
	decoders: checkDecoders,
	scene,
	xr,
	renderer,
	get current() { return current; },
};

