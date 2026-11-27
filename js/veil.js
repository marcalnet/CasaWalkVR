// The one sphere round the eyes (code audit, A5): it covers the view for the
// teleport fade (black), the move between layers (black; white for leaving
// VR) and the photo flash (white). Each asks for its own colour and how much
// it covers, under its own name; the strongest request is what you see, so
// two at once (a flash during a fade) never fight. A child of the camera,
// drawn over everything but the error card (js/xr-ui.js, renderOrder 1004).

import * as THREE from 'three';

const TUNNEL_AT = 0.25, TUNNEL_HALF = 1; // the tunnel's plane: this far from the eyes, this half-size (m)
const across = (deg) => Math.tan(THREE.MathUtils.degToRad(deg / 2)) * TUNNEL_AT / TUNNEL_HALF; // an angle across the view, as a fraction of the plane's half-size
const TUNNEL_CLEAR = across(60), TUNNEL_FULL = across(100); // clear within 60° across; the dim full from 100° (build 120, M2)
const TUNNEL_MAX = 0.5; // the dim at its darkest: half (never black: the final fade is the layer's own)
const TUNNEL_OPEN = 6; // how much larger it starts (the circle beyond the view's edge)

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
		// The tunnel (WALK_IN_ZOOM, js/xr.js): a dim all round a clear circle 60° across, full from 100°, turned to a spot.
		this.tunnel = null;
		if (typeof document !== 'undefined') {
			const c = document.createElement('canvas');
			c.width = c.height = 512;
			const g = c.getContext('2d'), grad = g.createRadialGradient(256, 256, TUNNEL_CLEAR * 256, 256, 256, TUNNEL_FULL * 256);
			grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
			g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
			this.tunnel = new THREE.Mesh(new THREE.PlaneGeometry(2 * TUNNEL_HALF, 2 * TUNNEL_HALF), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
			this.tunnel.renderOrder = 1001;
			this.tunnel.visible = false;
			this.tunnel.name = 'tunnel';
			camera.add(this.tunnel);
		}
	}

	/**
	 * The tunnel: 0 hidden, 1 closed to its 60° circle and at its darkest,
	 * TUNNEL_MAX (it closes in from the view's edge as it grows); dirLocal: the
	 * spot in the camera's space.
	 */
	setTunnel(amount, dirLocal = null) {
		const m = this.tunnel;
		if (!m) return;
		m.visible = amount > 0.001;
		if (!m.visible) return;
		if (dirLocal) m.position.copy(dirLocal).normalize().multiplyScalar(TUNNEL_AT);
		m.lookAt(0, 0, 0);
		m.scale.setScalar(1 + (TUNNEL_OPEN - 1) * (1 - amount)); // (a wide hole at first: the circle closes in from the edge)
		m.material.opacity = TUNNEL_MAX * Math.min(1, amount * 2);
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
	/** The session ends (js/xr.js handleEnd): nothing round the eyes. */
	end() { this.clear(); }

	clear() { this.requests.clear(); this.setVignette(0); this.setTunnel(0); this.apply(); }

	apply() {
		let top = null;
		for (const r of this.requests.values()) if (!top || r.opacity > top.opacity) top = r;
		this.mesh.visible = !!top;
		if (!top) return;
		this.mesh.material.opacity = top.opacity;
		this.mesh.material.color.set(top.color);
	}
}
