// One option per tool, set on one round dial (the next-build asks 3.4): every
// tool has exactly one option and one control part, the same way on each.
//
//   camera  the lens barrel   24 · 28 · 35 · 50 mm   (the viewfinder shows it)
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

export const DIAL = {
	RADIUS: 0.06, STOP: 0.022, GAP: 0.012, // the half circle and its stops (m)
	OPEN_FOR: 3, STEP_SHOW: 1.5, LABEL_FOR: 1, // seconds: untouched it closes; a stick step shows it; the label
	ZONE: 0.022, // a touch on the control part counts within this of its middle (the 22 mm floor)
	PULSE: 0.8, // seconds: the cue's one soft pulse on the first take
};

/** The angles (radians, 0 to the right, counter-clockwise) of n stops on the dial's top half, centred, STOP + GAP apart. */
export function stopAngles(n) {
	const step = (DIAL.STOP + DIAL.GAP) / DIAL.RADIUS;
	return Array.from({ length: n }, (_, i) => Math.PI / 2 + ((n - 1) / 2 - i) * step);
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

	/** The world position of a tool's control part. */
	partAt(tool, out = this._p) {
		const o = tool.object.getObjectByName(tool.option.part);
		return (o ?? tool.object).getWorldPosition(out);
	}

	/** Shows the dial round a tool's control part (stepped: by the stick, for STEP_SHOW). */
	show(tool, { stepped = false } = {}) {
		const xr = this.xr, at = this.partAt(tool).clone(), eye = xr.headWorld(), stops = tool.option.stops;
		// In front of the control part, towards the eyes, facing them; world-locked.
		const toEye = this._e.copy(eye).sub(at).normalize();
		this.group.position.copy(at).addScaledVector(toEye, 0.03);
		this.group.lookAt(eye);
		const angles = stopAngles(stops.length);
		const current = tool.option.get();
		for (let i = 0; i < 4; i++) {
			const k = this.pad.keys.get(`stop${i}`), s = stops[i];
			k.group.visible = !!s;
			if (!s) continue;
			k.group.position.set(Math.cos(angles[i]) * DIAL.RADIUS, Math.sin(angles[i]) * DIAL.RADIUS - DIAL.RADIUS / 2, 0);
			this.pad.setSpec(`stop${i}`, { id: `stop:${i}`, look: s.value === current ? 'chosen' : 'plain', label: s.label });
		}
		this.group.visible = true;
		this.open = { tool, t: 0, until: stepped ? DIAL.STEP_SHOW : DIAL.OPEN_FOR, stepped };
	}

	close() {
		this.open = null;
		this.group.visible = false;
		this.pad.reset();
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
		const { action, hot } = this.pad.update(dt, { active: true, exclude: held.c });
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
				const part = tool.object.getObjectByName(tool.option.part) ?? tool.object;
				cue = { mesh: new THREE.Mesh(new THREE.RingGeometry(DIAL.ZONE / 2, DIAL.ZONE / 2 + CONTROL_CUE.width, 32),
					new THREE.MeshBasicMaterial({ color: CONTROL_CUE.color, transparent: true, opacity: CONTROL_CUE.opacity, depthWrite: false, side: THREE.DoubleSide })), pulse: 0 };
				cue.mesh.name = 'control-cue';
				cue.mesh.raycast = () => {};
				part.add(cue.mesh);
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
			cue.mesh.material.opacity = CONTROL_CUE.opacity + (1 - CONTROL_CUE.opacity) * k;
			cue.mesh.lookAt(this.xr.headWorld());
		}
	}
}
