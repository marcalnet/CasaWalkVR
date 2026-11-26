// Plain colours folded into vertex colours (js/optimise.js, 1c; stage B3):
// every plain colour lands in its vertices exactly, one draw call per layer,
// storey and side; textured, see-through, emissive and ceiling materials keep
// their own; ?nofold (fold: false) keeps the old one-material-per-colour merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { optimiseModel, isPlainColour, modelStats } from '../js/optimise.js';

function scene() {
	const root = new THREE.Group();
	const furniture = new THREE.Group(); furniture.name = 'furniture';
	const ceilings = new THREE.Group(); ceilings.name = 'ceilings';
	root.add(furniture, ceilings);
	const box = (mat, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); m.position.x = x; return m; };
	const colours = [0xff0000, 0x00ff00, 0x0000ff, 0x808080];
	colours.forEach((c, i) => furniture.add(box(new THREE.MeshLambertMaterial({ color: c }), i * 2)));
	furniture.add(box(new THREE.MeshLambertMaterial({ color: 0xffffff, map: new THREE.Texture() }), 10)); // textured
	furniture.add(box(new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.4 }), 12)); // glass
	furniture.add(box(new THREE.MeshLambertMaterial({ color: 0xffeeaa, emissive: 0x333300 }), 14)); // a glow
	furniture.add(box(new THREE.MeshLambertMaterial({ color: 0x00ffff, side: THREE.DoubleSide }), 16)); // another side
	ceilings.add(box(new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }), 0));
	return { root, colours };
}

test('which materials fold: opaque, untextured, plain Lambert with no glow', () => {
	assert.ok(isPlainColour(new THREE.MeshLambertMaterial({ color: 0xff0000 })));
	assert.ok(!isPlainColour(new THREE.MeshLambertMaterial({ map: new THREE.Texture() })));
	assert.ok(!isPlainColour(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5 })));
	assert.ok(!isPlainColour(new THREE.MeshLambertMaterial({ emissive: 0x111111 })));
	assert.ok(!isPlainColour(new THREE.MeshPhongMaterial({ color: 0xff0000 })), 'shiny stays apart');
});

test('folded: one draw call for the plain colours per side, every vertex its own colour exactly; the rest as before', () => {
	const { root, colours } = scene();
	const before = optimiseModel(scene().root, { fold: false }), after = optimiseModel(root);
	assert.equal(modelStats(before.group).drawCalls, 9, 'unfolded: one per material');
	assert.equal(modelStats(after.group).drawCalls, 6, 'folded: the four plain ones become one (plus the double-sided one, the textured, the glass, the glow and the ceiling)');
	const plain = after.layers.main.children.find((m) => m.material.vertexColors && m.material.side === THREE.FrontSide);
	const col = plain.geometry.attributes.color, pos = plain.geometry.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const k = Math.round(pos.getX(i) / 2);
		const c = new THREE.Color(colours[k]);
		assert.ok(Math.abs(col.getX(i) - c.r) < 1e-6 && Math.abs(col.getY(i) - c.g) < 1e-6 && Math.abs(col.getZ(i) - c.b) < 1e-6, `vertex ${i} at x ${pos.getX(i)}`);
	}
	assert.ok(after.layers.ceilings.children.every((m) => !m.material.vertexColors), 'the ceilings keep their own (their light lift reads the colour)');
	assert.ok(after.layers.main.children.some((m) => m.material.map), 'the textured piece keeps its own');
	assert.ok(after.layers.main.children.some((m) => m.material.transparent), 'the glass keeps its own');
});
