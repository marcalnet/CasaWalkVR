// Sweet Home 3D's defaults for OBJ models (js/obj-defaults.js, used by
// js/formats.js): built-in materials for names no .mtl defines, and window
// panes shown see-through. The OBJ files here are tiny and made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFiles } from '../js/formats.js';
import { SH3D_DEFAULT_MATERIALS, defaultMtlFor, usedMaterialNames, isWindowPaneName } from '../js/obj-defaults.js';

const enc = (s) => new TextEncoder().encode(s);

// A frame quad and a pane quad, like a catalogue window: no mtllib.
function windowObj({ mtllib = '', paneGroup = 'sweethome3d_window_pane', paneMtl = 'flltgrey', frameMtl = 'white' } = {}) {
	return `${mtllib ? `mtllib ${mtllib}\n` : ''}v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\n` +
		`g frame\nusemtl ${frameMtl}\nf 1 2 3\nf 1 3 4\n` +
		`g ${paneGroup}\nusemtl ${paneMtl}\nf 5 6 7\nf 5 7 8\n`;
}

async function open(files) {
	const result = await openFiles(files.map(([name, text]) => ({ name, bytes: enc(text) })));
	const byGroup = {};
	result.root.traverse((o) => { if (o.isMesh && o.name !== 'ground') byGroup[o.name] = o.material; });
	return byGroup;
}

const rgb = (m) => m.color.getHexString(); // as written in the file (sRGB)

test('the table: 134 materials, glass names transparent, flltgrey opaque', () => {
	assert.equal(SH3D_DEFAULT_MATERIALS.length, 134);
	const names = new Set(SH3D_DEFAULT_MATERIALS.map((r) => r[0]));
	assert.equal(names.size, 134, 'no name twice');
	const row = (n) => SH3D_DEFAULT_MATERIALS.find((r) => r[0] === n);
	assert.equal(row('flltgrey')[4], 1, 'Sweet Home 3D gives the window glass no transparency of its own');
	assert.ok(row('smoked_glass')[4] < 1);
	assert.deepEqual(usedMaterialNames('usemtl white\nusemtl  flltgrey \nusemtl white\n'), ['white', 'flltgrey']);
	assert.equal(defaultMtlFor(['nonesuch']), '', 'unknown names add nothing');
	assert.equal(defaultMtlFor(['white'], new Set(['white'])), '', 'a defined name is left alone');
	assert.ok(isWindowPaneName('sweethome3d_window_pane_on_hinge_1'));
	assert.ok(!isWindowPaneName('sweethome3d_window_mirror'));
});

test('an OBJ with no .mtl: white and flltgrey take the table colours; the pane is half see-through', async () => {
	const m = await open([['window.obj', windowObj()]]);
	assert.equal(rgb(m.frame), 'ffffff', 'the frame is white, not the fallback grey');
	assert.equal(m.frame.opacity, 1);
	assert.equal(m.frame.transparent, false);
	assert.equal(rgb(m.sweethome3d_window_pane), 'd2d2d2');
	assert.equal(m.sweethome3d_window_pane.opacity, 0.5);
	assert.equal(m.sweethome3d_window_pane.transparent, true);
	assert.equal(m.sweethome3d_window_pane.depthWrite, false, 'drawn like any other transparent material');
});

test('a .mtl that defines the name wins over the table', async () => {
	const m = await open([
		['window.obj', windowObj({ mtllib: 'window.mtl' })],
		['window.mtl', 'newmtl white\nKd 0 0 1\n'],
	]);
	assert.equal(rgb(m.frame), '0000ff', 'the .mtl colour');
	assert.equal(rgb(m.sweethome3d_window_pane), 'd2d2d2', 'the name it lacks comes from the table');
});

test('a pane that is already transparent keeps its own opacity', async () => {
	const m = await open([
		['window.obj', windowObj({ mtllib: 'window.mtl' })],
		['window.mtl', 'newmtl flltgrey\nKd 0.8 0.8 0.8\nd 0.8\n'],
	]);
	assert.equal(m.sweethome3d_window_pane.opacity, 0.8, 'never made fainter');
});

test('a material shared by the frame and the pane is copied for the pane only; mirrors stay opaque', async () => {
	const shared = await open([['window.obj', windowObj({ paneMtl: 'white' })]]);
	assert.equal(shared.frame.opacity, 1, 'the frame stays solid');
	assert.equal(shared.sweethome3d_window_pane.opacity, 0.5);
	assert.notEqual(shared.frame, shared.sweethome3d_window_pane);
	const mirror = await open([['window.obj', windowObj({ paneGroup: 'sweethome3d_window_mirror' })]]);
	assert.equal(mirror.sweethome3d_window_mirror.opacity, 1);
	const plain = await open([['window.obj', windowObj({ paneGroup: 'glass' })]]);
	assert.equal(plain.glass.opacity, 1, 'only Sweet Home 3D\'s pane name counts');
});
