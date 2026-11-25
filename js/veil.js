// The one sphere round the eyes (code audit, A5): it covers the view for the
// teleport fade (black), the move between layers (black; white for leaving
// VR) and the photo flash (white). Each asks for its own colour and how much
// it covers, under its own name; the strongest request is what you see, so
// two at once (a flash during a fade) never fight. A child of the camera,
// drawn over everything but the error card (js/xr-ui.js, renderOrder 1004).

import * as THREE from 'three';

export class Veil {
	constructor(camera) {
		this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8),
			new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
		this.mesh.renderOrder = 1002;
		this.mesh.visible = false;
		this.mesh.name = 'veil';
		camera.add(this.mesh);
		this.requests = new Map(); // who -> { opacity, color }
		// A soft vignette (a dark ring at the edges of the view), for the slow growth stepping inside: the edges narrow to about 70%.
		this.vignette = null;
		if (typeof document !== 'undefined') {
			const c = document.createElement('canvas');
			c.width = c.height = 128;
			const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 40, 64, 64, 64);
			grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.7, 'rgba(0,0,0,0.0)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
			g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
			const tex = new THREE.CanvasTexture(c);
			this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
			this.vignette.position.z = -0.25; // (about 90° across at that distance: the corners are beyond the view)
			this.vignette.renderOrder = 1001;
			this.vignette.visible = false;
			this.vignette.name = 'vignette';
			camera.add(this.vignette);
		}
		this.vignetteAmount = 0;
	}

	/** who ('teleport', 'layer', 'flash'): cover the view this much (0..1) in this colour; 0 withdraws the request. */
	set(who, opacity, color = 0x000000) {
		if (opacity > 0) this.requests.set(who, { opacity: Math.min(1, opacity), color });
		else this.requests.delete(who);
		this.apply();
	}

	/** The vignette's strength (0..1): the view's edges darken. 0 hides it. */
	setVignette(amount) {
		this.vignetteAmount = amount;
		if (!this.vignette) return;
		this.vignette.visible = amount > 0.01;
		this.vignette.material.opacity = amount * 0.8;
	}

	/** How much who is covering the view now (0 when it asks for nothing). */
	amount(who) { return this.requests.get(who)?.opacity ?? 0; }

	/** Withdraws every request (the session ended). */
	clear() { this.requests.clear(); this.setVignette(0); this.apply(); }

	apply() {
		let top = null;
		for (const r of this.requests.values()) if (!top || r.opacity > top.opacity) top = r;
		this.mesh.visible = !!top;
		if (!top) return;
		this.mesh.material.opacity = top.opacity;
		this.mesh.material.color.set(top.color);
	}
}
