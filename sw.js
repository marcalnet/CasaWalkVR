// Service worker: offline use and clean updates. No build step and no file
// list to maintain.
//
// - Online: every app file is fetched from the network and revalidated with
//   the server ("no-cache"), so after an update you never get a mix of old
//   and new files (GitHub Pages lets browsers reuse files for 10 minutes).
// - Offline, or when the network does not answer within a few seconds: the
//   last good copy is served from the cache, so the viewer still opens and
//   Recent models (kept in IndexedDB) still load.
//
// Only this site's own app files are handled: pages, scripts, the font, the
// compressed-glTF decoder (WebAssembly), the interface artwork (assets/) and
// the example home. Model downloads
// and everything on other sites are left alone.

const CACHE = 'sweet-home-vr-v1';
const SCOPE = new URL('./', self.location.href); // the folder this file is served from
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const name of await caches.keys()) {
			if (name.startsWith('sweet-home-vr-') && name !== CACHE) await caches.delete(name);
		}
		await self.clients.claim();
	})());
});

/** The cache key for an app file, or null for anything this worker leaves alone. */
function appKey(href) {
	let url;
	try { url = new URL(href); } catch { return null; }
	if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return null;
	const path = url.pathname.slice(SCOPE.pathname.length);
	const isApp = path === '' || path === 'index.html' || path === 'examples/example-home.sh3d' || /^(js|vendor)\/.+\.js$/.test(path) || /^vendor\/.+\.(woff2|wasm)$/.test(path) || /^assets\/.+\.(png|webp|jpg)$/.test(path) || path === 'config.js';
	return isApp ? url.origin + url.pathname : null; // the ?query is ignored
}

async function fresh(key) {
	const res = await fetch(key, { cache: 'no-cache', credentials: 'same-origin' });
	// Only complete, successful answers replace the stored copy.
	if (res.ok && res.status === 200) (await caches.open(CACHE)).put(key, res.clone());
	return res;
}

async function networkFirst(key) {
	const stored = await (await caches.open(CACHE)).match(key);
	const network = fresh(key);
	if (!stored) return network; // nothing to fall back on: wait for the network
	network.catch(() => {}); // (handled by the race below)
	const slow = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS));
	const res = await Promise.race([network.catch(() => null), slow]);
	return res && res.ok ? res : stored;
}

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const key = appKey(event.request.url);
	if (key) event.respondWith(networkFirst(key));
});

// First visit: the page loaded before this worker was in charge, so it sends
// the list of files it used and they are stored for offline use.
self.addEventListener('message', (event) => {
	const urls = Array.isArray(event.data?.cache) ? event.data.cache : [];
	const keys = [...new Set(urls.map(appKey).filter(Boolean))].slice(0, 200);
	event.waitUntil(Promise.all(keys.map((k) => fresh(k).catch(() => {}))));
});
