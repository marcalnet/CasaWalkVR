// The wrist menu (milestone C0.3; SPEC.md C0 "Hands and touch" and "Layers").
//
// One orb on one wrist: the right one, or the left when the tool fan is set
// to the right hand (the fan takes the other hand, milestone C). Touching the
// orb with the other index (or the other controller's tip), pressing A (X
// when swapped) or pointing at it and pulling the trigger springs out three
// keys in an arc (the design of 24 Nov, item 5), floating 7 cm in front of the
// wrist towards the eyes (so the hand is behind them whichever way it turns),
// laid out as you see them (view space: right stays on your right whichever
// wrist wears it and however it is turned):
//
//        ← Back  Settings (and help)
//       (orb)          Walk in →     (inside: a flat "Inside" plate with the
//                                     room's name in its place)
//
// The arc rises from just above the orb round to its right, like a quarter
// rainbow, so the orb's left side and underside stay clear for the other
// index. Left to right is forward: the blue doors go one layer back (outline,
// left) or one layer in (filled, right); no key skips a layer. Keys
// (js/keys.js, 7 cm) are pressed by touch or by another controller's laser;
// the hand wearing the menu cannot press it. The arc is frozen: from the moment
// it opens it stays where it is in the world (a menu spawned from the wrist
// is static, HB §3), so the wearing hand can move freely. It closes after any
// key, when the orb is touched again, with B/Y, when the wrist is out of view
// for 0.4 s (a bare hand), or after 12 s with no finger within 15 cm of the nearest key and no laser on
// one; opened by a controller it stays until a key, B/Y or A again, or the 12 s.

import * as THREE from 'three';
import { WRIST_ORB } from './xr-input.js';
import { WRIST } from './theme.js';
import { ease } from './tween.js';
import { KeyPad } from './keys.js';

export const ORB_ON_GRIP = new THREE.Vector3(0, 0.035, 0.115); // the orb on a controller, in its grip space
const ORB_SCALE = 1; // the orb at full size (about 5 cm): easy to notice (the user's Quest 2 test)
const ORB_TIP_TOUCH = 0.035, ORB_TIP_RELEASE = 0.08; // a fingertip or controller tip touching the orb
const ORB_GRIP_TOUCH = 0.08, ORB_GRIP_RELEASE = 0.14; // or a whole controller reaching into it
const TOWARDS_EYES = 0.07; // the cross floats this far from the wrist towards the eyes: the hand is always behind it, never over the keys
const IDLE = 12, IDLE_NEAR = 0.15; // seconds with no finger within this of the nearest key (m), and no laser on a key, before it closes: a menu you forgot doesn't hang there
const OUT_OF_VIEW = 0.4; // seconds with the wrist out of view before it closes
const VIEW_ANGLE = THREE.MathUtils.degToRad(50); // "in view": within this of where the head looks
const ORDER = ['left', 'up', 'right']; // along the arc, ← Back first: the keys spring out in that order

/** What each slot holds at each layer (the same three places at both layers). Help is in Settings, "How to move". */
export function keysFor(mode, roomName = '') {
	return {
		up: { id: 'settings', look: 'plain', icon: 'settings', label: 'Settings', caption: 'and help' },
		right: mode === 'walk'
			? { id: null, look: 'flat', label: 'Inside', caption: roomName } // as deep as it goes: you are here (the keys stay where the hand learned them)
			: { id: 'in', look: 'filled', icon: 'in', label: 'Walk in →', caption: 'Inside the home' },
		left: { id: 'back', look: 'outline', icon: 'back', label: '← Back', caption: mode === 'walk' ? 'Scale model' : 'Leave VR' },
	};
}

export class WristMenu {
	constructor(xr) {
		this.xr = xr;
		this.orb = makeOrb();
		this.orb.group.scale.setScalar(ORB_SCALE);
		this.side = 'right';
		this.open = false;
		this.pinned = false; // opened by a controller: stays until a key, B/Y or A again
		this.openT = 0;
		this.outT = 0;
		this.frozen = false;
		this.idleT = 0;
		this.cross = new THREE.Group();
		this.cross.name = 'wrist-menu';
		this.cross.visible = false;
		this.pad = new KeyPad(xr, 'wrist-key');
		this.keys = {};
		for (const slot of ORDER) { this.keys[slot] = this.pad.add(slot, slot === 'up' ? WRIST.settingsW : WRIST.key); this.cross.add(this.keys[slot].group); }
		this.keysHot = false; this.laserNear = false; this.orbYield = false; // a fingertip is over a key: the orb ignores touches (it sits between the keys)
		xr.scene.add(this.cross);
		xr.hideFromPhotos(this.cross);
		this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._quat = new THREE.Quaternion();
		this._eye = new THREE.Vector3(); this._fwd = new THREE.Vector3(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._at = new THREE.Vector3();
		this.setSide();
	}

	/** The wrist that wears the menu: the hand that doesn't hold the tool fan. */
	setSide() {
		this.side = this.xr.toolFan === 'right' ? 'left' : 'right';
		this.close();
	}

	/** The input entry wearing the menu (a controller, or a tracked bare hand), or null. */
	get wearer() { return this.orb.holder; }

	/** The keys' content for this layer. */
	redraw() {
		const spec = keysFor(this.xr.mode, this.roomName ?? '');
		for (const slot of ORDER) {
			this.pad.setSpec(slot, spec[slot]);
			this.keys[slot].group.visible = !!spec[slot];
		}
	}

	toggle(opts) { this.open ? this.close(true) : this.show(opts); }

	/** Opens the cross. pinned: opened by a controller. */
	show({ pinned = false } = {}) {
		if (!this.wearer) return;
		this.open = true;
		this.pinned = pinned;
		this.openT = 0;
		this.outT = 0;
		this.idleT = 0;
		this.frozen = false;
		this.snap = true;
		this.roomName = this.xr.roomHere?.() ?? '';
		this.redraw();
		this.cross.visible = true;
		this.pad.feel('open');
	}

	close(sound = false) {
		if (this.open && sound) this.pad.feel('close');
		this.open = false;
		this.cross.visible = false;
		this.keysHot = false;
		this.pad.reset();
		this.onClose?.();
	}

	/**
	 * Once a frame (before the board): wears the orb, places and animates the
	 * cross, and handles touches and lasers on the orb and the keys. Claims the
	 * trigger of a controller whose laser is on them. Returns { action } for a
	 * pressed key ({ id }), else { action: null }.
	 */
	update(dt) {
		const xr = this.xr, input = xr.input;
		const wearer = input.wearers().find((c) => c.handedness === this.side) ?? null;
		this.wear(wearer);
		const o = this.orb;
		if (!wearer) { if (this.open) this.close(); animateOrb(o, performance.now() / 1000, false); return { action: null }; }
		const p = o.group.getWorldPosition(this._p);
		let hot = false, toggle = false, byController = false;

		// Touch the orb: another fingertip or controller tip (or a whole controller)
		// reaching into it; not while a fingertip is over a key.
		let touching = false, clear = true;
		for (const c of input.wearers()) {
			if (c === wearer || c.claim.trigger === 'tool') continue;
			const tip = c.touch.tracked ? c.touch.tip.distanceTo(p) : Infinity;
			const grip = c.isController ? (input.pose(c, this._q), this._q.distanceTo(p)) : Infinity;
			if (tip < ORB_TIP_TOUCH || grip < ORB_GRIP_TOUCH) { touching = true; byController ||= c.isController; }
			if (tip < ORB_TIP_RELEASE || grip < ORB_GRIP_RELEASE) clear = false;
		}
		// (Not while the other hand is busy at the tool fan: the fans' hands cross over each other's wrists.)
		if (touching && o.armed && !this.keysHot && !this.xr.fan?.fanBusy) { toggle = true; o.armed = false; }
		if (clear) o.armed = true;
		if (!clear) hot = true;

		// Place the cross: in front of the wrist, facing the eyes, right as you see it.
		if (this.open) this.place(dt, p);

		// The laser on the orb (closed): opens it, pinned.
		if (!this.open) {
			for (const c of input.active()) {
				if (c === wearer || c.claim.trigger) continue;
				input.setRaycaster(c, xr.raycaster);
				const hit = xr.raycaster.intersectObject(o.target, false)[0];
				if (!hit) continue;
				c.claim.trigger = 'ui';
				input.showHit(c, hit.distance);
				hot = true;
				if (c.state.down.trigger) { toggle = true; byController = true; }
			}
		}

		// The keys: touch and lasers (never the wearer's own hand or laser).
		const { action, hot: keysHot, near: padNear } = this.pad.update(dt, { active: this.open, exclude: wearer });
		this.keysHot = keysHot.size > 0;
		this.laserNear = padNear; // (a laser on a key counts as near, however far the hand)
		// The orb's own hand reaching into the fan: it shrinks and fades, out of the way (tool-fan.js sets orbYield).
		o.yieldK += ((this.orbYield ? 1 : 0) - o.yieldK) * (1 - Math.exp(-dt / 0.15 * 1));
		animateOrb(o, performance.now() / 1000, hot || this.open);

		if (action) this.close(); // after any key (Help opens the board, like Settings)
		else if (toggle && !action) {
			if (this.open) this.close(true);
			else this.show({ pinned: byController });
		}
		return { action };
	}

	/** Puts the orb on the wearer's wrist (or takes it off). */
	wear(c) {
		const o = this.orb, input = this.xr.input;
		const anchor = c ? input.wristOf(c) : null;
		if (c === o.holder && o.group.parent === anchor) return;
		o.group.removeFromParent();
		if (c) { anchor.add(o.group); o.group.position.copy(c.isHand ? WRIST_ORB : ORB_ON_GRIP); }
		if (o.holder !== c && this.open) this.close();
		o.holder = c;
	}

	/**
	 * The arc in front of the wrist (towards the eyes, so the hand is behind
	 * it whichever way it turns), facing the eyes, laid out as seen; set once
	 * as it opens and then frozen in the world; springing open.
	 */
	place(dt, p) {
		const xr = this.xr, cam = xr.camera;
		cam.updateMatrixWorld(true);
		const eye = this._eye.setFromMatrixPosition(cam.matrixWorld);
		// Out of view (a bare hand): close after 0.4 s.
		const fwd = this._fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
		const inView = fwd.angleTo(this._q.subVectors(p, eye)) < VIEW_ANGLE;
		this.outT = inView ? 0 : this.outT + dt;
		if (!this.pinned && this.outT > OUT_OF_VIEW) { this.close(true); return; }
		// Frozen: placed once, as it opens (the wrist may move freely after that).
		const wearer = this.wearer;
		this.frozen = !this.snap;
		if (this.snap) {
			const z = this._q.subVectors(eye, p).normalize();
			const at = this._at.copy(p).addScaledVector(z, TOWARDS_EYES);
			const x = this._x.set(1, 0, 0).transformDirection(cam.matrixWorld);
			x.addScaledVector(z, -x.dot(z)).normalize();
			const y = this._y.crossVectors(z, x);
			this._m.makeBasis(x, y, z);
			this._quat.setFromRotationMatrix(this._m);
			this.cross.position.copy(at);
			this.cross.quaternion.copy(this._quat);
			this.snap = false;
		}
		// A menu you forgot doesn't hang there: closed after IDLE seconds with no finger or laser near a key.
		const near = this.keysHot || this.laserNear || xr.input.touches().some((c) => c !== wearer && this.pad.near(c.touch.tip, IDLE_NEAR));
		this.idleT = near ? 0 : this.idleT + dt;
		if (this.idleT > IDLE) { this.close(true); return; }
		// Spring out along the arc, ← Back first.
		this.openT += dt;
		const arc = WRIST.arc;
		ORDER.forEach((slot, i) => {
			const k = this.keys[slot];
			const t = THREE.MathUtils.clamp((this.openT - 0.05 * i) / 0.1, 0, 1);
			const e = ease.spring(t); // (a small overshoot)
			const a = THREE.MathUtils.degToRad(arc.angles[slot]);
			k.group.position.set(Math.cos(a) * arc.radius * e, Math.sin(a) * arc.radius * e, 0);
			k.group.scale.setScalar(0.3 + 0.7 * Math.min(e, 1.1));
			k.out = t >= 1; // pressable once fully out
		});
	}

	/** Leaving VR. */
	reset() {
		this.close();
		this.orb.group.removeFromParent();
		this.orb.holder = null;
	}
}

// ---------------------------------------------------------------------------
// The orb
// ---------------------------------------------------------------------------

/**
 * Orb: a glowing core inside a faceted amber crystal, circled by two thin
 * rings. animateOrb() makes it breathe, turn and shimmer, and glow blue when
 * approached.
 */
export function makeOrb() {
	const group = new THREE.Group();
	group.name = 'menu-orb';
	const core = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true }));
	const shellMat = new THREE.MeshLambertMaterial({ color: 0xe99a45, emissive: 0x8a3f0c, flatShading: true, transparent: true, opacity: 0.78, depthWrite: false });
	const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024, 0), shellMat);
	const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd7a3, transparent: true, opacity: 0.9 });
	const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0018, 6, 48), ringMat);
	const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0016, 6, 48), ringMat);
	// A larger invisible target, so the orb is easy to hit with the laser.
	const target = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
	const body = new THREE.Group();
	body.add(core, shell, ring1, ring2);
	group.add(body, target);
	group.position.copy(ORB_ON_GRIP);
	return { group, body, core, shell, shellMat, ring1, ring2, ringMat, target, holder: null, armed: true, glow: 0, yieldK: 0, phase: Math.random() * 10 };
}

const ORB_AMBER = new THREE.Color(0xe99a45), ORB_BLUE = new THREE.Color(0x4d8dff);
const ORB_EMBER = new THREE.Color(0x8a3f0c), ORB_EMBER_BLUE = new THREE.Color(0x173f8a);

export function animateOrb(o, time, hot) {
	const t = time + o.phase;
	o.glow += ((hot ? 1 : 0) - o.glow) * 0.2;
	// Breathing: two slow waves, so it never looks mechanical.
	const breathe = 1 + 0.1 * Math.sin(t * 2.1) + 0.04 * Math.sin(t * 5.3);
	const y = o.yieldK ?? 0; // (0..1) the orb makes room for a hand reaching into the fan: half size, 30% strength
	o.body.scale.setScalar(breathe * (1 + 0.4 * o.glow) * (1 - 0.5 * y));
	o.shell.rotation.set(t * 0.5, t * 0.8, 0);
	o.ring1.rotation.set(Math.PI / 2 + 0.5 * Math.sin(t * 0.7), t * 1.3, 0);
	o.ring2.rotation.set(0.6 * Math.sin(t * 0.9), -t * 1.1, Math.PI / 3);
	o.shellMat.color.copy(ORB_AMBER).lerp(ORB_BLUE, o.glow);
	o.shellMat.emissive.copy(ORB_EMBER).lerp(ORB_EMBER_BLUE, o.glow).multiplyScalar(0.8 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.2)));
	o.ringMat.opacity = (0.6 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.6))) * (1 - 0.7 * y);
	o.shellMat.opacity = 0.78 * (1 - 0.7 * y);
	o.core.material.opacity = 1 - 0.7 * y;
}
