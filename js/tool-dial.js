// One option per tool, set on one round dial (the next-build asks 3.4): every
// tool has exactly one option and one control part, the same way on each.
//
//   camera  its top, back edge 24 · 28 · 35 · 50 mm   (the viewfinder shows it)
//   marker  the cap           black · blue · green · red (the cap's colour)
//   meter   the blade end     cm · ft in             (the reading's units)
//
// A tool says what it offers as tool.option = { part (the name of its control
// part's empty in the tool model), stops: [{ value, label }], get(), set(value) }.
//
//   Hands and controllers: the other index (or the other controller's tip)
//   touching the control part opens the dial round it.
//   Controllers: the stick press of the holding hand steps to the next stop,
//   and the dial shows 1.5 s with it lit.
//   The dial: a half circle of round stops, 6 cm in radius, in front of the
//   control part, facing the eyes, world-locked; stops 22 mm across, 12 mm
//   apart; the current one outlined. A press on a stop chooses it and closes
//   the dial; it also closes after 3 s untouched, when the tool leaves the
//   hand, or on a press outside it. While open it owns the other hand's pinch
//   and trigger (js/hand-owner.js).
//   Feedback: the tool shows the choice; a label over the control part for 1 s
//   ("35 mm", "Blue", "ft in"); the press sound.
//   A quiet cue: each control part always carries a thin ring (CONTROL_CUE),
//   one soft pulse on the first take of each tool each session.

import * as THREE from 'three';
import { KeyPad } from './keys.js';
import { Label } from './panel.js';
import { CONTROL_CUE } from './theme.js';
import { keepFromEyes } from './zones.js';

export const DIAL = {
	RADIUS: 0.06, STOP: 0.022, GAP: 0.012, // the half circle and its stops (m)
	OPEN_FOR: 3, STEP_SHOW: 1.5, LABEL_FOR: 1, // seconds: untouched it closes; a stick step shows it; the label
	ZONE: 0.022, // a touch on the control part counts within this of its middle (the 22 mm floor)
	TOWARDS: 0.03, UP: 0.10, // the dial floats this far from its part towards the eyes, and this far straight up (m): clear of the hand
	// and the controller holding it, and of the orb (the Designer, §5.8: towards the eyes alone ran over your own hand)
	FOLLOW: 0.08, // seconds: it follows the tool with the framing guide's smoothing
	PULSE: 0.8, // seconds: the cue's one soft pulse on the first take
};

/**
 * The angles (radians, 0 to the right as you see it, counter-clockwise) of n
 * stops on the dial's half circle, centred on `mid` (straight up by default),
 * STOP + GAP apart.
 */
export function stopAngles(n, mid = Math.PI / 2) {
	const step = (DIAL.STOP + DIAL.GAP) / DIAL.RADIUS;
	return Array.from({ length: n }, (_, i) => mid + ((n - 1) / 2 - i) * step);
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
		for (let i = 0; i < 4; i++) this.group.add(this.pad.add(`stop${i}`, DIAL.STOP, DIAL.STOP, { round: true }).group);
		this.label = new Label({ height: 0.03 });
		this.label.mesh.visible = false;
		this.label.mesh.material.depthTest = false;
		xr.scene.add(this.group, this.label.mesh);
		xr.hideFromPhotos(this.group, this.label.mesh);
		this.open = null; // { tool, t, until, stepped }
		this.labelT = 0;
		this.cues = new Map(); // tool -> its ring on the control part
		this._p = new THREE.Vector3(); this._e = new THREE.Vector3();
	}

	/** The world position of a tool's control part (where a touch opens the dial). */
	partAt(tool, out = this._p) {
		const o = tool.object.getObjectByName(tool.option.part);
		return (o ?? tool.object).getWorldPosition(out);
	}

	/**
	 * Where the dial opens: round the control part, or round option.at when the
	 * part sits by the holding wrist (the marker's cap: its dial opens 7 cm along
	 * the barrel, clear of the hand and the orb; the Designer, after the audit's S8).
	 */
	centreAt(tool, out = this._p) {
		const o = tool.option.at ? tool.object.getObjectByName(tool.option.at) : null;
		return o ? o.getWorldPosition(out) : this.partAt(tool, out);
	}

	/** Shows the dial round a tool's control part (stepped: by the stick, for STEP_SHOW). */
	show(tool, { stepped = false } = {}) {
		const stops = tool.option.stops;
		this.open = { tool, t: 0, until: stepped ? DIAL.STEP_SHOW : DIAL.OPEN_FOR, stepped };
		this.place(0, true);
		// Its half circle opens upwards as you see it, the same for either hand.
		const mid = Math.PI / 2, angles = stopAngles(stops.length, mid);
		const current = tool.option.get();
		for (let i = 0; i < 4; i++) {
			const k = this.pad.keys.get(`stop${i}`), s = stops[i];
			k.group.visible = !!s;
			if (!s) continue;
			k.group.position.set((Math.cos(angles[i]) - Math.cos(mid) / 2) * DIAL.RADIUS, (Math.sin(angles[i]) - Math.sin(mid) / 2) * DIAL.RADIUS, 0);
			this.pad.setSpec(`stop${i}`, { id: `stop:${i}`, look: s.value === current ? 'chosen' : 'plain', label: s.label });
		}
		this.group.visible = true;
	}

	/**
	 * Where the open dial floats: over its part (or option.at), TOWARDS metres
	 * towards the eyes and UP metres up, facing the eyes, never nearer them than
	 * 0.30 m (as the tools: pushed out along the line from the eyes). It follows
	 * the tool (smoothed over FOLLOW; snap: at once). A dial wrapped round a part
	 * held in the fist could never clear the fingers (the Designer, §5.8).
	 */
	place(dt, snap = false) {
		const xr = this.xr, at = this.centreAt(this.open.tool, this._c ??= new THREE.Vector3()), eye = xr.headWorld();
		const want = this._w ??= new THREE.Vector3();
		want.copy(eye).sub(at).normalize().multiplyScalar(DIAL.TOWARDS).add(at);
		want.y += DIAL.UP;
		keepFromEyes(want, eye);
		if (snap) this.group.position.copy(want);
		else this.group.position.lerp(want, 1 - Math.exp(-dt / DIAL.FOLLOW));
		this.group.lookAt(eye);
	}

	close() {
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

	/** The stick press of the holding controller: the next stop, the dial shown 1.5 s with it lit. */
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
	}

	/**
	 * Once a frame (after the tools): the other hand's tip on the held tool's
	 * control part opens the dial; presses on its stops; it closes after its
	 * time untouched, when the tool leaves the hand, or on a press outside it.
	 * The quiet rings follow their control parts.
	 */
	update(dt) {
		const xr = this.xr, held = xr.tools?.held;
		this.labelT = Math.max(0, this.labelT - dt);
		if (this.label.mesh.visible && this.labelT === 0) this.label.mesh.visible = false;
		this.updateCues(dt, held);
		const o = this.open;
		if (o && (!held || held.tool !== o.tool)) { this.close(); return; }
		if (!held?.tool.option) return;
		const other = xr.input.controllers.find((c) => c !== held.c && c.touch?.tracked);
		if (!o && other && other.touch.tip.distanceTo(this.partAt(held.tool)) < DIAL.ZONE) this.show(held.tool);
		if (!this.open) return;
		this.place(dt);
		const { action, hot } = this.pad.update(dt, { active: true, exclude: held.c, own: 'dial' }); // (the triggers claim() took for it)
		this.open.t = hot.size ? 0 : this.open.t + dt;
		if (action?.id?.startsWith('stop:')) {
			const s = this.open.tool.option.stops[Number(action.id.slice(5))];
			if (s) this.choose(this.open.tool, s.value);
			this.close();
			return;
		}
		// A press outside it (the other hand's trigger or pinch, not on a stop) closes it.
		const pressedOutside = other && !hot.size && ((other.isController && other.state.down.trigger) || other.gestures?.some((e) => e.type === 'tap'));
		if (pressedOutside || this.open.t >= this.open.until) this.close();
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
						: new THREE.RingGeometry(DIAL.ZONE / 2, DIAL.ZONE / 2 + w, 32);
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
			cue.mesh.material.opacity = this.open?.tool === tool ? 1 : CONTROL_CUE.opacity + (1 - CONTROL_CUE.opacity) * k; // (its dial open: full, so you see which part it belongs to)
			if (cue.faces) cue.mesh.lookAt(this.xr.headWorld());
		}
	}
}
