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

import * as THREE from 'three';
import { UP, DOWN } from './xr-targets.js';
import { yawOf } from './xr-input.js';
import { PLINTH_REST, EYE_BELOW_TOP, buildMarkers } from './xr-scene.js';
import { KeyPad } from './keys.js';
import { roomAt, roomLanding, alongAxis, clearOfWalls, headingOf } from './rooms.js';
import { Label } from './panel.js';
import { ease } from './tween.js';

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
const ZOOM_SPEED = 1.2; // e-folds/s at full stick
// The doors at the scale model, metres (the user's Quest 2 tests): Walk in →
// is the big one, ← Back about a third as long, the same height, on its left.
// They float at elbow height in front of you (on the plinth's edge you had to
// crouch to touch them with bare hands), close enough to touch, and low enough
// to stay under the line from the eyes to the model (60° below the horizon at
// their middle; the model's near edge is about 58° down from where you stand).
const DOOR_IN = [0.32, 0.09], DOOR_BACK = [0.1, 0.09];
const DOOR_BELOW_EYES = 0.6; // elbow height, standing or seated (the lift keeps the eyes at the same height)
const DOOR_AHEAD = 0.3; // in front of where you stand
const DOOR_TILT = 35; // degrees from flat, like the scale plate: the face turned up towards your eyes
const DOOR_FOLLOW = 0.08; // the doors move to a new head height once it differs by this much
const MARKER_HEIGHT = 1.7; // metres at the model's scale (the "stand here" figure)
// A landing spot must be free of furniture from this height above the floor
// (rugs and thresholds don't count) up to head height, around a body's width.
const CLEAR_FROM = 0.3, CLEAR_TO = 2.0;
const CLEAR_RING = [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]];

export class Dollhouse {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'dollhouse';
		// The model on the plinth, in stage space: position, turn and zoom.
		this.doll = { pos: new THREE.Vector3(0, PLINTH_REST, -xr.plinthDistance), yaw: 0, zoom: 1 };
		this.dollLift = DOLLHOUSE_LIFT_START; // VR dollhouse lift, from the measured head height
		this.grab = null; // grabbing the model: { c, p0, yaw0, aPos0, aYaw0 }
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
		this.doors.setSpec('back', { id: 'back', look: 'outline', icon: 'back', label: '\u2190 Back', caption: 'Leave VR' });
		this.doors.setSpec('in', { id: 'in', look: 'filled', icon: 'in', label: 'Walk in \u2192', caption: 'Inside the home' });
		xr.stage.add(this.doorGroup);
		xr.hideFromPhotos(this.doorGroup);
		this.placeDoors();
		this.clearRay = new THREE.Raycaster();
		this.clearRay.firstHitOnly = true;
	}

	/**
	 * The doors in front of where you stand, at elbow height for eyes at
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
		this.doors.reset();
		for (const m of this.markers) m.visible = false;
		for (const l of this.labels) l.mesh.visible = false;
		this.xr.stage.visible = false;
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
		xr.anchor.rotation.set(0, xr.stage.rotation.y + this.doll.yaw, 0);
		xr.anchor.scale.setScalar(xr.baseScale * this.doll.zoom);
		xr.anchor.updateMatrixWorld(true);
		xr.plate.set(1 / (xr.baseScale * this.doll.zoom)); // e.g. 1:42 on the plinth
		xr.lighting?.fit(); // the sun follows the model; shadows re-render
	}

	/** Moves the room, plinth and model in front of where the user now stands and looks. */
	recentre(headMatrix = this.xr.camera.matrixWorld) {
		const xr = this.xr;
		const head = new THREE.Vector3().setFromMatrixPosition(headMatrix);
		const yaw = yawOf(headMatrix);
		xr.stage.position.set(head.x, 0, head.z);
		xr.stage.rotation.set(0, yaw, 0);
		xr.stage.updateMatrixWorld(true);
		this.reset();
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
		// The doors (not while a menu is open in front of them).
		const door = this.doors.update(dt, { active: !xr.menu });
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

			// Grip: grab and move the model, keeping it upright (yaw only).
			if (c.state.down.grip && c.claim.grip === null && !this.grab) {
				const p = new THREE.Vector3();
				const yaw = input.pose(c, p);
				this.grab = { c, p0: p, yaw0: yaw, aPos0: xr.anchor.position.clone(), aYaw0: xr.anchor.rotation.y };
			}
			if (this.grab?.c === c && c.state.up.grip) this.grab = null;
		}

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

		// A controller that drops out mid-grab (battery, tracking) lets go.
		if (this.grab && (!this.grab.c.source || !this.grab.c.state.grip)) this.grab = null;
		if (this.grab) {
			const p = new THREE.Vector3();
			const yaw = input.pose(this.grab.c, p);
			const dy = yaw - this.grab.yaw0;
			const off = this.grab.aPos0.clone().sub(this.grab.p0).applyAxisAngle(UP, dy);
			const world = p.add(off);
			this.doll.pos.copy(xr.stage.worldToLocal(world));
			this.doll.yaw = this.grab.aYaw0 + dy - xr.stage.rotation.y;
			// Never push it into the plinth (or, off the plinth, below the floor:
			// in passthrough, the real floor, which is as far down as the view is raised).
			const { W, D } = xr.plinthSize;
			const onPlinth = xr.vrView && Math.abs(this.doll.pos.x) < W / 2 && Math.abs(this.doll.pos.z + xr.plinthDistance) < D / 2;
			this.doll.pos.y = Math.max(this.doll.pos.y, onPlinth ? PLINTH_REST : xr.vrView ? 0 : xr.lift + 0.004);
		}

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

