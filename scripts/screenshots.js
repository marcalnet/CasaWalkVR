// Loads each fixture in the 2D preview with headless Chromium and saves
// screenshots from several angles into test-output/.
//   npm run shots              all fixtures
//   npm run shots -- example   only fixtures whose name contains "example"

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.js';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'test-output');
const filter = process.argv[2] || '';
const VIEWS = (process.env.VIEWS || 'top,se,sw,ne,nw').split(',');

const fixtures = [];
for (const dir of ['examples', 'tests/fixtures', 'tests/fixtures/private']) {
	const abs = path.join(root, dir);
	if (!fs.existsSync(abs)) continue;
	for (const f of fs.readdirSync(abs)) if (/\.(sh3d|zip|obj|glb)$/i.test(f) && f.includes(filter)) fixtures.push(`${dir}/${f}`);
}

fs.mkdirSync(outDir, { recursive: true });
const port = 8124;
const server = await startServer(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

// The compressed-glTF decoders (Draco, meshopt, KTX2) must start under the
// page's real security policy: WebAssembly, and workers built from blob: URLs.
let failed = false;
if (!filter) {
	await page.goto(`http://localhost:${port}/?test`);
	const dec = await page.evaluate(() => window.__casawalk.decoders());
	const ok = Object.values(dec).every((v) => v === true);
	console.log(`• compressed glTF decoders: ${ok ? 'all start' : 'FAILED'}`, JSON.stringify(dec));
	failed ||= !ok;
}

for (const fx of fixtures) {
	const name = path.basename(fx).replace(/\.[^.]+$/, '');
	console.log(`• ${fx}`);
	const t0 = Date.now();
	await page.goto(`http://localhost:${port}/?test&model=${encodeURIComponent(fx)}`);
	const ok = await page.evaluate(() => window.__casawalk.ready);
	if (!ok) { console.log('  FAILED to load:', await page.textContent('#status')); continue; }
	// Let textures decode.
	await page.waitForTimeout(1500);
	console.log(`  loaded in ${Date.now() - t0} ms`, JSON.stringify(await page.evaluate(() => window.__casawalk.stats())));
	await page.evaluate(() => { document.getElementById('panel').classList.add('collapsed'); document.getElementById('view').hidden = true; });
	for (const v of VIEWS) {
		await page.evaluate((view) => window.__casawalk.frame(view), v);
		await page.waitForTimeout(200);
		await page.screenshot({ path: path.join(outDir, `${name}-${v}.png`) });
	}
}

await browser.close();
server.close();
console.log(`Screenshots in ${path.relative(process.cwd(), outDir)}/`);
if (failed) process.exitCode = 1;
