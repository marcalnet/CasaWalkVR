// Hand-held tools (SPEC.md phase 17): the street camera, the laser meter and
// the marker, taken from a fan over one wrist and used with the other hand.
// This is the frame they plug into; the tools themselves arrive in
// milestones C-F.
//
// While a tool is held, its hand's trigger, grip and second button belong to
// it (c.claim = 'tool', taken before the menu and the mode each frame): the
// trigger uses the tool, the second button is A on the right hand or Y on
// the left (the fan switched sides), and the grip swaps or returns it. The
// other hand's trigger and both sticks keep their jobs, so no tool ever
// makes you jump.
//
// A tool is an object with:
//   name, object (its Object3D, never in photos), controls? (more buttons it
//   owns while held: only 'stickPress', for the marker's colours),
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
export const HOLD = 1; // seconds: "hold A for a second"
// Bare hands have no way to work a tool yet: the tools get their own buttons,
// pressed by the other index (item 11 of the Quest 2 fixes, to come). A hand
// holding a tool never aims a teleport (XRExperience.aimBlock).
const EXTRA = ['stickPress']; // buttons a tool may also own (besides trigger, grip and its second button)
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
		this.held = { tool, c, hold: 0, fired: true, controls: (tool.controls ?? NONE).filter((k) => EXTRA.includes(k)) };
		tool.take?.(c);
	}

	/** The held tool goes back to the fan. */
	putBack() {
		const h = this.held;
		if (!h) return;
		this.held = null;
		h.tool.putBack?.();
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
		for (const name of h.controls) k[name] = 'tool';
		this.xr.input.setLaser(h.c, false);
	}

	/** Each frame, after the mode: sends the held tool its button presses, then lets it update. */
	update(dt) {
		const h = this.held;
		if (!h?.c.source) return;
		const { tool, c } = h, s = c.state, key = ToolSystem.secondKey(c);
		// A bare hand: no trigger yet (see the top); a lost hand ends a stroke.
		if (c.isHand) {
			for (const e of c.gestures ?? []) if (e.type === 'lost') tool.gesture?.(c, e);
			tool.update?.(dt, c);
			return;
		}
		if (s.down.trigger) tool.trigger?.(c, 'down');
		if (s.up.trigger) tool.trigger?.(c, 'up');
		if (s.down[key]) { h.hold = 0; h.fired = false; }
		if (s[key] && !h.fired) {
			h.hold += dt;
			if (h.hold >= HOLD) { h.fired = true; tool.secondary?.(c, 'hold'); }
		}
		if (s.up[key] && !h.fired) tool.secondary?.(c, 'press');
		for (const name of h.controls) if (s.down[name]) tool.control?.(c, name); // (the marker's stick press: colour)
		tool.update?.(dt, c);
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
