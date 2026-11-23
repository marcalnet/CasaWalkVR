// The tools' models (js/tool-models.js): real size, few draw calls, their named points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCamera, buildMeter, buildMarker, TOOL_COLOURS, MARKER_INKS } from '../js/tool-models.js';
import { COLOURS } from '../js/theme.js';

const calls = (g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); return n; };
const size = (g) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());

test('the three tools: real size, one draw call per colour, their named points', () => {
	const camera = buildCamera(), inactive = buildCamera({ inactive: true }), meter = buildMeter(), marker = buildMarker();
	assert.ok(calls(camera) === 1 && calls(meter) === 1 && calls(marker) === 2, 'one mesh per tool (the marker\'s ink apart): the fan costs few draw calls');
	assert.ok(calls(inactive) <= 7, 'the inactive camera: its tag and string on top');
	assert.ok(Math.abs(size(camera).x - 0.12) < 0.01, 'the camera is 12 cm across');
	assert.ok(Math.abs(size(marker).z - 0.15) < 0.01, 'the marker is about 15 cm long');
	for (const [g, names] of [[camera, ['grip', 'lens', 'viewfinder', 'shutter', 'screen', 'strap']], [meter, ['grip', 'tip', 'hook', 'screen', 'key']], [marker, ['grip', 'tip']]]) {
		for (const n of names) assert.ok(g.getObjectByName(n), `${g.name}: ${n}`);
		assert.ok(g.userData.fanScale > 0.5 && g.userData.fanScale < 1, `${g.name}: smaller in the fan`);
	}
	assert.ok(inactive.getObjectByName('tag'), 'the "Coming soon" tag');
	assert.equal(TOOL_COLOURS.graphite, COLOURS.text, 'the tools wear the theme\'s colours');
	marker.userData.setInk('red');
	const ink = marker.children.find((m) => m.material?.name === 'ink');
	assert.equal('#' + ink.material.color.getHexString(), MARKER_INKS.red.toLowerCase(), 'the ink recolours one material');
});
