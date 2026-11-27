// The meter's readings (build 215's C4, the user's decisions): the screen's value and unit on two lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingParts } from '../js/measure.js';

test('the screen: the value on one line, its unit on the next; nothing hit: a dash', () => {
	assert.deepEqual(readingParts(0.87, 'cm'), { value: '87', unit: 'cm' }, 'under a metre: centimetres');
	assert.deepEqual(readingParts(2.454, 'cm'), { value: '2.45', unit: 'm' }, 'from a metre: metres, two places');
	assert.deepEqual(readingParts(12.34, 'cm'), { value: '12.3', unit: 'm' }, 'from ten metres: one place');
	assert.deepEqual(readingParts(3.77, 'ftin'), { value: '12\' 4½"', unit: 'ft in' }, 'imperial: feet and inches to the quarter');
	assert.deepEqual(readingParts(null, 'cm'), { value: '—', unit: '' }, 'no dot: a dash');
	assert.deepEqual(readingParts(Number.NaN, 'ftin'), { value: '—', unit: '' });
});
