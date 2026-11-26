// The bare-hand tuning readout (the Quest 2 design of 24 Nov, for development
// only): with ?hands on the page URL, a small card above each tracked wrist
// shows live what the teleport gesture reads, so the thresholds in
// js/gestures.js can be tuned on the headset in one session:
//   the palm's angle from straight down ("palm 12°"), the pinch distance (thumb to index),
//   and "ready", "aiming" or "blocked: key / fan / model / tool / board /
//   wrist menu" (XRExperience.aimBlock), or what is not ready yet. Above a
//   controller: how much each candidate face axis of its grip turns to the eyes
//   (which one is the buttons' face: the tool fan's watch pose, build 120).
// Never shown to users: nothing in the menus or settings turns it on.

import * as THREE from 'three';
import { Label } from './panel.js';
import { GESTURE } from './gestures.js';
// (Turned on by ?hands: DEV.hands, js/dev.js.)

const ABOVE = 0.06; // the card this far above the wrist (m)
const HEIGHT = 0.018; // the card's height (m): about 12 cm wide, small enough to keep the view clear
const WAIST = 0.8; // a hand this far below the eyes is at your side: it never aims (m)

/** What the readout says for bare hand c (pure enough to test: xr supplies the rest). */
export function readoutText(xr, c) {
	const s = c.gesture?.shape;
	if (!s) return '';
	// The palm's angle to the eyes: under 60° it faces you (Meta's menu gesture) and never aims.
	const head = xr.headWorld();
	const toEyes = s.normal.dot(head.clone().sub(s.pinchAt).normalize());
	const palm = Math.round(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(toEyes, -1, 1))));
	const pinch = (s.pinch * 100).toFixed(1);
	let state;
	if (xr.modes.walk.tele?.c === c || xr.modes.dollhouse.handAim?.c === c) state = 'aiming';
	else {
		const block = xr.aimBlock(c, s.pinchAt);
		if (block) state = `blocked: ${block}`;
		else if (toEyes > GESTURE.TO_EYES) state = 'palm towards you';
		else if (s.pinchAt.y < head.y - WAIST) state = 'below the waist';
		else if (s.pinch >= GESTURE.PINCH_ON) state = 'ready: pinch';
		else state = 'pinched';
	}
	return `${c.handedness === 'left' ? 'L' : 'R'} · palm ${palm}° to eyes · pinch ${pinch} cm · ${state}`;
}

/**
 * What the readout says for controller c: how much each candidate "face" axis
 * of its grip turns to the eyes (1: straight at them), to settle on the headset
 * which one is the buttons' face (the fan's watch pose, js/tool-fan.js).
 */
export function controllerReadoutText(xr, c) {
	c.grip.updateMatrixWorld(true);
	const at = new THREE.Vector3().setFromMatrixPosition(c.grip.matrixWorld);
	const to = xr.headWorld().sub(at).normalize();
	const axis = (x, y, z) => new THREE.Vector3(x, y, z).normalize().transformDirection(c.grip.matrixWorld).dot(to).toFixed(2);
	return `${c.handedness === 'left' ? 'L' : 'R'} grip to eyes · +Y ${axis(0, 1, 0)} · -Z ${axis(0, 0, -1)} · (+Y-Z) ${axis(0, 1, -1)} (the face that reads near 1 in a watch pose)`;
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
			const wrist = c.isHand && c.touch.tracked ? xr.input.joint(c, 'wrist') : c.isController && c.touch.tracked ? c.grip.getWorldPosition(new THREE.Vector3()) : null;
			label.set(!wrist ? '' : c.isHand ? readoutText(xr, c) : controllerReadoutText(xr, c));
			if (!wrist) return;
			label.mesh.position.copy(wrist).y += ABOVE;
			label.mesh.lookAt(head);
		});
	}

	hide() { for (const l of this.labels) l.set(''); }
}
