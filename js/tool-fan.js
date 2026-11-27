// The tool fan (SPEC.md phase 17, milestone C2): the three tools, small,
// float in an arc about 15 cm above the fan hand (the left by default; Main
// hand: Left swaps both wrists), gently bobbing, full size, whenever that hand
// or controller is tracked: no watch pose, no fades (the next-build asks,
// section 5). While the fan hand is in its own area (the left: js/zones.js)
// they are home over it; out of it they wait, grouped, at the edge of the
// centre (never over the model or the keys), and glide between on a
// 0.25 s spring. While the other hand is within reach of them (0.25 m, until
// 0.35), nothing but the fan hand moves them: a tool never slides away from
// the hand reaching for it. Tracking lost: they stay 1 s, then fade.
//
// Taking a tool: reach over with the other hand. The tool you touch (the
// fingertip or the controller's tip within 5 cm) lifts a little (sound and
// vibration tick); squeeze that hand's grip, or close the bare hand, and it
// springs into the hand. Taking another the same way swaps them. Putting it
// back: with a controller, squeeze the grip away from the fan; with a bare
// hand, bring the tool back to its place in the fan. While a tool is held its
// hand's trigger, grip and second button are the tool's (js/xr-tools.js).
//
// Keeping the two wrists apart: while the taking hand is within reach of the
// tools (fanBusy: the reach, 0.25 m, let go at 0.35 m). (The orb ignored touches then; the keys that replaced it, build 215's C8, never do.)

import * as THREE from 'three';
import { MarkerTool } from './marker-tool.js';
import { LaserMeter } from './laser-meter.js';
import { StreetCamera } from './street-camera.js';
import { ease } from './tween.js';
import { Label, LABEL_H } from './panel.js';
import { RAMP, pxFor } from './type-ramp.js';
import { TOOLS, edgeSpot, keepFromEyes, dampTowards } from './zones.js';
import { HOLD, magnetStep, toolPose } from './hold.js';
import { CONTROL_CUE } from './theme.js';

export const ABOVE = 0.15; // the fan's middle, above the fan hand (metres)
const SPACING = 0.115; // between tools in the arc (the marker and the meter lie across it, 9 and 11 cm long)
// How each tool shows in the fan (the user's note, 24 Nov): the camera from the front, its lens towards you; the meter and
// the marker from the side, their length across the fan like tools on a pegboard, nib to the left as you see it.
// The marker turns its cap end 40° towards you, so the ring on its back shows (build 215's B2: lying flat across the
// fan, the ring was seen edge-on).
const VIEW = { camera: Math.PI, meter: Math.PI / 2, marker: Math.PI / 2 - THREE.MathUtils.degToRad(40) };
// Each tool's name tag: 3 cm tall, 5 cm under it; its word hand-lettered, 1.4° from about 0.5 m (12 mm capitals: build 215's C5, js/type-ramp.js).
export const TAG = { height: 0.03, below: -0.05, readAt: 0.5 };
TAG.px = pxFor(RAMP.kalam, 'kalam', TAG.height / LABEL_H, TAG.readAt);
const NAMES = { camera: 'Camera', meter: 'Meter', marker: 'Marker' };
const REACH = 0.05; // a controller's tip this close to a tool touches it
const REACH_HAND = 0.07; // a bare fingertip: tracking is looser, and the tools are small (the marker is 9 cm)
const PALM_REACH = 0.09; // a closing bare hand: its palm this close to a tool still takes it (the fingers curl away from the tool as the hand closes)
const MEMORY = 0.6; // seconds a touched tool stays the one a closing hand takes
const OUT = 0; // the fan's middle (the meter) sits straight over the fan hand (build 215's B1: the camera on its outer side, the marker on its inner side; before, 8 cm outward put the marker over the hand, out of the other hand's easy reach)
const KEYS_CLEAR = 0.1; // no tool nearer the main hand's keys than this (m): the fan moves outward (build 215's B1: never over the orb, now its keys, C8)
const FRONT = 0.005; // a tool held by a controller: its back this far in front of the laser's start (the controller's front face)
const OUTLINE_W = 0.0025; // the empty place's outline: 2.5 mm (CONTROL_CUE, 40%)
const FADE = 0.2; // seconds: the fan appears and goes (tracking found or lost)
// A touched tool (build 215's A7: the tick and the lift repeated like an alarm, faster or slower with the distance:
// the lift carried the tool out of reach, it dropped back, and was touched again): touched within the reach of where
// it rests (its lift and bob left out), let go only HOT_CLEAR further, and each tool ticks at most once a TICK_GAP.
const HOT_CLEAR = 0.02, TICK_GAP = 1;

export class ToolFan {
	/** xr: the XRExperience (its ToolSystem gets the tools). */
	constructor(xr) {
		this.xr = xr;
		this.group = new THREE.Group();
		this.group.name = 'tool-fan';
		this.group.visible = false;
		this.alpha = 0;
		this.t = 0;
		this.hot = null; // the slot a tip is touching
		this.fanBusy = false;
		this.target = null; // the slot a closing bare hand would take: the touched one, one touched a moment ago, or the one at the palm
		this.mem = null; // { slot, t }: the last slot a bare fingertip touched
		this._outward = new THREE.Vector3(); // across the view, away from the middle, on the fan hand's side
		const make = (name, tool) => {
			const object = tool.object, slot = { name, object, home: new THREE.Group(), pose: new THREE.Group(), held: false };
			slot.pose.rotation.y = VIEW[name] ?? 0; // (the pose is the group's, so the tool's own rotation stays free)
			slot.pose.add(object);
			slot.home.add(slot.pose);
			slot.label = new Label({ height: TAG.height, px: TAG.px, font: 'kalam' });
			slot.label.set(NAMES[name] ?? name);
			slot.label.mesh.position.y = TAG.below;
			slot.home.add(slot.label.mesh);
			slot.outline = outlineOf(object); // (the empty place, while its armed tool is near: js/hold.js, the magnet)
			slot.home.add(slot.outline);
			this.group.add(slot.home);
			const own = { take: tool.take?.bind(tool), putBack: tool.putBack?.bind(tool) };
			tool.take = (c) => { this.attach(slot, c); own.take?.(c); };
			tool.putBack = () => { this.detach(slot); own.putBack?.(); };
			slot.tool = tool;
			xr.tools.add(tool);
			return slot;
		};
		// The street camera works from milestone D (js/street-camera.js).
		this.camera = new StreetCamera(xr);
		this.meter = new LaserMeter(xr); // (milestone E)
		this.marker = new MarkerTool(xr); // (milestone F)
		this.slots = [
			make('camera', this.camera),
			make('meter', this.meter),
			make('marker', this.marker),
		];
		for (const s of this.slots) s.object.scale.setScalar(s.object.userData.fanScale);
		xr.scene.add(this.group);
		xr.hideFromPhotos(this.group, ...this.slots.map((s) => s.object));
	}

	/**
	 * Before the menu and the mode: a controller touching a tool in the fan
	 * owns its grip this frame (a squeeze that takes a tool never grabs the
	 * model or the space).
	 */
	claim() {
		const take = this.hands().take;
		if (this.hot && take?.isController && take.claim.grip === null) take.claim.grip = 'tool';
		// (A bare hand closing on a tool takes the tool, never the model too: the tester's finding.)
		this.fistTaken = this.target && take?.isHand ? take : null;
	}

	/** True if bare hand c's closing fist is the fan's this frame (it takes a tool, never the model). */
	claimsFist(c) { return this.fistTaken === c; }

	/** The fan hand and the taking hand (input entries, or null). */
	hands() {
		const xr = this.xr, fanSide = xr.toolFan === 'right' ? 'right' : 'left', takeSide = fanSide === 'left' ? 'right' : 'left';
		const find = (side) => xr.input.controllers.find((c) => c.handedness === side && ((c.isController && !c.resting) || (c.isHand && c.touch.tracked))) ?? null;
		return { fan: find(fanSide), take: find(takeSide) };
	}

	/** Once a frame (after the mode): open or close, touch, take, swap, put back. */
	update(dt) {
		const xr = this.xr, input = xr.input;
		this.t += dt;
		const { fan, take } = this.hands();
		const held = xr.tools.held;
		// Where the fan floats: above the fan hand, facing you. (Reused vectors: nothing allocated per frame.)
		const head = xr.headWorld();
		const anchor = this._anchor ??= new THREE.Vector3(), at = this._at ??= new THREE.Vector3(), wrist = this._wr ??= new THREE.Vector3();
		if (fan && xr.session) {
			this.lost = 0;
			input.wristOf(fan).getWorldPosition(wrist);
			// Home: above the fan hand and to its outer side (across the view).
			const outward = this._outward;
			outward.copy(xr.viewAxes().right).multiplyScalar(xr.toolFan === 'right' ? 1 : -1);
			anchor.copy(wrist).addScaledVector(outward, OUT);
			anchor.y += ABOVE;
			this.clearOfKeys(anchor, outward);
			this.aim(fan, take, anchor, wrist, head, dt);
		} else this.lost = (this.lost ?? 0) + dt;
		// (The pause's dark covers it between places: js/pause.js. Tracking lost: it stays LOST_HOLD, then fades.)
		const open = !!xr.session && this.lost < TOOLS.LOST_HOLD;
		this.alpha = THREE.MathUtils.clamp(this.alpha + (open ? dt : -dt) / (open ? FADE : TOOLS.LOST_FADE), 0, 1);
		this.group.visible = this.alpha > 0;
		if (this.group.visible) this.place(head);
		// Touching a tool with the taking hand's tip (where it rests: see HOT_CLEAR).
		let hot = null;
		if (this.alpha > 0.5 && take?.touch.tracked) {
			const reach = take.isHand ? REACH_HAND : REACH;
			let best = Infinity;
			this.slots.forEach((s, i) => {
				if (s.held) return;
				const d = this.restWorld(i, at).distanceTo(take.touch.tip);
				if (d < (s === this.hot ? reach + HOT_CLEAR : reach) && d < best) { best = d; hot = s; }
			});
		}
		if (hot !== this.hot) {
			if (hot && (hot.tickAt ?? -Infinity) <= this.t - TICK_GAP) {
				hot.tickAt = this.t;
				this.feel(take, 'tick', 'tick');
			}
			this.hot = hot;
		}
		this.fanBusy = this.alpha > 0.5 && this.reach; // (within reach of the tools, 0.25 m in, 0.35 m out; the next-build asks 5.4. The main hand's keys take a touch whatever it says: build 215's C8)
		// A closing bare hand takes the tool it touched (a moment ago: the fingers curl away as the hand closes) or holds in its palm.
		this.target = this.hot;
		if (take?.isHand && this.alpha > 0.5 && take.touch.tracked) {
			if (this.hot) this.mem = { slot: this.hot, t: this.t };
			if (!this.target && this.mem && this.t - this.mem.t < MEMORY && !this.mem.slot.held) this.target = this.mem.slot;
			if (!this.target) {
				const palm = xr.modes.dollhouse.holdPoint(take, this._palm ??= new THREE.Vector3());
				let best = PALM_REACH;
				if (palm) for (const s of this.slots) {
					if (s.held) continue;
					const d = s.home.getWorldPosition(at).distanceTo(palm);
					if (d < best) { best = d; this.target = s; }
				}
			}
			if (this.target) this.fanBusy = true;
		} else this.mem = null;
		// Taking: the grip (controller) or a closed hand (bare hand) on the touched tool.
		if (take) {
			const grab = take.isController ? take.state.down.grip : take.gestures?.some((e) => e.type === 'fist');
			const aim = take.isHand ? this.target : this.hot;
			if (grab && aim && (!held || held.c !== take || held.mode !== 'use')) { // (in use mode the held tool owns its hand: js/hold.js)
				xr.tools.take(aim.tool, take);
			} else if (grab && held?.c === take && take.isController) {
				// A squeeze away from the fan puts the held tool back.
				xr.tools.putBack();
			}
		}
		// The magnet (js/hold.js): an armed tool near its own place shows the place's outline, and within reach of it goes back.
		for (const s of this.slots) s.outline.visible = false;
		if (held && this.alpha > 0.5) {
			const i = this.slots.findIndex((s) => s.tool === held.tool);
			if (i >= 0) {
				const m = magnetStep(held.magnet ??= { armed: false }, held.mode, held.tool.object.getWorldPosition(at).distanceTo(this.restWorld(i, this._at2 ??= new THREE.Vector3())));
				this.slots[i].outline.visible = m.outline;
				// (Never while its options row shows: the other hand is pressing it, the Tester's guard.)
				if (m.fire && xr.dial?.open?.tool !== held.tool) { xr.tools.putBack(); if (xr.soundLevel !== 'off') xr.sound.play('tick', 0.6); }
			}
		}
		this.meter.fit(); // (the measured lines keep their size to the eye whatever the zoom)
	}

	/**
	 * Where the tools go this frame (js/zones.js): home over the fan hand while
	 * it is in its own area, else waiting at the edge of the centre; the glide
	 * between on the critically damped spring; within reach of the other hand,
	 * only the fan hand moves them (no glide starts, waiting they stay put).
	 */
	aim(fan, take, anchor, wrist, head, dt) {
		const xr = this.xr, areas = xr.areas, side = xr.toolFan === 'right' ? -1 : 1; // (+1: the fan's area is the left)
		const area = areas?.hands[xr.input.controllers.indexOf(fan)] ?? null;
		const own = side > 0 ? 'left' : 'right';
		// Within reach: the other hand's tip near the nearest tool (hysteresis).
		let near = Infinity;
		if (take?.touch.tracked) for (const s of this.slots) if (!s.held) near = Math.min(near, s.home.getWorldPosition(this._rp ??= new THREE.Vector3()).distanceTo(take.touch.tip));
		this.reach = near < (this.reach ? TOOLS.REACH_CLEAR : TOOLS.REACH);
		const home = !areas?.centre || area === null || area === own;
		if (!this.reach) this.mode = home ? 'home' : 'edge';
		this.mode ??= 'home';
		this.pos ??= anchor.clone(); this.vel ??= new THREE.Vector3();
		const target = this._tt ??= new THREE.Vector3();
		if (this.mode === 'home') target.copy(anchor);
		else if (this.reach) target.copy(this.pos); // (waiting, with a hand reaching for them: they stay put)
		else edgeSpot(head, areas.centre, side, wrist, target);
		keepFromEyes(target, head); // (never at the face: pushed out, never hidden)
		if (this.mode !== this.was) this.gliding = true;
		this.was = this.mode;
		if (this.gliding || this.mode === 'edge') {
			dampTowards(this.pos, this.vel, target, dt);
			if (this.mode === 'home' && this.pos.distanceTo(target) < 0.01) this.gliding = false;
		} else { this.pos.copy(target); this.vel.set(0, 0, 0); }
	}

	/** Moves a fan middle outward (along `outward`) until no tool rests within KEYS_CLEAR of the main hand's keys. */
	clearOfKeys(at, outward) {
		const keys = this.xr.ui?.wrist;
		if (!keys?.group.visible || this.xr.tools?.held) return at; // (a tool held: the keys' hand is bringing it home; the dock never runs from it)
		const spots = Object.values(keys.keys).map((k) => k.group.getWorldPosition(new THREE.Vector3()));
		const right = this.xr.viewAxes().right, t = this._ot ??= new THREE.Vector3();
		for (let round = 0; round < 3; round++) {
			let worst = 0;
			for (let i = -1; i <= 1; i++) for (const o of spots) worst = Math.max(worst, KEYS_CLEAR - t.copy(at).addScaledVector(right, i * SPACING).distanceTo(o));
			if (worst <= 0) break;
			at.addScaledVector(outward, worst + 0.005);
		}
		return at;
	}

	/** True while the fan floats over the right hand (Main hand: Left): its order mirrors, the marker still on its inner side. */
	get mirrored() { return this.xr.toolFan === 'right'; }

	/**
	 * Slot i's place in the arc (the fan's own space, without the lift and the
	 * bob): the camera on the fan hand's outer side, the meter in the middle,
	 * the marker on its inner side, either hand (B1; mirrored over the right
	 * hand: the Tester's finding).
	 */
	slotAt(i, out = new THREE.Vector3()) {
		const k = (i - 1) * (this.mirrored ? -1 : 1);
		return out.set(k * SPACING, Math.cos((i - 1) * 0.5) * 0.02 - 0.02, 0);
	}

	/** Where slot i rests in the fan (world): its place in the arc, without the touched lift or the bob. */
	restWorld(i, out = new THREE.Vector3()) {
		this.group.updateWorldMatrix(true, false);
		return this.group.localToWorld(this.slotAt(i, out));
	}

	/** The fan where aim() put it, turned to face you; tools bob gently. */
	place(head) {
		this.group.position.copy(this.pos ?? this._anchor);
		this.group.lookAt(head);
		const shown = this.alpha > 0.05;
		this.slots.forEach((s, i) => {
			const lift = s === this.hot ? 0.012 : 0;
			const bob = 0.004 * Math.sin(this.t * 2 + i * 1.7);
			this.slotAt(i, s.home.position).y += lift + bob;
			s.pose.rotation.y = this.mirrored ? -(VIEW[s.name] ?? 0) : VIEW[s.name] ?? 0; // (mirrored over the right hand: the marker's cap still turns to you)
			if (!s.held) s.object.visible = shown;
		});
		for (const s of this.slots) s.label.mesh.visible = !s.held && shown; // (the name tags go while the tool is in your hand)
	}

	/**
	 * A tool springs into hand c (js/hold.js, "How each tool sits on the
	 * hand"): a bare hand holds it in its hold frame (c.hold, placed each frame
	 * by the ToolSystem), a controller along its pointing ray (target-ray
	 * space, not its grip: the lens, the beam and the nib point where you aim),
	 * just in front of its front face. Each tool sits its own way (toolPose),
	 * its grip point at the frame's origin.
	 */
	attach(slot, c) {
		const xr = this.xr, o = slot.object;
		if (slot.glide) { xr.tweens.stop(slot.glide); slot.glide = null; }
		slot.held = true;
		const at = c.isHand ? this.holdGroup(c) : c.ray;
		at.add(o);
		const pose = toolPose(slot.name, c.handedness);
		o.scale.setScalar(1);
		o.rotation.set(...pose.rotation);
		const grip = o.getObjectByName('grip')?.position ?? new THREE.Vector3();
		o.position.fromArray(pose.position).sub(grip.clone().applyEuler(o.rotation));
		if (!c.isHand) o.position.z -= FRONT + backOf(o); // (its back just in front of the controller's front face)
		o.visible = true;
		const s0 = slot.object.userData.fanScale;
		slot.spring = xr.tweens.start({ duration: 0.3, ease: ease.spring, step: (k) => o.scale.setScalar(s0 + (1 - s0) * k), done: () => { slot.spring = null; } });
		this.feel(c, 'grab', 'click');
	}

	/** The group a bare hand holds its tool in (in the rig; the ToolSystem places it each frame from the joints). */
	holdGroup(c) {
		if (!c.hold) {
			c.hold = new THREE.Group();
			c.hold.name = `hold-${c.index}`;
			c.wrist.parent.add(c.hold);
			c.hold.position.copy(c.wrist.position); c.hold.quaternion.copy(c.wrist.quaternion); // (until the first frame places it)
		}
		return c.hold;
	}

	/** The tool glides back to its place in the fan (HOLD.GLIDE, easing out; at once when the fan is not shown). */
	detach(slot) {
		const o = slot.object, xr = this.xr;
		slot.held = false;
		if (slot.spring) { xr.tweens.stop(slot.spring); slot.spring = null; }
		if (slot.tool === this.camera) this.camera.clearPrints(); // (no print left floating over the fan)
		const fs = o.userData.fanScale;
		if (this.alpha > 0.05 && xr.session && o.parent) {
			o.updateWorldMatrix(true, false); slot.pose.updateWorldMatrix(true, false);
			slot.pose.attach(o); // (where it is now, in the place's space: it glides from there)
			const p0 = o.position.clone(), q0 = o.quaternion.clone(), s0 = o.scale.x, q1 = new THREE.Quaternion();
			slot.glide = xr.tweens.start({ duration: HOLD.GLIDE, ease: ease.out, step: (k) => {
				o.position.copy(p0).multiplyScalar(1 - k);
				o.quaternion.slerpQuaternions(q0, q1, k);
				o.scale.setScalar(s0 + (fs - s0) * k);
			}, done: () => { slot.glide = null; o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.setScalar(fs); } });
		} else {
			slot.pose.add(o);
			o.position.set(0, 0, 0);
			o.rotation.set(0, 0, 0);
			o.scale.setScalar(fs);
		}
		o.visible = this.alpha > 0.05;
		if (xr.soundLevel !== 'off') xr.sound.play('whoosh', 0.6);
	}

	/** Where the dock's middle is (world): the fan's middle, over the fan hand or waiting at the edge (js/hold.js); null while the fan is not shown (no dock: a held tool is in use). */
	dockAt(out = new THREE.Vector3()) { return this.alpha > 0 ? this.group.getWorldPosition(out) : null; }

	feel(c, sound, haptic) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/** Leaving VR: closed, nothing touched. */
	/** The session ends (js/xr.js handleEnd): the fan put away (the tools themselves: js/xr-tools.js end). */
	end() { this.reset(); }

	reset() {
		this.alpha = 0;
		this.group.visible = false;
		this.hot = null;
		this.target = this.mem = null;
		this.fanBusy = false;
		this.pos = this.vel = null; this.mode = this.was = null; this.gliding = false; this.reach = false; this.lost = 0;
	}
}

/** How far a tool reaches behind its own origin (+Z, its back), at its own rotation (m). */
function backOf(o) {
	const box = new THREE.Box3(), m = new THREE.Matrix4().makeRotationFromEuler(o.rotation);
	o.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
	o.traverse((c) => { if (c.isMesh && c.geometry) { c.geometry.computeBoundingBox(); box.union(c.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld))); } });
	box.applyMatrix4(m);
	const grip = o.getObjectByName('grip')?.position.clone().applyMatrix4(m) ?? new THREE.Vector3();
	return box.isEmpty() ? 0 : Math.max(0, box.max.z - grip.z);
}

/**
 * The outline of a tool's place in the fan (C1, the magnet): a thin frame
 * round the tool as it sits in the fan (its box at fan scale, facing you),
 * CONTROL_CUE's colour at 40%, 2.5 mm wide. Hidden until its armed tool is near.
 */
function outlineOf(object) {
	const box = new THREE.Box3();
	object.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
	object.traverse((c) => { if (c.isMesh && c.geometry) { c.geometry.computeBoundingBox(); box.union(c.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld))); } });
	const k = object.userData.fanScale ?? 1, size = box.isEmpty() ? new THREE.Vector3(0.05, 0.05, 0.05) : box.getSize(new THREE.Vector3());
	const w = Math.max(size.x, size.z) * k + 0.01, h = size.y * k + 0.01, t = OUTLINE_W;
	const mat = new THREE.MeshBasicMaterial({ color: CONTROL_CUE.color, transparent: true, opacity: CONTROL_CUE.opacity, depthWrite: false });
	const g = new THREE.Group();
	for (const [x, y, bw, bh] of [[0, h / 2, w, t], [0, -h / 2, w, t], [-w / 2, 0, t, h], [w / 2, 0, t, h]]) {
		const bar = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), mat);
		bar.position.set(x, y, 0);
		bar.raycast = () => {};
		g.add(bar);
	}
	g.name = 'place-outline';
	g.visible = false;
	return g;
}
