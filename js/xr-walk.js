// Walk mode (SPEC.md, "XR 1:1 walk mode"): the home at real scale. The rig
// (camera and controllers) moves: the left stick walks where you look, the
// right stick snap-turns; pushing the right stick forward or holding a
// trigger aims a teleport arc (release to go, with a short fade). The grip only
// takes and holds tools (the grip-and-pull slide went on 26 Nov 2026). In a one-level home you
// stay on the floor and walk through furniture; with more levels you can
// stand on anything, so stairs work (js/xr-targets.js). The stick walk always
// stops at walls (furniture never does: js/walls.js); your real body is never
// stopped (the wall portal opens instead: js/portal.js). B or Y goes back.
//
// Bare hands (js/gestures.js; eager since 25 Nov): pinch and hold 0.1 s, with
// any palm but one facing your eyes, the hand in front of you: the arc grows
// from the pinch (aimed from the shoulder through it), its ring blue where you
// can land, red where you can't (build 120: no white "not yet"). Open the pinch
// on blue: go, once the arc has shown 0.3 s (a quick pinch-and-open never moves
// you), to where the ring was 0.1 s before; on red: nothing (the arc draws back). Turn the palm
// towards your eyes or drop the hand below the waist: cancel. A quick wrist flick while aiming turns 30°; the arc stays. A pinch
// near a key, the fan, the model or a tool never aims (XRExperience.aimBlock).
// The ring snaps to hotspots (room middles, doorways: js/hotspots.js), for
// controllers too.

import * as THREE from 'three';
import { TeleportArc, yawOf } from './xr-input.js';
import { WallCollider } from './walls.js';
import { UP, DOWN, worldNormal, hitSegment, firstHit } from './xr-targets.js';
import { EYE_BELOW_TOP } from './xr-scene.js';
import { handAimRay, momentBefore } from './gestures.js';
import { hotspots, snapTo, HOTSPOT } from './hotspots.js';
import { Label } from './panel.js';

const WALK_SPEED = 0.75; // m/s at full stick
const STEP = 0.6; // floor following: look this far above and below the feet
const FADE_OUT = 0.1, FADE_IN = 0.15; // teleport fade, seconds
// Highest the teleport arc may rise above your feet: under a door frame
// (doors are about 2.0-2.1 m), so you can teleport through a doorway.
const ARC_CEILING = 1.85;
// A bare hand's teleport is eager (build 120's design, B6): blue or red, never a white "not yet";
// let go on blue and you go. Against a stray pinch, a release counts only once the arc has shown
// SHOWN_FOR; against the flick of opening fingers, the landing is where the ring was LOOK_BACK
// before the release; far aims are smoothed more (AIM_SMOOTH seconds per metre away).
const SHOWN_FOR = 0.3, LOOK_BACK = 0.1, AIM_SMOOTH = 0.05;
const WAIST = 0.8; // a pinching hand this far below the eyes is at your side: it never aims, and an aim cancels (m)
const MAX_DISCS = 48; // hotspot discs shown while aiming

export class Walk {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'walk';
		this.tele = null; // teleport being aimed: { c, via: 'stick' | 'trigger', result }
		this.fade = null; // { t, action }
		this.snapReady = true;
		this.collider = new WallCollider(); // the walls the stick walk stops at
		this.arc = new TeleportArc(xr.scene);
		// Hotspots: faint discs on the floor while aiming, and the room's name over the one the ring snaps to.
		this.discs = new THREE.InstancedMesh(new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }), MAX_DISCS);
		this.discs.frustumCulled = false;
		this.discs.count = 0;
		this.discs.visible = false;
		this.discs.name = 'hotspots';
		xr.scene.add(this.discs);
		this.spotLabel = new Label({ height: 0.12 });
		xr.scene.add(this.spotLabel.mesh);
		xr.hideFromPhotos(this.arc.dots, this.arc.ring, this.discs, this.spotLabel.mesh);
	}

	/** Walk in at the Sweet Home 3D observer camera (or the model's centre). */
	walkIn() {
		const { modelPt, yaw } = this.walkInPoint();
		this.setWalkTransform();
		this.xr.setMode('walk', modelPt, yaw);
	}

	/** Where Walk in → lands: the Sweet Home 3D camera's place (model space), or the middle of the home. */
	walkInPoint() {
		const xr = this.xr;
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
		return { modelPt, yaw };
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
		this.hideAim();
		for (const c of xr.input.controllers) { xr.input.showHit(c, null); xr.input.setLaser(c, false); }
		xr.applyView();
		xr.applyStoreys();
		this.setWalkTransform();
		// The walls the stick stops at, as they stand now, at 1:1 (every storey is shown while walking).
		this.collider.setMeshes((xr.model.layers.walls?.children ?? []).filter((m) => m.visible));
		xr.lift = this.personLift();
		const target = xr.centerer.localToWorld(modelPt.clone());
		this.placeUser(target, yaw);
	}

	/**
	 * Leaving walk mode (back to the dollhouse, or the session ended): stop
	 * aiming and any teleport in progress. (A teleport fading out
	 * when you went back used to leave the view half dark over the dollhouse
	 * and jump you on the next walk.)
	 */
	exit() {
		this.tele = null;
		this.hideAim();
		this.fade = null;
		this.xr.veil.set('teleport', 0);
	}

	/** Meta's menu covered the app: an aim in progress is dropped (nothing happens on return). */
	drop() {
		this.tele = null;
		this.hideAim();
	}

	/** Hides the arc, the hotspot discs and the hotspot's name. */
	hideAim() {
		this.arc.hide();
		this.discs.visible = false;
		this.spotLabel.set('');
	}

	/** The model's hotspots (model space), worked out once per model. */
	spots() {
		const xr = this.xr, m = xr.model;
		if (!m.hotspots) m.hotspots = hotspots(m.plan, (x, y, z) => xr.modes.dollhouse.isClear(x, y, z));
		return m.hotspots;
	}

	/**
	 * Traces the teleport arc from a ray (world), with the ring snapping to
	 * hotspots near where it lands; shows the discs of the hotspots near you.
	 * Returns { valid, point, snapped }.
	 */
	aim(origin, dir, { pending = false } = {}) {
		const xr = this.xr, rig = xr.rig, t = xr.targets();
		const spots = this.spots();
		const head = xr.centerer.worldToLocal(xr.headWorld());
		let snappedTo = null;
		// A wall portal open in front of you (a fingertip's, or your eyes'): the arc and the snap's sight lines pass through the hole.
		t.holes = xr.portals?.holes() ?? null;
		t.cut = xr.portals?.cutSet ?? null;
		const walls = (xr.model.layers.walls?.children ?? []).filter((w) => w.visible), knee = new THREE.Vector3(), to = new THREE.Vector3();
		// (Never through a wall: pointing beside a door must not land you in the next room; the tester's finding.)
		const clear = (p, s) => {
			knee.copy(p); knee.y += 0.4;
			xr.centerer.localToWorld(to.set(s.x, s.y + 0.4, s.z));
			const len = knee.distanceTo(to);
			if (len < 1e-3) return true;
			xr.raycaster.set(knee, to.sub(knee).divideScalar(len));
			xr.raycaster.far = len;
			return !firstHit(xr.raycaster.intersectObjects(walls, false), t);
		};
		const snap = (p) => {
			const m = xr.centerer.worldToLocal(p.clone());
			snappedTo = snapTo(spots, m, head, (s) => clear(p, s));
			return snappedTo ? xr.centerer.localToWorld(new THREE.Vector3(snappedTo.x, snappedTo.y, snappedTo.z)) : null;
		};
		// The arc stays low enough to pass through doorways (ARC_CEILING above your feet).
		const ceiling = rig.position.y - xr.lift + ARC_CEILING;
		const r = this.arc.update(origin, dir, (a, b) => this.hitSegment(a, b, t), { ceiling, snap, pending });
		// The discs: hotspots within SHOW metres, on any floor near yours.
		const feet = rig.position.y - xr.lift, m = new THREE.Matrix4(), p = new THREE.Vector3(), eye = xr.headWorld();
		let n = 0;
		for (const s of spots) {
			if (n >= MAX_DISCS) break;
			xr.centerer.localToWorld(p.set(s.x, s.y, s.z));
			if (Math.hypot(p.x - eye.x, p.z - eye.z) > HOTSPOT.SHOW) continue;
			if (Math.abs(p.y - feet) > 3) continue;
			this.discs.setMatrixAt(n++, m.makeTranslation(p.x, p.y + 0.012, p.z));
		}
		this.discs.count = n;
		this.discs.instanceMatrix.needsUpdate = true;
		this.discs.visible = n > 0;
		// The room's name over the hotspot the ring snapped to.
		this.spotLabel.set(snappedTo?.name || '');
		if (snappedTo?.name && r.point) {
			this.spotLabel.mesh.position.copy(r.point).y += 1.2;
			this.spotLabel.mesh.lookAt(xr.headWorld());
		}
		if (snappedTo && (!this.lastSnap || this.lastSnap !== snappedTo)) xr.sound.play('tick');
		this.lastSnap = snappedTo;
		return r;
	}

	/** Teleports to a world floor point, with the short fade (and the step sound). */
	go(target) {
		this.xr.sound.play('step');
		this.xr.pause?.note('teleport'); // (the teleport tip is learnt; the first-target ring goes: js/pause.js)
		this.fade = { t: 0, action: () => this.placeUser(target, null) };
	}

	/**
	 * Bare hands: pinch and hold: aim; open the pinch on a blue ring: go; palm
	 * towards your eyes, the hand dropped or lost: cancel; a wrist flick while
	 * aiming: turn (see the top of the file).
	 */
	handMoves(dt) {
		const xr = this.xr, input = xr.input;
		const cancel = () => { this.tele = null; this.hideAim(); xr.sound.play('release'); };
		for (const c of input.gestureHands()) {
			const mine = this.tele?.c === c;
			for (const e of c.gestures) {
				// (Either empty hand aims; while one aims, the other's pinch does nothing: the first one wins.)
				if (e.type === 'pinch' && !this.tele && !this.fade && xr.emptyHand(c) && !xr.aimBlock(c, c.gesture.shape?.pinchAt) && c.gesture.shape.pinchAt.y >= xr.headWorld().y - WAIST) { // (a hand at your side never aims)
					this.tele = { c, via: 'hand', age: 0, dir: null, past: [] };
					xr.sound.play('aim');
				} else if (!mine) {
					continue;
				} else if (e.type === 'pinchEnd') {
					const r = this.landingBefore(this.tele, LOOK_BACK);
					if (r?.valid && this.tele.age >= SHOWN_FOR) {
						this.tele = null;
						this.hideAim();
						this.go(r.point);
						this.teleports = (this.teleports ?? 0) + 1;
						xr.ui.onTeleport?.(this.teleports);
					} else cancel(); // (let go on red, or a quick pinch-and-open: a slip never moves you)
				} else if (e.type === 'open' || e.type === 'lost') {
					cancel();
				} else if (e.type === 'turn') {
					xr.turn(-e.dir * THREE.MathUtils.degToRad(xr.snapAngle));
					xr.sound.play('tick');
				}
			}
		}
		const tele = this.tele;
		if (tele?.via !== 'hand') return;
		const at = tele.c.gesture.shape?.pinchAt;
		if (xr.boardOpen || xr.ui.wrist.open || !tele.c.touch.tracked || !at) { this.tele = null; this.hideAim(); return; }
		if (at.y < xr.headWorld().y - WAIST) { cancel(); return; } // (the hand dropped below the waist)
		const { origin, dir } = handAimRay(xr.headWorld(), xr.viewAxes().right, at, tele.c.handedness);
		// Smoothed more the further it lands (0.05 s a metre: about 0.15 s at 3 m, 0.3 s at 6 m).
		const far = tele.result?.point ? Math.hypot(tele.result.point.x - origin.x, tele.result.point.z - origin.z) : 0;
		if (!tele.dir) tele.dir = dir.clone();
		else tele.dir.lerp(dir, 1 - Math.exp(-dt / Math.max(1e-3, AIM_SMOOTH * far))).normalize();
		const r = this.aim(origin, tele.dir);
		tele.age += dt;
		tele.result = r;
		// The last moments' landings (the release uses the one LOOK_BACK ago).
		// (Entries reused from those dropped: nothing allocated per frame on the Quest 2.)
		const e = this.spare?.pop() ?? { age: 0, valid: false, point: new THREE.Vector3(), has: false };
		e.age = tele.age; e.valid = r.valid; e.has = !!r.point;
		if (r.point) e.point.copy(r.point);
		tele.past.push(e);
		while (tele.past.length > 2 && tele.age - tele.past[1].age > LOOK_BACK) (this.spare ??= []).push(tele.past.shift());
	}

	/** The landing a hand's aim showed `back` seconds ago (or its oldest kept), else now's. */
	landingBefore(tele, back) {
		const best = momentBefore(tele.past, tele.age, back);
		if (!best) return tele.result ?? null;
		return { valid: best.valid, point: best.has === false ? null : best.point };
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
		xr.body = null; // (a teleport turns the body at once: js/zones.js)
		const headLocal = new THREE.Vector3().setFromMatrixPosition(xr.camera.matrix);
		const headYawLocal = yawOf(xr.camera.matrix);
		const heading = yaw ?? (rig.rotation.y + headYawLocal);
		rig.rotation.set(0, heading - headYawLocal, 0);
		const off = new THREE.Vector3(headLocal.x, 0, headLocal.z).applyAxisAngle(UP, rig.rotation.y);
		rig.position.set(target.x - off.x, target.y + xr.lift, target.z - off.z);
		rig.updateMatrixWorld(true);
	}

	/**
	 * The stick walk stops at walls (always, since 26 Nov 2026: the Solid
	 * walls setting went): the stick's move from `from` (the head before it)
	 * slides along walls instead of entering them; the rig is shifted back by
	 * the difference. Only the stick's move: walking for real in the room is
	 * never stopped, and a body already in a wall (leaning through a portal)
	 * is never pushed out, only kept from going further in.
	 * Only walls: furniture, doors and windows stay walk-through.
	 */
	stickStopsAtWalls(from) {
		const xr = this.xr;
		if (!this.collider.active) return;
		xr.rig.updateMatrixWorld(true);
		const now = xr.headWorld(), feet = xr.rig.position.y - xr.lift;
		const rest = this.collider.move(from, from, feet, now.y); // (where the walls would push the body as it stands: not done)
		const to = this.collider.move(from, now, feet, now.y);
		const x = from.x + to.x - rest.x, z = from.z + to.z - rest.z;
		if (x !== now.x || z !== now.z) {
			xr.rig.position.x += x - now.x;
			xr.rig.position.z += z - now.z;
			xr.rig.updateMatrixWorld(true);
		}
	}

	/** First solid hit between two world points (`t`: XRExperience.targets()); valid only on walkable floors. */
	hitSegment(a, b, t) { return hitSegment(this.xr.raycaster, a, b, t); }

	/**
	 * Floor following: cast down from STEP above the feet; adopt a walkable
	 * surface (see js/xr-targets.js) within ±STEP, which handles stairs and
	 * levels. (Walls stop only the stick's move: stickStopsAtWalls().)
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
		let opacity;
		if (f.t < FADE_OUT) {
			opacity = f.t / FADE_OUT;
		} else {
			if (f.action) { f.action(); f.action = null; }
			opacity = Math.max(0, 1 - (f.t - FADE_OUT) / FADE_IN);
			if (f.t >= FADE_OUT + FADE_IN) { this.fade = null; opacity = 0; }
		}
		this.xr.veil.set('teleport', opacity); // (the one sphere round the eyes, js/veil.js)
	}

	update(dt) {
		const xr = this.xr, ui = xr.ui, input = xr.input, rig = xr.rig;
		this.runFade(dt);
		for (const c of input.active()) {
			// B / Y with nothing open: ← Back, one layer up (to the scale model).
			if (c.state.down.b && c.claim.b === null && !ui.anyOpen) { xr.goLayer('back', () => xr.setMode('dollhouse')); return; }
		}
		if (ui.buttons()) { this.tele = null; this.hideAim(); }
		const { action } = ui.point();
		if (action) {
			xr.menuAction(action);
			if (xr.mode !== 'walk' || !xr.session) return;
		}
		// Lasers only show while a menu is open or one points at the orb (never
		// on a hand holding a tool).
		for (const c of input.active()) {
			const show = c.claim.trigger === 'ui' || ((xr.boardOpen || ui.wrist.open) && c.claim.trigger !== 'tool');
			input.setLaser(c, show);
			if (!show) input.showHit(c, null);
		}

		const left = input.hands.left, right = input.hands.right;
		this.handMoves(dt);

		// Teleport: push the right stick forward, or hold a trigger, and aim;
		// release to go.
		if (!this.tele && !xr.boardOpen && !this.fade) {
			const rs = right?.state.stick;
			if (rs && rs.y < -0.6 && Math.abs(rs.y) > Math.abs(rs.x)) this.tele = { c: right, via: 'stick' };
			else {
				const c = input.active().find((c) => c.state.down.trigger && c.claim.trigger === null);
				if (c) this.tele = { c, via: 'trigger' };
			}
		}
		if (this.tele && this.tele.via !== 'hand') {
			const { c, via } = this.tele;
			if (!c.source || (via === 'stick' ? c.state.stick.length() < 0.3 : !c.state.trigger)) {
				const r = this.tele.result;
				this.tele = null;
				this.hideAim();
				if (r?.valid) {
					this.go(r.point);
					this.teleports = (this.teleports ?? 0) + 1;
					xr.ui.onTeleport?.(this.teleports);
				}
			} else {
				c.ray.updateMatrixWorld(true);
				const origin = new THREE.Vector3().setFromMatrixPosition(c.ray.matrixWorld);
				const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.ray.matrixWorld);
				this.tele.result = this.aim(origin, dir);
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
			const from = xr.headWorld();
			rig.position.addScaledVector(move, WALK_SPEED * dt);
			this.stickStopsAtWalls(from);
		}

		if (!this.fade) this.followFloor(dt);
	}
}
