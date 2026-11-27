// Hand-held tools (SPEC.md phase 17): the street camera, the laser meter and
// the marker, taken from a fan over one wrist and used with the other hand.
// This is the frame they plug into; the tools themselves arrive in
// milestones C-F.
//
// While a tool is held, its hand's trigger, grip and second button belong to
// it (c.claim = 'tool', taken before the menu and the mode each frame): the
// trigger uses the tool (in use mode: js/hold.js; near the fan, in dock mode,
// it does nothing, so taking a tool never fires it), the second button is A
// on the right hand or Y on
// the left (the fan switched sides), and the grip swaps or returns it. The
// other hand's trigger and both sticks keep their jobs, so no tool ever
// makes you jump.
//
// A tool is an object with:
//   name, object (its Object3D, never in photos), controlPart (the empty in
//   its model that carries the quiet ring: js/control-cue.js),
//   take(c), putBack(), update(dt, c),
//   trigger(c, 'down' | 'up'),
//   secondary(c, 'press' | 'hold')  ('hold': kept down for HOLD seconds, e.g.
//                                     clear all; 'press': let go before that),
//   clear()  (forget what it made: measurements, strokes)
//
// What tools make (measurements, strokes) goes in `annotations`, in model
// space: it moves and scales with the dollhouse and stays put while walking.
// Nothing is saved: it is cleared on leaving VR or opening another model,
// and photos keep it (annotations are never hidden from photos).

import * as THREE from 'three';
import { HOLD as STICK, nextMode, holdFrame, toolPose } from './hold.js';
import { handAimRay } from './gestures.js';
export const HOLD = 1; // seconds: "hold A for a second"
// Bare hands (build 215's C2): in use mode the holding hand's pinch is the
// tool's trigger (the pinch's start, as a controller's trigger goes down; its
// end, as it comes up). A hand holding a tool never aims a teleport nor closes
// the wing (XRExperience.emptyHand), in either mode.
const NONE = [];

export class ToolSystem {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.tools = [];
		this.held = null; // { tool, c, hold (seconds the second button has been down), fired }
		this.annotations = new THREE.Group();
		this.annotations.name = 'annotations';
	}

	/** Adds a tool to the fan (milestone C). */
	add(tool) {
		this.tools.push(tool);
		if (tool.object) this.xr.hideFromPhotos(tool.object);
	}

	/**
	 * A tool goes into hand `c` (the one held before goes back first). If its
	 * second button is already down, that press is not the tool's: it acts
	 * from the next press.
	 */
	take(tool, c) {
		if (this.held) this.putBack();
		this.held = { tool, c, hold: 0, fired: true,
			mode: 'dock', magnet: { armed: false }, pressed: false, lostT: 0 }; // (every take starts in dock mode: js/hold.js)
		this.held.buttons = ['trigger', ToolSystem.secondKey(c)]; // (the controller model lights these: js/controller-model.js)
		tool.take?.(c);
	}

	/** The held tool goes back to the fan. */
	putBack() {
		const h = this.held;
		if (!h) return;
		this.held = null;
		h.tool.putBack?.();
	}

	/** The held tool's buttons (xr-input names): its trigger and its second button. Empty if none. */
	buttons() {
		return this.held?.buttons ?? NONE;
	}

	/** The second button of the hand holding a tool: A on the right, Y on the left. */
	static secondKey(c) { return c.handedness === 'left' ? 'b' : 'a'; }

	/** A new model: the annotations follow it into model space, empty. */
	setModel() {
		this.xr.centerer.add(this.annotations);
		this.clear();
	}

	/**
	 * Each frame, before the menu and the mode: the held tool's buttons are
	 * its own, and its hand's laser is hidden (the modes leave a claimed
	 * hand's laser off).
	 */
	claim() {
		const h = this.held;
		if (!h?.c.source) return;
		const k = h.c.claim;
		k.trigger = k.grip = 'tool';
		k[ToolSystem.secondKey(h.c)] = 'tool';
		this.xr.input.setLaser(h.c, false);
	}

	/**
	 * Each frame, after the mode and the fan: a bare hand's hold frame, the
	 * held tool's mode (js/hold.js: dock near the fan, use away from it), its
	 * trigger (the trigger, or a bare hand's pinch, in use mode only), its
	 * buttons, then it updates.
	 */
	update(dt) {
		const h = this.held;
		if (!h) return;
		const { tool, c } = h, s = c.state, key = ToolSystem.secondKey(c);
		if (c.isHand) this.placeHold(h, dt);
		// The mode, from the held tool's distance to the dock's middle.
		const dock = this.xr.fan?.dockAt(this._dock ??= new THREE.Vector3());
		const was = h.mode;
		if (tool.object) h.mode = dock ? nextMode(h.mode, tool.object.getWorldPosition(this._at ??= new THREE.Vector3()).distanceTo(dock)) : 'use'; // (no fan shown: no dock)
		if (h.mode !== was) {
			if (h.mode === 'use' && this.xr.soundLevel !== 'off') this.xr.sound.play('tick', 0.35); // (one soft tick: the ring lights, js/control-cue.js)
			if (h.mode === 'dock' && h.pressed) { h.pressed = false; tool.trigger?.(c, 'up'); } // (back near the fan: a stroke ends)
		}
		const use = h.mode === 'use';
		if (c.isHand) {
			for (const e of c.gestures ?? []) if (e.type === 'lost') tool.gesture?.(c, e);
			const sel = c.touch.select;
			if (use && sel.down) { h.pressed = true; tool.trigger?.(c, 'down'); }
			if (h.pressed && (sel.up || sel.lost || !c.touch.tracked)) { h.pressed = false; tool.trigger?.(c, 'up'); }
			tool.update?.(dt, c);
			return;
		}
		if (!c.source) return;
		if (use && s.down.trigger) { h.pressed = true; tool.trigger?.(c, 'down'); }
		if (h.pressed && s.up.trigger) { h.pressed = false; tool.trigger?.(c, 'up'); }
		if (s.down[key]) { h.hold = 0; h.fired = false; }
		if (s[key] && !h.fired) {
			h.hold += dt;
			if (h.hold >= HOLD) { h.fired = true; tool.secondary?.(c, 'hold'); }
		}
		if (s.up[key] && !h.fired) tool.secondary?.(c, 'press');
		tool.update?.(dt, c);
	}

	/**
	 * A bare hand's hold frame (js/hold.js), from this frame's joints: the
	 * palm's middle, out of the palm and forward, the tool along the hand's
	 * aim ray. Tracking lost: the tool never drops; it stays where the hand
	 * was for STICK.LOST_HOLD, then fades over STICK.LOST_FADE, and comes back
	 * with the hand.
	 */
	placeHold(h, dt) {
		const xr = this.xr, c = h.c, input = xr.input, o = h.tool.object, hold = c.hold;
		if (!hold) return;
		const shape = c.gesture?.shape;
		const wrist = c.touch.tracked && input.joint(c, 'wrist', this._w ??= new THREE.Vector3());
		const knuckle = wrist && input.joint(c, 'middle-finger-phalanx-proximal', this._k ??= new THREE.Vector3());
		if (knuckle && shape) {
			h.lostT = 0;
			const { dir } = handAimRay(xr.headWorld(), xr.viewAxes().right, shape.pinchAt, c.handedness);
			const f = holdFrame(wrist, knuckle, shape.normal, dir, this._frame ??= { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, toolPose(h.tool.name, c.handedness)); // (each tool its own offsets from the palm)
			const parent = hold.parent;
			parent.updateWorldMatrix(true, false);
			hold.position.copy(parent.worldToLocal(f.position));
			hold.quaternion.copy(parent.getWorldQuaternion(this._pq ??= new THREE.Quaternion()).invert().multiply(f.quaternion));
			if (!o.visible || h.faded) { o.visible = true; h.faded = false; if (!this.xr.fan?.slots.find((s) => s.tool === h.tool)?.spring) o.scale.setScalar(1); }
			return;
		}
		h.lostT += dt;
		if (h.lostT > STICK.LOST_HOLD) {
			const k = Math.max(0, 1 - (h.lostT - STICK.LOST_HOLD) / STICK.LOST_FADE);
			o.scale.setScalar(Math.max(1e-3, k));
			o.visible = k > 0;
			h.faded = true;
		}
	}

	/** Forgets everything the tools made. */
	clear() {
		for (const tool of this.tools) tool.clear?.();
		for (const o of [...this.annotations.children]) {
			o.removeFromParent();
			o.traverse((m) => { m.geometry?.dispose(); for (const mat of [].concat(m.material ?? [])) mat.dispose(); });
		}
	}

	/** Leaving VR: the held tool goes back to the fan, and what the tools made is cleared. */
	end() {
		this.putBack();
		this.clear();
	}
}
