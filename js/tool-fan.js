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
import { MarkerTool } from './marker-tool.js';
import { LaserMeter } from './laser-meter.js';
import { StreetCamera } from './street-camera.js';
import { ease } from './tween.js';
import { Label } from './panel.js';

const ABOVE = 0.15; // the fan's middle, above the fan hand (metres)
const SPACING = 0.115; // between tools in the arc (the marker and the meter lie across it, 9 and 11 cm long)
// How each tool shows in the fan (the user's note, 24 Nov): the camera from the front, its lens towards you; the meter and
// the marker from the side, their length across the fan like tools on a pegboard, nib to the left as you see it.
const VIEW = { camera: Math.PI, meter: Math.PI / 2, marker: Math.PI / 2 };
const TAG = { height: 0.03, below: -0.05 }; // each tool's name tag (like the tools' first-time show: js/tools-intro.js)
const NAMES = { camera: 'Camera', meter: 'Meter', marker: 'Marker' };
const IN_VIEW = THREE.MathUtils.degToRad(35); // the fan hand within this of where you look
const REACH = 0.05; // a controller's tip this close to a tool touches it
const REACH_HAND = 0.07; // a bare fingertip: tracking is looser, and the tools are small (the marker is 9 cm)
const PALM_REACH = 0.09; // a closing bare hand: its palm this close to a tool still takes it (the fingers curl away from the tool as the hand closes)
const MEMORY = 0.6; // seconds a touched tool stays the one a closing hand takes
const BUSY = 0.2; // the taking hand this close to the open fan: the orb ignores touches
const KEEP_CLEAR = 0.2; // the fan hand's index this close to any key (the orb, the doors and levels, the wrist keys, the wings): the fan stays closed
const WATCH = 0.5; // the fan opens only with the hand's palm (a controller's face) within 60 degrees of the direction to your eyes: "look at your watch"
const FIELD = 0.45, KEEP = 0.2, FIELD_PUSH = 0.1, FIELD_SPRING = 0.08; // the orb's field: felt from 45 cm, tools nudged out of the way and never nearer than 20 cm (a spring of about 0.25 s)
const YIELD_NEAR = 0.2; // the taking hand's fingertip this close to the open fan: its orb shrinks and fades
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
		this.target = null; // the slot a closing bare hand would take: the touched one, one touched a moment ago, or the one at the palm
		this.mem = null; // { slot, t }: the last slot a bare fingertip touched
		this.force = 0; // seconds the fan stays open by itself (the tools' show: js/tools-intro.js)
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
		this.fistTaken = !!(this.target && take?.isHand);
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
			const indexNear = fan.touch.tracked && xr.nearKey(fan.touch.tip, KEEP_CLEAR);
			// The "look at your watch" pose: a palm (or a controller's face) turned to your eyes. A hand reaching to press a key has its palm down or forward.
			const watching = this.palmToEyes(fan, head) > WATCH;
			// (Closed over a bare hand that is aiming: it would sit in the arc's way; the tester's finding. Not
			// merely in the ready pose: a curled hand raised to look at the fan reads as ready.)
			const aiming = xr.modes.walk?.tele?.c === fan || xr.modes.dollhouse?.handAim?.c === fan;
			// (The taking hand reaching in brings the orb on its wrist near the fan hand's index: the fan stays open while it reaches.)
			open = raised && look.angleTo(to) < IN_VIEW && (watching || this.alpha > 0.5) && !xr.ui.wrist.open && (!indexNear || this.fanBusy) && !aiming && forward.lengthSq() > 0;
			if (this.force > 0) { this.force -= dt; open = true; } // (the tools' show: the one time it opens without a look)
		}
		this.alpha = THREE.MathUtils.clamp(this.alpha + (open ? dt : -dt) / FADE, 0, 1);
		this.group.visible = this.alpha > 0;
		if (this.group.visible) this.place(anchor, head, dt);
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
			if (hot) xr.lessons?.note('fan'); // (the lesson's "your tools" step)
			if (hot && hot.live) this.feel(take, 'tick', 'tick');
			if (hot && !hot.live) this.refuse(hot, take);
			this.hot = hot;
		}
		this.fanBusy = this.alpha > 0.5 && !!take?.touch.tracked && take.touch.tip.distanceTo(anchor) < BUSY;
		xr.ui.wrist.orbYield = this.alpha > 0.5 && !!take?.touch.tracked && take.touch.tip.distanceTo(anchor) < YIELD_NEAR; // (the orb on that wrist makes room)
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

	/** How much the fan hand's palm (a controller's face) turns to the eyes: 1 straight at them, -1 away. */
	palmToEyes(c, head) {
		const n = this._n ??= new THREE.Vector3(), d = this._d ??= new THREE.Vector3();
		if (c.isHand) {
			const s = c.gesture?.shape;
			if (!s) return 1; // (no joints read yet: do not block)
			n.copy(s.normal); d.subVectors(head, s.pinchAt).normalize();
			return n.dot(d);
		}
		c.grip.updateMatrixWorld(true);
		n.set(0, 1, 0).transformDirection(c.grip.matrixWorld);
		d.subVectors(head, this.xr.input.wristOf(c).getWorldPosition(this._d2 ??= new THREE.Vector3())).normalize();
		return Math.abs(n.dot(d)); // (either face: the grip's axis differs a little between the Touch controllers, and a controller is looked at from either side)
	}

	/** The arc above the fan hand, turned to face you; tools bob gently (not the inactive camera). */
	place(anchor, head, dt = 1 / 72) {
		this.group.position.copy(anchor);
		this.group.lookAt(head);
		this.slots.forEach((s, i) => {
			const lift = s === this.hot && s.live ? 0.012 : 0;
			const bob = s.live ? 0.004 * Math.sin(this.t * 2 + i * 1.7) : 0;
			s.home.position.set((i - 1) * SPACING, Math.cos((i - 1) * 0.5) * 0.02 - 0.02 + lift + bob, 0);
		});
		this.slideAside(dt);
		for (const s of this.slots) {
			if (!s.held) s.object.visible = this.alpha > 0.05;
			s.label.mesh.visible = !s.held && this.alpha > 0.05; // (the name tags go with the fan, and while the tool is in your hand)
		}
	}

	/**
	 * The orb's field (the user's "magnet"): when the orb nears a tool the tool
	 * is nudged straight away from it, felt from 45 cm and never nearer than
	 * 20 cm, following with a soft spring: the tools slide aside, never vanish.
	 * (Only the fan hand's index reaching the orb matters here; the orb's own
	 * hand reaching in makes the orb yield instead: see orbYield.)
	 */
	slideAside(dt) {
		const xr = this.xr, orb = xr.ui.wrist.orb.group, o = this._orb2 ??= new THREE.Vector3(), p = this._p2 ??= new THREE.Vector3(), q = this._q2 ??= new THREE.Quaternion();
		orb.getWorldPosition(o);
		this.group.updateMatrixWorld(true);
		this.group.getWorldQuaternion(q).invert();
		const k = 1 - Math.exp(-dt / FIELD_SPRING);
		for (const s of this.slots) {
			s.push ??= new THREE.Vector3();
			const want = this._w ??= new THREE.Vector3();
			want.set(0, 0, 0);
			// (Only while the other hand reaches for the orb: the orb's own hand reaching into the fan makes the orb yield instead.)
			const fanHand = this.hands().fan;
			if (xr.ui.wrist.wearer && !s.held && fanHand?.touch.tracked && fanHand.touch.tip.distanceTo(o) < FIELD) {
				s.home.getWorldPosition(p); // (its place without the push: place() has just set it)
				const away = this._a2 ??= new THREE.Vector3();
				away.subVectors(p, o);
				const d = away.length();
				if (d < FIELD && d > 1e-4) {
					const t = THREE.MathUtils.smoothstep(FIELD - d, 0, FIELD - KEEP); // 0 at 45 cm, 1 at 20 cm
					const to = Math.max(d + t * FIELD_PUSH, KEEP);
					want.copy(away).multiplyScalar((to - d) / d);
				}
			}
			s.pushWorld ??= new THREE.Vector3();
			s.pushWorld.lerp(want, k);
			s.home.position.add(s.push.copy(s.pushWorld).applyQuaternion(q));
		}
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
	}
}
