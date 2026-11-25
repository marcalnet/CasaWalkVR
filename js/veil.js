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
	}

	/** who ('teleport', 'layer', 'flash'): cover the view this much (0..1) in this colour; 0 withdraws the request. */
	set(who, opacity, color = 0x000000) {
		if (opacity > 0) this.requests.set(who, { opacity: Math.min(1, opacity), color });
		else this.requests.delete(who);
		this.apply();
	}

	/** How much who is covering the view now (0 when it asks for nothing). */
	amount(who) { return this.requests.get(who)?.opacity ?? 0; }

	/** Withdraws every request (the session ended). */
	clear() { this.requests.clear(); this.apply(); }

	apply() {
		let top = null;
		for (const r of this.requests.values()) if (!top || r.opacity > top.opacity) top = r;
		this.mesh.visible = !!top;
		if (!top) return;
		this.mesh.material.opacity = top.opacity;
		this.mesh.material.color.set(top.color);
	}
}
