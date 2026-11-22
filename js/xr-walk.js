// Walk mode (SPEC.md, "XR 1:1 walk mode"): the home at real scale. The rig
// (camera and controllers) moves: the left stick walks where you look, the
// right stick snap-turns; pushing the right stick forward or holding a
// trigger aims a teleport arc (release to go, with a short fade); a held grip
// grabs the space so you can pull yourself along. In a one-level home you
// stay on the floor and walk through furniture; with more levels you can
// stand on anything, so stairs work (js/xr-targets.js). With Solid walls on,
// walls stop you (furniture never does: js/walls.js). B or Y goes back.

import * as THREE from 'three';
import { TeleportArc, yawOf } from './xr-input.js';
import { WallCollider } from './walls.js';
import { UP, DOWN, worldNormal, hitSegment } from './xr-targets.js';
import { EYE_BELOW_TOP, buildFade } from './xr-scene.js';

const WALK_SPEED = 0.75; // m/s at full stick
const STEP = 0.6; // floor following: look this far above and below the feet
const FADE_OUT = 0.1, FADE_IN = 0.15; // teleport fade, seconds
// Highest the teleport arc may rise above your feet: under a door frame
// (doors are about 2.0-2.1 m), so you can teleport through a doorway.
const ARC_CEILING = 1.85;

export class Walk {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'walk';
		this.tele = null; // teleport being aimed: { c, via: 'stick' | 'trigger', result }
		this.fade = null; // { t, action }
		this.snapReady = true;
		this.collider = new WallCollider(); // Solid walls
		this.body = null; // where the body was last frame (null: just placed)
		this.fadeMesh = buildFade(xr.camera);
		this.arc = new TeleportArc(xr.scene);
		xr.hideFromPhotos(this.fadeMesh, this.arc.dots, this.arc.ring);
	}

	/** Walk in at the Sweet Home 3D observer camera (or the model's centre). */
	walkIn() {
		const xr = this.xr;
		this.setWalkTransform();
		const obs = xr.model.observer;
		let modelPt, yaw = null;
		if (obs) {
			// Plan cm -> model metres: (x, elevation, y)
			const eye = xr.centerer.localToWorld(new THREE.Vector3(obs.x / 100, obs.z / 100, obs.y / 100));
			const floor = xr.findFloor(eye, 0) || eye.clone().setY(xr.centerer.localToWorld(new THREE.Vector3()).y);
			modelPt = xr.centerer.worldToLocal(floor.clone());
			yaw = Math.PI - obs.yaw; // Sweet Home 3D yaw -> three.js heading
		} else {
			const c = xr.model.bounds.getCenter(new THREE.Vector3());
			const eye = xr.centerer.localToWorld(c.setY(xr.model.bounds.max.y));
			const floor = xr.findFloor(eye, 0.01) || eye.setY(0);
			modelPt = xr.centerer.worldToLocal(floor.clone());
		}
		xr.setMode('walk', modelPt, yaw);
	}

	setWalkTransform() {
		const xr = this.xr;
		xr.anchor.position.set(0, 0, 0);
		xr.anchor.rotation.set(0, 0, 0);
		xr.anchor.scale.setScalar(1);
		xr.anchor.updateMatrixWorld(true);
		xr.lighting?.fit();
	}

	/** Enters 1:1 standing at a model-space floor point, optionally facing `yaw`. */
	enter(modelPt, yaw) {
		const xr = this.xr;
		this.tele = null;
		for (const c of xr.input.controllers) { xr.input.showHit(c, null); xr.input.setLaser(c, false); c.pull = null; }
		xr.applyView();
		xr.applyStoreys();
		this.setWalkTransform();
		// Solid walls: the walls as they stand now, at 1:1 (every storey is shown while walking).
		this.collider.setMeshes((xr.model.layers.walls?.children ?? []).filter((m) => m.visible));
		xr.lift = this.personLift();
		const target = xr.centerer.localToWorld(modelPt.clone());
		this.placeUser(target, yaw);
	}

	/**
	 * Leaving walk mode (back to the dollhouse, or the session ended): stop
	 * aiming, pulling and any teleport in progress. (A teleport fading out
	 * when you went back used to leave the view half dark over the dollhouse
	 * and jump you on the next walk.)
	 */
	exit() {
		this.tele = null;
		this.arc.hide();
		this.fade = null;
		this.fadeMesh.material.opacity = 0;
		this.fadeMesh.visible = false;
		for (const c of this.xr.input.controllers) c.pull = null;
	}

	/** Lift that puts the eyes at the chosen person height (0 = your own). */
	personLift() {
		const xr = this.xr;
		if (!xr.personHeight) return 0;
		const eye = new THREE.Vector3().setFromMatrixPosition(xr.camera.matrix).y;
		return eye > 0.3 ? xr.personHeight - EYE_BELOW_TOP - eye : 0;
	}

	/**
	 * Moves the rig so the user's head is above `target` (feet at its height,
	 * plus the person-height lift), facing `yaw` if given, otherwise keeping
	 * their current heading.
	 */
	placeUser(target, yaw) {
		const xr = this.xr, rig = xr.rig;
		const headLocal = new THREE.Vector3().setFromMatrixPosition(xr.camera.matrix);
		const headYawLocal = yawOf(xr.camera.matrix);
		const heading = yaw ?? (rig.rotation.y + headYawLocal);
		rig.rotation.set(0, heading - headYawLocal, 0);
		const off = new THREE.Vector3(headLocal.x, 0, headLocal.z).applyAxisAngle(UP, rig.rotation.y);
		rig.position.set(target.x - off.x, target.y + xr.lift, target.z - off.z);
		rig.updateMatrixWorld(true);
		this.body = null; // (solid walls: only pushed out from here, never swept from the old spot)
	}

	/**
	 * Solid walls: whatever moved the head this frame (the stick, a grip
	 * pull, or walking for real in the room), the body slides along walls
	 * instead of entering them; the rig is shifted back by the difference.
	 * Only walls: furniture, doors and windows stay walk-through.
	 */
	keepOutOfWalls() {
		const xr = this.xr;
		const now = xr.headWorld();
		if (!xr.solid || !this.collider.active) { this.body = now; return; }
		const feet = xr.rig.position.y - xr.lift;
		const to = this.collider.move(this.body ?? now, now, feet, now.y);
		if (to.x !== now.x || to.z !== now.z) {
			xr.rig.position.x += to.x - now.x;
			xr.rig.position.z += to.z - now.z;
			xr.rig.updateMatrixWorld(true);
		}
		this.body = to;
	}

	/** First solid hit between two world points (`t`: XRExperience.targets()); valid only on walkable floors. */
	hitSegment(a, b, t) { return hitSegment(this.xr.raycaster, a, b, t); }

	/**
	 * Floor following: cast down from STEP above the feet; adopt a walkable
	 * surface (see js/xr-targets.js) within ±STEP, which handles stairs and
	 * levels. (Walls block movement only with Solid walls on: keepOutOfWalls().)
	 */
	followFloor(dt) {
		const xr = this.xr;
		const head = xr.headWorld();
		const feet = xr.rig.position.y - xr.lift;
		xr.floorRay.set(new THREE.Vector3(head.x, feet + STEP, head.z), DOWN);
		xr.floorRay.far = 2 * STEP;
		const hits = xr.floorRay.intersectObjects(xr.targets().walkableList, false);
		const h = hits.find((x) => worldNormal(x).y > 0.7);
		if (!h) return;
		const k = Math.min(1, dt * 12); // a quick ease, so steps don't jolt
		xr.rig.position.y += (h.point.y - feet) * k;
		xr.rig.updateMatrixWorld(true);
	}

	/** Advances the teleport fade; the move happens while the view is black. */
	runFade(dt) {
		const f = this.fade;
		if (!f) return;
		f.t += dt;
		const m = this.fadeMesh.material;
		if (f.t < FADE_OUT) {
			m.opacity = f.t / FADE_OUT;
		} else {
			if (f.action) { f.action(); f.action = null; }
			m.opacity = Math.max(0, 1 - (f.t - FADE_OUT) / FADE_IN);
			if (f.t >= FADE_OUT + FADE_IN) { this.fade = null; m.opacity = 0; }
		}
		this.fadeMesh.visible = m.opacity > 0;
	}

	update(dt) {
		const xr = this.xr, ui = xr.ui, input = xr.input, rig = xr.rig;
		this.runFade(dt);
		for (const c of input.active()) {
			// B / Y with nothing open: ← Back, one layer up (to the scale model).
			if (c.state.down.b && c.claim.b === null && !ui.anyOpen) { xr.goLayer('back', () => xr.setMode('dollhouse')); return; }
		}
		if (ui.buttons()) { this.tele = null; this.arc.hide(); }
		const { action } = ui.point();
		if (action) {
			xr.menuAction(action);
			if (xr.mode !== 'walk' || !xr.session) return;
		}
		// Lasers only show while a menu is open or one points at the orb (never
		// on a hand holding a tool).
		for (const c of input.active()) {
			const show = c.claim.trigger === 'ui' || ((!!xr.menu || ui.wrist.open) && c.claim.trigger !== 'tool');
			input.setLaser(c, show);
			if (!show) input.showHit(c, null);
		}

		const left = input.hands.left, right = input.hands.right;
		const t = xr.targets();

		// Teleport: push the right stick forward, or hold a trigger, and aim;
		// release to go.
		if (!this.tele && !xr.menu && !this.fade) {
			const rs = right?.state.stick;
			if (rs && rs.y < -0.6 && Math.abs(rs.y) > Math.abs(rs.x)) this.tele = { c: right, via: 'stick' };
			else {
				const c = input.active().find((c) => c.state.down.trigger && c.claim.trigger === null);
				if (c) this.tele = { c, via: 'trigger' };
			}
		}
		if (this.tele) {
			const { c, via } = this.tele;
			if (!c.source || (via === 'stick' ? c.state.stick.length() < 0.3 : !c.state.trigger)) {
				const r = this.tele.result;
				this.tele = null;
				this.arc.hide();
				if (r?.valid) {
					const target = r.point;
					this.fade = { t: 0, action: () => this.placeUser(target, null) };
				}
			} else {
				c.ray.updateMatrixWorld(true);
				const origin = new THREE.Vector3().setFromMatrixPosition(c.ray.matrixWorld);
				const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.ray.matrixWorld);
				// The arc stays low enough to pass through doorways (ARC_CEILING above your feet).
				const ceiling = rig.position.y - xr.lift + ARC_CEILING;
				this.tele.result = this.arc.update(origin, dir, (a, b) => this.hitSegment(a, b, t), { ceiling });
			}
		}

		// Right stick left/right: snap turn (re-arms when the stick centres).
		if (right && !(this.tele?.c === right && this.tele.via === 'stick')) {
			const x = right.state.stick.x;
			if (this.snapReady && Math.abs(x) > 0.7 && Math.abs(x) > Math.abs(right.state.stick.y)) {
				xr.turn(-Math.sign(x) * THREE.MathUtils.degToRad(xr.snapAngle));
				this.snapReady = false;
			} else if (Math.abs(x) < 0.3) {
				this.snapReady = true;
			}
		}

		// Grips: grab the space and pull yourself along (horizontally; the
		// floor following keeps you on the floor).
		const pull = new THREE.Vector3();
		let pulling = 0;
		for (const c of input.active()) {
			if (c.state.down.grip && c.claim.grip === null && !xr.menu) c.pull = c.grip.position.clone();
			if (!c.state.grip) c.pull = null;
			if (c.pull) {
				pull.add(c.pull.clone().sub(c.grip.position));
				c.pull.copy(c.grip.position);
				pulling++;
			}
		}
		if (pulling && !this.fade) {
			pull.divideScalar(pulling).setY(0).applyAxisAngle(UP, rig.rotation.y);
			rig.position.add(pull);
		}

		// Left stick: smooth locomotion relative to where the head looks.
		const ls = left?.state.stick;
		if (ls && (ls.x || ls.y) && !this.fade) {
			rig.updateMatrixWorld(true);
			const m = xr.camera.matrix.clone().premultiply(rig.matrixWorld);
			const yaw = yawOf(m);
			const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
			const rightDir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
			const move = fwd.multiplyScalar(-ls.y).addScaledVector(rightDir, ls.x);
			if (move.lengthSq() > 1) move.normalize();
			rig.position.addScaledVector(move, WALK_SPEED * dt);
		}

		if (!this.fade) {
			this.keepOutOfWalls();
			this.followFloor(dt);
		}
	}
}
