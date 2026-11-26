// The page's files card (split from js/main.js, stage B2): Open file, the
// sample homes, the link box, Recent, and the photos taken in VR (kept in
// js/storage.js until saved to Downloads). Browser-only: it builds the card's
// rows from storage, always as text (names come from outside), never as HTML.
//
// js/main.js calls initPhotos() and initFilesCard() where it always set them
// up, and passes the page's shared parts (page: setStatus, load, loadUrl, and
// sendable for the link box's note).

import { CONFIG } from '../../config.js';
import { listRecents, getRecent, removeRecent, getLastLink, listPhotos, getPhoto, removePhoto, markPhotoSaved } from '../storage.js';
import { saveFile } from '../photo.js';
import { SAMPLES } from '../samples.js';

const $ = (id) => document.getElementById(id);
let page = null; // { setStatus, load, loadUrl, sendable }

/** "just now", "5 min ago", "3 h ago", or a short date. */
export function ago(date) {
	const s = (Date.now() - date) / 1000;
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Recent models
// ---------------------------------------------------------------------------

export async function renderRecents() {
	const list = $('recent');
	const items = await listRecents();
	$('recent-section').hidden = items.length === 0;
	list.replaceChildren(...items.map((r) => {
		const li = document.createElement('li');
		if (r.source.type === 'link') li.className = 'with-refresh';
		const open = document.createElement('button');
		open.className = 'recent-open';
		const mb = (r.size / 1048576).toFixed(r.size < 10485760 ? 1 : 0);
		const kind = { link: 'Link', dropbox: 'Dropbox', file: 'File', sent: 'From computer' }[r.source.type] || 'File'; // (dropbox: models opened with the Dropbox Chooser, removed in Nov 2026, may still be under Recent)
		const span = (cls, text) => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
		open.title = `${r.name}: ${kind.toLowerCase()}, ${mb} MB, ${ago(r.date)}. Opens the saved copy.`;
		open.append(span('recent-name', r.name), span('recent-meta', ago(r.date)));
		open.addEventListener('click', async () => {
			const rec = await getRecent(r.id);
			if (!rec) { page.setStatus('That saved copy is no longer available.', true); renderRecents(); return; }
			page.load(rec.files, rec.name, { type: 'recent', url: rec.source.url, id: r.id }).catch(() => {});
		});
		li.append(open);
		if (r.source.type === 'link') {
			const refresh = document.createElement('button');
			refresh.className = 'recent-icon';
			refresh.textContent = '↻';
			refresh.title = 'Download the latest version from the same link';
			refresh.setAttribute('aria-label', `Update ${r.name} from its link`);
			refresh.addEventListener('click', () => page.loadUrl(r.source.url).catch(() => {}));
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

export async function renderPhotos() {
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

/** The photos' Save all key, and the photos kept so far. */
export function initPhotos(ctx) {
	page = ctx;
	$('photos-save').addEventListener('click', async () => {
		const unsaved = (await listPhotos()).filter((p) => !p.saved).reverse(); // oldest first
		for (const [i, p] of unsaved.entries()) {
			await savePhoto(p.id);
			if (i < unsaved.length - 1) await new Promise((r) => setTimeout(r, 400)); // (one at a time)
		}
		page.setStatus(unsaved.length === 1 ? 'Photo saved to Downloads.' : `${unsaved.length} photos saved to Downloads.`);
		renderPhotos();
	});
	renderPhotos();
}

/**
 * Open file, the sample homes, the link box and Recent. (The display card's
 * options, time of day and the switches, stay with js/main.js: they belong to
 * the view.)
 */
export function initFilesCard(ctx) {
	page = ctx;
	$('open-file').addEventListener('click', () => $('file-input').click());
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
			page.setStatus('Quest Browser blocked this file type. Rename it to .zip and try again', true);
			return;
		}
		page.load(files, picked.length === 1 ? picked[0].name : `${picked.length} files`, { type: 'file' }).catch(() => {});
	});

	// The sample homes (js/samples.js): a chooser of cards, one tap opens one.
	// (examples/example-home.sh3d stays as the tests' small fixture.)
	for (const s of SAMPLES) {
		const b = document.createElement('button');
		b.className = 'sample';
		b.dataset.sample = s.id;
		const img = document.createElement('img');
		img.src = s.picture;
		img.alt = '';
		img.loading = 'lazy';
		const text = document.createElement('div');
		const name = document.createElement('b'), line = document.createElement('span'), size = document.createElement('span');
		name.textContent = s.name;
		line.textContent = s.line;
		size.textContent = s.credit ? `${s.credit} · ${s.size}` : s.size;
		text.append(name, line, size);
		b.append(img, text);
		b.addEventListener('click', () => {
			$('samples').hidden = true;
			$('open-sample').setAttribute('aria-expanded', 'false');
			page.loadUrl(s.file, { remember: false }).catch(() => {});
		});
		$('samples').append(b);
	}
	$('open-sample').addEventListener('click', () => {
		const open = $('samples').hidden;
		$('samples').hidden = !open;
		$('open-sample').setAttribute('aria-expanded', String(open));
	});
	$('open-link').addEventListener('click', () => {
		const url = $('link-input').value;
		if (url.trim()) page.loadUrl(url).catch(() => {});
	});
	return {
		/** The link box (after the display card's options are wired, as before the split). */
		wireLinkBox() {
			$('link-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('open-link').click(); });
			$('link-input').addEventListener('input', () => { const n = $('send-note'); if (n) n.textContent = page.sendable().note; });
			$('units').value = CONFIG.defaultObjUnits;
			$('link-input').value = getLastLink();
			renderRecents();
		},
	};
}
