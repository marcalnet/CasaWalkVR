// The marker (js/marker-tool.js): strokes grow as the nib moves, one draw call
// each; one ink, dark grey; undo and clear; a lost hand ends a stroke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MarkerTool } from '../js/marker-tool.js';
import { MARKER_INK } from '../js/tool-models.js';

function fakeXR() {
	const centerer = new THREE.Group(), anchor = new THREE.Group();
	anchor.add(centerer);
	const annotations = new THREE.Group();
	centerer.add(annotations);
	return { anchor, centerer, tools: { annotations }, soundLevel: 'off', sound: { play() {} }, haptics: { play() {} } };
}

test('drawing: a stroke grows from the nib; finished strokes merge into one mesh, in the one dark grey ink; undo and clear', () => {
	const xr = fakeXR(), m = new MarkerTool(xr), c = { isController: true };
	m.take(c);
	const nib = m.object; // (moving the whole marker moves its nib)
	m.trigger(c, 'down');
	for (let i = 0; i <= 50; i++) { nib.position.set(i * 0.01, 1, 0); nib.updateMatrixWorld(true); m.update(1 / 72); }
	m.trigger(c, 'up');
	assert.equal(xr.tools.annotations.children.length, 1, 'one stroke, one mesh');
	const s = m.strokes[0];
	assert.ok(s.n > 40, `points along 50 cm: ${s.n}`);
	m.trigger(c, 'down'); nib.position.x += 0.1; nib.updateMatrixWorld(true); m.update(1 / 72); nib.position.y += 0.1; nib.updateMatrixWorld(true); m.update(1 / 72); m.trigger(c, 'up');
	assert.equal(m.strokes.length, 2);
	assert.ok(m.merged.material === m.material && '#' + m.material.color.getHexString() === MARKER_INK.toLowerCase(), 'both strokes in the one mesh, dark grey');
	assert.equal(xr.tools.annotations.children.length, 1);
	assert.ok(m.undo());
	assert.equal(m.strokes.length, 1);
	assert.ok(m.clear());
	assert.equal(xr.tools.annotations.children.length, 0);
});

test('a stroke ends on a jump (a fade, a layer change) and when the holding hand is lost', () => {
	const xr = fakeXR(), m = new MarkerTool(xr), c = { isController: true };
	m.take(c);
	m.trigger(c, 'down');
	m.object.position.set(0, 1, 0); m.object.updateMatrixWorld(true); m.update(1 / 72);
	m.object.position.x += 0.05; m.object.updateMatrixWorld(true); m.update(1 / 72);
	xr.modes = { walk: { fade: { t: 0 } } }; // a teleport starts
	m.update(1 / 72);
	assert.equal(m.drawing, null, 'the teleport ended the stroke');
	xr.modes = { walk: { fade: null } };
	const h = { isHand: true, touch: { tracked: true } };
	m.putBack(); m.take(h);
	m.trigger(h, 'down');
	assert.ok(m.drawing);
	m.gesture(h, { type: 'lost' });
	assert.equal(m.drawing, null, 'a lost hand (its gesture event) ends it');
	m.trigger(h, 'down');
	h.touch.tracked = false;
	m.update(1 / 72);
	assert.equal(m.drawing, null, 'a lost hand ends it');
});

test('20 strokes cost one mesh; the nib jumping ends a stroke', () => {
	const xr = fakeXR(), m = new MarkerTool(xr), c = { isController: true };
	m.take(c);
	for (let k = 0; k < 20; k++) {
		m.trigger(c, 'down');
		for (let i = 0; i <= 10; i++) { m.object.position.set(i * 0.01, 1 + k * 0.05, 0); m.object.updateMatrixWorld(true); m.update(1 / 72); }
		m.trigger(c, 'up');
	}
	assert.equal(m.strokes.length, 20);
	assert.equal(xr.tools.annotations.children.length, 1, 'one mesh for all the finished strokes');
	m.trigger(c, 'down');
	m.object.position.set(0, 1, 0); m.object.updateMatrixWorld(true); m.update(1 / 72);
	m.object.position.set(0.02, 1, 0); m.object.updateMatrixWorld(true); m.update(1 / 72);
	m.object.position.set(1, 1, 0); m.object.updateMatrixWorld(true); m.update(1 / 72); // (a jump of a metre)
	assert.equal(m.drawing, null, 'the jump ended the stroke');
});
