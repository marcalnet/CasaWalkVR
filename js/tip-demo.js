// The pause's demonstration (js/pause.js; the next-build asks, "Tip screens"):
// a looping 3D hand shows the move of the tip on show, drawn over the dark of
// the pause. (It began as the pinch hand shown the first time inside, 25 Nov
// 2026; the pause took it over on 26 Nov.)
//
// One loop of 3 s: the hand rests sideways in front of you; it pinches (the
// finger tips brighten); an arc grows from the pinch to an orange ring on the
// floor ahead; the ring turns blue; the hand opens and the ring gives a small
// ripple; a short pause, then again. With controllers the arc and the ring
// play alone (no controller model yet). The demo kinds (the tip's `demo`):
//   pinch  the loop above (the teleport tip)
//   door   the same, a small orange door lighting at the arc's end instead of
//          the ring (the Enter VR tip: "walk in")
//   flick  the pinch held, the wrist flicks aside and back (the turn tip)
//   touch  the open hand reaches forward; a disc opens where it touches (the
//          portal tip)
//   grab   the hand closes, turns a quarter, opens again (the grab tip)
//
// Where: 0.6 m ahead, 15° to the main hand's side, 20° below eye level, 1.2
// times life size, world-locked where it appears and turned to you. The pause
// places it (play) and stops it. Never in photos (the interface layer).
//
// The hand is the generic hand model (js/hand-model.js) posed between IWER's
// open and fist presets (js/hand-poses.js: pinchJoints).

import * as THREE from 'three';
import { loadHands, dressHand, mirrorPose } from './hand-model.js';
import { HAND_POSES, pinchJoints, fistJoints } from './hand-poses.js';
import { COLOURS } from './theme.js';

export const DEMO = {
	AHEAD: 0.6, BELOW: 20, SIDE: 15, // metres ahead; degrees below the eyes and to the main hand's side
	SCALE: 1.2, LENGTH: 3, // the hand's size (times life) and one loop (s)
	FADE: 0.3, // seconds in and out
	ORDER: 1003, // drawn over the pause's dark (js/veil.js is 1002)
};

/** The loop's moments (s): the hand pinches, the arc grows, the ring is steady, the hand opens. */
export const LOOP = { pinchFrom: 0.5, pinchTo: 0.9, arcTo: 1.7, openFrom: 2.2, openTo: 2.5 };

/** The other loops' moments (s): { k: the gesture 0..1 (closing, flicking, reaching), turn: radians, disc: 0..1 }. */
export function gestureAt(demo, t) {
	const ramp = (a, b) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1), s = (v) => v * v * (3 - 2 * v);
	if (demo === 'flick') return { k: 1, turn: 0.6 * (s(ramp(0.8, 1.0)) - s(ramp(1.3, 1.6))), disc: 0 };
	if (demo === 'touch') { const reach = s(ramp(0.4, 1.0)) - s(ramp(2.2, 2.7)); return { k: 0, reach, disc: s(ramp(0.9, 1.4)) * (1 - s(ramp(2.2, 2.6))) }; }
	if (demo === 'grab') return { k: s(ramp(0.4, 0.8)) * (1 - s(ramp(2.2, 2.6))), turn: (Math.PI / 2) * s(ramp(0.9, 1.9)) * (1 - s(ramp(2.6, 2.9))), disc: 0 };
	return { k: 0, turn: 0, disc: 0 };
}

/** The loop's state at time t (s into the loop): pinch 0..1, arc 0..1 (how much is drawn), blue (the ring is steady), ripple 0..1. */
export function loopAt(t) {
	const L = LOOP, ramp = (a, b) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
	const pinch = ramp(L.pinchFrom, L.pinchTo) * (1 - ramp(L.openFrom, L.openTo));
	const arc = t < L.openFrom ? ramp(L.pinchTo, L.arcTo) : 1 - ramp(L.openFrom, L.openTo);
	return { pinch, arc, blue: t >= L.arcTo && t < L.openFrom, ripple: t >= L.openFrom ? ramp(L.openFrom, DEMO.LENGTH) : 0 };
}

const UP = new THREE.Vector3(0, 1, 0);
const BLUE = new THREE.Color(0x4d8dff), ORANGE = new THREE.Color(COLOURS.primary);

export class TipDemo {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.group = new THREE.Group();
		this.group.name = 'tip-demo';
		this.group.visible = false;
		this.state = null; // { t (since it began), fade (0..1 visible), out (fading away) }
		this.kind = 'hands';
		this.loaded = loadHands().then((h) => {
			if (!h) return;
			this.hands = { left: dressHand(h.left, 'left'), right: dressHand(h.right, 'right') };
			for (const d of Object.values(this.hands)) { d.visible = false; d.scale.setScalar(DEMO.SCALE); onTop(d); this.group.add(d); }
		});
		const flat = (r0, r1, colour, opacity) => new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
		this.ring = flat(0.44, 0.5, COLOURS.primary, 0.9);
		this.ring.name = 'tip-demo-ring';
		this.ripple = flat(0.5, 0.53, 0x4d8dff, 0);
		this.ripple.name = 'tip-demo-ripple';
		this.door = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), new THREE.MeshBasicMaterial({ color: COLOURS.primary, transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
		this.door.name = 'tip-demo-door';
		this.arcGeometry = new THREE.BufferGeometry();
		this.arcPoints = new Float32Array(ARC_POINTS * 3);
		this.arcGeometry.setAttribute('position', new THREE.BufferAttribute(this.arcPoints, 3));
		this.arcLine = new THREE.Line(this.arcGeometry, new THREE.LineBasicMaterial({ color: COLOURS.primary, transparent: true, depthTest: false }));
		this.arcLine.frustumCulled = false;
		this.arcLine.name = 'tip-demo-arc';
		this.disc = new THREE.Mesh(new THREE.CircleGeometry(0.1, 40), new THREE.MeshBasicMaterial({ color: 0xf4efe6, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
		this.disc.name = 'tip-demo-disc';
		this.group.add(this.ring, this.ripple, this.door, this.arcLine, this.disc);
		for (const o of [this.ring, this.ripple, this.door, this.arcLine, this.disc]) { o.raycast = () => {}; o.renderOrder = DEMO.ORDER; }
		xr.scene.add(this.group);
		xr.hideFromPhotos(this.group);
		this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
	}

	/** True while it shows. */
	get playing() { return !!this.state; }

	/**
	 * Puts it in front of you (world-locked from here) and starts the loop:
	 * kind 'hands' | 'controllers'; target, the floor point its arc lands on
	 * (world); door: a small door at the end of the arc instead of the ring.
	 */
	play(kind, target, { demo = 'pinch' } = {}) {
		const xr = this.xr, head = xr.headWorld(), { forward, right } = xr.viewAxes();
		this.kind = kind;
		this.demo = demo;
		const door = demo === 'door', arcs = demo === 'pinch' || door;
		this.withDoor = door;
		const side = xr.toolFan === 'right' ? -1 : 1, a = THREE.MathUtils.degToRad(DEMO.SIDE) * side, below = THREE.MathUtils.degToRad(DEMO.BELOW);
		const flatDir = this._a.copy(forward).multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
		// (The group sits at the world's origin and never moves: everything in it is placed in world space.)
		this.spot = head.clone().addScaledVector(flatDir, Math.cos(below) * DEMO.AHEAD);
		this.spot.y -= Math.sin(below) * DEMO.AHEAD;
		this.target = target.clone();
		this.ring.position.copy(this.target);
		this.ripple.position.copy(this.target);
		this.door.position.copy(this.target).y += 0.04;
		this.door.lookAt(head);
		this.ring.visible = arcs && !door;
		this.door.visible = door;
		this.arcLine.visible = arcs;
		this.ripple.visible = arcs;
		this.disc.visible = demo === 'touch';
		this.disc.position.copy(this.spot).addScaledVector(forward, 0.16); // (where the reaching fingertip arrives)
		this.disc.lookAt(head);
		const mine = side > 0 ? 'right' : 'left';
		this.side = mine;
		if (this.hands) {
			for (const [k, d] of Object.entries(this.hands)) d.visible = kind === 'hands' && k === mine;
			const h = this.hands[mine];
			h.position.copy(this.spot);
			// Seen from the side, as you would hold it: the palm towards you, the fingers pointing to your left and a little up
			// (a pinch read side-on: the thumb and index tips make a small ring you can see). The hand model's own axes
			// are the headset's (its fingers pitch up from its -Z), so the turn is worked out from the pose's joints.
			const j = poseAt(mine, 0), f = j['middle-finger-tip'].position.clone().sub(j.wrist.position).normalize();
			const n = new THREE.Vector3(0, -1, 0).addScaledVector(f, f.y).normalize(); // (the palm side is -Y: its component across the fingers)
			const triad = (p, q) => new THREE.Matrix4().makeBasis(p, q, new THREE.Vector3().crossVectors(p, q));
			const toYou = this._a.copy(head).sub(this.spot).normalize();
			const fingers = this._b.copy(right).multiplyScalar(-Math.cos(0.45)).addScaledVector(UP, Math.sin(0.45)).normalize();
			const palm = this._c.copy(toYou).addScaledVector(fingers, -toYou.dot(fingers)).normalize();
			h.quaternion.setFromRotationMatrix(triad(fingers.clone(), palm.clone()).multiply(triad(f, n).invert()));
			this.baseQuat = h.quaternion.clone();
			this.forward = forward.clone();
		}
		this.state = { t: 0, fade: 0, out: false };
		this.group.visible = true;
	}

	/** Fades it away (the pause is ending). */
	fadeOut() { if (this.state) this.state.out = true; }

	/** Gone at once. */
	stop() {
		this.state = null;
		this.group.visible = false;
		if (this.hands) for (const d of Object.values(this.hands)) d.visible = false;
	}

	/** Once a frame while it plays. */
	update(dt) {
		const s = this.state;
		if (!s) return;
		s.t += dt;
		s.fade = THREE.MathUtils.clamp(s.fade + (s.out ? -dt : dt) / DEMO.FADE, 0, 1);
		if (s.out && s.fade <= 0) { this.stop(); return; }
		this.draw(s);
	}

	/** Poses the hand, the arc, the ring for this moment of the loop. */
	draw(s) {
		if (this.demo === 'flick' || this.demo === 'touch' || this.demo === 'grab') { this.drawGesture(s); return; }
		const m = loopAt(s.t % DEMO.LENGTH), fade = s.fade;
		const h = this.hands?.[this.side];
		let from = this._b.copy(this.spot); // (the pinch point: the hand's own, once there is a hand)
		if (h?.visible) {
			h.userData.pose(poseAt(this.side, m.pinch));
			h.userData.setTip(m.pinch);
			h.userData.setOpacity(fade);
			h.updateMatrixWorld(true);
			const t = h.userData.bones['thumb-tip'], i = h.userData.bones['index-finger-tip'];
			from = t && i ? this._b.setFromMatrixPosition(t.matrixWorld).add(this._c.setFromMatrixPosition(i.matrixWorld)).multiplyScalar(0.5) : from;
		}
		// The arc: a parabola from the pinch to the ring, drawn as far as `m.arc`.
		const to = this.target, n = ARC_POINTS;
		const drawn = Math.max(2, Math.round(m.arc * n));
		for (let k = 0; k < n; k++) {
			const u = Math.min(k, drawn - 1) / (n - 1);
			this.arcPoints[k * 3] = from.x + (to.x - from.x) * u;
			this.arcPoints[k * 3 + 1] = from.y + (to.y - from.y) * u + Math.sin(Math.PI * u) * 0.6;
			this.arcPoints[k * 3 + 2] = from.z + (to.z - from.z) * u;
		}
		this.arcGeometry.setDrawRange(0, m.arc > 0.01 ? drawn : 0);
		this.arcGeometry.attributes.position.needsUpdate = true;
		const colour = m.blue || m.arc >= 1 && m.pinch > 0 ? BLUE : ORANGE;
		this.arcLine.material.color.copy(colour);
		this.arcLine.material.opacity = fade;
		this.ring.material.color.copy(m.blue ? BLUE : ORANGE);
		this.ring.material.opacity = (0.55 + 0.35 * Math.sin(s.t * 4)) * fade;
		this.door.material.opacity = (m.blue ? 1 : 0.5) * fade; // (it lights as the arc reaches it)
		// The ripple after the hand opens: a ring that grows and fades.
		this.ripple.scale.setScalar(1 + 0.6 * m.ripple);
		this.ripple.material.opacity = this.withDoor ? 0 : (1 - m.ripple) * (m.ripple > 0 ? 0.8 : 0) * fade;
	}
}

/** (TipDemo) The flick, touch and grab loops: the hand posed and turned, the disc opening. */
TipDemo.prototype.drawGesture = function (s) {
	const g = gestureAt(this.demo, s.t % DEMO.LENGTH), fade = s.fade, h = this.hands?.[this.side];
	if (h?.visible) {
		h.userData.pose(this.demo === 'grab' ? fistAt(this.side, g.k) : poseAt(this.side, this.demo === 'flick' ? 1 : 0));
		h.userData.setTip(this.demo === 'flick' ? 1 : 0);
		h.userData.setOpacity(fade);
		h.quaternion.copy(this.baseQuat).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, g.turn ?? 0));
		h.position.copy(this.spot).addScaledVector(this.forward, 0.12 * (g.reach ?? 0));
	}
	this.disc.material.opacity = 0.85 * g.disc * fade;
	this.disc.scale.setScalar(Math.max(0.01, g.disc));
};

/** Draws an object over the pause's dark: every mesh in it on top, depth ignored. */
function onTop(o) {
	o.traverse((c) => {
		if (!c.isMesh) return;
		c.renderOrder = DEMO.ORDER + (c.renderOrder - 30) * 0.1; // (the hand's depth pass, then its colour: js/hand-model.js)
		for (const m of [].concat(c.material)) m.depthTest = false;
	});
}

const ARC_POINTS = 24;
const poses = {};
/** The demonstration hand's joints with the pinch closed by k (0..1): the right hand is the left one mirrored. */
function fistAt(side, k) {
	const open = (poses[side] ??= { open: side === 'right' ? mirrorPose(HAND_POSES.open) : HAND_POSES.open, fist: side === 'right' ? mirrorPose(HAND_POSES.fist) : HAND_POSES.fist });
	return fistJoints(open.open, open.fist, k);
}

function poseAt(side, k) {
	const open = (poses[side] ??= { open: side === 'right' ? mirrorPose(HAND_POSES.open) : HAND_POSES.open, fist: side === 'right' ? mirrorPose(HAND_POSES.fist) : HAND_POSES.fist });
	return pinchJoints(open.open, open.fist, k);
}
