// Recent models, kept in the browser's IndexedDB so reopening one is a
// single tap (and works offline). Also remembers the last pasted link, and
// keeps the photos taken in VR until they are saved (the Quest Browser's
// download prompt would end the VR session, so nothing is downloaded in VR).
//
// Each recent: { id, name, date, size, source, files: [{ name, bytes }] }
//   source: { type: 'link', url } | { type: 'file' } | { type: 'dropbox', url }
// Each photo: { id, name, date, size, blob (JPEG), saved (true once saved to Downloads) }
//
// Every call is wrapped so private windows or blocked storage just mean
// "no recents" instead of breaking the app.

const DB_NAME = 'sweet-home-vr';
const STORE = 'recent';
const PHOTOS = 'photos';
const MAX_RECENTS = 5;
export const MAX_PHOTOS = 50; // the oldest photo makes room for a new one
const LAST_LINK_KEY = 'svr.lastLink';

let dbPromise = null;

function openDb() {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB unavailable')); return; }
		// Version 2 added the photos; recent models carry over.
		const req = indexedDB.open(DB_NAME, 2);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: 'id' });
		};
		req.onblocked = () => console.warn('Storage upgrade waits for another tab of this site to close');
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	// Ask the browser not to evict our data under storage pressure.
	navigator.storage?.persist?.().catch(() => {});
	return dbPromise;
}

function tx(mode, fn, storeName = STORE) {
	return openDb().then((db) => new Promise((resolve, reject) => {
		const t = db.transaction(storeName, mode);
		const store = t.objectStore(storeName);
		let result;
		Promise.resolve(fn(store)).then((r) => { result = r; });
		t.oncomplete = () => resolve(result);
		t.onerror = () => reject(t.error);
		t.onabort = () => reject(t.error);
	}));
}

const req2promise = (req) => new Promise((resolve, reject) => {
	req.onsuccess = () => resolve(req.result);
	req.onerror = () => reject(req.error);
});

/** Recent models without their bytes, newest first. */
export async function listRecents() {
	try {
		const all = await tx('readonly', (s) => req2promise(s.getAll()));
		return all.sort((a, b) => b.date - a.date).map(({ files, ...meta }) => meta);
	} catch (e) {
		console.warn('Recents unavailable', e);
		return [];
	}
}

/** One recent model with its bytes, or null. */
export async function getRecent(id) {
	try { return (await tx('readonly', (s) => req2promise(s.get(id)))) || null; } catch { return null; }
}

/**
 * Saves a model as the newest recent. An entry with the same link (or, for
 * picked files, the same name) is replaced. Keeps the newest MAX_RECENTS.
 */
export async function addRecent({ name, files, source }) {
	try {
		const size = files.reduce((n, f) => n + f.bytes.byteLength, 0);
		const all = await tx('readonly', (s) => req2promise(s.getAll()));
		const same = all.find((r) => (source.url && r.source.url === source.url) || (!source.url && !r.source.url && r.name === name));
		const id = same ? same.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const record = { id, name, date: Date.now(), size, source, files };
		const keep = [record, ...all.filter((r) => r.id !== id).sort((a, b) => b.date - a.date)];
		await tx('readwrite', (s) => {
			s.put(record);
			for (const old of keep.slice(MAX_RECENTS)) s.delete(old.id);
		});
		return id;
	} catch (e) {
		// Most likely out of quota: the model still opened, it just isn't cached.
		console.warn('Could not save recent', e);
		return null;
	}
}

export async function removeRecent(id) {
	try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Photos taken in VR
// ---------------------------------------------------------------------------

/**
 * Keeps a photo (a JPEG Blob) as the newest; keeps the newest MAX_PHOTOS.
 * Returns { id, dropped (how many old photos made room) }, or null if it
 * could not be kept (storage full or unavailable).
 */
export async function addPhoto(blob, name) {
	try {
		const all = await tx('readonly', (s) => req2promise(s.getAllKeys()), PHOTOS);
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; // (ids sort by date)
		const old = all.sort().slice(0, Math.max(0, all.length + 1 - MAX_PHOTOS));
		await tx('readwrite', (s) => {
			s.put({ id, name, date: Date.now(), size: blob.size, blob, saved: false });
			for (const k of old) s.delete(k);
		}, PHOTOS);
		return { id, dropped: old.length };
	} catch (e) {
		console.warn('Could not keep the photo', e);
		return null;
	}
}

/** The kept photos, newest first, without their pictures: { id, name, date, size, saved }. */
export async function listPhotos() {
	try {
		const all = await tx('readonly', (s) => req2promise(s.getAll()), PHOTOS);
		return all.sort((a, b) => b.date - a.date).map(({ blob, ...meta }) => meta);
	} catch {
		return [];
	}
}

/** One photo with its picture, or null. */
export async function getPhoto(id) {
	try { return (await tx('readonly', (s) => req2promise(s.get(id)), PHOTOS)) || null; } catch { return null; }
}

/** Marks a photo as saved to Downloads. */
export async function markPhotoSaved(id) {
	try {
		await tx('readwrite', async (s) => {
			const p = await req2promise(s.get(id));
			if (p) s.put({ ...p, saved: true });
		}, PHOTOS);
	} catch { /* ignore */ }
}

export async function removePhoto(id) {
	try { await tx('readwrite', (s) => s.delete(id), PHOTOS); } catch { /* ignore */ }
}

export function getLastLink() {
	try { return localStorage.getItem(LAST_LINK_KEY) || ''; } catch { return ''; }
}

export function setLastLink(url) {
	try { localStorage.setItem(LAST_LINK_KEY, url); } catch { /* ignore */ }
}
