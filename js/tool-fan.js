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
import { CLAIM } from './xr-targets.js';
import { angleOf, zoneOf, zoneHull, inZone } from './wings.js';

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
const BUSY = CLAIM.near, BUSY_CLEAR = CLAIM.clear; // the taking hand this close to the open fan: the orb ignores touches, until it is BUSY_CLEAR away
// When the fan opens (build 120's design, item 1: a key always beats the fan): the watch pose, the
// hand high enough, and no key near; open, a key within KEY_CLOSE closes it until the hand is KEY_CLEAR away.
const KEY_CLEAR = CLAIM.clear; // the fan hand's tip this close to any key (the orb, the doors and levels, the wrist keys, the wings): it stays closed
const KEY_CLOSE = CLAIM.near; // open, the tip this close to a key: it fades out (KEY_FADE) and stays closed until KEY_CLEAR away
const KEY_FADE = 0.15; // seconds
const HIGH = 0.5; // the fan hand's wrist no lower than this below the eyes (the doors and the level keys are 0.65 m below)
const WATCH = 0.5; // the palm (bare hands; controllers need only be raised and in view) within 60 degrees of the direction to your eyes: "look at your watch"
const OUT = 0.08; // the open fan sits this far to the fan hand's outer side, beside its ABOVE
// The orb's field (build 120's design, item 2): the whole fan slides outward across the view as a group,
// held there while the orb stays near, and glides back once it has gone.
const FIELD = 0.45; // the orb this close to the nearest tool: the fan slides
const KEEP = 0.25; // ... until its nearest tool is this far from the orb
const LINE_CLEAR = 0.1; // and no tool this close to the line from the eyes to the orb
const HOLD_FIELD = 0.55; // it stays slid while the orb is this close to the fan's own place
const LEASH = 0.35; // never further than this from the fan hand
const RETURN_AFTER = 0.5, SLIDE_SPRING = 0.1; // the orb gone this long (s), the fan glides back; the slide's spring (s)
// Bare hands (build 120's design, item 4): the tools rest small on the back of the fan wrist, docked,
// whenever that hand is in view, and open into the fan on the watch pose.
const DOCK = { above: 0.05, scale: 0.5, opacity: 0.6, nearKey: 0.2, inView: THREE.MathUtils.degToRad(60), change: 0.2 };
const DOCKED_HANDS = true; // the docked row with bare hands (for controllers it waits for the user's answer: build 120's design, item 4)
const REACHING = 0.35; // the taking hand's fingertip this close to the fan: it is reaching into the fan (its orb is not a key the fan hand reaches for)
const REACH_POINT = THREE.MathUtils.degToRad(40); // ... and pointing within this of a tool: it is taking (the tools never flee the fingertip)
const YIELD_NEAR = CLAIM.near, YIELD_CLEAR = CLAIM.clear; // the taking hand's fingertip this close to the open fan: its orb shrinks and fades, until YIELD_CLEAR away
const RETURN = 0.08; // a bare hand bringing its tool this close to its place puts it back
const FADE = 0.2; // seconds (opening and closing)
// Where the open fan may be (the interaction harmony's conflict 9; both inputs; the docked row is not affected):
// every tool of the open arc at least EYES_OPEN from the eyes, off the model as seen (its silhouette plus
// MODEL_MARGIN), and CLAIM.clear from any live key, to open; open, it fades (KEY_FADE) once a tool comes
// within EYES_CLOSE, onto the silhouette itself, or within CLAIM.near of a live key.
const EYES_OPEN = 0.4, EYES_CLOSE = 0.35; // metres
const MODEL_MARGIN = THREE.MathUtils.degToRad(5);

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
		let open = false, docked = false, keyNear = false;
		const anchor = this._anchor ??= new THREE.Vector3(), look = this._look ??= new THREE.Vector3(), to = this._to ??= new THREE.Vector3(), orb = this._orb ??= new THREE.Vector3(), at = this._at ??= new THREE.Vector3(), wrist = this._wr ??= new THREE.Vector3();
		if (fan && xr.session) {
			input.wristOf(fan).getWorldPosition(wrist);
			const { forward, right } = xr.viewAxes();
			// The open fan's place: above the fan hand and to its outer side (across the view).
			const outward = this._outward ??= new THREE.Vector3();
			outward.copy(right).multiplyScalar(xr.toolFan === 'right' ? 1 : -1);
			anchor.copy(wrist).addScaledVector(outward, OUT);
			anchor.y += ABOVE;
			look.setFromMatrixColumn(xr.camera.matrixWorld, 2).negate();
			to.copy(anchor).sub(head).normalize();
			const raised = wrist.y > head.y - HIGH;
			xr.ui.wrist.orb.group.getWorldPosition(orb);
			// (The orb's own hand reaching into the fan brings its orb past the fan hand's tip: that is not the fan hand reaching for the orb.)
			const reaching = !!take?.touch.tracked && take.touch.tip.distanceTo(anchor) < REACHING;
			// A key always beats the fan: within KEY_CLEAR it never opens; open, within KEY_CLOSE it closes (and stays so until KEY_CLEAR).
			const tip = fan.touch.tracked ? fan.touch.tip : null;
			const nearClear = !!tip && xr.nearKey(tip, KEY_CLEAR, { orb: !reaching }), nearClose = !!tip && xr.nearKey(tip, KEY_CLOSE, { orb: !reaching });
			if (nearClose && !this.fanBusy) this.keyShut = true;
			if (!nearClear) this.keyShut = false;
			keyNear = nearClear;
			// The "look at your watch" pose: a palm (or a controller's face) turned to your eyes. A hand reaching to press a key has its palm down or forward.
			// (Controllers: raised and in view is enough, as in build 120, until the buttons' face axis is measured
			// on a Quest: the Lead's decision. The key rules below apply to both.)
			const watching = !fan.isHand || this.palmToEyes(fan, head) > WATCH;
			// (Closed over a bare hand that is aiming: it would sit in the arc's way; the tester's finding. Not
			// merely in the ready pose: a curled hand raised to look at the fan reads as ready.)
			const aiming = xr.modes.walk?.tele?.c === fan || xr.modes.dollhouse?.handAim?.c === fan;
			const keysOk = this.alpha > 0.5 ? !this.keyShut : !nearClear || this.fanBusy;
			// Where its tools would be: far enough from the eyes, off the model, clear of live keys (conflict 9);
			// and a slide with nowhere clear to go fades it (conflict 10).
			this._hull = xr.mode === 'dollhouse' && xr.model ? zoneHull(zoneOf(xr.modes.dollhouse.modelBox(this._box ??= new THREE.Box3()), head, this._yaw = xr.viewYaw()) ?? []) : null;
			if (this.slideBlocked && orb.distanceTo(anchor) > HOLD_FIELD) this.slideBlocked = false; // (faded for a blocked slide: until the orb has gone)
			const arc = this.arcState(anchor, head);
			this.posShut = this.alpha > 0.5 && (arc.must || this.slideBlocked);
			const posOk = this.alpha > 0.5 ? !this.posShut : arc.may && !this.slideBlocked;
			open = raised && look.angleTo(to) < IN_VIEW && (watching || this.alpha > 0.5) && !xr.ui.wrist.open && !xr.teaching && keysOk && posOk && !aiming && forward.lengthSq() > 0; // (one teacher at a time: closed while one plays)
			if (this.force > 0) { this.force -= dt; open = true; } // (the tools' show: the one time it opens without a look)
			// Docked (bare hands): the tools rest on the back of the wrist whenever that hand is in view; not while it holds the model.
			const holding = xr.modes.dollhouse?.grab?.c === fan;
			to.copy(wrist).sub(head).normalize();
			docked = DOCKED_HANDS && fan.isHand && fan.touch.tracked && look.angleTo(to) < DOCK.inView && !holding && !aiming;
			to.copy(anchor).sub(head).normalize();
		}
		const fade = open ? FADE : this.keyShut || this.posShut ? KEY_FADE : FADE;
		this.alpha = THREE.MathUtils.clamp(this.alpha + (open ? dt : -dt) / fade, 0, 1);
		// The docked row's presence (0..1), dimmed near a key so it never crowds the level keys.
		this.dock = THREE.MathUtils.clamp((this.dock ?? 0) + (docked ? dt : -dt) / DOCK.change, 0, 1);
		this.dockDim = keyNear ? DOCK.nearKey / DOCK.opacity : 1;
		this.group.visible = this.alpha > 0 || this.dock > 0;
		if (this.group.visible) this.place(anchor, head, dt, wrist);
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
		const takeD = this.alpha > 0.5 && take?.touch.tracked ? take.touch.tip.distanceTo(anchor) : Infinity;
		this.fanBusy = takeD < (this.fanBusy ? BUSY_CLEAR : BUSY);
		xr.ui.wrist.fanYield = takeD < (xr.ui.wrist.fanYield ? YIELD_CLEAR : YIELD_NEAR); // (the orb on that wrist makes room)
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

	/** How much the fan hand's palm turns to the eyes: 1 straight at them, -1 away (a controller: always 1). */
	palmToEyes(c, head) {
		const n = this._n ??= new THREE.Vector3(), d = this._d ??= new THREE.Vector3();
		if (c.isHand) {
			const s = c.gesture?.shape;
			if (!s) return 1; // (no joints read yet: do not block)
			n.copy(s.normal); d.subVectors(head, s.pinchAt).normalize();
			return n.dot(d);
		}
		return 1; // (a controller: no watch pose until its face axis is measured; the ?hands readout shows the candidates)
	}

	/**
	 * Where the open arc's tools would be now (above the fan hand, slid as it
	 * is): { may } open (every tool EYES_OPEN from the eyes, none within the
	 * model's silhouette plus MODEL_MARGIN, none within CLAIM.clear of a live
	 * key), { must } fade (a tool within EYES_CLOSE, on the silhouette itself,
	 * or within CLAIM.near of a live key). The interaction harmony's conflict 9.
	 */
	arcState(anchor, head) {
		const xr = this.xr, out = this._outward, right = xr.viewAxes().right, p = this._ap ??= new THREE.Vector3(), a = this._aa ??= { az: 0, el: 0 };
		let near = Infinity, inside = false, margin = false, keyClose = false, keyClear = true;
		for (let i = 0; i < this.slots.length; i++) {
			p.copy(anchor).addScaledVector(out, this.slide ?? 0).addScaledVector(right, (i - 1) * SPACING);
			near = Math.min(near, p.distanceTo(head));
			if (this._hull?.length) {
				angleOf(p, head, this._yaw, a);
				if (inZone(a, this._hull)) inside = true;
				if (inZone(a, this._hull, MODEL_MARGIN)) margin = true;
			}
			if (xr.nearKey(p, CLAIM.near, { orb: false })) keyClose = true;
			if (xr.nearKey(p, CLAIM.clear, { orb: false })) keyClear = false;
		}
		return { may: near >= EYES_OPEN && !margin && keyClear, must: near < EYES_CLOSE || inside || keyClose };
	}

	/** True if a tool at p sits on a live key (CLAIM.near) or over the model's silhouette: a slide must not end there (conflict 10). */
	onSomething(p) {
		if (this.xr.nearKey(p, CLAIM.near, { orb: false })) return true;
		if (!this._hull?.length) return false;
		return inZone(angleOf(p, this.xr.headWorld(), this._yaw, this._sa ??= { az: 0, el: 0 }), this._hull);
	}

	/**
	 * The fan above the fan hand, turned to face you; tools bob gently (not the
	 * inactive camera). Bare hands: between the docked row on the back of the
	 * wrist (small, still, dimmed, no names) and the open fan, as it opens.
	 */
	place(anchor, head, dt = 1 / 72, wrist = anchor) {
		const xr = this.xr, fan = this.hands().fan;
		const k = DOCKED_HANDS && fan?.isHand ? ease.inOut(this.alpha) : 1; // 0 docked .. 1 open
		const dockAt = this._dockAt ??= new THREE.Vector3();
		if (fan) dockAt.set(0, DOCK.above, 0).applyMatrix4(xr.input.wristOf(fan).matrixWorld); else dockAt.copy(wrist);
		const open = this._openAt ??= new THREE.Vector3();
		const slide = this.slideAside(dt, anchor, head);
		open.copy(anchor).addScaledVector(this._outward, slide);
		this.group.position.lerpVectors(dockAt, open, k);
		this.group.lookAt(head);
		const size = DOCK.scale + (1 - DOCK.scale) * k;
		const shown = this.alpha > 0.05 || this.dock > 0.05;
		const opacity = k >= 1 ? 1 : (DOCK.opacity * this.dockDim * Math.min(1, this.dock * 2)) * (1 - k) + k;
		this.slots.forEach((s, i) => {
			const lift = s === this.hot && s.live ? 0.012 : 0;
			const bob = s.live ? 0.004 * Math.sin(this.t * 2 + i * 1.7) : 0;
			s.home.position.set((i - 1) * SPACING * size, (Math.cos((i - 1) * 0.5) * 0.02 - 0.02 + lift + bob) * k, 0);
			if (s.held) return;
			s.object.visible = shown;
			s.object.scale.setScalar(s.object.userData.fanScale * size);
			setOpacity(s.object, opacity);
		});
		for (const s of this.slots) s.label.mesh.visible = !s.held && this.alpha > 0.05 && k > 0.5; // (the name tags go with the open fan, and while the tool is in your hand)
	}

	/**
	 * The orb's field (build 120's design, item 2): when the orb nears the open
	 * fan, the whole fan slides outward across the view as a group, until its
	 * nearest tool is KEEP from the orb and none is near the line from the eyes
	 * to the orb, never more than LEASH from the hand; it stays slid while the
	 * orb stays within HOLD_FIELD of the fan's place, and glides back once the
	 * orb has been away RETURN_AFTER. Never while the taking hand takes a tool
	 * (the orb yields instead: fanYield). Returns the slide (m).
	 */
	slideAside(dt, base, head) {
		const xr = this.xr, wrist = xr.ui.wrist, out = this._outward;
		if (!out.lengthSq()) return this.slide ?? 0;
		const o = wrist.orb.group.getWorldPosition(this._orb2 ??= new THREE.Vector3());
		const right = this._right ??= new THREE.Vector3().copy(xr.viewAxes().right);
		right.copy(xr.viewAxes().right);
		const tool = this._tp ??= new THREE.Vector3();
		const at = (sl, i) => tool.copy(base).addScaledVector(out, sl).addScaledVector(right, (i - 1) * SPACING);
		const nearest = (sl) => Math.min(...this.slots.map((_, i) => at(sl, i).distanceTo(o)));
		const lineD = (sl) => Math.min(...this.slots.map((_, i) => segmentDistance(at(sl, i), head, o)));
		this.slide ??= 0; this.slideTarget ??= 0; this.awayT ??= 0;
		const taking = this.taking(), active = !!wrist.wearer && this.alpha > 0 && !taking && !wrist.fanYield
			&& (nearest(this.slide) < FIELD || (this.slide > 0.005 && o.distanceTo(base) < HOLD_FIELD));
		// The slide's end must be clear too: no tool on a live key or over the model (conflict 10). Nowhere clear: the fan fades instead.
		const clear = (sl) => this.slots.every((_, i) => !this.onSomething(at(sl, i)));
		if (active) {
			this.awayT = 0;
			let want = null;
			for (let sl = 0; sl <= LEASH + 1e-9; sl += 0.01) if (nearest(sl) >= KEEP && lineD(sl) >= LINE_CLEAR && clear(sl)) { want = sl; break; }
			this.slideBlocked = want === null;
			if (want !== null) this.slideTarget = Math.max(want, this.slideTarget); // (held while the orb stays: never bobbing back towards it)
		} else {
			if (this.slideBlocked && o.distanceTo(base) > HOLD_FIELD) this.slideBlocked = false; // (until the orb has gone)
			if ((this.awayT += dt) > RETURN_AFTER) this.slideTarget = 0;
		}
		this.slide += (this.slideTarget - this.slide) * (1 - Math.exp(-dt / SLIDE_SPRING));
		if (this.slide < 1e-4 && this.slideTarget === 0) this.slide = 0;
		return this.slide;
	}

	/** The taking hand is taking a tool: its tip within REACHING of one and pointing within REACH_POINT of it. */
	taking() {
		const take = this.hands().take;
		if (!take?.touch.tracked) return false;
		const dir = this._td ??= new THREE.Vector3(), p = this._tp2 ??= new THREE.Vector3();
		if (take.isHand) dir.subVectors(take.touch.tip, take.wrist.getWorldPosition(p)).normalize();
		else { take.ray.updateMatrixWorld(true); dir.set(0, 0, -1).transformDirection(take.ray.matrixWorld); }
		return this.slots.some((s) => {
			if (s.held) return false;
			s.home.getWorldPosition(p);
			const d = p.distanceTo(take.touch.tip);
			return d < REACHING && (d < 0.05 || dir.angleTo(p.sub(take.touch.tip)) < REACH_POINT);
		});
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
		setOpacity(o, 1); // (never dimmed in the hand)
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
		this.slideBlocked = this.posShut = false;
	}
}

/** Distance from point p to the segment a-b. */
function segmentDistance(p, a, b) {
	const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
	const len2 = abx * abx + aby * aby + abz * abz;
	const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2)) : 0;
	return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

/** A tool's materials at `a` times their own opacity (recorded once): the docked row is dimmed. */
function setOpacity(object, a) {
	if (object.userData.cwOpacity === a) return;
	object.userData.cwOpacity = a;
	object.traverse((o) => {
		for (const m of [].concat(o.material ?? [])) {
			m.userData.baseOpacity ??= m.opacity;
			m.userData.baseTransparent ??= m.transparent;
			const t = a < 0.999 || m.userData.baseTransparent;
			if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
			m.opacity = m.userData.baseOpacity * a;
		}
	});
}
