// The quiet ring on each tool's control part (the camera's top edge, the
// marker's cap, the meter's blade): always there, thin and faint (CONTROL_CUE in
// js/theme.js), one soft pulse on the first take of each tool each session,
// and full while the tool is held in use mode: "this tool is live" (build
// 215's C1). (It lived with the tools' options row, js/tool-dial.js, until the
// user simplified the tools on 27 Nov 2026: one lens, one ink, the meter's units
// in Settings, and the row went.)
//
// A tool names its control part (tool.controlPart: an empty in its model);
// where the model says how the ring is seen in the hand (userData.cue: a band
// round the camera's top edge, a ring on the marker's cap end) it follows that,
// else it is a ring round the control part, facing you (the meter's blade).

import * as THREE from 'three';
import { CONTROL_CUE } from './theme.js';

export const CUE = { PULSE: 0.8 }; // seconds: the one soft pulse on the first take

export class ControlCues {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.cues = new Map(); // tool -> { mesh, pulse, faces }
	}

	/** The ring of a tool, made on first sight. */
	cueOf(tool) {
		let cue = this.cues.get(tool);
		if (cue) return cue;
		const spec = tool.object.userData.cue, w = CONTROL_CUE.width;
		const geo = spec?.shape === 'band' ? new THREE.CylinderGeometry(spec.radius, spec.radius, w, 32, 1, true).rotateX(Math.PI / 2)
			: spec?.shape === 'ring' ? new THREE.RingGeometry(spec.radius - w, spec.radius, 32).rotateX(spec.up ? -Math.PI / 2 : 0)
				: new THREE.RingGeometry(0.011, 0.011 + w, 32); // (round the meter's blade: 22 mm across)
		cue = { mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: CONTROL_CUE.color, transparent: true, opacity: CONTROL_CUE.opacity, depthWrite: false, side: THREE.DoubleSide })), pulse: 0, faces: !spec };
		cue.mesh.name = 'control-cue';
		cue.mesh.raycast = () => {};
		if (spec) { tool.object.add(cue.mesh); cue.mesh.position.fromArray(spec.at); }
		else (tool.object.getObjectByName(tool.controlPart) ?? tool.object).add(cue.mesh);
		this.xr.hideFromPhotos(cue.mesh);
		this.cues.set(tool, cue);
		return cue;
	}

	/** Once a frame (after the tools): each ring's strength; the pulse on a tool's first take this session. */
	update(dt) {
		const xr = this.xr, held = xr.tools?.held;
		for (const tool of xr.tools?.tools ?? []) {
			if (!tool.controlPart) continue;
			const cue = this.cueOf(tool);
			if (held?.tool === tool && xr.store && !xr.store.cued.has(tool.name)) {
				xr.store.cued.add(tool.name);
				cue.pulse = CUE.PULSE;
			}
			cue.pulse = Math.max(0, cue.pulse - dt);
			const k = cue.pulse > 0 ? Math.sin((1 - cue.pulse / CUE.PULSE) * Math.PI) : 0;
			const live = held?.tool === tool && held.mode === 'use'; // (in use mode, full: "this tool is live", build 215's C1)
			cue.mesh.material.opacity = live ? 1 : CONTROL_CUE.opacity + (1 - CONTROL_CUE.opacity) * k;
			if (cue.faces) cue.mesh.lookAt(xr.headWorld());
		}
	}
}
