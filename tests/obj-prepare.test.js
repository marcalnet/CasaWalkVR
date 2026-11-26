// OBJ preparation (js/formats.js prepareObjText) light on memory (heavy
// homes, step 2): an OBJ that needs nothing changed comes back as the very
// same string; lines and points go; concave faces are cut properly; Windows
// line ends and tabs are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareObjText } from '../js/formats.js';

test('nothing to change: the same text comes back, not a copy of it', () => {
	const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
	assert.equal(prepareObjText(obj), obj);
});

test('lines and points go; a U-shaped face is cut by earcut, never a fan over the gap; Windows line ends', () => {
	// A U (8 corners): a fan from the first corner would cover the notch.
	const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]].map(([x, y]) => `v ${x} ${y} 0`).join('\r\n');
	const out = prepareObjText(`${u}\r\nl 1 2\r\np 3\r\nf\t1 2 3 4 5 6 7 8\r\n`);
	assert.ok(!/^[lp] /m.test(out) && !out.includes('\r'), 'no line or point records, no CR');
	const faces = out.split('\n').filter((l) => l.startsWith('f '));
	assert.equal(faces.length, 6, 'eight corners: six triangles');
	// No triangle covers the notch's middle (1.5, 2).
	const v = u.split('\r\n').map((l) => l.split(' ').slice(1, 3).map(Number));
	const inside = ([px, py], [a, b, c]) => {
		const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
		const d1 = s([px, py], a, b), d2 = s([px, py], b, c), d3 = s([px, py], c, a);
		return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
	};
	for (const f of faces) assert.ok(!inside([1.5, 2], f.slice(2).split(' ').map((t) => v[+t - 1])), `${f} covers the notch`);
});

test('a face mixing corners with and without normals keeps none (never NaN normals)', () => {
	const out = prepareObjText('v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2 3//1\n');
	assert.match(out, /^f 1 2 3$/m);
});
