// Who owns a hand (js/hand-owner.js): the ladder, in order, on one snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { aimOwner, LADDER, OWNER } from '../js/hand-owner.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const L = { handedness: 'left' }, R = { handedness: 'right' };
const none = { held: null, board: false, keys: null, doors: null, tools: [], model: null };

test('the ladder: a hand holding a tool, an options row, an open wing, the main hand\'s keys, a key, the tools, the model, in that order; else nobody', () => {
	assert.deepEqual(LADDER, ['tool', 'board', 'hand keys', 'key', 'fan', 'model']);
	const p = V(0, 1.2, -0.4);
	assert.equal(aimOwner(R, p, none), null, 'nothing near: free to aim');
	assert.equal(aimOwner(R, p, { ...none, held: { c: R, at: V(0, 1, 0) } }), 'tool', 'holding a tool');
	assert.equal(aimOwner(L, p, { ...none, held: { c: R, at: p.clone().add(V(0.15, 0, 0)) } }), 'tool', 'within reach of the held tool (15 + 5 cm)');
	assert.equal(aimOwner(R, p, { ...none, board: true }), 'board');
	assert.equal(aimOwner(R, p, none, true), 'key', 'a fingertip on a key');
	const keysAt = (wearer) => ({ near: (q, m) => q.distanceTo(p.clone().add(V(0.1, 0, 0))) < m, wearer });
	assert.equal(aimOwner(R, p, { ...none, keys: keysAt(L) }), 'hand keys', 'at the other hand\'s keys (build 215, C8)');
	assert.equal(aimOwner(R, p, { ...none, keys: keysAt(R) }), null, 'never its own keys');
	assert.equal(aimOwner(R, p, { ...none, doors: { near: () => true } }), 'key', 'at a live door');
	assert.equal(aimOwner(R, p, { ...none, tools: [p.clone().add(V(0.14, 0, 0))] }), 'fan', 'within 15 cm of a tool');
	assert.equal(aimOwner(R, p, { ...none, tools: [p.clone().add(V(0.2, 0, 0))] }), null, '20 cm from a tool: free');
	assert.equal(aimOwner(R, p, { ...none, model: new THREE.Box3(V(-0.5, 0, -1), V(0.5, 1.25, -0.3)) }), 'model', 'at the model');
	assert.equal(aimOwner(R, p, { ...none, board: true, tools: [p] }), 'board', 'the first rung wins');
	assert.equal(OWNER.NEAR, 0.15);
});
