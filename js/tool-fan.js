// The tool fan (SPEC.md phase 17, milestone C2): the three tools, small,
// float in an arc about 15 cm above the fan hand (the left by default; Main
// hand: Left swaps both wrists), gently bobbing, full size, whenever that hand
// or controller is tracked: no watch pose, no fades (the next-build asks,
// section 5). While the fan hand is in its own area (the left: js/zones.js)
// they are home over it; out of it they wait, grouped, at the edge of the
// centre (never over the model, the keys or the orb), and glide between on a
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
// The street camera sits in the fan from milestone C, honestly inactive
// (until milestone D): dimmed, not bobbing, a "Coming soon" tag on a string.
// Touched or squeezed, it gives a small side-to-side wobble (sound deny) and
// the tag swings forward and grows for 2 s.
//
// Keeping the two wrists apart: while the taking hand is within reach of the
// tools (fanBusy: the reach, 0.25 m, let go at 0.35 m), the orb ignores touches (WristMenu reads it).

import * as THREE from 'three';
import { MarkerTool } from './marker-tool.js';
import { LaserMeter } from './laser-meter.js';
import { StreetCamera } from './street-camera.js';
import { ease } from './tween.js';
import { Label } from './panel.js';
import { TOOLS, edgeSpot, keepFromEyes, dampTowards } from './zones.js';

export const ABOVE = 0.15; // the fan's middle, above the fan hand (metres)
const SPACING = 0.115; // between tools in the arc (the marker and the meter lie across it, 9 and 11 cm long)
// How each tool shows in the fan (the user's note, 24 Nov): the camera from the front, its lens towards you; the meter and
// the marker from the side, their length across the fan like tools on a pegboard, nib to the left as you see it.
const VIEW = { camera: Math.PI, meter: Math.PI / 2, marker: Math.PI / 2 };
const TAG = { height: 0.03, below: -0.05 }; // each tool's name tag
const NAMES = { camera: 'Camera', meter: 'Meter', marker: 'Marker' };
const REACH = 0.05; // a controller's tip this close to a tool touches it
const REACH_HAND = 0.07; // a bare fingertip: tracking is looser, and the tools are small (the marker is 9 cm)
const PALM_REACH = 0.09; // a closing bare hand: its palm this close to a tool still takes it (the fingers curl away from the tool as the hand closes)
const MEMORY = 0.6; // seconds a touched tool stays the one a closing hand takes
const OUT = 0.08; // the open fan sits this far to the fan hand's outer side, beside its ABOVE
const RETURN = 0.08; // a bare hand bringing its tool this close to its place puts it back
const FADE = 0.2; // seconds: the fan appears and goes (tracking found or lost)

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
		const make = (name, object, live, tool = null) => {
			const slot = { name, object, live, home: new THREE.Group(), pose: new THREE.Group(), wobble: 0, tagGrow: 0, held: false };
			slot.pose.rotation.y = VIEW[name] ?? 0; // (the pose is the group's, so the tool's own rotation stays free for the wobble)
			slot.pose.add(object);
			slot.home.add(slot.pose);
			slot.label = new Label({ height: TAG.height });
			slot.label.set(NAMES[name] ?? name);
			slot.label.mesh.position.y = TAG.below;
			slot.home.add(slot.label.mesh);
			this.group.add(slot.home);
			tool = tool ?? { name, object, live, trigger: () => {}, secondary: () => {} }; // (the meter in milestone E, the marker in F)
			const own = { take: tool.take?.bind(tool), putBack: tool.putBack?.bind(tool) };
			tool.take = (c) => { this.attach(slot, c); own.take?.(c); };
			tool.putBack = () => { this.detach(slot); own.putBack?.(); };
			slot.tool = tool;
			if (live) xr.tools.add(tool);
			return slot;
		};
		// The street camera works from milestone D (js/street-camera.js).
		this.camera = new StreetCamera(xr);
		this.meter = new LaserMeter(xr); // (milestone E)
		this.marker = new MarkerTool(xr); // (milestone F)
		this.slots = [
			make('camera', this.camera.object, true, this.camera),
			make('meter', this.meter.object, true, this.meter),
			make('marker', this.marker.object, true, this.marker),
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
			this.aim(fan, take, anchor, wrist, head, dt);
		} else this.lost = (this.lost ?? 0) + dt;
		// (The pause's dark covers it between places: js/pause.js. Tracking lost: it stays LOST_HOLD, then fades.)
		const open = !!xr.session && this.lost < TOOLS.LOST_HOLD;
		this.alpha = THREE.MathUtils.clamp(this.alpha + (open ? dt : -dt) / (open ? FADE : TOOLS.LOST_FADE), 0, 1);
		this.group.visible = this.alpha > 0;
		if (this.group.visible) this.place(head);
		// Touching a tool with the taking hand's tip.
		let hot = null;
		if (this.alpha > 0.5 && take?.touch.tracked) {
			let best = take.isHand ? REACH_HAND : REACH;
			for (const s of this.slots) {
				if (s.held) continue;
				const d = s.home.getWorldPosition(at).distanceTo(take.touch.tip);
				if (d < best) { best = d; hot = s; }
			}
		}
		if (hot !== this.hot) {
			if (hot && hot.live) this.feel(take, 'tick', 'tick');
			if (hot && !hot.live) this.refuse(hot, take);
			this.hot = hot;
		}
		this.fanBusy = this.alpha > 0.5 && this.reach; // (within reach of the tools, 0.25 m in, 0.35 m out: the orb ignores touches; the next-build asks 5.4)
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
			if (grab && aim) {
				if (!aim.live) this.refuse(aim, take);
				else xr.tools.take(aim.tool, take);
			} else if (grab && held?.c === take && take.isController) {
				// A squeeze away from the fan puts the held tool back.
				xr.tools.putBack();
			}
		}
		// A bare hand brings its tool back to its place: it goes back.
		if (held?.c?.isHand && this.alpha > 0.5) {
			const slot = this.slots.find((s) => s.tool === held.tool);
			const tip = held.tool.object.getWorldPosition(at);
			if (slot && tip.distanceTo(slot.home.getWorldPosition(this._at2 ??= new THREE.Vector3())) < RETURN && slot.settled) xr.tools.putBack();
		}
		this.meter.fit(); // (the measured lines keep their size to the eye whatever the zoom)
		this.animate(dt);
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

	/** The fan where aim() put it, turned to face you; tools bob gently (not the inactive camera). */
	place(head) {
		this.group.position.copy(this.pos ?? this._anchor);
		this.group.lookAt(head);
		const shown = this.alpha > 0.05;
		this.slots.forEach((s, i) => {
			const lift = s === this.hot && s.live ? 0.012 : 0;
			const bob = s.live ? 0.004 * Math.sin(this.t * 2 + i * 1.7) : 0;
			s.home.position.set((i - 1) * SPACING, Math.cos((i - 1) * 0.5) * 0.02 - 0.02 + lift + bob, 0);
			if (!s.held) s.object.visible = shown;
		});
		for (const s of this.slots) s.label.mesh.visible = !s.held && shown; // (the name tags go while the tool is in your hand)
	}

	/** The inactive camera: a small shake of the head, sound deny, and its tag grows for 2 s. */
	refuse(slot, c) {
		slot.wobble = 0.3;
		slot.tagGrow = 2;
		this.feel(c, 'deny', 'deny');
	}

	animate(dt) {
		for (const s of this.slots) {
			if (s.wobble > 0) {
				s.wobble = Math.max(0, s.wobble - dt);
				s.object.rotation.z = Math.sin((0.3 - s.wobble) / 0.3 * Math.PI * 3) * 0.15 * (s.wobble / 0.3);
			}
			if (!s.live) {
				s.tagGrow = Math.max(0, s.tagGrow - dt);
				const tag = s.object.getObjectByName('tag');
				if (tag) tag.scale.setScalar(1 + 0.8 * Math.min(1, s.tagGrow * 2));
			}
		}
	}

	/** A tool springs into hand c: at the hand, its grip point in the palm. */
	attach(slot, c) {
		// A controller carries its tool along its pointing ray (target-ray space), not its grip:
		// the grip tilts up from where the controller points, and the meter's beam, the
		// camera's lens and the marker's nib must point where you aim. A bare hand: its wrist.
		const xr = this.xr, o = slot.object, at = c.isHand ? c.wrist : c.ray;
		slot.held = true;
		slot.settled = false;
		at.add(o);
		const grip = o.getObjectByName('grip');
		o.scale.setScalar(1);
		o.rotation.set(0, 0, 0);
		// (Controllers: a little back from the ray's start, at the front of the controller, and below it.
		// Bare hands: the wrist, a little towards the fingers and the palm.)
		o.position.copy(grip ? grip.position.clone().negate() : new THREE.Vector3());
		o.position.add(c.isHand ? new THREE.Vector3(0, -0.03, -0.07) : new THREE.Vector3(0, -0.025, 0.04));
		o.visible = true;
		const s0 = slot.object.userData.fanScale;
		xr.tweens.start({ duration: 0.3, ease: ease.spring, step: (k) => o.scale.setScalar(s0 + (1 - s0) * k), done: () => { slot.settled = true; } });
		this.feel(c, 'grab', 'click');
	}

	/** The tool flies back to its place in the fan. */
	detach(slot) {
		const o = slot.object;
		slot.held = false;
		if (slot.tool === this.camera) this.camera.clearPrints(); // (no print left floating over the fan)
		slot.pose.add(o);
		o.position.set(0, 0, 0);
		o.rotation.set(0, 0, 0);
		o.scale.setScalar(o.userData.fanScale);
		o.visible = this.alpha > 0.05;
		if (this.xr.soundLevel !== 'off') this.xr.sound.play('whoosh', 0.6);
	}

	feel(c, sound, haptic) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/** Leaving VR: closed, nothing touched. */
	reset() {
		this.alpha = 0;
		this.group.visible = false;
		this.hot = null;
		this.target = this.mem = null;
		this.fanBusy = false;
		this.pos = this.vel = null; this.mode = this.was = null; this.gliding = false; this.reach = false; this.lost = 0;
	}
}
