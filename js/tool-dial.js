// Each tool's options, on a row of keys that shows when the other hand comes
// near (build 215's C3, the UX/UI Designer's spec; it replaces the half-circle
// dial of the next-build asks 3.4: with controllers nobody found it).
//
//   camera  Wide · Medium · Zoom          (24 / 50 / 75 mm: the lens)
//   meter   cm · ft in · Undo             (the reading's units)
//   marker  four colour keys · Undo        (the ink; two rows: 3 + 2)
//
// A tool says what it offers as tool.option = { part (the name of its control
// part's empty in the tool model), stops: [{ value, label (its name), key?
// (the word on its key), fill? (a key filled with that colour, no word) }],
// get(), set(value) }, and tool.undo?() (an Undo key, last in the row).
//
//   Reveal by reaching: the other hand's index (or the other controller's tip)
//   within NEAR of the held tool shows its row; it goes beyond FAR, after
//   OPEN_FOR untouched, or when the tool goes back. Once closed it shows again
//   only after that hand has been beyond FAR.
//   Controllers: the other tip presses the keys by touch or by its laser; the
//   holding hand's stick press still steps through the options, and shows
//   the row STEP_SHOW with the choice lit.
//   The row: round keys KEY across, GAP apart, at most 3 a row (more below),
//   its middle TOWARDS metres towards the eyes, UP metres up and INWARD metres
//   towards the body's middle from the control part, facing the eyes, never nearer them than 0.30 m (pushed
//   out); the current option filled orange, the others white.
//   A choice: the key fills, a click, the label "Wide angle" over the control
//   part 1 s; the row stays CHOSEN_HOLD, then fades over FADE. Undo: one
//   click a press, and the row stays while the hand is near.
//   While the row shows it owns the other hand's pinch and trigger
//   (js/hand-owner.js, the 'dial' rung), and the tool's quiet ring is full.
//   A quiet cue: each control part always carries a thin ring (CONTROL_CUE),
//   one soft pulse on the first take of each tool each session.

import * as THREE from 'three';
import { KeyPad } from './keys.js';
import { Label } from './panel.js';
import { CONTROL_CUE } from './theme.js';
import { keepFromEyes } from './zones.js';

export const DIAL = {
	KEY: 0.07, GAP: 0.012, PER_ROW: 3, // round keys 7 cm across (as the orb's ← Back), 1.2 cm apart, three a row (m)
	NEAR: 0.12, FAR: 0.18, // the other hand's tip this near the held tool shows the row; beyond FAR it goes (m)
	OPEN_FOR: 3, STEP_SHOW: 1.5, LABEL_FOR: 1, // seconds: untouched it goes; a stick step shows it; the chosen label
	CHOSEN_HOLD: 1, FADE: 0.2, // seconds: after a choice the row stays, then fades
	TOWARDS: 0.03, UP: 0.10, // the row's middle: this far from the control part towards the eyes, and this far up (m; the Designer's §5.8)
	INWARD: 0.14, // ... and this far towards the body's middle, away from the holding hand (m): above the hand, a bare hand's thumb came within 1 cm of the keys; 14 cm in keeps every key 6.5 cm or more from it (measured: tests/xr-session.test.js)
	FOLLOW: 0.08, // seconds: it follows the tool with the framing guide's smoothing
	PULSE: 0.8, // seconds: the cue's one soft pulse on the first take
};

/** Where key i of n sits in the row (x, y, metres from the row's middle): PER_ROW a row, rows below each other, each row centred. */
export function rowSpot(i, n) {
	const per = DIAL.PER_ROW, rows = Math.ceil(n / per), row = Math.floor(i / per), inRow = Math.min(per, n - row * per), step = DIAL.KEY + DIAL.GAP;
	return { x: (i % per - (inRow - 1) / 2) * step, y: ((rows - 1) / 2 - row) * step };
}

/** The next stop's value after `value` in stops (wrapping). */
export function nextStop(stops, value) {
	const i = stops.findIndex((s) => s.value === value);
	return stops[(i + 1) % stops.length].value;
}

export class ToolDial {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.group = new THREE.Group();
		this.group.name = 'tool-dial';
		this.group.visible = false;
		this.pad = new KeyPad(xr, 'dial');
		for (let i = 0; i < 6; i++) this.group.add(this.pad.add(`stop${i}`, DIAL.KEY, DIAL.KEY, { round: true }).group);
		this.label = new Label({ height: 0.03 });
		this.label.mesh.visible = false;
		this.label.mesh.material.depthTest = false;
		xr.scene.add(this.group, this.label.mesh);
		xr.hideFromPhotos(this.group, this.label.mesh);
		this.open = null; // { tool, t (untouched), until, stepped, chosen (seconds since a choice, or null) }
		this.armed = true; // (closed, the row shows again only once the other hand has been beyond FAR)
		this.labelT = 0;
		this.cues = new Map(); // tool -> its ring on the control part
		this._p = new THREE.Vector3(); this._e = new THREE.Vector3();
	}

	/** The world position of a tool's control part (the row floats over it). */
	partAt(tool, out = this._p) {
		const o = tool.object.getObjectByName(tool.option.part);
		return (o ?? tool.object).getWorldPosition(out);
	}

	/** The keys a tool's row shows: its options, then Undo if it has one. */
	keysOf(tool) {
		const current = tool.option.get();
		const keys = tool.option.stops.map((s, i) => ({ id: `stop:${i}`, look: s.value === current ? 'current' : 'plain', label: s.fill ? '' : s.key ?? s.label, fill: s.fill }));
		if (tool.undo) keys.push({ id: 'undo', look: 'plain', label: 'Undo' });
		return keys;
	}

	/** Shows a tool's row (stepped: by the stick, for STEP_SHOW). */
	show(tool, { stepped = false } = {}) {
		this.open = { tool, t: 0, until: stepped ? DIAL.STEP_SHOW : DIAL.OPEN_FOR, stepped, chosen: null };
		this.place(0, true);
		this.redraw();
		this.group.scale.setScalar(1);
		this.group.visible = true;
	}

	/** The row's keys for the open tool: where, and what each shows. */
	redraw() {
		const keys = this.keysOf(this.open.tool);
		for (let i = 0; i < 6; i++) {
			const k = this.pad.keys.get(`stop${i}`), spec = keys[i];
			k.group.visible = !!spec;
			if (!spec) continue;
			const { x, y } = rowSpot(i, keys.length);
			k.group.position.set(x, y, 0);
			this.pad.setSpec(`stop${i}`, spec);
		}
	}

	/**
	 * Where the row floats: its middle TOWARDS metres from the control part
	 * towards the eyes and UP metres up, facing the eyes, never nearer them
	 * than 0.30 m (as the tools: pushed out along the line from the eyes). It
	 * follows the tool (smoothed over FOLLOW; snap: at once).
	 */
	place(dt, snap = false) {
		const xr = this.xr, at = this.partAt(this.open.tool, this._c ??= new THREE.Vector3()), eye = xr.headWorld();
		const want = this._w ??= new THREE.Vector3();
		want.copy(eye).sub(at).normalize().multiplyScalar(DIAL.TOWARDS).add(at);
		want.y += DIAL.UP;
		const held = xr.tools?.held;
		if (held) want.addScaledVector(xr.viewAxes().right, (held.c.handedness === 'left' ? 1 : -1) * DIAL.INWARD);
		keepFromEyes(want, eye);
		if (snap) this.group.position.copy(want);
		else this.group.position.lerp(want, 1 - Math.exp(-dt / DIAL.FOLLOW));
		this.group.lookAt(eye);
	}

	close() {
		if (this.open) this.armed = false; // (it shows again once the hand has been away)
		this.open = null;
		this.group.visible = false;
		this.pad.reset();
	}

	/**
	 * Each frame, before the places (with the tools' and the fan's claims):
	 * while the dial is open, the other controllers' triggers are its own: a
	 * stop chosen by laser, or a press outside that closes it, is never also a
	 * teleport or a walk-in (the next-build asks 3.4; the code audit's S1).
	 * Bare hands: the hand arbiter's 'dial' rung (js/hand-owner.js).
	 */
	claim() {
		if (!this.open) return;
		const held = this.xr.tools?.held;
		for (const c of this.xr.input.active()) if (c !== held?.c && c.claim.trigger === null) c.claim.trigger = 'dial';
	}

	/** The stick press of the holding controller: the next option, the row shown STEP_SHOW with it lit. */
	step(tool) {
		const v = nextStop(tool.option.stops, tool.option.get());
		this.choose(tool, v);
		this.show(tool, { stepped: true });
	}

	/** A stop chosen: the tool takes it; its label floats over the control part 1 s; the press sound. */
	choose(tool, value) {
		const xr = this.xr;
		tool.option.set(value);
		const s = tool.option.stops.find((x) => x.value === value);
		this.label.set(s?.label ?? String(value));
		this.label.mesh.position.copy(this.partAt(tool)).y += 0.05;
		this.label.mesh.lookAt(xr.headWorld());
		this.label.mesh.visible = true;
		this.labelT = DIAL.LABEL_FOR;
		if (xr.soundLevel !== 'off') xr.sound.play('press');
		if (this.open?.tool === tool) { this.open.chosen = 0; this.redraw(); } // (the key fills; the row stays CHOSEN_HOLD, then fades)
	}

	/**
	 * Once a frame (after the tools): the other hand's tip near the held tool
	 * shows its row; presses on its keys; it goes beyond FAR, after OPEN_FOR
	 * untouched, after a choice (CHOSEN_HOLD, then a FADE), or when the tool
	 * leaves the hand. The quiet rings follow their control parts.
	 */
	update(dt) {
		const xr = this.xr, held = xr.tools?.held;
		this.labelT = Math.max(0, this.labelT - dt);
		if (this.label.mesh.visible && this.labelT === 0) this.label.mesh.visible = false;
		this.updateCues(dt, held);
		const o = this.open;
		if (o && (!held || held.tool !== o.tool)) { this.close(); return; }
		if (!held?.tool.option) { this.armed = true; return; }
		const other = xr.input.controllers.find((c) => c !== held.c && c.touch?.tracked);
		const d = other ? this.distanceTo(held.tool, other.touch.tip) : Infinity;
		if (d > DIAL.FAR) this.armed = true;
		if (!o && this.armed && d < DIAL.NEAR) this.show(held.tool);
		if (!this.open) return;
		this.place(dt);
		const { action, hot } = this.pad.update(dt, { active: !this.open.chosen, exclude: held.c, own: 'dial' }); // (the triggers claim() took for it)
		this.open.t = hot.size ? 0 : this.open.t + dt;
		if (action?.id === 'undo') { this.open.tool.undo(); this.open.t = 0; }
		else if (action?.id?.startsWith('stop:')) {
			const s = this.open.tool.option.stops[Number(action.id.slice(5))];
			if (s) this.choose(this.open.tool, s.value);
		}
		if (this.open.chosen != null) {
			this.open.chosen += dt;
			const k = 1 - Math.max(0, this.open.chosen - DIAL.CHOSEN_HOLD) / DIAL.FADE;
			this.group.scale.setScalar(Math.max(1e-3, k));
			if (k <= 0) this.close();
			return;
		}
		if (this.open.stepped ? this.open.t >= this.open.until : (d > DIAL.FAR || this.open.t >= this.open.until)) this.close();
	}

	/** How far a point is from a held tool: from its origin or its control part, whichever is nearer (m). */
	distanceTo(tool, p) {
		return Math.min(tool.object.getWorldPosition(this._e).distanceTo(p), this.partAt(tool, this._e).distanceTo(p));
	}

	/** The quiet ring on each tool's control part (always), and its one pulse on the first take this session. */
	updateCues(dt, held) {
		for (const tool of this.xr.tools?.tools ?? []) {
			if (!tool.option) continue;
			let cue = this.cues.get(tool);
			if (!cue) {
				// Where the model says it is seen in the hand (userData.cue: a flat ring on the camera's top edge, a ring on
				// the marker's cap end), else a ring round the control part, facing you (the meter's blade). Depth-tested.
				const spec = tool.object.userData.cue, w = CONTROL_CUE.width;
				const geo = spec?.shape === 'band' ? new THREE.CylinderGeometry(spec.radius, spec.radius, w, 32, 1, true).rotateX(Math.PI / 2)
					: spec?.shape === 'ring' ? new THREE.RingGeometry(spec.radius - w, spec.radius, 32).rotateX(spec.up ? -Math.PI / 2 : 0)
						: new THREE.RingGeometry(0.011, 0.011 + w, 32); // (round the meter's blade: 22 mm across)
				cue = { mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: CONTROL_CUE.color, transparent: true, opacity: CONTROL_CUE.opacity, depthWrite: false, side: THREE.DoubleSide })), pulse: 0, faces: !spec };
				cue.mesh.name = 'control-cue';
				cue.mesh.raycast = () => {};
				if (spec) { tool.object.add(cue.mesh); cue.mesh.position.fromArray(spec.at); }
				else (tool.object.getObjectByName(tool.option.part) ?? tool.object).add(cue.mesh);
				this.xr.hideFromPhotos(cue.mesh);
				this.cues.set(tool, cue);
			}
			// The first take of this tool this session: one soft pulse (to full and back).
			if (held?.tool === tool && this.xr.store && !this.xr.store.cued.has(tool.name)) {
				this.xr.store.cued.add(tool.name);
				cue.pulse = DIAL.PULSE;
			}
			cue.pulse = Math.max(0, cue.pulse - dt);
			const k = cue.pulse > 0 ? Math.sin((1 - cue.pulse / DIAL.PULSE) * Math.PI) : 0;
			const live = this.open?.tool === tool || (held?.tool === tool && held.mode === 'use'); // (its dial open: full, so you see which part it belongs to; in use mode, full: "this tool is live", build 215's C1)
			cue.mesh.material.opacity = live ? 1 : CONTROL_CUE.opacity + (1 - CONTROL_CUE.opacity) * k;
			if (cue.faces) cue.mesh.lookAt(this.xr.headWorld());
		}
	}
}
