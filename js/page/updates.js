// Which build is running, and offline use (split from js/main.js, stage B2).
// Browser-only.

import { BUILD } from '../version.js';
import { buildLabel, buildNumberIn } from '../build-label.js';
import { DEV } from '../dev.js';
import { SAMPLES } from '../samples.js';

const $ = (id) => document.getElementById(id);

/**
 * Which build is running, bottom left (js/version.js, stamped before each push),
 * and a Reload button when the site has a newer one than this page (a cached
 * copy): asked for on load and whenever the page comes back into view. xr:
 * told the newer build's number (Help in the headset says so too).
 */
export function initBuildLabel(xr) {
	const el = $('build');
	el.textContent = buildLabel(BUILD);
	el.title = 'The build of CasaWalk this page is running';
	const check = async () => {
		try {
			const text = await (await fetch('js/version.js', { cache: 'no-store' })).text();
			const live = buildNumberIn(text);
			if (live === null || live <= BUILD.number || el.querySelector('button')) return;
			xr.newerBuild = live; // (Help in the headset says so too: never a reload by itself)
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = 'A newer version is available · Reload';
			b.addEventListener('click', () => location.reload());
			el.append(b);
		} catch { /* offline: nothing to say */ }
	};
	check();
	document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}

/**
 * Offline use and clean updates (sw.js). Only on the real site (https), or
 * with ?sw while developing, so local tests always see the files on disk.
 */
export function registerOffline() {
	if (!('serviceWorker' in navigator && (location.protocol === 'https:' || DEV.sw))) return;
	const firstVisit = !navigator.serviceWorker.controller;
	navigator.serviceWorker.register('./sw.js').then(async () => {
		const reg = await navigator.serviceWorker.ready;
		// On the first visit the page loaded before the worker existed: tell it
		// which files were used (and the example home), so they work offline.
		if (firstVisit) {
			const used = performance.getEntriesByType('resource').map((r) => r.name);
			reg.active?.postMessage({ cache: [location.href, ...['examples/example-home.sh3d', ...SAMPLES.flatMap((s) => [s.file, s.picture])].map((f) => new URL(f, location.href).href), ...used] });
		}
	}).catch((e) => console.warn('Offline support is not available', e));
}
