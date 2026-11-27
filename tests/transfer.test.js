// Send to my Quest, file transfer: the protocol in js/transfer.js, run over a
// fake connection (no network), and the pairing settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sendModel, Receiver, newPairId, isPairId, CHUNK } from '../js/transfer.js';
import { sendToQuestUrl } from '../js/links.js';
import { CONFIG } from '../config.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** A connection that delivers to `deliver` asynchronously, like a data channel. */
function fakeChannel(deliver) {
	let queued = 0;
	return {
		sent: [],
		send(data) {
			this.sent.push(data);
			const size = typeof data === 'string' ? data.length : data.byteLength;
			queued += size;
			setTimeout(() => { queued -= size; deliver(data); }, 0);
		},
		buffered: () => queued,
	};
}

const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

test('a model with several files arrives byte for byte', async () => {
	const files = [{ name: 'house.obj', bytes: bytes(150_000, 1) }, { name: 'house.mtl', bytes: bytes(500, 2) }, { name: 'tex/wood.jpg', bytes: bytes(CHUNK * 3, 3) }, { name: 'empty.txt', bytes: new Uint8Array(0) }];
	const events = [];
	const done = new Promise((resolve) => {
		const rx = new Receiver({ maxBytes: 10 * 1048576, onStart: (m) => events.push(['start', m.name, m.total]), onModel: (got, name) => resolve({ got, name }), onError: (e) => resolve({ error: e }) });
		globalThis.__rx = rx;
	});
	const channel = fakeChannel((d) => globalThis.__rx.receive(d));
	let lastProgress = 0;
	await sendModel(channel, files, 'My house', { onProgress: (sent, total) => { assert.ok(sent >= lastProgress && sent <= total); lastProgress = sent; } });
	const { got, name, error } = await done;
	assert.equal(error, undefined);
	assert.equal(name, 'My house');
	assert.deepEqual(events, [['start', 'My house', files.reduce((n, f) => n + f.bytes.byteLength, 0)]]);
	assert.deepEqual(got.map((f) => f.name), files.map((f) => f.name));
	for (const [i, f] of got.entries()) assert.deepEqual([...f.bytes], [...files[i].bytes], f.name);
	// Sent in pieces no larger than CHUNK.
	assert.ok(channel.sent.filter((d) => typeof d !== 'string').every((d) => d.byteLength <= CHUNK));
	delete globalThis.__rx;
});

test('the receiver refuses what it should', () => {
	const errors = [], models = [];
	const rx = new Receiver({ maxBytes: 1000, onModel: (f) => models.push(f), onError: (e) => errors.push(e) });
	const model = (o) => JSON.stringify({ t: 'model', id: 'a', name: 'm', files: [{ name: 'a.sh3d', size: 10 }], ...o });
	// Too large for the limit: refused before anything is stored, and its pieces are ignored.
	rx.receive(model({ files: [{ name: 'a.sh3d', size: 5000 }] }));
	assert.match(errors.pop(), /larger than/);
	rx.receive(new ArrayBuffer(4000));
	rx.receive(JSON.stringify({ t: 'end', id: 'a' }));
	assert.equal(models.length, 0);
	// Malformed announcements.
	for (const bad of [{ files: [] }, { files: [{ name: '', size: 1 }] }, { files: [{ name: 'x', size: -1 }] }, { files: [{ name: 'x', size: 1.5 }] }, { files: [{ name: 'x'.repeat(300), size: 1 }] }, { name: 7 }, { files: 'nope' }]) {
		rx.receive(model(bad));
		assert.match(errors.pop(), /does not understand/, JSON.stringify(bad));
	}
	// More bytes than announced.
	rx.receive(model());
	rx.receive(new ArrayBuffer(11));
	assert.match(errors.pop(), /more than it announced/);
	// Fewer bytes than announced.
	rx.receive(model());
	rx.receive(new ArrayBuffer(4));
	rx.receive(JSON.stringify({ t: 'end', id: 'a' }));
	assert.match(errors.pop(), /incomplete/);
	// Not JSON; unknown messages are ignored.
	rx.receive('{oops');
	assert.match(errors.pop(), /unexpected/);
	rx.receive(JSON.stringify({ t: 'something-new' }));
	assert.equal(errors.length, 0);
	assert.equal(models.length, 0);
});

test('pairing names are random, well formed, and checked', () => {
	const ids = new Set(Array.from({ length: 2000 }, newPairId));
	assert.equal(ids.size, 2000);
	for (const id of ids) assert.ok(isPairId(id), id);
	for (const bad of ['', 'casawalk-', 'casawalk-ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'casawalk-abc', `casawalk-${'a'.repeat(27)}`, 'peerjs-anything', '<script>', null, 42]) assert.equal(isPairId(bad), false, String(bad));
	// Web Launch carries the pairing name to the headset as ?pair=.
	const id = newPairId();
	const target = new URL(new URL(sendToQuestUrl('https://example.github.io/CasaWalk/?model=x', { pair: id })).searchParams.get('url'));
	assert.equal(target.searchParams.get('pair'), id);
	assert.equal(target.searchParams.get('model'), null);
});

test('the security policy allows the pairing server in config.js, and nothing else new', () => {
	const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
	const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
	const connect = csp.match(/connect-src ([^;]+)/)[1].trim().split(/\s+/);
	assert.deepEqual(connect, ["'self'", 'https:', `wss://${CONFIG.pairing.host}`, 'data:', 'blob:']);
	assert.equal(CONFIG.pairing.secure, true);
	// The WebRTC connection servers (not governed by connect-src) are named, not
	// left to PeerJS's defaults, and each one is named in the README's privacy list.
	const ice = CONFIG.pairing.config?.iceServers ?? [];
	const hosts = ice.flatMap((s) => [].concat(s.urls)).map((u) => u.replace(/^(stun|turn)s?:/, '').replace(/:\d+.*$/, ''));
	assert.deepEqual(hosts, ['stun.l.google.com', 'eu-0.turn.peerjs.com', 'us-0.turn.peerjs.com']);
	const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
	for (const h of hosts) assert.ok(readme.includes(h), `README names ${h}`);
	// The pairing library is vendored with its licence and loaded from this site.
	assert.ok(fs.existsSync(path.join(ROOT, 'vendor/peerjs/peerjs.min.js')));
	assert.ok(fs.existsSync(path.join(ROOT, 'vendor/peerjs/LICENSE')));
	const src = fs.readFileSync(path.join(ROOT, 'js/pairing.js'), 'utf8');
	assert.match(src, /s\.src = '\.\/vendor\/peerjs\/peerjs\.min\.js'/);
	assert.ok(!/eval\(|new Function/.test(fs.readFileSync(path.join(ROOT, 'vendor/peerjs/peerjs.min.js'), 'utf8')), 'no eval in the vendored library (the policy forbids it)');
});
