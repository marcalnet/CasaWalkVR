import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, decode, encode, readSetting, writeSetting } from '../js/settings.js';
import { TIMES } from '../js/lighting.js';

// People's saved settings must keep working: the keys and the meaning of
// every stored string are pinned here (they were spread over main.js and
// xr.js before js/settings.js).
test('the storage keys never change', () => {
	const keys = Object.fromEntries(Object.entries(SETTINGS).map(([name, s]) => [name, s.key]));
	assert.deepEqual(keys, {
		light: 'casawalk.light', shadows: 'casawalk.shadows', depth: 'casawalk.depth', view: 'casawalk.view', turn: 'casawalk.snapAngle',
		height: 'casawalk.height', figure: 'casawalk.figure', solid: 'casawalk.solidWalls', seeThrough: 'casawalk.seeThrough', sound: 'casawalk.sound',
	});
});

test('stored strings mean what they always meant', () => {
	const S = SETTINGS;
	const cases = [
		// [setting, stored string (null: nothing stored), value]
		[S.light, null, null], [S.light, 'sunset', 'sunset'], [S.light, 'dusk', null],
		[S.shadows, null, false], [S.shadows, '1', true], [S.shadows, '0', false], [S.shadows, 'yes', false],
		[S.depth, null, false], [S.depth, '1', true],
		[S.view, null, 'vr'], [S.view, 'ar', 'ar'], [S.view, 'vr', 'vr'], [S.view, 'AR', 'vr'],
		[S.turn, null, 30], [S.turn, '15', 15], [S.turn, '45', 45], [S.turn, '20', 30], [S.turn, 'x', 30],
		[S.height, null, 0], [S.height, '1.4', 1.4], [S.height, '1.7', 1.7], [S.height, '2', 2], [S.height, '1.8', 0],
		// The figure was on unless switched off ('0'), so anything else is on.
		[S.figure, null, true], [S.figure, '0', false], [S.figure, '1', true], [S.figure, 'junk', true],
		[S.solid, null, false], [S.solid, '1', true], [S.solid, '0', false],
		[S.seeThrough, null, 0], [S.seeThrough, '0.35', 0.35], [S.seeThrough, '1', 1], [S.seeThrough, '0', 0],
		[S.seeThrough, '1.5', 0], [S.seeThrough, '-0.2', 0], [S.seeThrough, 'NaN', 0], [S.seeThrough, '', 0],
		[S.sound, null, 'all'], [S.sound, 'off', 'off'], [S.sound, 'effects', 'effects'], [S.sound, 'loud', 'all'],
	];
	for (const [spec, raw, want] of cases) assert.equal(decode(spec, raw), want, `${spec.key} = ${JSON.stringify(raw)}`);
	assert.deepEqual(SETTINGS.light.options, TIMES);
});

test('values are stored as they always were, and read back the same', () => {
	assert.equal(encode(SETTINGS.shadows, true), '1');
	assert.equal(encode(SETTINGS.figure, false), '0');
	assert.equal(encode(SETTINGS.turn, 45), '45');
	assert.equal(encode(SETTINGS.height, 2.0), '2');
	assert.equal(encode(SETTINGS.seeThrough, 0.35), '0.35');
	assert.equal(encode(SETTINGS.view, 'ar'), 'ar');
	for (const spec of Object.values(SETTINGS)) {
		const values = spec.flag ? [true, false] : spec.range ? [0.05, 0.5, 1] : spec.options;
		for (const v of values) assert.equal(decode(spec, encode(spec, v)), v, `${spec.key} ${v}`);
	}
});

test('reading and writing use localStorage, and never throw without it', () => {
	const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	try {
		const store = new Map();
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
		assert.equal(readSetting('turn'), 30);
		writeSetting('turn', 15);
		assert.equal(store.get('casawalk.snapAngle'), '15');
		assert.equal(readSetting('turn'), 15);
		// Private mode: storage throws; the defaults are used.
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
		assert.equal(readSetting('figure'), true);
		assert.doesNotThrow(() => writeSetting('figure', false));
	} finally {
		if (had) Object.defineProperty(globalThis, 'localStorage', had);
		else delete globalThis.localStorage;
	}
});
