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

test('feet and inches: quarters under a foot; feet and quarters to 33 ft; whole inches beyond; 12" carries; the regions that start in ft in', async () => {
	const { formatLength, defaultUnits } = await import('../js/measure.js');
	const ft = (m) => formatLength(m, 'ftin');
	assert.equal(ft(7.25 * 0.0254), '7¼"');
	assert.equal(ft(11.75 * 0.0254), '11¾"');
	assert.equal(ft(0.5 * 0.0254), '½"');
	assert.equal(ft((5 * 12 + 3) * 0.0254), `5' 3"`);
	assert.equal(ft((12 * 12 + 4.5) * 0.0254), `12' 4½"`);
	assert.equal(ft(12 * 12 * 0.0254), `12' 0"`, 'zero inches');
	assert.equal(ft((12 * 12 + 11.9) * 0.0254), `13' 0"`, '12" carries to the next foot');
	assert.equal(ft((48 * 12 + 3.2) * 0.0254), `48' 3"`, 'from 33 ft: whole inches');
	assert.equal(formatLength(1.6, 'cm'), '1.60 m', 'metric unchanged');
	assert.deepEqual(['en-US', 'en-GB', 'es', 'es-ES', 'my-MM', 'en-LR', 'fr-CA'].map(defaultUnits), ['ftin', 'cm', 'cm', 'cm', 'ftin', 'ftin', 'cm']);
});

test('the meter\'s units: its stick press steps cm and ft in, remembered; the lines relabel', async () => {
	const { Measurements, formatLength } = await import('../js/measure.js');
	const m = new Measurements();
	m.units = 'ftin';
	m.point({ x: 0, y: 0, z: 0 });
	const { line } = m.point({ x: (5 * 12 + 3) * 0.0254, y: 0, z: 0 });
	assert.equal(line.label, `5' 3"`);
	assert.equal(formatLength(line.length, 'cm'), '1.60 m');
});
