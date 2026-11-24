// The bare-hand tuning readout (the Quest 2 design of 24 Nov, for development
// only): with ?hands on the page URL, a small card above each tracked wrist
// shows live what the teleport gesture reads, so the thresholds in
// js/gestures.js can be tuned on the headset in one session:
//   the palm's angle from straight down ("palm 12°"), the pinch distance (thumb to index),
//   and "ready", "aiming" or "blocked: key / fan / model / tool / board /
//   wrist menu" (XRExperience.aimBlock), or what is not ready yet.
// Never shown to users: nothing in the menus or settings turns it on.

import * as THREE from 'three';
import { Label } from './panel.js';
import { GESTURE } from './gestures.js';

const ABOVE = 0.06; // the card this far above the wrist (m)
const HEIGHT = 0.018; // the card's height (m): about 12 cm wide, small enough to keep the view clear
const WAIST = 0.8, CHEST = 0.2; // "ready" between these distances below the eyes (m)

/** True when the page URL asks for the readout (?hands). */
export function readoutWanted(search = globalThis.location?.search ?? '') {
	return new URLSearchParams(search).has('hands');
}

/** What the readout says for bare hand c (pure enough to test: xr supplies the rest). */
export function readoutText(xr, c) {
	const s = c.gesture?.shape;
	if (!s) return '';
	const palm = Math.round(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-s.normal.y, -1, 1))));
	const pinch = (s.pinch * 100).toFixed(1);
	let state;
	if (xr.modes.walk.tele?.c === c || xr.modes.dollhouse.handAim?.c === c) state = 'aiming';
	else {
		const block = xr.aimBlock(c, s.pinchAt);
		const eye = xr.headWorld().y;
		if (block) state = `blocked: ${block}`;
		else if (s.normal.y >= -GESTURE.PALM_DOWN) state = 'palm not down';
		else if (s.pinchAt.y < eye - WAIST) state = 'below the waist';
		else if (s.pinchAt.y > eye - CHEST) state = 'above the chest';
		else state = 'ready';
	}
	return `${c.handedness === 'left' ? 'L' : 'R'} · palm ${palm}° · pinch ${pinch} cm · ${state}`;
}

export class HandReadout {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.labels = xr.input.controllers.map(() => {
			const l = new Label({ height: HEIGHT });
			l.mesh.name = 'hand-readout';
			xr.scene.add(l.mesh);
			return l;
		});
		xr.hideFromPhotos(...this.labels.map((l) => l.mesh));
	}

	/** Once a frame, after the modes. */
	update() {
		const xr = this.xr, head = xr.headWorld();
		xr.input.controllers.forEach((c, i) => {
			const label = this.labels[i];
			const wrist = c.isHand && c.touch.tracked ? xr.input.joint(c, 'wrist') : null;
			label.set(wrist ? readoutText(xr, c) : '');
			if (!wrist) return;
			label.mesh.position.copy(wrist).y += ABOVE;
			label.mesh.lookAt(head);
		});
	}

	hide() { for (const l of this.labels) l.set(''); }
}
