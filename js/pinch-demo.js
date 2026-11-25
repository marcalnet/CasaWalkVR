// The first time inside: a looping 3D hand shows the move, no card (the UX
// design of 25 Nov 2026, approved by the user; SPEC.md, "The first-time
// demonstration"). It replaces the inside lesson card.
//
// One loop of 3 s: the hand rests sideways in front of you; it pinches (the
// finger tips brighten); a demonstration arc grows from the pinch to an orange
// ring on the floor 1.5-4 m ahead (the nearest hotspot, else 2.5 m ahead); the
// ring turns blue; the hand opens and the ring gives a small ripple; a short
// pause, then again. Under the hand, three words: "Pinch · aim · let go"
// (a controller: "Trigger · aim · let go").
//
// Where: about 1 m in front of you, 25° below eye level and 15° to the right
// (the other side with the tool fan on the right), 1.2 times life size, world-
// locked where it first appears and turned to you (never head-locked).
//
// When it goes: after your first teleport (sound `press`, remembered per input
// kind, `casawalk.welcome.walk.hands` / `.controllers`), or after 15 s (it
// fades over 0.4 s; not remembered, so it comes back next time). Help when
// stuck: 40 s inside with no teleport and it plays once more, then never again
// that visit. Nothing else appears on arriving inside but the room's name.
//
// The hand is the generic hand model (js/hand-model.js) posed between IWER's
// open and fist presets (js/hand-poses.js: pinchJoints). With controllers the
// arc and the ring play alone. Never in photos (the interface layer).

import * as THREE from 'three';
import { loadHands, dressHand, mirrorPose } from './hand-model.js';
import { HAND_POSES, pinchJoints } from './hand-poses.js';
import { Label } from './panel.js';
import { COLOURS } from './theme.js';
import { readSetting, writeSetting } from './settings.js';
import { lessonSetting } from './lessons.js';

export const DEMO = {
	AHEAD: 1.0, BELOW: 25, RIGHT: 15, // metres ahead; degrees below the eyes and to the side
	SCALE: 1.2, LENGTH: 3, // the hand's size (times life) and one loop (s)
	SHOW: 15, FADE: 0.4, STUCK: 40, // seconds on screen, fade, and the wait before the one replay
	LABEL: 'Pinch · aim · let go', LABEL_CONTROLLERS: 'Trigger · aim · let go',
};

/** The loop's moments (s): the hand pinches, the arc grows, the ring is steady, the hand opens. */
export const LOOP = { pinchFrom: 0.5, pinchTo: 0.9, arcTo: 1.7, openFrom: 2.2, openTo: 2.5 };

/** The loop's state at time t (s into the loop): pinch 0..1, arc 0..1 (how much is drawn), blue (the ring is steady), ripple 0..1. */
export function loopAt(t) {
	const L = LOOP, ramp = (a, b) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
	const pinch = ramp(L.pinchFrom, L.pinchTo) * (1 - ramp(L.openFrom, L.openTo));
	const arc = t < L.openFrom ? ramp(L.pinchTo, L.arcTo) : 1 - ramp(L.openFrom, L.openTo);
	return { pinch, arc, blue: t >= L.arcTo && t < L.openFrom, ripple: t >= L.openFrom ? ramp(L.openFrom, DEMO.LENGTH) : 0 };
}

const UP = new THREE.Vector3(0, 1, 0);
const BLUE = new THREE.Color(0x4d8dff), ORANGE = new THREE.Color(COLOURS.primary);

export class PinchDemo {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.group = new THREE.Group();
		this.group.name = 'pinch-demo';
		this.group.visible = false;
		this.state = null; // { t (since it began), fade (0..1 visible), out (fading away) }
		this.visit = null; // { t (since stepping inside), teleported, replayed }
		this.kind = 'hands';
		this.hand = null; // the dressed hand model, once loaded (none in Node tests)
		this.loaded = loadHands().then((h) => {
			if (!h) return;
			this.hands = { left: dressHand(h.left, 'left'), right: dressHand(h.right, 'right') };
			for (const d of Object.values(this.hands)) { d.visible = false; d.scale.setScalar(DEMO.SCALE); this.group.add(d); }
		});
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 48).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: COLOURS.primary, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
		this.ring.name = 'pinch-demo-ring';
		this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.53, 48).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0x4d8dff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
		this.ripple.name = 'pinch-demo-ripple';
		this.arcGeometry = new THREE.BufferGeometry();
		this.arcPoints = new Float32Array(ARC_POINTS * 3);
		this.arcGeometry.setAttribute('position', new THREE.BufferAttribute(this.arcPoints, 3));
		this.arcLine = new THREE.Line(this.arcGeometry, new THREE.LineBasicMaterial({ color: COLOURS.primary, transparent: true, depthTest: false }));
		this.arcLine.frustumCulled = false;
		this.arcLine.renderOrder = 11;
		this.arcLine.name = 'pinch-demo-arc';
		this.label = new Label({ height: 0.045 });
		this.group.add(this.ring, this.ripple, this.arcLine, this.label.mesh);
		for (const o of [this.ring, this.ripple, this.arcLine]) o.raycast = () => {};
		xr.scene.add(this.group);
		xr.hideFromPhotos(this.group);
		this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
	}

	/** True while it shows. */
	get playing() { return !!this.state; }

	/** The input kind now (as the lessons read it): controllers if any is held, else bare hands. */
	inputKind() { return this.xr.input.active().length ? 'controllers' : 'hands'; }

	/** Stepping inside: starts the demonstration the first time for this input kind. */
	start() {
		const kind = this.inputKind();
		if (!this.xr.session || readSetting(lessonSetting('walk', kind))) { this.stop(); return false; }
		this.visit = { t: 0, teleported: false, replayed: false };
		this.play(kind);
		return true;
	}

	/** Leaving the home, or VR: gone at once. */
	stop() {
		this.state = null;
		this.visit = null;
		this.group.visible = false;
		if (this.hands) for (const d of Object.values(this.hands)) d.visible = false;
	}

	/** The app says what you did: your first teleport ends it (sound `press`, remembered). */
	note(event) {
		if (event !== 'teleport' || !this.visit || this.visit.teleported) return;
		this.visit.teleported = true;
		writeSetting(lessonSetting('walk', this.kind), true);
		if (this.state && this.xr.soundLevel !== 'off') this.xr.sound.play('press');
		if (this.state) this.state.out = true;
	}

	/** Puts it in front of you (world-locked from here) and starts the loop. */
	play(kind) {
		const xr = this.xr, head = xr.headWorld(), { forward, right } = xr.viewAxes();
		this.kind = kind;
		const side = xr.toolFan === 'right' ? -1 : 1, a = THREE.MathUtils.degToRad(DEMO.RIGHT) * side, below = THREE.MathUtils.degToRad(DEMO.BELOW);
		const flat = this._a.copy(forward).multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a));
		// (The group sits at the world's origin and never moves: everything in it is placed in world space.)
		this.spot = head.clone().addScaledVector(flat, Math.cos(below) * DEMO.AHEAD);
		this.spot.y -= Math.sin(below) * DEMO.AHEAD;
		this.target = this.findTarget();
		this.ring.position.copy(this.target);
		this.ripple.position.copy(this.target);
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
			const triad = (a, b) => new THREE.Matrix4().makeBasis(a, b, new THREE.Vector3().crossVectors(a, b));
			const toYou = this._a.copy(head).sub(this.spot).normalize();
			const fingers = this._b.copy(right).multiplyScalar(-Math.cos(0.45)).addScaledVector(UP, Math.sin(0.45)).normalize();
			const palm = this._c.copy(toYou).addScaledVector(fingers, -toYou.dot(fingers)).normalize();
			h.quaternion.setFromRotationMatrix(triad(fingers.clone(), palm.clone()).multiply(triad(f, n).invert()));
		}
		this.label.set(kind === 'hands' ? DEMO.LABEL : DEMO.LABEL_CONTROLLERS);
		this.label.mesh.position.copy(this.spot).y -= 0.2;
		this.state = { t: 0, fade: 0, out: false };
		this.group.visible = true;
	}

	/** The orange ring: the nearest hotspot 1.5-4 m ahead, else a floor point 2.5 m ahead (else just ahead of you). */
	findTarget() {
		const xr = this.xr, head = xr.headWorld(), { forward } = xr.viewAxes();
		let best = null;
		for (const s of xr.model?.hotspots ?? xr.modes.walk.spots?.() ?? []) {
			const p = xr.centerer.localToWorld(new THREE.Vector3(s.x, s.y, s.z));
			const d = Math.hypot(p.x - head.x, p.z - head.z);
			const ahead = (p.x - head.x) * forward.x + (p.z - head.z) * forward.z;
			if (d < 1.5 || d > 4 || ahead < d * 0.7) continue;
			if (!best || Math.abs(d - 2.5) < Math.abs(best.d - 2.5)) best = { p, d };
		}
		const at = best?.p ?? xr.findFloor(head.clone().addScaledVector(forward, 2.5), 0.5) ?? head.clone().addScaledVector(forward, 2.5).setY(head.y - xr.lift);
		return at.clone().setY(at.y + 0.015);
	}

	/** Once a frame (inside only). */
	update(dt) {
		const xr = this.xr;
		if (xr.mode !== 'walk') { if (this.visit || this.state) this.stop(); return; }
		const v = this.visit;
		if (!v) return;
		v.t += dt;
		// Help when stuck: 40 s inside with no teleport, it plays once more.
		if (!this.state && !v.teleported && !v.replayed && v.t > DEMO.STUCK) { v.replayed = true; this.play(this.inputKind()); }
		const s = this.state;
		if (!s) return;
		s.t += dt;
		if (s.t > DEMO.SHOW) s.out = true;
		s.fade = THREE.MathUtils.clamp(s.fade + (s.out ? -dt : dt) / DEMO.FADE, 0, 1);
		if (s.out && s.fade <= 0) { this.state = null; this.group.visible = false; if (this.hands) for (const d of Object.values(this.hands)) d.visible = false; return; }
		this.draw(s);
	}

	/** Poses the hand, the arc, the ring for this moment of the loop. */
	draw(s) {
		const m = loopAt(s.t % DEMO.LENGTH), fade = s.fade, head = this.xr.headWorld();
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
		// The ripple after the hand opens: a ring that grows and fades.
		this.ripple.scale.setScalar(1 + 0.6 * m.ripple);
		this.ripple.material.opacity = (1 - m.ripple) * (m.ripple > 0 ? 0.8 : 0) * fade;
		this.label.mesh.material.opacity = fade;
		this.label.mesh.lookAt(head);
	}
}

const ARC_POINTS = 24;
const poses = {};
/** The demonstration hand's joints with the pinch closed by k (0..1): the right hand is the left one mirrored. */
function poseAt(side, k) {
	const open = (poses[side] ??= { open: side === 'right' ? mirrorPose(HAND_POSES.open) : HAND_POSES.open, fist: side === 'right' ? mirrorPose(HAND_POSES.fist) : HAND_POSES.fist });
	return pinchJoints(open.open, open.fist, k);
}
