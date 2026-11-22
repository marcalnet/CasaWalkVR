// Walls in the headset (SPEC.md, "XR 1:1 walk mode"): no DOM, Node-testable.
//
// WallCollider  "Solid walls": keeps the walker's body out of the walls.
//               Only walls are solid (the user's choice): furniture, doors
//               and windows stay walk-through, so doorways and stairs work.
//               The body is a column of spheres from just above the feet up
//               to the eyes; each one is pushed out of the nearest wall
//               (closest point on the wall's BVH), sideways only, so you
//               slide along walls. Moves are taken in short steps, so a fast
//               pull can never carry the body through a thin wall.
//
// SeeThrough    "See-through": fades walls and furniture towards glass.
//               Floors, ceilings and the ground stay as they are. The
//               original opacity of every material is kept, so 0 restores
//               the model exactly.

import * as THREE from 'three';

const RADIUS = 0.2; // body radius, metres: a doorway needs 0.4 m clear
const LOW = 0.4; // lowest sphere, above the feet: steps and thresholds don't block
const SPACING = 0.3; // between the spheres, up to the eyes
const STEP = RADIUS / 2; // longest move resolved at once
const ITERATIONS = 3; // pushes per step (corners need two)
export const SEE_THROUGH_MAX = 0.85; // at the end of the slider, walls keep 15% of their opacity

export class WallCollider {
	constructor({ radius = RADIUS } = {}) {
		this.radius = radius;
		this.walls = []; // [{ mesh, inverse, box }]
		this._p = new THREE.Vector3();
		this._q = new THREE.Vector3();
		this._hit = {};
	}

	/**
	 * The wall meshes to collide with (merged, each with a BVH). Their world
	 * transform is read now: call again after the model moves.
	 */
	setMeshes(meshes) {
		this.walls = [];
		for (const mesh of meshes) {
			if (!mesh.geometry?.boundsTree) continue;
			mesh.updateWorldMatrix(true, false);
			if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
			const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(this.radius);
			this.walls.push({ mesh, inverse: mesh.matrixWorld.clone().invert(), box });
		}
	}

	get active() { return this.walls.length > 0; }

	/**
	 * Moves a body standing at `from` towards `to` (world; only x and z are
	 * used) without entering a wall. feetY and eyeY: world heights of the feet
	 * and the eyes. Returns the position reached (a new Vector3, y from `to`).
	 */
	move(from, to, feetY, eyeY) {
		const pos = new THREE.Vector3(from.x, to.y, from.z);
		const dx = to.x - from.x, dz = to.z - from.z;
		const steps = Math.min(40, Math.max(1, Math.ceil(Math.hypot(dx, dz) / STEP)));
		const heights = this.heights(feetY, eyeY);
		for (let i = 0; i < steps; i++) {
			pos.x += dx / steps;
			pos.z += dz / steps;
			this.resolve(pos, heights);
		}
		return pos;
	}

	/** Sphere heights: from LOW above the feet up to the eyes, about SPACING apart. */
	heights(feetY, eyeY) {
		const lo = feetY + LOW, hi = Math.max(lo, eyeY);
		const n = Math.max(1, Math.ceil((hi - lo) / SPACING));
		return Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
	}

	/** Pushes `pos` (x, z) out of every wall within the radius, at every height. */
	resolve(pos, heights) {
		const r = this.radius, p = this._p, q = this._q;
		for (let it = 0; it < ITERATIONS; it++) {
			let pushed = false;
			for (const y of heights) {
				for (const w of this.walls) {
					p.set(pos.x, y, pos.z);
					if (!w.box.containsPoint(p)) continue;
					p.applyMatrix4(w.inverse);
					// (The model is at 1:1 while walking, so local distances are metres.)
					const hit = w.mesh.geometry.boundsTree?.closestPointToPoint(p, this._hit, 0, r);
					if (!hit) continue;
					q.copy(hit.point).applyMatrix4(w.mesh.matrixWorld);
					const ox = pos.x - q.x, oz = pos.z - q.z;
					const d = Math.hypot(ox, oz);
					// A wall straight above or below (a lintel, the top of a low
					// wall) has no sideways direction: it does not push.
					if (d >= r || d < 1e-4) continue;
					const k = (r - d) / d;
					pos.x += ox * k;
					pos.z += oz * k;
					pushed = true;
				}
			}
			if (!pushed) break;
		}
	}
}

export class SeeThrough {
	constructor() {
		this.amount = 0; // 0 = as modelled, 1 = SEE_THROUGH_MAX
		this.meshes = [];
	}

	/**
	 * A new model: the walls and furniture to fade. A material that is also
	 * used by a floor, ceiling or the ground is copied first, so only walls
	 * and furniture fade.
	 */
	setModel(layers) {
		this.restore();
		const walls = (layers.walls?.children ?? []).filter((m) => m.isMesh);
		const main = (layers.main?.children ?? []).filter((m) => m.isMesh);
		const fade = [...walls, ...main];
		const floorMats = new Set(), mainMats = new Set();
		for (const name of ['floors', 'ceilings', 'ground']) {
			for (const m of layers[name]?.children ?? []) for (const mat of [].concat(m.material)) floorMats.add(mat);
		}
		for (const m of main) for (const mat of [].concat(m.material)) mainMats.add(mat);
		/** A copy of `mat` for one kind of mesh when it is shared with another (one copy per kind and material). */
		const owner = (shared) => {
			const copies = new Map();
			return (mat) => {
				if (!shared(mat)) return mat;
				if (!copies.has(mat)) {
					const c = mat.clone();
					// Keep the depth shading hook (js/depth.js) on the copy.
					c.onBeforeCompile = mat.onBeforeCompile;
					c.customProgramCacheKey = mat.customProgramCacheKey;
					copies.set(mat, c);
				}
				return copies.get(mat);
			};
		};
		// Only walls and furniture fade, and they fade differently (below): a wall
		// material shared with a floor or with furniture gets its own copy, and a
		// furniture material shared with a floor gets one.
		const wallOwn = owner((mat) => floorMats.has(mat) || mainMats.has(mat)), mainOwn = owner((mat) => floorMats.has(mat));
		for (const m of walls) m.material = Array.isArray(m.material) ? m.material.map(wallOwn) : wallOwn(m.material);
		for (const m of main) m.material = Array.isArray(m.material) ? m.material.map(mainOwn) : mainOwn(m.material);
		for (const m of fade) {
			for (const mat of [].concat(m.material)) {
				mat.userData.cwBase ??= { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite };
			}
		}
		this.meshes = fade;
		// The walls are one pane of glass: while faded, an invisible depth pass
		// (renderOrder 2) keeps only the nearest wall surface, then the walls'
		// colour (renderOrder 3, no depth writing) blends over the furniture
		// (renderOrder 1, keeping its own depth) and the floors behind. Without
		// it, faded surfaces that write no depth are drawn in whatever order the
		// merged meshes sort in, and a far wall or a sofa paints over the near
		// wall even at 5% (the user's Quest 2 finding; the tester's diagnosis).
		this.walls = new Set(walls);
		this.depthMat ??= new THREE.MeshBasicMaterial({
			colorWrite: false, depthWrite: true, transparent: true, // transparent: in the transparent list, ordered by renderOrder
			polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // a hair behind, so the wall's own colour passes LessEqual
		});
		for (const d of this.depthMeshes ?? []) d.removeFromParent();
		this.depthMeshes = walls.map((m) => {
			const d = new THREE.Mesh(m.geometry, this.depthMat); // a child sharing the geometry: storey hiding and transforms follow
			d.name = 'see-through-depth';
			d.renderOrder = 2;
			d.visible = false;
			d.raycast = () => {}; // never a target, a wall to the collider, or a floor
			m.add(d);
			return d;
		});
		for (const m of fade) m.renderOrder = this.walls.has(m) ? 3 : 1;
		this.apply();
	}

	/** amount: 0..1 of the slider. */
	set(amount) {
		this.amount = THREE.MathUtils.clamp(amount, 0, 1);
		this.apply();
	}

	apply(amount = this.amount) {
		const keep = 1 - SEE_THROUGH_MAX * amount;
		const faded = amount > 0;
		for (const m of this.meshes) {
			for (const mat of [].concat(m.material)) {
				const b = mat.userData.cwBase;
				if (!b) continue;
				mat.opacity = b.opacity * keep;
				const transparent = b.transparent || faded;
				if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
				// Faded walls write no depth (their depth pass did); furniture keeps its own.
				mat.depthWrite = faded && this.walls?.has(m) ? false : b.depthWrite;
			}
		}
		for (const d of this.depthMeshes ?? []) d.visible = faded;
	}

	/** Back to the model's own look (used when leaving the headset). */
	restore() { if (this.meshes.length) this.apply(0); }
}
