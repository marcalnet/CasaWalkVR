// Safety checks: what a model file or a link is allowed to make the app do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import zlib from 'node:zlib';
import { EntryStore, UserError, openFiles, WHITE_PIXEL } from '../js/formats.js';
import { parseXml, parseHome } from '../js/sh3d.js';
import { checkLink, directLink, fileNameOf, sendToQuestUrl } from '../js/links.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('links inside a model to other servers are never fetched', () => {
	const store = new EntryStore(new Map([['tex/wood.png', new Uint8Array([0x89, 0x50, 1, 2])]]));
	const resolve = (u) => store.manager.resolveURL(u);
	for (const u of ['https://tracker.example/pixel.png', 'http://192.168.1.1/admin', '//evil.example/x.bin', 'file:///etc/passwd', 'ftp://x/y', 'javascript:alert(1)', '/absolute/on/this/site.png', 'relative.png']) {
		assert.ok(resolve(u).startsWith('data:image/png'), `${u} must be replaced by the placeholder`);
	}
	assert.equal(store.blockedLinks(), 8);
	// The file's own content still works.
	assert.ok(resolve('mem:tex/wood.png').startsWith('blob:'));
	assert.ok(resolve('mem:missing.png').startsWith('data:image/png'));
	assert.equal(resolve('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
	assert.equal(resolve('blob:nodedata:1234'), 'blob:nodedata:1234');
	assert.equal(store.blockedLinks(), 8);
	store.dispose();
	assert.equal(store.entries.size, 0);
});

test('an OBJ whose material points at another server loads without contacting it', async () => {
	const obj = 'mtllib a.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl m\nf 1/1 2/2 3/3\n';
	const mtl = 'newmtl m\nKd 1 1 1\nmap_Kd https://tracker.example/pixel.png\n';
	// A stand-in for the browser's <img>, recording every address it is given.
	const asked = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (u) => { asked.push(String(u)); return Promise.reject(new Error('no network in tests')); };
	globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(v) { asked.push(String(v)); } }) };
	try {
		const result = await openFiles([{ name: 'a.obj', bytes: strToU8(obj) }, { name: 'a.mtl', bytes: strToU8(mtl) }], { units: 'm' });
		assert.equal(result.store.blockedLinks(), 1);
		assert.equal(asked.length, 1, 'the texture was requested once');
		assert.ok(asked[0].startsWith('data:image/png'), `asked for ${asked[0]}`);
	} finally {
		globalThis.fetch = realFetch;
		delete globalThis.document;
	}
});

test('the placeholder image is a valid PNG', () => {
	const b = Buffer.from(WHITE_PIXEL.split(',')[1], 'base64');
	assert.equal(b.subarray(1, 4).toString(), 'PNG');
	let pixels = null;
	for (let i = 8; i < b.length;) {
		const n = b.readUInt32BE(i), type = b.subarray(i + 4, i + 8), data = b.subarray(i + 8, i + 8 + n);
		assert.equal(b.readUInt32BE(i + 8 + n), zlib.crc32(Buffer.concat([type, data])), `${type} checksum`);
		if (type.toString() === 'IDAT') pixels = zlib.inflateSync(data);
		i += 12 + n;
	}
	assert.deepEqual([...pixels], [0, 255, 255, 255, 255]); // one opaque white pixel
});

test('zip bombs are refused before anything is unpacked', () => {
	const zip = zipSync({ 'a.txt': new Uint8Array(4096), 'dir/b.txt': new Uint8Array(4096), 'dir/': new Uint8Array(0) });
	// Fits: both files, no directory entry.
	const ok = EntryStore.fromZip(zip, { bytes: 10000, entries: 10 });
	assert.deepEqual([...ok.entries.keys()].sort(), ['a.txt', 'dir/b.txt']);
	// Too many bytes, or too many entries.
	assert.throws(() => EntryStore.fromZip(zip, { bytes: 5000, entries: 10 }), UserError);
	assert.throws(() => EntryStore.fromZip(zip, { bytes: 10000, entries: 1 }), UserError);
	// Nested archives share the parent's budget.
	const parent = EntryStore.fromZip(zip, { bytes: 9000, entries: 10 });
	assert.throws(() => parent.child(zip), UserError);
	// Not a zip at all.
	assert.throws(() => EntryStore.fromZip(new Uint8Array([1, 2, 3, 4])), UserError);
});

test('only https links, or links on this site, may be downloaded', () => {
	const page = 'https://example.github.io/CasaWalk/';
	assert.equal(checkLink('https://host.example/a/home.sh3d', page).ok, true);
	assert.equal(checkLink('https://host.example/a/home.sh3d', page).sameOrigin, false);
	assert.equal(checkLink('tests/fixtures/x.sh3d', page).sameOrigin, true);
	assert.equal(checkLink('tests/fixtures/x.sh3d', 'http://localhost:8123/?test').ok, true);
	for (const bad of ['http://host.example/x.sh3d', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'blob:https://x/1', 'ftp://x/y']) {
		assert.equal(checkLink(bad, page).ok, false, bad);
	}
	// Dropbox shared links become direct downloads; look-alike hosts do not.
	assert.equal(new URL(directLink('https://www.dropbox.com/scl/fi/abc/home.sh3d?rlkey=k&dl=0')).hostname, 'dl.dropboxusercontent.com');
	assert.equal(new URL(directLink('https://www.dropbox.com/scl/fi/abc/home.sh3d?rlkey=k&dl=0')).searchParams.get('rlkey'), 'k');
	assert.equal(new URL(directLink('https://dropbox.com.evil.example/x')).hostname, 'dropbox.com.evil.example');
	assert.equal(new URL(directLink('https://notdropbox.com/x')).hostname, 'notdropbox.com');
	// Odd encodings never throw.
	assert.equal(fileNameOf('https://h/a/My%20Home.sh3d'), 'My Home.sh3d');
	assert.equal(fileNameOf('https://h/a/bad%E0%A4%A.sh3d'), 'bad%E0%A4%A.sh3d');
	assert.equal(fileNameOf('not a url'), 'model');
});

test('Send to my Quest: Meta\'s Web Launch address carries the viewer and the pasted link', () => {
	const page = 'https://example.github.io/CasaWalk/?model=old#x';
	const dropbox = 'https://www.dropbox.com/scl/fi/abc/My%20home.sh3d?rlkey=k&dl=0';
	const launch = new URL(sendToQuestUrl(page, dropbox));
	assert.equal(launch.origin + launch.pathname, 'https://www.oculus.com/open_url/');
	// What opens on the headset: this viewer, with the link as ?model= (old query and # removed).
	const target = new URL(launch.searchParams.get('url'));
	assert.equal(target.origin + target.pathname, 'https://example.github.io/CasaWalk/');
	assert.equal(target.searchParams.get('model'), dropbox); // survives both rounds of encoding unchanged
	assert.equal(target.hash, '');
	assert.deepEqual([...launch.searchParams.keys()], ['url']);
	// On arrival it is an ordinary cross-site ?model= link: allowed, but it waits for Load.
	const arrived = checkLink(target.searchParams.get('model'), target.toString());
	assert.equal(arrived.ok, true);
	assert.equal(arrived.sameOrigin, false);
	// Without a link, the viewer alone.
	assert.equal(new URL(sendToQuestUrl(page)).searchParams.get('url'), 'https://example.github.io/CasaWalk/');
	// Web Launch only takes https pages: nothing is built from a local test server.
	assert.equal(sendToQuestUrl('http://localhost:8123/', dropbox), null);
	assert.equal(sendToQuestUrl('not a url'), null);
});

test('damaged Home.xml values cannot put NaN or Infinity into the scene', () => {
	const home = parseHome(`<?xml version="1.0"?><home version="7000" wallHeight="oops">
		<wall id="w" xStart="NaN" yStart="1e999" xEnd="-Infinity" yEnd="abc" thickness="&#x110000;" height="250"/>
		<pieceOfFurniture id="p" name="&#99999999999;&lt;b&gt;" x="1e999" y="2" width="x" depth="50" height="50" modelRotation="1 0 0 0 1 0 0 0 nope"/>
		<room id="r"><point x="0" y="0"/><point x="NaN" y="5"/><point x="5" y="5"/></room>
	</home>`);
	assert.equal(home.wallHeight, 250);
	const w = home.walls[0];
	for (const k of ['xStart', 'yStart', 'xEnd', 'yEnd', 'thickness']) assert.ok(Number.isFinite(w[k]), k);
	const p = home.pieces[0];
	for (const k of ['x', 'y', 'width', 'depth', 'height']) assert.ok(Number.isFinite(p[k]), k);
	assert.equal(p.modelRotation, null);
	assert.equal(p.name, '&#99999999999;<b>'); // an impossible character code is left as written
	assert.ok(home.rooms[0].points.flat().every(Number.isFinite));
	// Attribute names that collide with object internals are just data.
	const node = parseXml('<a __proto__="x" constructor="y" b="1"/>');
	assert.equal(node.attrs.b, '1');
	assert.equal({}.polluted, undefined);
});

test('the page allows only its own scripts, and the import map hash is right', () => {
	const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
	const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
	assert.ok(csp, 'index.html has a Content-Security-Policy');
	const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
	const hash = `sha256-${crypto.createHash('sha256').update(map).digest('base64')}`;
	assert.ok(csp.includes(`'${hash}'`), `import map changed: put '${hash}' in the Content-Security-Policy`);
	assert.match(csp, /default-src 'none'/);
	// No unsafe-inline, no unsafe-eval, no outside hosts. 'wasm-unsafe-eval'
	// allows WebAssembly only (the vendored compressed-glTF decoders), never eval.
	assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'sha256-[^']+'(;|$)/);
	assert.ok(!/'unsafe-(eval|inline)'/.test(csp.match(/script-src [^;]+/)[0]));
	assert.match(csp, /worker-src 'self' blob:(;|$)/); // sw.js (offline use) and the decoders' workers, built from vendored files
	assert.match(csp, /object-src 'none'/);
	assert.match(csp, /font-src 'self'(;|$)/); // only the vendored font
	const fontUrls = [...html.matchAll(/@font-face[^}]*url\("([^"]+)"\)/g)].map((m) => m[1]);
	assert.ok(fontUrls.length > 0);
	for (const u of fontUrls) {
		assert.ok(u.startsWith('./vendor/'), u);
		assert.ok(fs.existsSync(path.join(ROOT, u)), `${u} exists`);
		assert.ok(fs.existsSync(path.join(ROOT, path.dirname(u), 'LICENSE')), `${u} ships with its licence`);
	}
	assert.match(csp, /base-uri 'none'/);
	// Every script the page loads is its own file; nothing comes from a CDN.
	const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual(scripts, ['./js/main.js']);
	assert.ok(!/https?:\/\/[^"'\s]+\.(js|css)/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no outside scripts or styles');
	for (const target of Object.values(JSON.parse(map).imports)) assert.ok(target.startsWith('./vendor/'), target);
});

test('no personal files or secrets are tracked by git', async () => {
	const { execFileSync } = await import('node:child_process');
	const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
	// (The .sh3d files in the repository are the generated example and heavy test homes and the listed sample homes, all original.)
	const { SAMPLES } = await import('../js/samples.js');
	const ours = new Set(['examples/example-home.sh3d', 'examples/heavy-home.sh3d', ...SAMPLES.map((s) => s.file)]);
	assert.deepEqual(tracked.filter((f) => (/\.(sh3d|rtf|webloc|env|pem|key)$/i.test(f) && !ours.has(f)) || f.includes('fixtures/private')), []);
	const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
	assert.ok(!/secret\s*:/i.test(config), 'config.js must never hold the Dropbox app secret');
});
