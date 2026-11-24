// The safety net (js/safety.js): a lone error shows the card and the app goes
// on; repeated errors end the session; the last error is kept for the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafetyNet, SAFETY, describeError } from '../js/safety.js';

const DT = 1 / 72;
function net() {
	const log = [];
	const n = new SafetyNet({ showCard: (ending) => log.push(ending ? 'card:ending' : 'card'), hideCard: () => log.push('hide'), endSession: () => log.push('end'), log: () => {} });
	n.begin();
	return { n, log };
}

test('a lone error: the card shows, the next frames run, the card goes after a while', () => {
	const { n, log } = net();
	let runs = 0;
	n.frame(DT, () => { throw new TypeError('x is undefined'); });
	assert.deepEqual(log, ['card']);
	assert.deepEqual(n.lastError, { message: 'TypeError: x is undefined', where: 'frame' });
	for (let t = 0; t < SAFETY.CARD_TIME + 0.5; t += DT) n.frame(DT, () => runs++);
	assert.ok(runs > 400, 'the app goes on');
	assert.deepEqual(log, ['card', 'hide']);
	assert.ok(!n.failed && n.errors === 1);
});

test('an error every frame: the work stops, the card says it is returning, the session ends once', () => {
	const { n, log } = net();
	let runs = 0;
	for (let i = 0; i < 72 * 3; i++) n.frame(DT, () => { runs++; throw new Error('broken'); });
	assert.equal(runs, SAFETY.MAX_ERRORS, 'no more frames of work once it is ending');
	assert.deepEqual(log, ['card', 'card:ending', 'end']);
	assert.ok(n.failed && n.lastError.message === 'broken');
	n.begin();
	assert.ok(!n.failed && n.errors === 0 && n.lastError.message === 'broken', 'a new session starts clean; the last error stays for the page');
});

test('errors far apart never end the session', () => {
	const { n, log } = net();
	for (let k = 0; k < 10; k++) {
		n.frame(DT, () => { throw new Error('now and then'); });
		for (let t = 0; t < 5; t += DT) n.frame(DT, () => {}); // (one every 5 s: never 10 within 30 s)
	}
	assert.ok(!n.failed && !log.includes('end'), JSON.stringify(log));
});

test('errors from the page count too; anything thrown reads as a short line', () => {
	const { n, log } = net();
	n.fail('a string', 'page');
	assert.deepEqual(n.lastError, { message: 'a string', where: 'page' });
	assert.equal(describeError({ message: 'plain object' }), 'plain object');
	assert.equal(describeError(undefined), 'undefined');
	assert.equal(describeError(new Error('a'.repeat(400))).length, 160);
	assert.deepEqual(log, ['card']);
});

test('a slow loop of errors (one a second) ends the session at the tenth', () => {
	const { n, log } = net();
	let k = 0;
	for (let t = 0; t < 15 && !n.failed; t += DT) n.frame(DT, () => { if (Math.floor(t + DT) > Math.floor(t)) { k++; throw new Error(`slow ${k}`); } });
	assert.ok(n.failed, JSON.stringify(log));
	assert.equal(k, SAFETY.SLOW_MAX, 'ended at the tenth error');
});

test('an error while a half-done change is under way (critical) ends the session at once', () => {
	let critical = true;
	const log = [];
	const n = new SafetyNet({ showCard: (e) => log.push(e ? 'card:ending' : 'card'), endSession: () => log.push('end'), critical: () => critical, log: () => {} });
	n.begin();
	n.frame(DT, () => { throw new Error('mid-dive'); });
	for (let t = 0; t < SAFETY.END_DELAY + 0.1; t += DT) n.frame(DT, () => {});
	assert.deepEqual(log, ['card:ending', 'end']);
	critical = false;
});
