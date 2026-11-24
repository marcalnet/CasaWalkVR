// Bare hands, drawn (milestone C0.2, SPEC.md "C0. Hands and touch"):
// original, from plain shapes. A capsule along every finger bone between the
// WebXR joints, and a few thicker ones across the palm, rebuilt each frame
// into one mesh per hand. Frosted paper white and translucent (js/theme.js,
// HAND), drawn in two passes so it reads as one clean shape: first depth
// only, then colour where the depth is the hand's own nearest (no darker seams where capsules
// overlap). The index fingertip carries the orange accent, the "pen": faint,
// and full when a key is near. In passthrough only a faint outline and the
// fingertip show. When tracking is lost the hand fades out. Never in photos.
// Draw calls: 3 per hand.

import * as THREE from 'three';
import { HAND } from './theme.js';
import { loadHands, dressHand } from './hand-model.js';

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const CHAIN = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];

/** The bones: [joint a, joint b, radius (null: the joints' own)]. */
export const BONES = [
	['wrist', 'thumb-metacarpal', 0.014],
	['thumb-metacarpal', 'thumb-phalanx-proximal', null],
	['thumb-phalanx-proximal', 'thumb-phalanx-distal', null],
	['thumb-phalanx-distal', 'thumb-tip', null],
	...FINGERS.flatMap((f) => [
		['wrist', `${f}-metacarpal`, 0.012],
		...CHAIN.slice(0, -1).map((j, i) => [`${f}-${j}`, `${f}-${CHAIN[i + 1]}`, i === 0 ? 0.013 : null]),
	]),
	// The palm: thick bars across it, so it reads as a hand, not a skeleton.
	['index-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal', 0.014],
	['index-finger-metacarpal', 'pinky-finger-metacarpal', 0.016],
	['wrist', 'middle-finger-phalanx-proximal', 0.02],
];

// One low-poly capsule (radius 1, straight part 1 long, along Y), reshaped per bone.
const TEMPLATE = new THREE.CapsuleGeometry(1, 1, 2, 8, 1);
const T_POS = TEMPLATE.attributes.position.array, T_NOR = TEMPLATE.attributes.normal.array;
const T_IDX = TEMPLATE.index.array, T_N = T_POS.length / 3;
const UP = new THREE.Vector3(0, 1, 0);

export class HandView {
	/** c: an XRInput entry (c.hand is three.js's hand group, its joints filled while tracked). */
	constructor(c) {
		this.c = c;
		this.alpha = 0;
		this.near = false; // a key is near the fingertip
		const n = BONES.length * T_N;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
		const idx = new Uint16Array(BONES.length * T_IDX.length);
		for (let b = 0; b < BONES.length; b++) for (let i = 0; i < T_IDX.length; i++) idx[b * T_IDX.length + i] = T_IDX[i] + b * T_N;
		geo.setIndex(new THREE.BufferAttribute(idx, 1));
		this.geometry = geo;
		// Pass 1: depth only. Pass 2: colour where the depth is the hand's own front surface.
		// (Transparent, so it is drawn in the transparent list at its renderOrder, after the menus
		// and keys: an opaque depth pass would punch holes in them where the finger is in front.)
		this.depthMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, depthWrite: true }));
		this.depthMesh.renderOrder = 30;
		this.colourMat = new THREE.MeshLambertMaterial({ color: HAND.fill, emissive: HAND.fill, emissiveIntensity: 0.35, transparent: true, opacity: HAND.opacity, depthWrite: false, depthFunc: THREE.LessEqualDepth });
		// (LessEqual, not Equal: the two passes use different shaders, and a phone GPU may
		// compute slightly different depths in each; pass 1 already holds the nearest.)
		this.colourMesh = new THREE.Mesh(geo, this.colourMat);
		this.colourMesh.renderOrder = 31;
		this.tipMat = new THREE.MeshBasicMaterial({ color: HAND.tip, transparent: true, opacity: HAND.tipIdle, depthWrite: false });
		this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 12, 8), this.tipMat);
		this.tip.renderOrder = 32;
		this.group = new THREE.Group();
		this.group.name = 'hand-view';
		this.group.add(this.depthMesh, this.colourMesh, this.tip);
		for (const m of [this.depthMesh, this.colourMesh, this.tip]) m.frustumCulled = false;
		this.group.visible = false;
		// The joints are in the hand group's space, which is the rig's: the view sits there too.
		c.hand.parent?.add(this.group);
		this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
		// The hand model (C0.5): once loaded, it replaces the capsules (theme.HAND.model).
		this.models = null; // { left, right }: dressed hand models, made once loaded
		this.model = null; // the one shown (this hand's side)
		if (HAND.model === 'generic') loadHands().then((h) => { if (h) this.models = { left: dressHand(h.left, 'left'), right: dressHand(h.right, 'right') }; });
	}

	/** Once a frame. passthrough: only the fingertip and a faint outline. */
	update(dt, { passthrough = false, show = true } = {}) {
		const c = this.c;
		const tracked = show && c.isHand && c.touch.tracked;
		// The hand model for this side, once loaded (else the capsules).
		const want = this.models && (c.handedness === 'left' || c.handedness === 'right') ? this.models[c.handedness] : null;
		if (want !== this.model) {
			this.model?.removeFromParent();
			this.model = want;
			if (want) this.group.add(want);
			this.depthMesh.visible = this.colourMesh.visible = this.tip.visible = !want;
		}
		if (tracked) this.model ? this.model.userData.pose(c.hand.joints) : this.rebuild();
		this.alpha = tracked ? 1 : Math.max(0, this.alpha - dt / HAND.fade);
		this.group.visible = this.alpha > 0;
		if (!this.group.visible) return;
		this.colourMat.opacity = (passthrough ? HAND.passthroughOpacity : HAND.opacity) * this.alpha;
		if (this.model) {
			this.model.userData.setOpacity((passthrough ? HAND.passthroughOpacity : HAND.opacity) * this.alpha);
			this.model.userData.setTip(this.near ? 1 : 0);
		} else this.depthMesh.visible = this.colourMesh.visible = this.alpha > 0.01;
		this.tipMat.opacity = (this.near ? 1 : HAND.tipIdle) * this.alpha;
	}

	/** The capsules from this frame's joints. */
	rebuild() {
		const joints = this.c.hand.joints, pos = this.geometry.attributes.position.array, nor = this.geometry.attributes.normal.array;
		const a = this._a, b = this._b, q = this._q, v = this._v;
		let o = 0;
		for (const [ja, jb, radius] of BONES) {
			const A = joints[ja], B = joints[jb];
			if (!A?.visible || !B?.visible) { pos.fill(0, o, o + T_N * 3); o += T_N * 3; continue; } // (a missing joint: an empty capsule)
			a.copy(A.position); b.copy(B.position);
			const r = radius ?? Math.max(0.005, Math.min(A.jointRadius ?? 0.008, B.jointRadius ?? 0.008));
			const len = a.distanceTo(b);
			q.setFromUnitVectors(UP, v.subVectors(b, a).normalize());
			const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
			for (let i = 0; i < T_N; i++) {
				const x = T_POS[i * 3], y = T_POS[i * 3 + 1], z = T_POS[i * 3 + 2];
				// The straight part stretches to the bone; the caps keep the radius.
				const yy = y > 0.5 ? len / 2 + (y - 0.5) * r : y < -0.5 ? -len / 2 + (y + 0.5) * r : y * len;
				v.set(x * r, yy, z * r).applyQuaternion(q);
				pos[o + i * 3] = v.x + mx; pos[o + i * 3 + 1] = v.y + my; pos[o + i * 3 + 2] = v.z + mz;
				v.set(T_NOR[i * 3], T_NOR[i * 3 + 1], T_NOR[i * 3 + 2]).applyQuaternion(q);
				nor[o + i * 3] = v.x; nor[o + i * 3 + 1] = v.y; nor[o + i * 3 + 2] = v.z;
			}
			o += T_N * 3;
		}
		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.normal.needsUpdate = true;
		const tip = joints['index-finger-tip'];
		if (tip?.visible) this.tip.position.copy(tip.position);
	}

	/** Leaving VR. */
	hide() { this.alpha = 0; this.group.visible = false; this.near = false; }
}
