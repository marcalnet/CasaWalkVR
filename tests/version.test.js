// The build stamp (js/version.js, scripts/stamp.js) and how it reads (js/build-label.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD } from '../js/version.js';
import { buildLabel, buildNumberIn } from '../js/build-label.js';

test('the build stamp: a number and a date, read the same by the page and by the newer-build check', () => {
	assert.ok(Number.isInteger(BUILD.number) && BUILD.number >= 0);
	assert.ok(!Number.isNaN(Date.parse(BUILD.date)), BUILD.date);
	assert.equal(buildLabel({ number: 213, date: '2026-11-23T14:05:00Z' }, 'UTC'), 'Build 213 · 23 Nov 2026 14:05');
	assert.equal(buildLabel(null), '');
	const text = fs.readFileSync(path.resolve(import.meta.dirname, '../js/version.js'), 'utf8');
	assert.equal(buildNumberIn(text), BUILD.number, 'the check reads the same number from the file');
	assert.equal(buildNumberIn('nothing'), null);
});
