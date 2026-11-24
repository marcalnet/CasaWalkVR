// Dollhouse mode (SPEC.md, "XR dollhouse mode"): the home on a plinth in a
// gallery room (VR view) or floating over passthrough (AR view), about
// 1.2 m across. Thumbstick left/right rotates it, up/down zooms; a grip held
// while moving the controller moves it (upright, never into the plinth); the
// laser shows a person-height marker where you will land, and the trigger
// steps inside, at 1:1, there: pointing at a room, the marker hops to the
// room's clear middle with its name above it, and you land facing along the
// room; pointing outside, you land where you point, clear of the walls,
// facing the house (js/rooms.js). You look down at it as a 2 m tall person
// would, whatever your own height (the head's real height is measured on
// entry, on Recentre and when coming back from walking).
// (On screen this will be called the "scale model", milestone B; the code
// keeps the word dollhouse.)
//
// Holding the model (C0.4, both inputs): a grip held anywhere, or a bare hand
// closed on it (within 8 cm of its box). It stays level (the user's decision,
// 24 Nov): it moves with the hand and turns only about the vertical; a bare
// hand moves it by the palm's centre, ignores turns under 3° and is smoothed
// more. Let go near the plinth (its base within 15 cm of the top, over it):
// it settles. Let go anywhere else: it floats where it is, level, with a line
// down to the floor; once hands
// and controllers are 30 cm away for 4 s (a ring on the plinth fills), it
// glides home and settles. Bare hands step inside with the teleport gesture
// (js/gestures.js): palm down, pinch and hold, point at a room (a straight
// ray from the shoulder through the pinch, the marker hops to the room), and
// open the pinch once the marker has held still 0.3 s. Palm up, or the hand
// dropped: cancel. A pinch within 15 cm of the model or a key never aims.

import * as THREE from 'three';
import { UP, DOWN } from './xr-targets.js';
import { yawOf } from './xr-input.js';
import { PLINTH_REST, PLINTH_HEIGHT, EYE_BELOW_TOP, buildMarkers } from './xr-scene.js';
import { KeyPad } from './keys.js';
import { DELIBERATE } from './touch.js';
import { roomAt, roomLanding, alongAxis, clearOfWalls, headingOf } from './rooms.js';
import { Label } from './panel.js';
import { ease } from './tween.js';
import { handAimRay } from './gestures.js';
import { HAND } from './theme.js';

const DOLLHOUSE_PERSON = 2.0; // metres
const DOLLHOUSE_LIFT_START = 0.25; // used for the first frames, before the head height is known
const DOLLHOUSE_LIFT_MAX = 1.4; // (lying on the floor is not a case to support)
const ZOOM_MIN = 0.5, ZOOM_MAX = 4;
const ABOVE_REAL_FLOOR = 0.05; // passthrough: the model never sinks below the real floor
// Standard architectural scales: after zooming, a scale this close to one of
// them (as a fraction) settles on it. (1:5 and 1:10 are detail scales; a
// home on the plinth is usually between 1:5 and 1:30.)
export const STANDARD_SCALES = [5, 10, 20, 25, 50, 100, 200];
const SETTLE_NEAR = 0.08;

/** The standard scale (the 50 of 1:50) near a ratio, or null. */
export function nearestScale(ratio) {
	return STANDARD_SCALES.find((s) => Math.abs(ratio - s) / s <= SETTLE_NEAR) ?? null;
}
const ROTATE_SPEED = 1.6; // rad/s at full stick
const HOLD_REACH = 0.08; // a closed hand within this of the model's box holds it
const DROP_NEAR = 0.15; // let go this close to the plinth top (over it): it settles
const RETURN_AWAY = 0.3, RETURN_WAIT = 4; // a floating model goes home once nothing is within 0.3 m for 4 s
const GRAB_SMOOTH = 0.06, GRAB_SMOOTH_HAND = 0.1; // seconds: a held model follows a controller / a bare hand smoothed this much
const HAND_TURN_DEAD = THREE.MathUtils.degToRad(3); // a bare hand's turn: changes under 3° are tremor, ignored
const MAX_FRAME_TURN = THREE.MathUtils.degToRad(20); // a held model turns at most this much in one frame
const AIM_STEADY = 0.3; // a bare hand steps inside (opening the pinch) once its landing has held still this long
const WAIST = 0.8; // a pinching hand this far below the eyes is dropped: the aim cancels (m)
const ZOOM_SPEED = 1.2; // e-folds/s at full stick
// The doors at the scale model, metres (the user's Quest 2 tests): Walk in →
// is the big one, ← Back about a third as long, the same height, on its left.
// They float at waist height in front of you (on the plinth's edge you had to
// crouch to touch them with bare hands), close enough to touch, and low enough
// to stay under the line from the eyes to the model (65° below the horizon at
// their middle; the model's near edge is about 58° down from where you stand).
const DOOR_IN = [0.32, 0.09], DOOR_BACK = [0.1, 0.09];
const DOOR_BELOW_EYES = 0.65; // waist height (the user's word), standing or seated (the lift keeps the eyes at the same height)
const DOOR_AHEAD = 0.3; // in front of where you stand
// Nearly upright (70° from flat, facing you): a push from the front is a push forward;
// a hand lowered onto it from above is far off its normal and never presses it.
const DOOR_TILT = 70;
const BACK_HOLD = 0.6; // ← Back (leave VR) is held this long, a ring filling (the Lead's decision)
const DOOR_FOLLOW = 0.08; // the doors move to a new head height once it differs by this much
const MARKER_HEIGHT = 1.7; // metres at the model's scale (the "stand here" figure)
// A landing spot must be free of furniture from this height above the floor
// (rugs and thresholds don't count) up to head height, around a body's width.
const CLEAR_FROM = 0.3, CLEAR_TO = 2.0;
const CLEAR_RING = [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]];

/**
 * Where a head faces, as a heading about the vertical, even looking straight
 * down or up: the forward direction flattened onto the floor, plus the head's
 * up direction flattened (looking down, the top of the head points forward;
 * looking up, backward). Like yawOf() otherwise.
 */
export function headHeading(m) {
	const e = m.elements;
	const f = new THREE.Vector3(-e[8], -e[9], -e[10]).normalize(), u = new THREE.Vector3(e[4], e[5], e[6]).normalize();
	const x = f.x - Math.sign(f.y) * u.x, z = f.z - Math.sign(f.y) * u.z;
	return Math.atan2(-x, -z);
}

export class Dollhouse {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'dollhouse';
		// The model on the plinth, in stage space: position, turn and zoom.
		// (Always level: only a turn about the vertical. The full free tilt of C0.4 went on 24 Nov 2026.)
		this.doll = { pos: new THREE.Vector3(0, PLINTH_REST, -xr.plinthDistance), yaw: 0, zoom: 1 };
		this.floating = null; // let go in the air: { wait (s with nothing near), going (the glide home) }
		this.handAim = null; // a bare hand stepping inside: { c, spot }
		this.dollLift = DOLLHOUSE_LIFT_START; // VR dollhouse lift, from the measured head height
		this.grab = null; // holding the model: { c, kind, p0, q0inv, turn, pos0, yaw0, pos, yaw }
		this.markers = buildMarkers(); // one "stand here" marker per controller
		// The room's name above each marker: in the world, so it stays readable at any zoom.
		this.labels = this.markers.map(() => new Label());
		for (const l of this.labels) xr.scene.add(l.mesh);
		xr.hideFromPhotos(...this.markers, ...this.labels.map((l) => l.mesh));
		// The doors at the scale model (the user's Quest 2 tests): always there,
		// without opening the orb. A big Walk in → in front of you at elbow
		// height, a small ← Back (leave VR) on its left, tilted up towards you.
		// Pressed by touch, a controller's tip or its laser.
		this.doors = new KeyPad(xr, 'plinth-door');
		this.doorGroup = new THREE.Group();
		this.doorGroup.name = 'plinth-doors';
		this.doorGroup.add(this.doors.add('back', ...DOOR_BACK).group, this.doors.add('in', ...DOOR_IN).group);
		this.doors.setSpec('back', { id: 'back', look: 'outline', icon: 'back', label: '\u2190 Back', caption: 'Hold: leave VR', hold: BACK_HOLD });
		this.doors.setSpec('in', { id: 'in', look: 'filled', icon: 'in', label: 'Walk in \u2192', caption: 'Inside the home' });
		xr.stage.add(this.doorGroup);
		xr.hideFromPhotos(this.doorGroup);
		this.placeDoors();
		this.clearRay = new THREE.Raycaster();
		this.clearRay.firstHitOnly = true;
		// A bare hand's pointing ray (orange, straight), one per hand.
		this.handRays = xr.input.controllers.map(() => {
			const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
				new THREE.LineBasicMaterial({ color: HAND.ready, transparent: true, opacity: 0.9 }));
			l.visible = false; l.frustumCulled = false; l.name = 'hand-aim';
			xr.scene.add(l);
			return l;
		});
		// Floating: a line down to the floor, and the ring on the plinth that fills before it goes home.
		this.dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
			new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.03, gapSize: 0.03, transparent: true, opacity: 0.6 }));
		this.dropLine.visible = false; this.dropLine.frustumCulled = false; this.dropLine.name = 'drop-line';
		this.homeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64, 1).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
		this.homeRing.visible = false; this.homeRing.name = 'home-ring';
		this.homeOutline = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 64, 1).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
		this.homeOutline.visible = false;
		this.holdBox = new THREE.Box3Helper(new THREE.Box3(), 0xffffff);
		this.holdBox.material.transparent = true; this.holdBox.material.opacity = 0.35;
		this.holdBox.visible = false;
		xr.stage.add(this.homeRing, this.homeOutline);
		xr.scene.add(this.dropLine, this.holdBox);
		xr.hideFromPhotos(...this.handRays, this.dropLine, this.homeRing, this.homeOutline, this.holdBox);
	}

	/**
	 * The doors in front of where you stand, at waist height for eyes at
	 * eyeY (stage space; by default where the lift puts them), tilted up
	 * towards you: Walk in → in the middle, ← Back 3 cm to its left.
	 */
	placeDoors(eyeY = DOLLHOUSE_PERSON - EYE_BELOW_TOP) {
		const both = DOOR_IN[0] + DOOR_BACK[0] + 0.03;
		this.doors.keys.get('in').group.position.set(both / 2 - DOOR_IN[0] / 2, 0, 0);
		this.doors.keys.get('back').group.position.set(-both / 2 + DOOR_BACK[0] / 2, 0, 0);
		this.doorGroup.position.set(0, eyeY - DOOR_BELOW_EYES, -DOOR_AHEAD);
		this.doorGroup.rotation.set(-(Math.PI / 2 - THREE.MathUtils.degToRad(DOOR_TILT)), 0, 0);
		this.doorEyes = eyeY;
	}

	/** The doors follow a new head height (sitting down, standing up), never while being pressed. */
	followDoors(door) {
		if (door.near || door.hot.size) return; // (hot: the keys a fingertip is on)
		const eye = this.xr.stage.worldToLocal(this.xr.headWorld()).y;
		if (eye > 0.5 && Math.abs(eye - this.doorEyes) > DOOR_FOLLOW) this.placeDoors(eye);
	}

	/** A new model: the markers go into model space (they turn and zoom with it). */
	setModel() {
		this.xr.centerer.add(...this.markers);
	}

	/** A new session: the model back in the middle, and the view lift for the first frames. */
	begin() {
		this.reset();
		this.dollLift = DOLLHOUSE_LIFT_START;
	}

	reset() {
		if (this.settling) { this.xr.tweens.stop(this.settling); this.settling = null; }
		this.stopFloating();
		this.doll.pos.set(0, PLINTH_REST, -this.xr.plinthDistance);
		this.doll.yaw = 0;
		this.doll.zoom = 1;
	}

	/** measure: take the head height now (false at session start, when there is no pose yet). */
	enter({ measure = true } = {}) {
		const xr = this.xr;
		xr.rig.position.set(0, 0, 0);
		xr.rig.rotation.set(0, 0, 0);
		xr.lift = 0;
		if (measure) this.measureLift(xr.camera.matrix);
		xr.stage.visible = true;
		for (const c of xr.input.controllers) xr.input.setLaser(c, true);
		xr.applyView();
		xr.applyStoreys();
		this.apply();
		xr.ui.setWelcome(xr.ui.welcomeOn);
	}

	/** Leaving the dollhouse (for walking, or the session ended). */
	exit() {
		this.grab = null;
		this.cancelHandAim();
		this.holdBox.visible = false;
		this.doors.reset();
		for (const m of this.markers) m.visible = false;
		for (const l of this.labels) l.mesh.visible = false;
		this.xr.stage.visible = false;
	}

	/** Meta's menu covered the app: a held model is let go (it floats, then goes home), an aim is dropped. */
	drop() {
		if (this.grab) this.release();
		this.cancelHandAim();
	}

	/** Where you are looking, as a heading in the model's own frame (it is turned on the plinth). */
	modelHeading() {
		return yawOf(this.xr.camera.matrixWorld) - this.xr.anchor.rotation.y;
	}

	/**
	 * Where stepping inside lands, for a floor point under the laser (world):
	 * { model (model-space point), yaw (heading in the model), name (the
	 * room's, or '') }. Rooms come from the Sweet Home 3D plan; a model
	 * without one (OBJ, GLB) lands where you point.
	 */
	landing(floorWorld) {
		const xr = this.xr, plan = xr.model.plan;
		const p = xr.centerer.worldToLocal(floorWorld.clone());
		const heading = this.modelHeading();
		if (!plan) return { model: p, yaw: heading, name: '' };
		const room = roomAt(plan, p.x, p.y, p.z);
		if (room) {
			// (Worked out once per room and model: its clear middle and long direction.)
			room.landing ??= roomLanding(room, (x, z) => this.isClear(x, room.floorY, z));
			const l = room.landing;
			if (l) return { model: new THREE.Vector3(l.x, room.floorY, l.z), yaw: alongAxis(l.axis, heading), name: room.name };
		}
		// Outside: clear of the walls, facing the middle of the house.
		const [x, z] = clearOfWalls(plan, p.x, p.y, p.z);
		const c = xr.model.bounds.getCenter(new THREE.Vector3());
		const towards = Math.hypot(c.x - x, c.z - z) > 0.5 ? headingOf([c.x - x, c.z - z]) : heading;
		return { model: new THREE.Vector3(x, p.y, z), yaw: towards, name: '' };
	}

	/** True if a body can stand at model point (x, z) on a floor at floorY: no furniture or wall from knee to head height. */
	isClear(x, floorY, z) {
		const xr = this.xr, ray = this.clearRay, obstacles = xr.targets().obstacles;
		const scale = xr.anchor.scale.x; // model metres -> world metres
		const o = new THREE.Vector3();
		for (const [dx, dz] of CLEAR_RING) {
			xr.centerer.localToWorld(o.set(x + dx, floorY + CLEAR_TO, z + dz));
			ray.set(o, DOWN);
			ray.far = (CLEAR_TO - CLEAR_FROM) * scale;
			if (ray.intersectObjects(obstacles, false).length) return false;
		}
		return true;
	}

	/** Places the model from this.doll: on the stage, turned and zoomed. */
	apply() {
		const xr = this.xr;
		const p = xr.stage.localToWorld(this.doll.pos.clone());
		xr.anchor.position.copy(p);
		xr.anchor.quaternion.setFromAxisAngle(UP, xr.stage.rotation.y + this.doll.yaw);
		xr.anchor.scale.setScalar(xr.baseScale * this.doll.zoom);
		xr.anchor.updateMatrixWorld(true);
		xr.plate.set(1 / (xr.baseScale * this.doll.zoom)); // e.g. 1:42 on the plinth
		xr.lighting?.fit(); // the sun follows the model; shadows re-render
	}

	/**
	 * Moves the room, plinth and doors in front of where the user now stands
	 * and looks, the model on the plinth, level. It keeps the model's zoom
	 * and its turn on the plinth, so you find the home as you left it. Every
	 * arrival at the scale model does this, behind the fade (the first entry,
	 * Back from inside, the Meta button's re-centre).
	 */
	recentre(headMatrix = this.xr.camera.matrixWorld) {
		const xr = this.xr;
		const head = new THREE.Vector3().setFromMatrixPosition(headMatrix);
		const yaw = headHeading(headMatrix);
		xr.stage.position.set(head.x, 0, head.z);
		xr.stage.rotation.set(0, yaw, 0);
		xr.stage.updateMatrixWorld(true);
		const { yaw: turn, zoom } = this.doll;
		this.grab = null;
		this.reset();
		this.doll.yaw = turn;
		this.doll.zoom = zoom;
		this.apply();
	}

	/**
	 * How much the view is raised: the measured lift, in passthrough too, so
	 * switching between VR and passthrough only changes the background and
	 * the model stays where it is. (Seated, the lift is large; in passthrough
	 * it is then capped so the model still floats above the real floor.)
	 */
	viewLift() {
		if (this.xr.vrView) return this.dollLift;
		return Math.min(this.dollLift, Math.max(0, this.doll.pos.y - ABOVE_REAL_FLOOR));
	}

	/**
	 * VR dollhouse: works out the lift that puts the eyes where a 2 m tall
	 * person's would be, from the head's real height above the floor.
	 * headLocal: the head pose in tracking space (camera.matrix, or the
	 * viewer pose).
	 */
	measureLift(headLocal) {
		const xr = this.xr;
		const y = new THREE.Vector3().setFromMatrixPosition(headLocal).y;
		// (Ignore nonsense heights: no pose yet, or the 2D camera's position.)
		if (y > 0.3 && y < 2.5) this.dollLift = THREE.MathUtils.clamp(DOLLHOUSE_PERSON - EYE_BELOW_TOP - y, 0, DOLLHOUSE_LIFT_MAX);
		if (xr.mode === 'dollhouse') xr.setLift(this.viewLift());
	}

	update(dt) {
		const xr = this.xr, ui = xr.ui, input = xr.input;
		ui.faceWelcome();
		if (ui.buttons()) return;
		const point = ui.point();
		// The doors (not while a menu is open in front of them). They sit where hands and
		// controllers rest (the tester's finding; the Lead's rules): by touch only a
		// deliberate push from the front (DELIBERATE); a laser only when the door is in
		// front of the model, pressed and let go over it; ← Back is held 0.6 s.
		const door = this.doors.update(dt, { active: !xr.menu, rules: DELIBERATE, blockers: xr.targets().pointable, laserOnRelease: true });
		this.followDoors(door);
		const action = point.action ?? door.action;
		const { pointable } = xr.targets();
		let jumpTo = null;
		const spots = [];
		for (const c of input.active()) {
			input.setLaser(c, c.claim.trigger !== 'tool'); // (a hand holding a tool has no laser)
			if (c.claim.trigger === null) {
				input.setRaycaster(c, xr.raycaster);
				const modelHit = xr.raycaster.intersectObjects(pointable, false)[0];
				if (modelHit) {
					input.showHit(c, modelHit.distance);
					const floor = xr.findFloor(modelHit.point, 0.01);
					if (floor) {
						spots[c.index] = this.landing(floor);
						if (c.state.down.trigger) jumpTo = spots[c.index];
					}
				} else {
					input.showHit(c, null);
				}
			}

			// Grip: hold the model (anywhere; no aiming needed).
			if (c.state.down.grip && c.claim.grip === null && !this.grab) this.startGrab(c);
			if (this.grab?.c === c && c.state.up.grip) this.release();
		}
		// Bare hands: hold with a closed hand, step inside with the teleport gesture.
		const handJump = this.handMoves(dt, spots);
		if (handJump) jumpTo = handJump;

		// Actions that leave the dollhouse end this frame's dollhouse update.
		if (jumpTo) { xr.goLayer('in', () => xr.setMode('walk', jumpTo.model, jumpTo.yaw)); return; }
		if (action) {
			xr.menuAction(action);
			if (xr.mode !== 'dollhouse' || !xr.session) return;
		}

		// One "stand here" marker per controller, turned the way you will
		// face, with the room's name above it.
		const top = new THREE.Vector3(), eye = xr.camera.getWorldPosition(new THREE.Vector3());
		this.markers.forEach((m, i) => {
			const s = spots[i], label = this.labels[i];
			m.visible = !!s;
			label.set(s?.name);
			if (!s) return;
			m.position.copy(s.model);
			m.rotation.y = s.yaw;
			if (label.mesh.visible) {
				xr.centerer.localToWorld(top.set(s.model.x, s.model.y + MARKER_HEIGHT, s.model.z));
				label.mesh.position.copy(top).y += 0.05;
				label.mesh.lookAt(eye);
			}
		});

		// A controller that drops out mid-grab (battery, tracking) lets go; the model stays where it is.
		if (this.grab && (!this.grab.c.source || (this.grab.kind === 'controller' && !this.grab.c.state.grip))) this.release();
		if (this.grab) this.updateGrab(dt);
		this.updateFloating(dt);

		// Thumbsticks: left/right rotates, up/down zooms (either controller).
		// Letting go of a zoom near a standard scale settles on it.
		let sx = 0, sy = 0, zoomHand = null;
		for (const c of input.active()) { sx += c.state.stick.x; sy += c.state.stick.y; if (c.state.stick.y) zoomHand = c; }
		if (sx) this.doll.yaw -= sx * ROTATE_SPEED * dt;
		if (sy) {
			if (this.settling) { xr.tweens.stop(this.settling); this.settling = null; }
			this.doll.zoom = THREE.MathUtils.clamp(this.doll.zoom * Math.exp(-sy * ZOOM_SPEED * dt), ZOOM_MIN, ZOOM_MAX);
			this.zoomHand = zoomHand;
		} else if (this.zoomHand) {
			this.settleZoom(this.zoomHand);
			this.zoomHand = null;
		}
		this.apply();
	}

	/** True while the model stands level (its up within 1° of vertical): always, since it only turns about the vertical (a check for the tests). */
	level() { return (this._up ??= new THREE.Vector3()).copy(UP).applyQuaternion(this.xr.anchor.quaternion).y > Math.cos(THREE.MathUtils.degToRad(1)); }

	/** The model's box in the world (its bounds, as placed now). */
	modelBox(out = new THREE.Box3()) {
		const xr = this.xr;
		xr.centerer.updateMatrixWorld(true);
		return out.copy(xr.model.bounds).applyMatrix4(xr.centerer.matrixWorld);
	}

	/** Where a hand holds (world): a bare hand's palm centre (between the wrist and the middle knuckle), a controller's grip. Null when not tracked. */
	holdPoint(c, out = new THREE.Vector3()) {
		if (c.isHand) {
			const input = this.xr.input, knuckle = input.joint(c, 'middle-finger-phalanx-proximal', out);
			const wrist = knuckle && input.joint(c, 'wrist', this._wrist ??= new THREE.Vector3());
			return wrist ? knuckle.add(wrist).multiplyScalar(0.5) : null;
		}
		c.grip.updateMatrixWorld(true);
		return out.setFromMatrixPosition(c.grip.matrixWorld);
	}

	/** A hand's turn in the world (the wrist joint, or the controller's grip). */
	holdTurn(c, out = new THREE.Quaternion()) {
		const o = c.isHand ? c.hand.joints?.wrist : c.grip;
		if (!o) return null;
		o.updateMatrixWorld(true);
		return o.getWorldQuaternion(out);
	}

	/** Takes hold of the model with c (a controller's grip or a closed bare hand). */
	startGrab(c) {
		const xr = this.xr, p = this.holdPoint(c), q = this.holdTurn(c);
		if (!p || !q) return;
		if (this.settling) { xr.tweens.stop(this.settling); this.settling = null; }
		this.stopFloating();
		this.cancelHandAim();
		xr.anchor.updateMatrixWorld(true);
		const hand = c.isHand;
		this.grab = { c, kind: hand ? 'hand' : 'controller', p0: p, qPrev: q.clone(), raw: 0, turn: 0,
			pos0: xr.stage.worldToLocal(xr.anchor.position.clone()), yaw0: this.doll.yaw,
			pos: this.doll.pos.clone(), yaw: this.doll.yaw };
		xr.sound.play('grab');
		if (!c.isHand) xr.haptics.play(c, 'click');
		xr.lessons?.note('held');
	}

	/**
	 * The held model follows the hand, level: it moves with the hold point
	 * and turns only with the hand's turn about the vertical (a bare hand's
	 * turns under 3° are ignored), smoothed, never into the plinth or the floor.
	 */
	updateGrab(dt) {
		const xr = this.xr, g = this.grab, p = this.holdPoint(g.c), q = this.holdTurn(g.c);
		if (!p || !q) return; // (tracking lost for a moment: the model stays where it is)
		// The hand's turn about the vertical since it took hold, added up frame by frame:
		// each frame's small turn, its twist about the vertical. (The twist of the whole turn
		// since taking hold flips sign once the hand has rolled or pitched about 180°: the
		// tester's finding, a 36° jump.) A frame's turn is never more than 20° (a tracking glitch).
		const dq = q.clone().multiply(g.qPrev.invert());
		g.qPrev.copy(q);
		if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; } // (the short way round)
		g.raw += THREE.MathUtils.clamp(2 * Math.atan2(dq.y, dq.w), -MAX_FRAME_TURN, MAX_FRAME_TURN);
		const raw = g.raw;
		// A bare hand: the turn trails the hand's by up to 3° (a dead zone, so tremor never turns it).
		if (g.kind === 'hand') {
			const d = THREE.MathUtils.euclideanModulo(raw - g.turn + Math.PI, 2 * Math.PI) - Math.PI;
			if (Math.abs(d) > HAND_TURN_DEAD) g.turn += d - Math.sign(d) * HAND_TURN_DEAD;
		} else {
			g.turn = raw;
		}
		// Where the model goes, in stage space: its offset from the hold point, turned with the hand.
		const st = xr.stage, p0 = st.worldToLocal(g.p0.clone()), now = st.worldToLocal(p.clone());
		const pos = g.pos0.clone().sub(p0).applyAxisAngle(UP, g.turn).add(now);
		const k = 1 - Math.exp(-dt / (g.kind === 'hand' ? GRAB_SMOOTH_HAND : GRAB_SMOOTH));
		g.pos.lerp(pos, k);
		g.yaw += (g.yaw0 + g.turn - g.yaw) * k;
		// (doll.pos is the anchor's place: the model's offset in it stays, so the anchor moves and turns as above)
		this.doll.pos.copy(g.pos);
		this.doll.yaw = g.yaw;
		this.apply();
		this.keepAbove();
	}

	/** Never into the plinth or the floor: the model's lowest point stays 4 mm above them. */
	keepAbove() {
		const xr = this.xr, box = this.modelBox();
		const c = xr.stage.worldToLocal(box.getCenter(new THREE.Vector3()));
		const { W, D } = xr.plinthSize;
		const over = xr.vrView && Math.abs(c.x) < W / 2 && Math.abs(c.z + xr.plinthDistance) < D / 2;
		const limit = (over ? PLINTH_HEIGHT : xr.vrView ? 0 : xr.lift) + 0.004;
		if (box.min.y < limit) { this.doll.pos.y += limit - box.min.y; this.apply(); }
		return { box, over };
	}

	/**
	 * Lets go. Near the plinth (its base close to the top, over it, nearly
	 * level) it settles there, level; anywhere else it floats (and goes home by
	 * itself: updateFloating).
	 */
	release() {
		const xr = this.xr, g = this.grab;
		this.grab = null;
		if (!g) return;
		const { box, over } = this.keepAbove();
		if (over && box.min.y - PLINTH_HEIGHT < DROP_NEAR) this.settleDown(0.35);
		else this.floating = { wait: 0, going: null };
	}

	/** Glides down onto the plinth (keeping its place over it), levelling itself; sound settle. */
	settleDown(duration) {
		const xr = this.xr, from = this.doll.pos.clone();
		this.settling = xr.tweens.start({
			duration, ease: ease.inOut,
			step: (k) => { this.doll.pos.y = from.y + (PLINTH_REST - from.y) * k; this.apply(); },
			done: () => { this.settling = null; this.apply(); xr.sound.play('settle'); },
		});
	}

	/** No longer floating: the ring and the drop line go. */
	stopFloating() {
		if (this.floating?.going) this.xr.tweens.stop(this.floating.going);
		this.floating = null;
		this.dropLine.visible = this.homeRing.visible = this.homeOutline.visible = false;
	}

	/**
	 * A floating model: the line down to the floor, and the countdown home.
	 * It waits while a hand or a controller is within RETURN_AWAY of it, then
	 * after RETURN_WAIT seconds glides home along a gentle arc and settles.
	 */
	updateFloating(dt) {
		const xr = this.xr, f = this.floating;
		// The faint box when a bare hand is close enough to hold the model.
		const box = this.modelBox(this._box ??= new THREE.Box3()), p = this._p ??= new THREE.Vector3();
		let canHold = false, near = false;
		for (const c of xr.input.controllers) {
			if (!(c.isHand ? c.touch.tracked : c.isController) || !this.holdPoint(c, p)) continue;
			const d = box.distanceToPoint(p);
			if (c.isHand && d < HOLD_REACH && !this.grab) canHold = true;
			if (d < RETURN_AWAY) near = true;
		}
		this.holdBox.box.copy(box);
		this.holdBox.visible = canHold;
		if (!f) return;
		if (f.going) return; // (the glide home runs on its tween)
		f.wait = near || this.grab ? 0 : f.wait + dt;
		// The line down to the floor, from under the model's middle.
		const c = box.getCenter(new THREE.Vector3());
		const pos = this.dropLine.geometry.attributes.position;
		pos.setXYZ(0, c.x, box.min.y, c.z); pos.setXYZ(1, c.x, xr.vrView ? 0 : xr.lift, c.z);
		pos.needsUpdate = true;
		this.dropLine.computeLineDistances();
		this.dropLine.visible = true;
		// Its place on the plinth: an outline, and a ring that fills over the wait.
		const size = xr.model.bounds.getSize(new THREE.Vector3()).multiplyScalar(xr.anchor.scale.x);
		const r = Math.max(0.1, Math.min(Math.max(size.x, size.z) / 2, xr.plinthSize.W / 2 - 0.02));
		for (const m of [this.homeRing, this.homeOutline]) {
			m.position.set(0, PLINTH_HEIGHT + 0.003, -xr.plinthDistance);
			m.scale.setScalar(r);
			m.visible = xr.vrView;
		}
		const n = this.homeRing.geometry.index.count;
		this.homeRing.geometry.setDrawRange(0, Math.floor((n / 6) * Math.min(1, f.wait / RETURN_WAIT)) * 6);
		if (f.wait >= RETURN_WAIT) this.goHome();
	}

	/** The glide home: 0.8 s along a gentle arc, levelling itself, then it settles (sound settle). */
	goHome() {
		const xr = this.xr, f = this.floating;
		const from = this.doll.pos.clone(), to = new THREE.Vector3(0, PLINTH_REST, -xr.plinthDistance);
		this.dropLine.visible = false;
		f.going = xr.tweens.start({
			duration: 0.8, ease: ease.inOut,
			step: (k) => {
				this.doll.pos.lerpVectors(from, to, k);
				this.doll.pos.y += Math.sin(Math.PI * k) * 0.15;
				this.apply();
			},
			done: () => { this.apply(); this.floating = null; this.stopFloating(); xr.sound.play('settle'); },
		});
	}

	/** Cancels a bare hand's pointing (its ray and marker go). */
	cancelHandAim() {
		if (!this.handAim) return;
		this.handRays[this.handAim.c.index].visible = false;
		this.handAim = null;
	}

	/**
	 * Bare hands at the scale model: a closed hand on the model holds it; the
	 * teleport gesture (pinch and hold, point, let go) steps inside. spots: this frame's
	 * landing per input index (the hand's is added). Returns where to step
	 * inside, or null.
	 */
	handMoves(dt, spots) {
		const xr = this.xr, ui = xr.ui, input = xr.input;
		const box = this.modelBox(this._box2 ??= new THREE.Box3()), p = this._p2 ??= new THREE.Vector3();
		const busy = !!xr.menu || ui.wrist.open;
		let jump = null;
		for (const c of input.gestureHands()) {
			const palm = this.holdPoint(c, p);
			const d = palm ? box.distanceToPoint(palm) : Infinity;
			for (const e of c.gestures) {
				if (e.type === 'fist' && !this.grab && d < HOLD_REACH && !busy && !c.fistClaimed) { this.cancelHandAim(); this.startGrab(c); } // (a fist on a fan tool takes the tool)
				else if ((e.type === 'fistEnd' || e.type === 'lost') && this.grab?.c === c) this.release();
				else if ((e.type === 'open' || e.type === 'lost') && this.handAim?.c === c) { this.cancelHandAim(); xr.sound.play('release'); }
				// The pinch held, palm down, aims; opening it on a steady landing steps inside.
				else if (e.type === 'pinch' && !this.handAim && !busy && this.grab?.c !== c && !xr.aimBlock(c, c.gesture.shape?.pinchAt)) {
					this.handAim = { c, spot: null, steady: 0, at: new THREE.Vector3(), has: false };
					xr.sound.play('aim');
				} else if (e.type === 'pinchEnd' && this.handAim?.c === c) {
					if (this.handAim.spot && this.handAim.steady >= AIM_STEADY) jump = this.handAim.spot;
					else { this.cancelHandAim(); xr.sound.play('release'); }
				}
			}
		}
		const a = this.handAim;
		if (!a) return jump;
		if (busy || !a.c.touch.tracked) { this.cancelHandAim(); return null; }
		const through = a.c.gesture.shape?.pinchAt;
		if (!through) return jump;
		if (!jump && through.y < xr.headWorld().y - WAIST) { this.cancelHandAim(); xr.sound.play('release'); return null; } // (the hand dropped)
		const { origin, dir } = handAimRay(xr.headWorld(), xr.viewAxes().right, through, a.c.handedness);
		xr.raycaster.set(origin, dir);
		xr.raycaster.far = 5;
		const hit = xr.raycaster.intersectObjects(xr.targets().pointable, false)[0];
		const line = this.handRays[a.c.index], end = hit ? hit.point : origin.clone().addScaledVector(dir, 3);
		const pos = line.geometry.attributes.position;
		pos.setXYZ(0, origin.x, origin.y, origin.z); pos.setXYZ(1, end.x, end.y, end.z);
		pos.needsUpdate = true;
		line.visible = true;
		const floor = hit ? xr.findFloor(hit.point, 0.01) : null;
		a.spot = floor ? this.landing(floor) : null;
		if (a.spot) spots[a.c.index] = a.spot;
		// Steady: the landing (in the model) stays put.
		if (a.spot && a.has && a.spot.model.distanceTo(a.at) < 0.15 / Math.max(1e-3, xr.anchor.scale.x * 10)) a.steady += dt;
		else a.steady = 0;
		if (a.spot) { a.at.copy(a.spot.model); a.has = true; } else a.has = false;
		return jump;
	}

	/**
	 * After zooming: near a standard architectural scale (1:50, ...), the
	 * model glides onto it, with a light tick in the hand that zoomed.
	 */
	settleZoom(c) {
		const xr = this.xr;
		const target = nearestScale(1 / (xr.baseScale * this.doll.zoom));
		if (!target) return;
		const from = this.doll.zoom, to = 1 / (xr.baseScale * target);
		if (to < ZOOM_MIN || to > ZOOM_MAX || Math.abs(to - from) < 1e-6) return;
		this.settling = xr.tweens.start({
			duration: 0.25, ease: ease.out,
			step: (k) => { this.doll.zoom = from + (to - from) * k; this.apply(); },
			done: () => { this.settling = null; xr.haptics.play(c, 'tick'); xr.sound.play('tick'); },
		});
	}
}

