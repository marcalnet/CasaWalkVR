// The headset's frame counter, for development and measuring (code audit,
// A3): with ?stats on the page URL, a small line below your view shows the
// frames per second and what the last frame cost to draw (draw calls and
// triangles, both eyes together, everything: the model, the gallery, the
// interface, the hands). Updated twice a second. Never shown to users, never
// in photos.

import * as THREE from 'three';
import { Label } from './panel.js';

const EVERY = 0.5; // seconds between updates (a canvas redraw each frame would cost frames itself)

/** True when the page URL asks for the counter (?stats). */
export function statsWanted(search = globalThis.location?.search ?? '') {
	return new URLSearchParams(search).has('stats');
}

/** The counter's line: fps from frames over seconds; info: renderer.info.render of the last frame. */
export function statsText(frames, seconds, info) {
	const fps = seconds > 0 ? Math.round(frames / seconds) : 0;
	const tri = info.triangles >= 1e6 ? `${(info.triangles / 1e6).toFixed(2)}M` : `${Math.round(info.triangles / 1000)}k`;
	return `${fps} fps · ${info.calls} draw calls · ${tri} triangles (both eyes)`;
}

export class FrameStats {
	/** xr: the XRExperience (its renderer and camera). */
	constructor(xr) {
		this.xr = xr;
		this.label = new Label({ height: 0.02 });
		this.label.mesh.name = 'frame-stats';
		this.label.mesh.position.set(0, -0.22, -0.7); // (below the middle of your view, where it does not cover the home)
		this.label.mesh.renderOrder = 1003;
		xr.camera.add(this.label.mesh);
		xr.hideFromPhotos(this.label.mesh);
		this.reset();
	}

	reset() { this.frames = 0; this.t = 0; this.label.set(''); }

	/** Once a frame (before this frame's render: renderer.info still holds the last one). */
	update(dt) {
		this.frames++;
		this.t += dt;
		if (this.t < EVERY) return;
		this.label.set(statsText(this.frames, this.t, this.xr.renderer.info.render));
		this.frames = 0; this.t = 0;
	}
}
