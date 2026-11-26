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
		light: 'casawalk.light', shadows: 'casawalk.shadows', depth: 'casawalk.depth', view: 'casawalk.view',
		height: 'casawalk.height', seeThrough: 'casawalk.seeThrough', mainHand: 'casawalk.mainHand', sound: 'casawalk.sound', cameraLens: 'casawalk.cameraLens',
		pinchSeenHands: 'casawalk.welcome.walk.hands', pinchSeenControllers: 'casawalk.welcome.walk.controllers', toolsIntro: 'casawalk.toolsIntro',
	});
});

test('removed settings (the scale figure, Turn, the guide, the lessons) are ignored', () => {
	assert.equal(SETTINGS.guide, undefined); // nor 'casawalk.walkGuide'
	assert.equal(SETTINGS.solid, undefined); // nor 'casawalk.solidWalls'
	assert.ok(!Object.values(SETTINGS).some((s) => s.key.startsWith('casawalk.welcome.scale')), 'nor the scale model\'s lessons');
	assert.equal(SETTINGS.figure, undefined); // 'casawalk.figure' may still be stored: nothing reads it
	assert.equal(SETTINGS.turn, undefined); // nor 'casawalk.snapAngle': snap turns are 30°
});

test('stored strings mean what they always meant', () => {
	const S = SETTINGS;
	const cases = [
		// [setting, stored string (null: nothing stored), value]
		[S.light, null, null], [S.light, 'sunset', 'sunset'], [S.light, 'dusk', null],
		[S.shadows, null, false], [S.shadows, '1', true], [S.shadows, '0', false], [S.shadows, 'yes', false],
		[S.depth, null, false], [S.depth, '1', true],
		[S.view, null, 'vr'], [S.view, 'ar', 'ar'], [S.view, 'vr', 'vr'], [S.view, 'AR', 'vr'],
		[S.height, null, 0], [S.height, '1.4', 1.4], [S.height, '1.7', 1.7], [S.height, '2', 2], [S.height, '1.8', 0],
		[S.shadows, null, false], [S.shadows, '1', true], [S.shadows, '0', false],
		[S.seeThrough, null, 0], [S.seeThrough, '0.35', 0.35], [S.seeThrough, '1', 1], [S.seeThrough, '0', 0],
		[S.seeThrough, '1.5', 0], [S.seeThrough, '-0.2', 0], [S.seeThrough, 'NaN', 0], [S.seeThrough, '', 0],
		[S.mainHand, null, 'right'], [S.mainHand, 'left', 'left'], [S.mainHand, 'up', 'right'],
		[S.sound, null, 'all'], [S.sound, 'off', 'off'], [S.sound, 'effects', 'effects'], [S.sound, 'loud', 'all'],
	];
	for (const [spec, raw, want] of cases) assert.equal(decode(spec, raw), want, `${spec.key} = ${JSON.stringify(raw)}`);
	assert.deepEqual(SETTINGS.light.options, TIMES);
});

test('values are stored as they always were, and read back the same', () => {
	assert.equal(encode(SETTINGS.shadows, true), '1');
	assert.equal(encode(SETTINGS.shadows, false), '0');
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
		assert.equal(readSetting('height'), 0);
		writeSetting('height', 1.4);
		assert.equal(store.get('casawalk.height'), '1.4');
		assert.equal(readSetting('height'), 1.4);
		// Private mode: storage throws; the defaults are used.
		Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
		assert.equal(readSetting('shadows'), false);
		assert.doesNotThrow(() => writeSetting('shadows', true));
	} finally {
		if (had) Object.defineProperty(globalThis, 'localStorage', had);
		else delete globalThis.localStorage;
	}
});

test('Recent keeps the newest five within 150 MB, and never a model over 50 MB (heavy homes, step 4)', async () => {
	const { recentsPlan, RECENT_MAX_FILE, RECENT_MAX_TOTAL } = await import('../js/storage.js');
	const MB = 1048576, r = (id, size, date) => ({ id, size: size * MB, date });
	assert.deepEqual(recentsPlan(r('big', 51, 9), []), { keep: false, drop: [] }, 'over 50 MB: not kept');
	const others = [r('a', 40, 5), r('b', 40, 4), r('c', 40, 3), r('d', 1, 2), r('e', 1, 1), r('f', 1, 0)];
	const plan = recentsPlan(r('new', 40, 9), others);
	assert.ok(plan.keep);
	assert.deepEqual(plan.drop.sort(), ['c', 'f'], 'the 150 MB total drops c; five at most drops f');
	assert.ok(RECENT_MAX_FILE < RECENT_MAX_TOTAL);
});
