// Opens a model in the real page (headless Chromium, software rendering) and
// measures the whole load: how long until it is shown, the page's JavaScript
// memory, the first draws (the first one sends the geometry to the GPU), and
// whether the tab survives. For the heavy-models investigation. Run with
// Node 24:
//   node scripts/measure-browser.js test-output/stress/many-1m.sh3d
//   HEAP_MB=1024 node scripts/measure-browser.js test-output/stress/warehouse.sh3d
// HEAP_MB caps the page's JavaScript heap, to see where a smaller device
// would give up (the Quest's tab limit is not published; this is a stand-in).
// Prints one JSON line.

import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const file = process.argv[2];
const PORT = Number(process.env.PORT) || 8143;
const server = await startServer(PORT);
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'];
if (process.env.HEAP_MB) args.push(`--js-flags=--max-old-space-size=${process.env.HEAP_MB}`);
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const out = { file: path.basename(file), heapCapMB: Number(process.env.HEAP_MB) || null };
let crashed = false;
page.on('crash', () => { crashed = true; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

try {
	const t0 = Date.now();
	await page.goto(`http://localhost:${PORT}/?test&model=${encodeURIComponent(file)}`, { timeout: 60000 });
	// Sample the page's JS memory while it loads (it can only answer between the load's long steps).
	let peakMB = 0;
	const watch = setInterval(async () => {
		try { const m = await page.evaluate(() => performance.memory.usedJSHeapSize); peakMB = Math.max(peakMB, Math.round(m / 1048576)); } catch {}
	}, 250);
	const ok = await page.evaluate(() => window.__casawalk.ready).catch((e) => { throw new Error(crashed ? 'the tab crashed' : e.message); });
	clearInterval(watch);
	out.loadS = +((Date.now() - t0) / 1000).toFixed(1);
	out.ok = ok;
	Object.assign(out, await page.evaluate(() => {
		const S = window.__casawalk, m = performance.memory;
		return { status: document.getElementById('status').textContent.slice(0, 160), stats: S.stats(), heapMB: Math.round(m.usedJSHeapSize / 1048576), heapLimitMB: Math.round(m.jsHeapSizeLimit / 1048576) };
	}));
	out.peakHeapSampledMB = Math.max(peakMB, out.heapMB);
	// The first draws: the first may still send geometry to the GPU; the second is the plain draw.
	out.drawsMs = await page.evaluate(() => {
		const S = window.__casawalk, gl = S.renderer.getContext(), ms = [];
		for (let i = 0; i < 3; i++) { const t = performance.now(); S.frame('se'); gl.finish(); ms.push(Math.round(performance.now() - t)); }
		return ms;
	});
	out.gpu = await page.evaluate(() => { const i = window.__casawalk.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries }; });
} catch (e) {
	out.ok = false;
	out.error = crashed ? 'the tab crashed' : e.message.slice(0, 200);
}
out.crashed = crashed;
if (errors.length) out.pageErrors = errors.slice(0, 3);
console.log(JSON.stringify(out));
await browser.close().catch(() => {});
server.close();
