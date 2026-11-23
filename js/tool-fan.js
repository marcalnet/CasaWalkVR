// The tool fan (SPEC.md phase 17, milestone C2): the three tools, small,
// float in an arc about 15 cm above the fan hand (the left by default; the
// Tool fan setting swaps both wrists), gently bobbing. It fades in when that
// hand is raised in front of you and you look at it, and out otherwise.
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
// Keeping the two wrists apart: the fan stays closed while the wrist menu is
// open, and while the fan hand's index is within 15 cm of the orb; while the
// taking hand is within 20 cm of the open fan, the orb ignores touches
// (fanBusy).

import * as THREE from 'three';
import { buildMarker } from './tool-models.js';
import { LaserMeter } from './laser-meter.js';
import { StreetCamera } from './street-camera.js';
import { ease } from './tween.js';

const ABOVE = 0.15; // the fan's middle, above the fan hand (metres)
const SPACING = 0.1; // between tools in the arc
const IN_VIEW = THREE.MathUtils.degToRad(35); // the fan hand within this of where you look
const REACH = 0.05; // a tip this close to a tool touches it
const BUSY = 0.2; // the taking hand this close to the open fan: the orb ignores touches
const KEEP_CLEAR = 0.15; // the fan hand's index this close to the orb: the fan stays closed
const RETURN = 0.08; // a bare hand bringing its tool this close to its place puts it back
const FADE = 0.2; // seconds

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
		const make = (name, object, live, tool = null) => {
			const slot = { name, object, live, home: new THREE.Group(), wobble: 0, tagGrow: 0, held: false };
			slot.home.add(object);
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
		this.slots = [
			make('camera', this.camera.object, true, this.camera),
			make('meter', this.meter.object, true, this.meter),
			make('marker', buildMarker({ ink: 'black' }), true),
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
		this.fistTaken = !!(this.hot && take?.isHand);
		if (this.fistTaken) take.fistClaimed = true; else if (take) take.fistClaimed = false;
	}

	/** The fan hand and the taking hand (input entries, or null). */
	hands() {
		const xr = this.xr, fanSide = xr.toolFan === 'right' ? 'right' : 'left', takeSide = fanSide === 'left' ? 'right' : 'left';
		const find = (side) => xr.input.controllers.find((c) => c.handedness === side && (c.isController || (c.isHand && c.touch.tracked))) ?? null;
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
		let open = false;
		const anchor = this._anchor ??= new THREE.Vector3(), look = this._look ??= new THREE.Vector3(), to = this._to ??= new THREE.Vector3(), orb = this._orb ??= new THREE.Vector3(), at = this._at ??= new THREE.Vector3();
		if (fan && xr.session) {
			input.wristOf(fan).getWorldPosition(anchor);
			anchor.y += ABOVE;
			const { forward } = xr.viewAxes();
			look.setFromMatrixColumn(xr.camera.matrixWorld, 2).negate();
			to.copy(anchor).sub(head).normalize();
			const raised = anchor.y > head.y - 0.55;
			xr.ui.wrist.orb.group.getWorldPosition(orb);
			const indexNear = fan.touch.tracked && fan.touch.tip.distanceTo(orb) < KEEP_CLEAR;
			// (Closed over a bare hand that is aiming: it would sit in the arc's way; the tester's finding. Not
			// merely in the ready pose: a curled hand raised to look at the fan reads as ready.)
			const aiming = xr.modes.walk?.tele?.c === fan || xr.modes.dollhouse?.handAim?.c === fan;
			open = raised && look.angleTo(to) < IN_VIEW && !xr.ui.wrist.open && !indexNear && !aiming && forward.lengthSq() > 0;
		}
		this.alpha = THREE.MathUtils.clamp(this.alpha + (open ? dt : -dt) / FADE, 0, 1);
		this.group.visible = this.alpha > 0;
		if (this.group.visible) this.place(anchor, head);
		// Touching a tool with the taking hand's tip.
		let hot = null;
		if (this.alpha > 0.5 && take?.touch.tracked) {
			let best = REACH;
			for (const s of this.slots) {
				if (s.held) continue;
				const d = s.home.getWorldPosition(at).distanceTo(take.touch.tip);
				if (d < best) { best = d; hot = s; }
			}
		}
		if (hot !== this.hot) {
			if (hot) xr.lessons?.note('fan'); // (the lesson's "your tools" step)
			if (hot && hot.live) this.feel(take, 'tick', 'tick');
			if (hot && !hot.live) this.refuse(hot, take);
			this.hot = hot;
		}
		this.fanBusy = this.alpha > 0.5 && !!take?.touch.tracked && take.touch.tip.distanceTo(anchor) < BUSY;
		// Taking: the grip (controller) or a closed hand (bare hand) on the touched tool.
		if (take) {
			const grab = take.isController ? take.state.down.grip : take.gestures?.some((e) => e.type === 'fist');
			if (grab && this.hot) {
				if (!this.hot.live) this.refuse(this.hot, take);
				else xr.tools.take(this.hot.tool, take);
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

	/** The arc above the fan hand, turned to face you; tools bob gently (not the inactive camera). */
	place(anchor, head) {
		this.group.position.copy(anchor);
		this.group.lookAt(head);
		this.slots.forEach((s, i) => {
			const lift = s === this.hot && s.live ? 0.012 : 0;
			const bob = s.live ? 0.004 * Math.sin(this.t * 2 + i * 1.7) : 0;
			s.home.position.set((i - 1) * SPACING, Math.cos((i - 1) * 0.5) * 0.02 - 0.02 + lift + bob, 0);
		});
		for (const s of this.slots) if (!s.held) s.object.visible = this.alpha > 0.05;
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
		const xr = this.xr, o = slot.object, at = xr.input.wristOf(c);
		slot.held = true;
		slot.settled = false;
		at.add(o);
		const grip = o.getObjectByName('grip');
		o.scale.setScalar(1);
		o.rotation.set(0, 0, 0);
		// (Controllers: the grip space. Bare hands: the wrist, a little towards the fingers and the palm.)
		o.position.copy(grip ? grip.position.clone().negate() : new THREE.Vector3());
		if (c.isHand) o.position.add(new THREE.Vector3(0, -0.03, -0.07));
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
		slot.home.add(o);
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
		this.fanBusy = false;
	}
}
