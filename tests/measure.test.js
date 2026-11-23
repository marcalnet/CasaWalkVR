// The meter's measuring (js/measure.js): lines, labels, snapping, undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapLine, formatLength, Measurements, SNAP_DEG } from '../js/measure.js';

test('labels read like a tape: cm under a metre, two decimals under ten', () => {
	assert.equal(formatLength(1.6), '1.60 m');
	assert.equal(formatLength(0.854), '85 cm');
	assert.equal(formatLength(0.08), '8 cm');
	assert.equal(formatLength(12.43), '12.4 m');
	assert.equal(formatLength(NaN), '');
});

test(`lines within ${SNAP_DEG}° of vertical or level snap straight; others don't`, () => {
	const a = { x: 0, y: 0, z: 0 };
	const v = snapLine(a, { x: 0.03, y: 1, z: 0 }); // 1.7° off vertical
	assert.equal(v.snap, 'vertical');
	assert.deepEqual([v.point.x, v.point.z], [0, 0]);
	const l = snapLine(a, { x: 2, y: 0.05, z: 0 }); // 1.4° off level
	assert.equal(l.snap, 'level');
	assert.equal(l.point.y, 0);
	assert.equal(snapLine(a, { x: 1, y: 0.2, z: 0 }).snap, null, '11° off level: as pointed');
	assert.equal(snapLine(a, { x: 1, y: 1, z: 0 }).snap, null);
});

test('two triggers make a line with its real length; undo takes back the waiting point, then the last line; clear all', () => {
	const m = new Measurements();
	assert.equal(m.point({ x: 0, y: 0.75, z: 0 }).kind, 'start');
	const r = m.point({ x: 1.6, y: 0.76, z: 0 });
	assert.equal(r.kind, 'line');
	assert.equal(r.line.label, '1.60 m', 'snapped level: exactly 1.60 m');
	assert.equal(r.line.snap, 'level');
	m.point({ x: 0, y: 0, z: 0 });
	assert.equal(m.undo(), 'point');
	assert.equal(m.lines.length, 1);
	assert.equal(m.undo(), 'line');
	assert.equal(m.undo(), null);
	m.point({ x: 0, y: 0, z: 0 }); m.point({ x: 0, y: 2.5, z: 0 });
	m.point({ x: 1, y: 0, z: 0 });
	assert.ok(m.clear());
	assert.deepEqual([m.lines.length, m.pending], [0, null]);
});
