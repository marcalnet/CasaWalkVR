// The model service (js/model-service.js, stage B1): files in, a finished
// model out, the older of two opens dropped, the old model freed (first, when
// asked), errors marked as the newest or not, links checked in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ModelService } from '../js/model-service.js';
import { UserError } from '../js/formats.js';

const FILE = path.resolve(import.meta.dirname, '../examples/example-home.sh3d');
const files = () => [{ name: 'example-home.sh3d', bytes: new Uint8Array(fs.readFileSync(FILE)) }];
const config = { maxDownloadMB: 200, googleApiKey: '' };
const read = { makeTexture: () => null };

test('a model opens: merged, in layers, the one shown; the statuses said in order; nothing loading after', async () => {
	const said = [];
	const models = new ModelService({ config, onStatus: (t) => said.push(t) });
	const m = await models.open(files(), 'Example', { type: 'file' }, { read });
	assert.ok(m && models.current === m && m.label === 'Example' && m.source.type === 'file');
	assert.ok(m.layers.main && m.layers.walls && m.merged.drawCalls > 0, 'merged into layers');
	assert.equal(said[0], 'Opening Example…');
	assert.equal(said.at(-1), 'Optimising for Quest…');
	assert.equal(models.loading, 0);
	const plain = await new ModelService({ config }).open(files(), 'As loaded', undefined, { read, nomerge: true });
	assert.equal(plain.merged, null, '?nomerge: the model as loaded');
});

test('two opens at once: the older one is dropped (null), the newer is shown; the one shown before is freed, by onFree', async () => {
	let freed = 0;
	const models = new ModelService({ config, onFree: () => freed++ });
	const first = await models.open(files(), 'One', undefined, { read });
	const [a, b] = await Promise.all([models.open(files(), 'Two', undefined, { read }), models.open(files(), 'Three', undefined, { read })]);
	assert.equal(a, null, 'superseded');
	assert.ok(b && models.current === b && b.label === 'Three');
	assert.equal(freed, 1, 'the first model freed once, when Three was ready');
	assert.notEqual(models.current, first);
});

test('freeFirst: the model shown is freed before reading (onFreed), as in the headset', async () => {
	const order = [];
	const models = new ModelService({ config, onFree: () => order.push('free') });
	await models.open(files(), 'One', undefined, { read });
	const p = models.open(files(), 'Two', undefined, { read, freeFirst: true, onStart: () => order.push('start'), onFreed: () => order.push('freed') });
	assert.equal(models.current, null, 'freed at once, before the read');
	await p;
	assert.deepEqual(order, ['start', 'free', 'freed']);
});

test('an error says whether it was the newest open; a bad link is refused in plain words, said and thrown', async () => {
	const models = new ModelService({ config });
	await assert.rejects(models.open(files(), 'Too heavy', undefined, { read: { ...read, triangleLimit: 10 } }), (e) => e instanceof UserError && e.latest === true, 'refused before building, as the newest open');
	assert.equal(models.current, null, 'nothing shown');
	assert.equal(models.loading, 0);
	const said = [];
	const linked = new ModelService({ config, onStatus: (t, err) => said.push([t, !!err]) });
	await assert.rejects(linked.fetchLink('ftp://example.com/home.sh3d', { base: 'https://www.casawalkvr.com/' }), (e) => e instanceof UserError, 'refused before any download');
	assert.ok(said.length === 1 && said[0][1], `said as an error: ${said[0]?.[0]}`);
});
