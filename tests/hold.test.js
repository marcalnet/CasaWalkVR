// Holding a tool (js/hold.js; build 215's C1 and C2, the user's sticky tools):
// the two modes and their hysteresis, the magnet's arming, and how each tool
// sits in a bare hand (clear of the hand, along its aim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HOLD, nextMode, magnetStep, holdFrame, toolPose } from '../js/hold.js';
import { HAND_POSES, pinchJoints } from '../js/hand-poses.js';
import { presetJoints, mirrorPose } from '../js/hand-model.js';
import { handShape } from '../js/gestures.js';
import { buildCamera, buildMeter, buildMarker } from '../js/tool-models.js';

test('the modes: dock within 15 cm of the dock\'s middle, use beyond 25 cm, 10 cm of hysteresis between', () => {
	assert.equal(HOLD.DOCK, 0.15); assert.equal(HOLD.USE, 0.25);
	let mode = 'dock'; // (every take starts in dock mode)
	const walk = (d) => (mode = nextMode(mode, d));
	assert.equal(walk(0.05), 'dock');
	assert.equal(walk(0.2), 'dock', 'between 15 and 25 cm, from dock: still dock');
	assert.equal(walk(0.26), 'use', 'past 25 cm: use');
	assert.equal(walk(0.2), 'use', 'back between: still use');
	assert.equal(walk(0.16), 'use');
	assert.equal(walk(0.14), 'dock', 'within 15 cm: dock again');
});

test('the magnet: armed only once the tool has been in use mode; fires within 10 cm of its own place; the outline from 30 cm', () => {
	const s = { armed: false };
	assert.deepEqual(magnetStep(s, 'dock', 0.02), { fire: false, outline: false }, 'just taken, at its place: never snaps back');
	assert.deepEqual(magnetStep(s, 'dock', 0.5), { fire: false, outline: false });
	assert.deepEqual(magnetStep(s, 'use', 0.6), { fire: false, outline: false }, 'in use: armed, far away');
	assert.ok(s.armed);
	assert.deepEqual(magnetStep(s, 'use', 0.28), { fire: false, outline: true }, 'within 30 cm: the place shows its outline');
	assert.deepEqual(magnetStep(s, 'dock', 0.12), { fire: false, outline: true }, 'back in dock mode, still armed');
	assert.deepEqual(magnetStep(s, 'dock', 0.09), { fire: true, outline: true }, 'within 10 cm of its own place: it goes back');
});

/**
 * A bare hand's joints (world), the open or the pinch pose, either side, held
 * as a hand is when it uses a tool: pointing ahead (-Z), its palm down, or
 * turned inwards (towards the body's middle).
 */
function handJoints(side, pinch, palm = 'down') {
	const open = side === 'right' ? mirrorPose(HAND_POSES.open) : HAND_POSES.open, fist = side === 'right' ? mirrorPose(HAND_POSES.fist) : HAND_POSES.fist;
	const j = pinch ? pinchJoints(open, fist, 1) : presetJoints(open);
	// The hand turned so its length points ahead and its palm faces down or in (from its open pose, as measured).
	const o = presetJoints(open), shape = handShape(Object.fromEntries(Object.entries(o).map(([n, v]) => [n, v.position])), side);
	const want = { along: new THREE.Vector3(0, 0, -1), normal: palm === 'down' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(side === 'right' ? -1 : 1, 0, 0) };
	const basis = (a, n) => { const x = new THREE.Vector3().crossVectors(n, a).normalize(), nn = new THREE.Vector3().crossVectors(a, x); return new THREE.Matrix4().makeBasis(x, nn, a); };
	const a0 = shape.along.clone(), n0 = shape.normal.clone().addScaledVector(a0, -shape.normal.dot(a0)).normalize();
	const R = basis(want.along, want.normal).multiply(basis(a0, n0).invert());
	return Object.fromEntries(Object.entries(j).map(([n, v]) => [n, { p: v.position.clone().applyMatrix4(R), r: open[n]?.r ?? 0.008 }]));
}

/** Every triangle of a tool (world). */
function triangles(object) {
	object.updateMatrixWorld(true);
	const out = [];
	object.traverse((m) => {
		if (!m.isMesh || !m.visible || m.name === 'control-cue') return;
		const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count;
		const v = (k) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld);
		for (let k = 0; k < n; k += 3) out.push(new THREE.Triangle(v(k), v(k + 1), v(k + 2)));
	});
	return out;
}

/** The deepest any part of tool `name` goes into the hand's joint spheres (m; negative: clear), held `out` and `forward` (m), over both sides, the open and the pinch pose, palm down or turned in; and its aim error (degrees). */
export function clearance(name, out, forward) {
	const build = { camera: buildCamera, meter: buildMeter, marker: buildMarker }[name];
	let worst = -Infinity, at = '', aimOff = 0;
	for (const side of ['right', 'left']) for (const pinch of [false, true]) for (const palm of ['down', 'in']) {
		const j = handJoints(side, pinch, palm);
		const named = Object.fromEntries(Object.entries(j).map(([n, v]) => [n, v.p]));
		const shape = handShape(named, side), aim = new THREE.Vector3(0, 0, -1);
		const frame = holdFrame(named.wrist, named['middle-finger-phalanx-proximal'], shape.normal, aim, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, { out, forward });
		const hold = new THREE.Group(), o = build();
		hold.position.copy(frame.position); hold.quaternion.copy(frame.quaternion);
		hold.add(o);
		const pose = toolPose(name, side);
		o.rotation.set(...pose.rotation);
		o.position.fromArray(pose.position).sub(o.getObjectByName('grip').position.clone().applyEuler(o.rotation));
		hold.updateMatrixWorld(true);
		const tris = triangles(o), q = new THREE.Vector3();
		for (const [n, { p, r }] of Object.entries(j)) {
			let d = Infinity;
			for (const t of tris) { t.closestPointToPoint(p, q); d = Math.min(d, q.distanceTo(p)); }
			if (r - d > worst) { worst = r - d; at = `${side} ${pinch ? 'pinch' : 'open'} palm ${palm}: ${n}`; }
		}
		const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
		aimOff = Math.max(aimOff, THREE.MathUtils.radToDeg(dir.angleTo(aim)));
	}
	return { worst, at, aimOff };
}

test('each tool sits in a bare hand clear of the palm and the fingers (5 mm at most of overlap), in the open and the pinch pose, palm down or turned in, its working end along the aim (the Designer\'s per-tool numbers, from the sweep)', () => {
	const rows = [];
	for (const name of ['camera', 'meter', 'marker']) {
		const { out, forward } = toolPose(name);
		const c = clearance(name, out, forward);
		rows.push(`${name}: ${(out * 100).toFixed(1)} cm out, ${(forward * 100).toFixed(1)} cm forward: ${c.worst > 0 ? `${(c.worst * 1000).toFixed(1)} mm into` : `${(-c.worst * 1000).toFixed(1)} mm clear of`} ${c.at}; aim within ${c.aimOff.toFixed(1)}°`);
		assert.ok(c.worst <= 0.005, `${name}: ${(c.worst * 1000).toFixed(1)} mm into the hand (${c.at}); 5 mm at most`);
		assert.ok(c.aimOff < 5, `${name}: its working axis ${c.aimOff.toFixed(1)}° from the aim (5° at most)`);
	}
	console.log(`How each tool sits in a bare hand:\n${rows.join('\n')}`);
});

test('the hold frame: 4 cm out of the palm and 3 cm forward of its middle; the tool looks along the aim, level', () => {
	const wrist = new THREE.Vector3(0, 1, 0), knuckle = new THREE.Vector3(0, 1, -0.09), normal = new THREE.Vector3(-1, 0, 0), aim = new THREE.Vector3(0, 0, -1);
	const f = holdFrame(wrist, knuckle, normal, aim, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
	assert.ok(f.position.distanceTo(new THREE.Vector3(-0.04, 1, -0.045 - 0.03)) < 1e-9, `at ${f.position.toArray()}`);
	const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quaternion);
	assert.ok(fwd.distanceTo(aim) < 1e-9 && up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9, 'along the aim, its up the world\'s');
});
