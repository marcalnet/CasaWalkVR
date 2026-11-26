// The street camera's framing guide (the next-build asks 3.5): a red outline
// rectangle at the depth of what the lens is aimed at, sized exactly to the
// photo's 3:2 frame at that depth. The photo is taken from the camera, not from your eyes, with
// another lens: a frame at the subject's depth marks where the photo's edges
// cut the subject, as seen from your eyes.
//
//   depth   one BVH raycast a frame along the lens axis, clamped 0.3-8 m (8 m
//           with no hit: the sky), eased over 0.15 s so it glides across edges
//   size    the lens's frustum section at that depth (24-50 mm, film 24 mm high,
//           3:2): it changes at once when the lens steps
//   outline 3 mm at 1 m, growing with distance (about 0.17° to the eye), as thin
//           quads (a GL line is 1 px on a Quest); no fill; depth test off (it
//           reads as "the edges", never as an object); FRAME in js/theme.js.
//           (The four lines from the lens to its corners went: the frame alone
//           is clear, and GL lines were 1 px: the UX review's C5.)
//   when    only while the camera is held, fading in and out over 0.2 s; hidden
//           0.4 s while the shutter fires and the print pops
//   comfort the pose smoothed over 0.08 s (hand tremor at 2 m); the photo is
//           taken from that same smoothed pose (pose()), so it matches the frame
// On the interface layer: never in a photo. One draw call each.

import * as THREE from 'three';
import { FRAME } from './theme.js';

export const GUIDE = { NEAR: 0.3, FAR: 8, EASE: 0.15, SMOOTH: 0.08, WIDTH: 0.003, FADE: 0.2, SHUTTER: 0.4 };

/** The photo frame's half-size (m) at distance d for a vertical field of view (degrees), 3:2. */
export function frameAt(d, fovDeg) {
	const h = d * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
	return { hw: h * 1.5, hh: h };
}

export class FramingGuide {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.group = new THREE.Group();
		this.group.name = 'framing-guide';
		this.group.visible = false;
		const colour = new THREE.Color(FRAME.line);
		// The outline: four quads (8 triangles), rewritten each frame.
		this.outline = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 6 * 3), 3)),
			new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: FRAME.opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
		for (const m of [this.outline]) { m.frustumCulled = false; m.renderOrder = 44; m.raycast = () => {}; this.group.add(m); }
		xr.scene.add(this.group);
		xr.hideFromPhotos(this.group);
		this.alpha = 0;
		this.hideT = 0;
		this.dist = null;
		this.pose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), ready: false };
		this._ray = new THREE.Raycaster(); this._ray.firstHitOnly = true;
		this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3();
	}

	/** The smoothed lens pose the frame is drawn from (world matrix, looking along -Z), or null before the first frame. */
	poseMatrix(out = new THREE.Matrix4()) {
		return this.pose.ready ? out.compose(this.pose.p, this.pose.q, this._one ??= new THREE.Vector3(1, 1, 1)) : null;
	}

	/** The shutter fired: hidden while it fires and the print pops. */
	shutter() { this.hideT = GUIDE.SHUTTER; }

	/** Gone at once (the camera put back, VR left). */
	reset() { this.alpha = 0; this.group.visible = false; this.dist = null; this.pose.ready = false; }

	/**
	 * Once a frame. held: the camera is in a hand; lens: its world matrix,
	 * looking along -Z (as a camera); fov: the lens's vertical field (degrees).
	 */
	update(dt, held, lens, fov) {
		this.hideT = Math.max(0, this.hideT - dt);
		const on = held && this.hideT === 0;
		this.alpha = THREE.MathUtils.clamp(this.alpha + (on ? dt : -dt) / GUIDE.FADE, 0, 1);
		this.group.visible = this.alpha > 0;
		if (!this.group.visible) { this.pose.ready = false; return; }
		// The pose, smoothed (hand tremor).
		lens.decompose(this._p, this._q, this._s);
		const k = this.pose.ready ? 1 - Math.exp(-dt / GUIDE.SMOOTH) : 1;
		this.pose.p.lerp(this._p, k); this.pose.q.slerp(this._q, k); this.pose.ready = true;
		// The depth: what the lens is aimed at, clamped, eased.
		const dir = this._d.set(0, 0, -1).applyQuaternion(this.pose.q);
		this._ray.set(this.pose.p, dir);
		this._ray.far = GUIDE.FAR;
		const t = this.xr.targets?.(), meshes = t ? [...t.pointable, ...(t.floors ?? [])] : [];
		const hit = meshes.length ? this._ray.intersectObjects(meshes, false)[0] : null;
		const want = THREE.MathUtils.clamp(hit ? hit.distance : GUIDE.FAR, GUIDE.NEAR, GUIDE.FAR);
		this.dist = this.dist === null ? want : this.dist + (want - this.dist) * (1 - Math.exp(-dt / GUIDE.EASE));
		this.draw(this.dist, fov);
	}

	/** The outline at distance d, in the smoothed lens's frame. */
	draw(d, fov) {
		const { hw, hh } = frameAt(d, fov), w = GUIDE.WIDTH * d;
		this.group.position.copy(this.pose.p);
		this.group.quaternion.copy(this.pose.q);
		const z = -d, o = this.outline.geometry.attributes.position.array;
		// Four bars: top, bottom (full width), left, right (between them).
		const bars = [[-hw, hh - w, hw, hh], [-hw, -hh, hw, -hh + w], [-hw, -hh + w, -hw + w, hh - w], [hw - w, -hh + w, hw, hh - w]];
		bars.forEach(([x0, y0, x1, y1], i) => o.set([x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z], i * 18));
		this.outline.geometry.attributes.position.needsUpdate = true;
		this.outline.material.opacity = FRAME.opacity * this.alpha;
	}
}
