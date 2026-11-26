// What each home costs to draw after merging (code audit, A3): draw calls and
// triangles against CONFIG.budget. The example and sample homes must fit. The
// heavy test home (examples/heavy-home.sh3d, scripts/make-heavy-home.js) is
// measured every run and its numbers printed; it is over budget today, so its
// check is a "todo" (reported, not failing) until the draw-call work of stage
// B3 brings it under. Remove the todo then.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { openFiles } from '../js/formats.js';
import { optimiseModel, modelStats } from '../js/optimise.js';
import { CONFIG } from '../config.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Opens a .sh3d exactly as the app does (js/formats.js openFiles: the models'
 * own colours, Sweet Home 3D's built-in materials and see-through window
 * panes), merges it, and measures it.
 */
async function measure(file) {
	const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, file)));
	const entries = unzipSync(bytes);
	const built = await openFiles([{ name: path.basename(file), bytes }], {
		// (Node decodes no images: a stand-in texture per image, so materials that differ only by their image stay apart, as in the app.)
		makeTexture: (ref) => Object.assign(new THREE.Texture(), { name: ref }),
	});
	const { group } = optimiseModel(built.root);
	built.store.dispose();
	return { ...modelStats(group), storeys: built.storeys, missing: built.stats.missingModels, textures: textureMemory(entries) };
}

/**
 * The textures the home uses and an estimate of their graphics memory: each
 * image as the app keeps it (shrunk to CONFIG.maxTextureSize on its longer
 * side), 4 bytes a pixel, plus a third for its smaller copies (mipmaps).
 * Reads the size from the PNG or JPEG header (Node decodes no images).
 */
function textureMemory(entries) {
	const xml = new TextDecoder().decode(entries['Home.xml']);
	const images = new Set([...xml.matchAll(/<texture\b[^>]*\bimage='([^']+)'/g)].map((m) => m[1]));
	let bytes = 0;
	for (const name of images) {
		const b = entries[name];
		let w = 0, h = 0;
		if (b?.[0] === 0x89) { const v = new DataView(b.buffer, b.byteOffset); w = v.getUint32(16); h = v.getUint32(20); }
		else if (b?.[0] === 0xff) { for (let i = 2; i < b.length - 8;) { const len = (b[i + 2] << 8) | b[i + 3]; if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc3) { h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8]; break; } i += 2 + len; } }
		const k = Math.min(1, CONFIG.maxTextureSize / Math.max(w, h, 1));
		bytes += Math.round(w * k) * Math.round(h * k) * 4 * 4 / 3;
	}
	return { count: images.size, mb: Math.round(bytes / 1048576) };
}

// (The heavy home takes a few seconds to build: measured once, shared by its two tests.)
let heavy = null;
const measureHeavy = () => (heavy ??= measure('examples/heavy-home.sh3d'));

const fits = (s) => s.drawCalls <= CONFIG.budget.drawCalls && s.triangles <= CONFIG.budget.triangles;
const line = (s) => `${s.drawCalls} draw calls (budget ${CONFIG.budget.drawCalls}), ${s.triangles.toLocaleString('en-GB')} triangles (budget ${CONFIG.budget.triangles.toLocaleString('en-GB')}), ${s.textures.count} textures (about ${s.textures.mb} MB of graphics memory)`;

for (const file of ['examples/example-home.sh3d', 'examples/pond-house.sh3d', 'examples/apartment.sh3d']) {
	test(`${path.basename(file)} fits the Quest 2 budget`, async (t) => {
		const s = await measure(file);
		t.diagnostic(line(s));
		assert.equal(s.missing, 0);
		assert.ok(fits(s), line(s));
	});
}

test('the heavy test home: three storeys, about a million triangles, six textures, every model read', async (t) => {
	const s = await measureHeavy();
	t.diagnostic(line(s));
	assert.equal(s.storeys, 3);
	assert.equal(s.textures.count, 6);
	// (Stage B3, plain colours folded into vertex colours, took it from 193 draw calls to 34.)
	assert.ok(s.drawCalls <= 40, `${s.drawCalls} draw calls: more than B3's 40`);
	assert.equal(s.missing, 0);
	assert.ok(s.triangles > 900_000 && s.triangles <= CONFIG.budget.triangles, `${s.triangles} triangles`);
});

test('the heavy test home fits the Quest 2 budget (since stage B3: plain colours folded into vertex colours)', async (t) => {
	const s = await measureHeavy();
	t.diagnostic(line(s));
	assert.ok(fits(s), line(s));
});

test('the ?stats counter: only with ?stats; fps, draw calls and triangles in one short line', async () => {
	const { statsText } = await import('../js/frame-stats.js');
	assert.equal(statsText(36, 0.5, { calls: 142, triangles: 1_934_000 }), '72 fps · 142 draw calls · 1.93M triangles (both eyes)');
	assert.equal(statsText(30, 0.5, { calls: 60, triangles: 41_200 }), '60 fps · 60 draw calls · 41k triangles (both eyes)');
});

test('one place for the development switches and the device (code audit, A4)', async () => {
	const { devFlags } = await import('../js/dev.js');
	const { isHeadsetBrowser, isQuest2 } = await import('../js/device.js');
	assert.deepEqual(devFlags('?test&model=examples/heavy-home.sh3d&stats'), { test: true, hands: false, stats: true, nomerge: false, nofold: false, sw: false, worker: false, tips: false });
	assert.equal(devFlags('?tips').tips, true, '?tips: a pause on every move, every tip');
	assert.equal(devFlags('?worker').worker, true, '?worker: OBJ models read in a worker');
	assert.deepEqual(devFlags(''), { test: false, hands: false, stats: false, nomerge: false, nofold: false, sw: false, worker: false, tips: false });
	const q2 = 'Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0 Chrome/132 VR Safari/537.36';
	const q3 = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0 Chrome/132 VR Safari/537.36';
	const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132 Safari/537.36';
	assert.ok(isHeadsetBrowser(q2) && isHeadsetBrowser(q3) && !isHeadsetBrowser(mac));
	assert.ok(isQuest2(q2) && !isQuest2(q3) && !isQuest2(mac));
	// Nothing else reads the address's switches or the browser's name.
	const js = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true }).filter((f) => f.endsWith('.js') && f !== 'dev.js' && f !== 'device.js'); // (js/page/ too)
	assert.ok(js.some((f) => f.startsWith('page')), 'the page\'s parts are read too');
	for (const f of js) {
		const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
		assert.ok(!/\.has\('(test|hands|stats|nomerge|sw|tips)'\)/.test(src), `${f} reads a development switch itself`);
		assert.ok(!/userAgent/.test(src), `${f} reads the browser's name itself`);
	}
});
