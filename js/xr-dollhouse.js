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
// (js/gestures.js): pinch and hold, point at a room (a straight ray from the
// shoulder through the pinch, the marker hops to the room), and open the
// pinch once the marker has held still 0.3 s. The palm towards your eyes, or
// the hand dropped: cancel. A pinch within 15 cm of the model or a key never aims.

import * as THREE from 'three';
import { UP, DOWN, CLAIM } from './xr-targets.js';
import { yawOf } from './xr-input.js';
import { PLINTH_HEIGHT, PLINTH_HEIGHT_HANDS, PLINTH_MARGIN, PLINTH_MARGIN_HANDS, setPlinthHeight, EYE_BELOW_TOP, buildMarkers } from './xr-scene.js';
import { KeyPad } from './keys.js';
import { DELIBERATE } from './touch.js';
import { roomAt, roomLanding, alongAxis, clearOfWalls, headingOf } from './rooms.js';
import { Label } from './panel.js';
import { ease } from './tween.js';
import { handAimRay, pinchGate } from './gestures.js';
import { HAND } from './theme.js';

const DOLLHOUSE_PERSON = 2.0; // metres
const DOLLHOUSE_LIFT_START = 0.25; // used for the first frames, before the head height is known
const DOLLHOUSE_LIFT_MAX = 1.4; // (lying on the floor is not a case to support)
const ZOOM_MIN = 0.5, ZOOM_MAX = 4;
const ABOVE_REAL_FLOOR = 0.05; // passthrough: the model never sinks below the real floor
// Round scales only (build 111's test: 1:23 and 1:8 showed). The scale model
// rests, and the plate reads, only on these (1:5, 1:10, 1:15, 1:20, ...); while
// you zoom the plate shows the nearest one and on letting go the model glides
// onto it. The fit scale at entry rounds up to one too (js/xr.js setModel), so
// the model still fits the plinth.
export const ROUND_SCALES = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000];

/** A yaw (radians) turned to the nearest quarter turn: square to the plinth (0°, 90°, 180°, 270°). */
export function squareYaw(yaw) { return Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2); }

/** The round scale (the 50 of 1:50) nearest a ratio (by proportion, not by difference). */
export function roundScale(ratio) {
	let best = ROUND_SCALES[0];
	for (const s of ROUND_SCALES) if (Math.abs(Math.log(s / ratio)) < Math.abs(Math.log(best / ratio))) best = s;
	return best;
}

/** The smallest round scale at or above a ratio (a smaller model than asked: it still fits), else the ratio rounded. */
export function roundScaleUp(ratio) {
	return ROUND_SCALES.find((s) => s >= ratio - 1e-9) ?? Math.round(ratio);
}
const ROTATE_SPEED = 1.6; // rad/s at full stick
const HOLD_REACH = 0.08; // a closed hand within this of the model's box holds it
const PLINTH_WAIT = 1.0, PLINTH_MOVE = 0.8, PLINTH_CLEAR = 0.3; // the input must hold this long (s); the move; no hand or controller within this of the model (m)
const DROP_NEAR = 0.15; // let go this close to the plinth top (over it): it settles
const DROP_NEAR_HAND = 0.3, DROP_OVER_HAND = 0.15; // bare hands, with no depth cues and a shaky hold: twice as far above it, and 15 cm beyond its edge
const RETURN_AWAY_HAND = 0.15; // a bare hand counts as "at the model" only this close, and only above the waist (a hand hanging at your side, or one tracking lost in the model's box, never keeps it from going home)
const RETURN_GLIDE = 1.6, RETURN_LOOK = THREE.MathUtils.degToRad(60); // the glide home (s; build 111's 1.6 s, which build 120 cut to 0.3 s: see long below; the Lead offers the user 3.2 s); the plinth must be within this of where you look
const HOME_RING = { across: 1 / 3, line: 0.03, colour: 0x1d2329, opacity: 0.9, track: 0.25 }; // the countdown ring: a third of the plinth's width across, a 3 cm graphite line (the theme's text colour), fill 90%, track 25% (build 120's design, item 6)
const RETURN_ARC = 0.2; // the glide home rises this much at its middle (m)
const RETURN_AWAY = 0.3, RETURN_WAIT = 4; // a floating model goes home once nothing is within 0.3 m for 4 s
const GRAB_SMOOTH = 0.06, GRAB_SMOOTH_HAND = 0.1; // seconds: a held model follows a controller / a bare hand smoothed this much
const HAND_TURN_DEAD = THREE.MathUtils.degToRad(3); // a bare hand's turn: changes under 3° are tremor, ignored
const MAX_FRAME_TURN = THREE.MathUtils.degToRad(20); // a held model turns at most this much in one frame
// A bare hand steps inside on letting go once the ray has shown SHOWN_FOR, at the landing it showed LOOK_BACK before
// (against the flick of opening fingers): the same rule as walking inside (B6; the interaction harmony's conflict 5).
const SHOWN_FOR = 0.3, LOOK_BACK = 0.1;
const HOVER = { frames: 2, linger: 0.2, away: CLAIM.near, faint: 0.36, solid: 0.9 }; // the hover ray before a pinch: shown after 2 frames in the zone, gone 0.2 s after; not within 15 cm of the model; its opacity, and the aim's
const WAIST = 0.8; // a pinching hand this far below the eyes is at your side: it never aims, and an aim cancels (m)
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
// The levels: a stack of keys to the left of the doors, ground at the bottom like the building's section (the UX design of 25 Nov).
const LEVEL_KEY = [0.08, 0.04], LEVEL_KEY_MANY = 0.03, LEVEL_GAP = 0.012, LEVELS_LEFT = 0.12; // key size (m); with more than six levels they are 3 cm tall; the stack's middle this far left of ← Back
const BACK_HOLD = 0.6; // ← Back (leave VR) is held this long, a ring filling (the Lead's decision)
const DOORS_FADE = 0.15; // seconds: the doors fade out while the board is open (they showed through it), and back
const DOORS_ARC = 0.3; // ... and to this while the wrist arc is open (still seen, never pressed)
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
		this.doll = { pos: new THREE.Vector3(0, xr.plinthH + 0.004, -xr.plinthDistance), yaw: 0, zoom: 1 };
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
		this.levelCount = 0; // the keys in the stack now (level keys are slots 'level0', 'level1'... of the doors' pad)
		this.levelTitle = new Label({ height: 0.026 });
		this.levelTitle.set('Levels');
		this.doorGroup.add(this.levelTitle.mesh);
		xr.stage.add(this.doorGroup);
		xr.hideFromPhotos(this.doorGroup);
		this.doorAlpha = 1; // 0 while the settings board is open (the Quest 2 design's item 7)
		this.placeDoors();
		this.clearRay = new THREE.Raycaster();
		this.clearRay.firstHitOnly = true;
		this.clearRay.layers.enableAll();
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
		this.homeRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64, 1).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: HOME_RING.colour, transparent: true, opacity: HOME_RING.opacity, depthWrite: false, side: THREE.DoubleSide }));
		this.homeRing.visible = false; this.homeRing.name = 'home-ring';
		this.homeOutline = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64, 1).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: HOME_RING.colour, transparent: true, opacity: HOME_RING.track, depthWrite: false, side: THREE.DoubleSide }));
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
		// The levels: left of ← Back, the stack's middle LEVELS_LEFT from its edge, at the doors' height.
		const n = this.levelCount, h = n > 6 ? LEVEL_KEY_MANY : LEVEL_KEY[1], x = -both / 2 - LEVELS_LEFT;
		for (let i = 0; i < n; i++) this.doors.keys.get(`level${i}`).group.position.set(x, (i - (n - 1) / 2) * (h + LEVEL_GAP), 0);
		this.levelTitle.mesh.position.set(x, ((n - 1) / 2) * (h + LEVEL_GAP) + h / 2 + 0.02, 0.002);
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

	/** A new model: the markers go into model space (they turn and zoom with it); the levels stack follows the home. */
	setModel() {
		this.xr.centerer.add(...this.markers);
		this.buildLevels();
		this.houseBounds = houseBounds(this.xr.model);
	}

	/** One key per level (a home with two or more), ground at the bottom; keys left over from a taller home stay hidden. */
	buildLevels() {
		const n = (this.xr.model?.storeys ?? 1) >= 2 ? this.xr.model.storeys : 0;
		const h = n > 6 ? LEVEL_KEY_MANY : LEVEL_KEY[1];
		for (let i = 0; i < n; i++) {
			if (!this.doors.keys.has(`level${i}`)) this.doorGroup.add(this.doors.add(`level${i}`, LEVEL_KEY[0], h).group);
			else { const k = this.doors.keys.get(`level${i}`); k.h = h; }
		}
		this.levelCount = n;
		this.showDoors(); // (the faded materials are collected again)
		this.refreshLevels();
		this.placeDoors(this.doorEyes);
	}

	/** What each level key shows: its name, the chosen one filled; hidden when the home has no such level. */
	refreshLevels() {
		const xr = this.xr, n = this.levelCount, names = xr.model?.storeyNames ?? [], chosen = xr.maxStorey ?? n - 1;
		for (const [slot, k] of this.doors.keys) {
			if (!slot.startsWith('level')) continue;
			const i = Number(slot.slice(5)), on = i < n;
			k.group.visible = k.out = on;
			if (on) this.doors.setSpec(slot, { id: `level:${i}`, look: i === chosen ? 'chosen' : 'plain', label: String(names[i] || `Level ${i}`).slice(0, 12) });
		}
		this.levelTitle.mesh.visible = n >= 2;
	}

	/** A new session: the model back in the middle, and the view lift for the first frames. */
	begin() {
		this.reset();
		this.showDoors();
		this.dollLift = DOLLHOUSE_LIFT_START;
	}

	reset() {
		if (this.settling) { this.xr.tweens.stop(this.settling); this.settling = null; }
		this.stopFloating();
		this.doll.pos.set(0, this.xr.plinthH + 0.004, -this.xr.plinthDistance);
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
		this.snapPlinth(); // (the height for the input in hand, at once: the live switch is animated)
		for (const c of xr.input.controllers) xr.input.setLaser(c, true);
		xr.applyView();
		xr.applyStoreys();
		this.apply();
		xr.ui.setWelcome(xr.ui.welcomeOn);
	}

	// -----------------------------------------------------------------------
	// The plinth's height: 0.60 m while any controller is tracked, 1.24 m with
	// only bare hands (the user's decision; build 111's design, item 3)
	// -----------------------------------------------------------------------

	/** The height for the input in hand. */
	wantedPlinth() {
		const input = this.xr.input;
		// (Bare hands only when a hand is really there: at a session's start no input is reported yet, and the plinth must not start tall for a controller user.)
		return !input.active().length && input.controllers.some((c) => c.isHand && c.touch.tracked) ? PLINTH_HEIGHT_HANDS : PLINTH_HEIGHT;
	}

	/** Sets the plinth's top to h now: the body, the plate, and a model resting on it ride along. */
	setPlinthNow(h) {
		const xr = this.xr, resting = !this.grab && !this.floating && Math.abs(this.doll.pos.y - (xr.plinthH + 0.004)) < 0.002;
		xr.plinthH = h;
		setPlinthHeight(xr.pedestal, h);
		// Bare hands: 30 cm of table round the model, not 20, grown with the height (the model and the
		// room stay where they are; the front edge stays 0.6 m ahead, so the table grows back and sideways).
		const base = xr.plinthBase;
		if (base) {
			const k = THREE.MathUtils.clamp((h - PLINTH_HEIGHT) / (PLINTH_HEIGHT_HANDS - PLINTH_HEIGHT), 0, 1), grow = 2 * (PLINTH_MARGIN_HANDS - PLINTH_MARGIN) * k;
			xr.pedestal.scale.set((base.W + grow) / base.W, 1, (base.D + grow) / base.D);
			xr.pedestal.position.z = -xr.plinthDistance - grow / 2; // (its front edge stays 0.6 m ahead: it grows back and sideways)
			xr.plinthSize = { W: base.W + grow, D: base.D + grow };
			xr.plate?.mesh.scale.set(1 / xr.pedestal.scale.x, 1, 1 / xr.pedestal.scale.z); // (the plate is on the plinth: never stretched)
		}
		const plate = xr.plate?.mesh;
		if (plate) plate.position.y = h + (plate.userData.tiltHalf ?? 0.03);
		if (xr.model) xr.ui.placeWelcome(); // (the welcome card floats above the model: it rides along)
		if (resting) { this.doll.pos.y = h + 0.004; this.apply(); }
		else if (this.grab) this.keepAbove(); // (a model in the hand is never left inside the rising plinth)
	}

	/** At once (entering): the height for the input in hand. */
	snapPlinth() {
		if (this.plinthAnim) { this.xr.tweens.stop(this.plinthAnim); this.plinthAnim = null; }
		this.plinthSwitch = null;
		this.setPlinthNow(this.wantedPlinth());
	}

	/**
	 * Once a frame: when the input changes (controllers to bare hands, or back)
	 * and holds for 1.0 s (the Quest flickers between them), the plinth and
	 * everything on it rise or sink over 0.8 s (sine ease), once the model is
	 * at rest and no hand or controller is within 30 cm of it. The room, the
	 * doors and the levels stay still. A very soft settle sound, no vibration.
	 */
	updatePlinth(dt) {
		const xr = this.xr, want = this.wantedPlinth();
		if (this.plinthAnim) return;
		if (Math.abs(want - xr.plinthH) < 1e-6) { this.plinthSwitch = null; return; }
		if (this.plinthSwitch?.to !== want) this.plinthSwitch = { to: want, t: 0 };
		this.plinthSwitch.t += dt;
		if (this.plinthSwitch.t < PLINTH_WAIT) return;
		// Not while the model is held, floating, gliding home or settling, or a hand or controller is near it.
		if (this.grab || this.floating || this.settling) return;
		const box = this.modelBox(this._box3 ??= new THREE.Box3()), p = this._p3 ??= new THREE.Vector3();
		for (const c of xr.input.controllers) {
			if (!c.touch.tracked || !this.holdPoint(c, p)) continue; // (a hand, or a controller in hand: not one put down)
			if (box.distanceToPoint(p) < PLINTH_CLEAR) return;
		}
		const from = xr.plinthH;
		this.plinthSwitch = null;
		if (xr.soundLevel !== 'off') xr.sound.play('settle', 0.33);
		this.plinthAnim = xr.tweens.start({
			duration: PLINTH_MOVE, ease: ease.inOut, long: true, // (sine; long: not capped at 0.3 s)
			step: (k) => this.setPlinthNow(from + (want - from) * k),
			done: () => { this.plinthAnim = null; this.setPlinthNow(want); },
		});
	}

	/** Leaving the dollhouse (for walking, or the session ended). */
	exit() {
		this.grab = null;
		this.cancelHandAim();
		this.endHover();
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
		xr.plate.set(roundScale(1 / (xr.baseScale * this.doll.zoom))); // e.g. 1:40 on the plinth: round scales only
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

	/**
	 * While the settings board is open, the doors fade out (and take no
	 * presses: doors.update below is inactive then), so they never show
	 * through or beside the board; they come back when it closes.
	 */
	/**
	 * True while the doors and level keys take presses: not while a wing is
	 * open (they fade out) nor while the wrist arc is open (they fade to 30%:
	 * its keys may sit beside them; the interaction harmony's conflict 2).
	 * Only live keys guard anything (a press, the fan, the orb).
	 */
	get doorsLive() { return !this.xr.boardOpen && !this.xr.ui.wrist.open; }

	fadeDoors(dt) {
		const target = this.xr.boardOpen ? 0 : this.xr.ui.wrist.open ? DOORS_ARC : 1;
		if (this.doorAlpha === target) return;
		this.doorAlpha = target > this.doorAlpha ? Math.min(target, this.doorAlpha + dt / DOORS_FADE) : Math.max(target, this.doorAlpha - dt / DOORS_FADE);
		// (Each material's own opacity is recorded once, on first sight, and never read back from a faded
		// state: build 120's B1, a new home loaded while the doors were faded kept them at 0 for good.)
		this.doorMaterials ??= (() => { const list = []; this.doorGroup.traverse((o) => { for (const m of [].concat(o.material ?? [])) if (!list.includes(m)) { m.userData.baseOpacity ??= m.opacity; list.push(m); } }); return list; })();
		for (const m of this.doorMaterials) { m.transparent = true; m.opacity = m.userData.baseOpacity * this.doorAlpha; }
		this.doorGroup.visible = this.doorAlpha > 0;
	}

	/** The doors shown in full at once (a new home, a new session). */
	showDoors() {
		this.doorAlpha = 1;
		for (const m of this.doorMaterials ?? []) m.opacity = m.userData.baseOpacity;
		this.doorMaterials = null; // (collected again: a new home may add level keys)
		this.doorGroup.visible = true;
	}

	update(dt) {
		const xr = this.xr, ui = xr.ui, input = xr.input;
		this.fadeDoors(dt);
		ui.faceWelcome();
		if (ui.buttons()) return;
		const point = ui.point();
		// The doors (not while a menu is open in front of them). They sit where hands and
		// controllers rest (the tester's finding; the Lead's rules): by touch only a
		// deliberate push from the front (DELIBERATE); a laser only when the door is in
		// front of the model, pressed and let go over it; ← Back is held 0.6 s.
		const door = this.doors.update(dt, { active: this.doorsLive, rules: DELIBERATE, blockers: xr.targets().pointable, laserOnRelease: true });
		this.followDoors(door);
		let action = point.action ?? door.action;
		if (action?.id?.startsWith('level:')) { // a level key: show the home up to that level (the chosen one does nothing)
			const i = Number(action.id.slice(6));
			action = i === (xr.maxStorey ?? this.levelCount - 1) ? null : { id: 'levels', value: i };
		}
		const { pointable } = xr.targets();
		let jumpTo = null;
		const spots = [];
		for (const c of input.active()) {
			input.setLaser(c, c.claim.trigger !== 'tool'); // (a hand holding a tool has no laser)
			if (c.claim.trigger === null && !xr.toolsIntro?.showing) { // (while the tools' show plays, the aims wait)
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
		if (jumpTo) { xr.goLayer('in', () => xr.setMode('walk', jumpTo.model, jumpTo.yaw), jumpTo.model); return; }
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
		this.updatePlinth(dt);

		// Thumbsticks: left/right rotates, up/down zooms (either controller).
		// Letting go of a zoom near a standard scale settles on it.
		let sx = 0, sy = 0, zoomHand = null;
		for (const c of input.active()) { sx += c.state.stick.x; sy += c.state.stick.y; if (c.state.stick.y) zoomHand = c; }
		if (sx) { this.doll.yaw -= sx * ROTATE_SPEED * dt; if (this.floating) this.stickTurned = true; } // (a turn you made with the stick is kept when it goes home)
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

	/**
	 * The house's box in the world, as placed now (houseBounds): what the
	 * wings, the open fan, the tools' show and the arrival title keep clear of
	 * (the interaction harmony's conflict 13: the home, not its lawn).
	 */
	houseBox(out = new THREE.Box3()) {
		const xr = this.xr;
		xr.centerer.updateMatrixWorld(true);
		return out.copy(this.houseBounds ?? xr.model.bounds).applyMatrix4(xr.centerer.matrixWorld);
	}

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
	keepAbove(margin = 0) {
		const xr = this.xr, box = this.modelBox();
		const c = xr.stage.worldToLocal(box.getCenter(new THREE.Vector3()));
		const { W, D } = xr.plinthSize;
		const over = xr.vrView && Math.abs(c.x) < W / 2 + margin && Math.abs(c.z + xr.plinthDistance) < D / 2 + margin;
		const limit = (over ? xr.plinthH : xr.vrView ? 0 : xr.lift) + 0.004;
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
		const hand = g.kind === 'hand';
		const { box, over } = this.keepAbove(hand ? DROP_OVER_HAND : 0);
		if (over && box.min.y - xr.plinthH < (hand ? DROP_NEAR_HAND : DROP_NEAR)) this.settleDown(0.35, hand);
		else this.floating = { wait: 0, going: null };
	}

	/** Glides down onto the plinth (keeping its place over it), levelling itself; sound settle. */
	settleDown(duration, centre = false) {
		const xr = this.xr, from = this.doll.pos.clone();
		this.settling = xr.tweens.start({
			duration, ease: ease.inOut, long: true, // (0.35 s: just over the 0.3 s cap)
			step: (k) => {
				this.doll.pos.y = from.y + (xr.plinthH + 0.004 - from.y) * k;
				// (Let go a hand's breadth beyond its edge: it also slides onto the plinth, never half off it.)
				if (centre) { this.doll.pos.x = from.x * (1 - k); this.doll.pos.z = from.z + (-xr.plinthDistance - from.z) * k; }
				this.apply();
			},
			done: () => { this.settling = null; this.apply(); xr.sound.play('settle'); },
		});
	}

	/** No longer floating: the ring and the drop line go. */
	stopFloating() {
		this.stickTurned = false;
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
			if (!c.touch.tracked || !this.holdPoint(c, p)) continue; // (a hand, or a controller in hand: not one put down)
			const d = box.distanceToPoint(p);
			if (c.isHand && d < HOLD_REACH && !this.grab) canHold = true;
			if (c.isHand) { if (d < RETURN_AWAY_HAND && p.y >= xr.headWorld().y - WAIST) near = true; } else if (d < RETURN_AWAY) near = true;
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
		const r = Math.max(0.08, xr.plinthSize.W * HOME_RING.across / 2); // (a third of the plinth's width across, in its middle)
		if (this.homeRingR !== r) { // (the line stays 3 cm wide whatever the radius)
			this.homeRingR = r;
			for (const m of [this.homeRing, this.homeOutline]) { m.geometry.dispose(); m.geometry = new THREE.RingGeometry(Math.max(0.01, 1 - HOME_RING.line / r), 1, 64, 1).rotateX(-Math.PI / 2); }
		}
		for (const m of [this.homeRing, this.homeOutline]) {
			m.position.set(0, xr.plinthH + 0.003, -xr.plinthDistance);
			m.scale.setScalar(r);
			m.visible = xr.vrView;
		}
		const n = this.homeRing.geometry.index.count;
		this.homeRing.geometry.setDrawRange(0, Math.floor((n / 6) * Math.min(1, f.wait / RETURN_WAIT)) * 6);
		// The plinth more than 60° from where you look: it waits for you to look (the ring, full, breathes slowly).
		if (f.wait >= RETURN_WAIT) {
			const head = xr.headWorld(), look = this._look3 ??= new THREE.Vector3(), to = this._to3 ??= new THREE.Vector3();
			look.setFromMatrixColumn(xr.camera.matrixWorld, 2).negate();
			xr.stage.localToWorld(to.set(0, xr.plinthH, -xr.plinthDistance)).sub(head).normalize();
			if (look.angleTo(to) > RETURN_LOOK) {
				this.homeRing.material.opacity = HOME_RING.opacity * (0.7 + 0.3 * Math.sin(this.clockT = (this.clockT ?? 0) + dt * 2.2));
				return;
			}
			this.homeRing.material.opacity = HOME_RING.opacity;
			this.goHome();
		}
	}

	/**
	 * The glide home: 1.6 s (smooth ease: no jolt as it starts or stops) along a gentle arc rising 20 cm at its
	 * middle, turning to the nearest quarter turn square to the plinth (unless
	 * you turned it with the stick: then it lands on that turn), then it
	 * settles (sound settle).
	 */
	goHome() {
		const xr = this.xr, f = this.floating;
		const from = this.doll.pos.clone(), to = new THREE.Vector3(0, xr.plinthH + 0.004, -xr.plinthDistance);
		const yaw0 = this.doll.yaw, yaw1 = this.stickTurned ? yaw0 : squareYaw(yaw0);
		this.dropLine.visible = false;
		f.going = xr.tweens.start({
			duration: RETURN_GLIDE, ease: ease.smooth, long: true, // (long: tweens are capped at 0.3 s otherwise; build 120's glide ran 0.3 s)
			step: (k) => {
				this.doll.pos.lerpVectors(from, to, k);
				this.doll.pos.y += Math.sin(Math.PI * k) * RETURN_ARC;
				this.doll.yaw = yaw0 + (yaw1 - yaw0) * k;
				this.apply();
			},
			done: () => { this.apply(); this.floating = null; this.stopFloating(); xr.sound.play('settle'); },
		});
	}

	/**
	 * Before any pinch (build 120's design, item 5: hover before select): the
	 * bare main hand between the eyes and the model, for 2 frames, shows a
	 * faint aim ray and the marker on the room, at once; a pinch then makes it
	 * the aim. Not with the hand at the model (it holds), at a key, holding a
	 * tool, or the fan hand, nor while a controller is in use (its laser
	 * points); it goes 0.2 s after the hand leaves. A ray that
	 * slips off the floor for a moment (a wall) keeps the room it was on.
	 */
	hoverAim(dt, spots, busy, box) {
		const xr = this.xr, head = xr.headWorld();
		const c = busy || this.grab || xr.input.active().length ? null : xr.input.gestureHands().find((h) => h.touch.tracked && xr.teleportHand(h)) ?? null;
		const shape = c?.gesture?.shape, through = shape?.pinchAt ?? null;
		let inZone = false;
		// (The pinch gate: palm not towards you, 20 cm in front, between the waist and the eyes; the harmony's conflict 4.)
		if (c && through && pinchGate(shape, head, xr.viewAxes().forward) && !xr.aimBlock(c, through) && box.distanceToPoint(through) >= HOVER.away) {
			const ray = this._hoverRay ??= new THREE.Ray();
			ray.origin.copy(head); ray.direction.subVectors(through, head).normalize();
			inZone = ray.intersectsBox(box);
		}
		const h = this.hover ??= { c: null, frames: 0, gone: 0, spot: null, slip: 0 };
		if (inZone) { if (h.c !== c) { this.endHover(); h.c = c; } h.frames++; h.gone = 0; } else h.gone += dt;
		if (!h.c || h.frames < HOVER.frames) { if (!inZone) h.frames = 0; return; }
		if (h.gone > HOVER.linger) { this.endHover(); return; }
		const tip = h.c.gesture?.shape?.pinchAt ?? h.c.touch.tip;
		const { origin, dir } = handAimRay(head, xr.viewAxes().right, tip, h.c.handedness);
		xr.raycaster.set(origin, dir);
		xr.raycaster.far = 5;
		const hit = xr.raycaster.intersectObjects(xr.targets().pointable, false)[0];
		const line = this.handRays[h.c.index], end = hit ? hit.point : origin.clone().addScaledVector(dir, 3);
		const pos = line.geometry.attributes.position;
		pos.setXYZ(0, origin.x, origin.y, origin.z); pos.setXYZ(1, end.x, end.y, end.z);
		pos.needsUpdate = true;
		line.material.opacity = HOVER.faint;
		line.visible = true;
		const floor = hit ? xr.findFloor(hit.point, 0.01) : null;
		const spot = floor ? this.landing(floor) : null;
		if (spot) { h.spot = spot; h.slip = 0; } else if ((h.slip += dt) > HOVER.linger) h.spot = null;
		if (h.spot) spots[h.c.index] = h.spot;
	}

	/** The hover ray goes. */
	endHover() {
		const h = this.hover;
		if (!h?.c) return;
		if (this.handAim?.c !== h.c) this.handRays[h.c.index].visible = false;
		h.c = null; h.frames = 0; h.gone = 0; h.spot = null; h.slip = 0;
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
		const busy = xr.boardOpen || ui.wrist.open || !!xr.toolsIntro?.showing; // (while the tools' show plays, the aims wait: the harmony's conflict 7)
		let jump = null;
		for (const c of input.gestureHands()) {
			const palm = this.holdPoint(c, p);
			const d = palm ? box.distanceToPoint(palm) : Infinity;
			for (const e of c.gestures) {
				if (e.type === 'fist' && !this.grab && d < HOLD_REACH && !busy && !c.fistClaimed) { this.cancelHandAim(); this.startGrab(c); } // (a fist on a fan tool takes the tool)
				else if ((e.type === 'fistEnd' || e.type === 'lost') && this.grab?.c === c) this.release();
				else if ((e.type === 'open' || e.type === 'lost') && this.handAim?.c === c) { this.cancelHandAim(); xr.sound.play('release'); }
				// The pinch held aims; opening it steps inside (once shown SHOWN_FOR, the landing from LOOK_BACK before).
				else if (e.type === 'pinch' && !this.handAim && !busy && this.grab?.c !== c && xr.teleportHand(c) && !xr.aimBlock(c, c.gesture.shape?.pinchAt) && c.gesture.shape.pinchAt.y >= xr.headWorld().y - WAIST) { // (a hand at your side never aims)
					this.handAim = { c, spot: null, age: 0, past: [] };
					xr.sound.play('aim');
				} else if (e.type === 'pinch' && !this.handAim && !busy && this.grab?.c !== c && !xr.teleportHand(c) && !xr.aimBlock(c, c.gesture.shape?.pinchAt) && c.gesture.shape?.pinchAt) {
					xr.ui.noteWrongHand(c, c.gesture.shape.pinchAt);
				} else if (e.type === 'pinchEnd' && this.handAim?.c === c) {
					const spot = this.spotBefore(this.handAim, LOOK_BACK);
					if (spot && this.handAim.age >= SHOWN_FOR) jump = spot;
					else { this.cancelHandAim(); xr.sound.play('release'); } // (a quick pinch-and-open, or let go off the model: a slip never moves you)
				}
			}
		}
		const a = this.handAim;
		if (!a) { this.hoverAim(dt, spots, busy, box); return jump; }
		this.endHover();
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
		line.material.opacity = HOVER.solid;
		const floor = hit ? xr.findFloor(hit.point, 0.01) : null;
		a.spot = floor ? this.landing(floor) : null;
		if (a.spot) spots[a.c.index] = a.spot;
		// The last moments' landings (letting go uses the one LOOK_BACK ago).
		a.age += dt;
		a.past.push({ age: a.age, spot: a.spot });
		while (a.past.length > 2 && a.age - a.past[1].age > LOOK_BACK) a.past.shift();
		return jump;
	}

	/** The landing a hand's aim showed `back` seconds ago (or its oldest kept), else now's. */
	spotBefore(a, back) {
		const want = a.age - back;
		let best = null;
		for (const e of a.past) if (e.age <= want + 1e-6) best = e;
		return (best ?? a.past[0])?.spot ?? a.spot;
	}

	/**
	 * After zooming: the model glides onto the nearest round scale (1:50, ...
	 * one the zoom range allows), with a light tick in the hand that zoomed.
	 */
	settleZoom(c) {
		const xr = this.xr;
		const ratio = 1 / (xr.baseScale * this.doll.zoom);
		const allowed = ROUND_SCALES.filter((n) => { const z = 1 / (xr.baseScale * n); return z >= ZOOM_MIN - 1e-9 && z <= ZOOM_MAX + 1e-9; });
		if (!allowed.length) return;
		const target = allowed.reduce((a, b) => (Math.abs(Math.log(b / ratio)) < Math.abs(Math.log(a / ratio)) ? b : a));
		const from = this.doll.zoom, to = 1 / (xr.baseScale * target);
		if (Math.abs(to - from) < 1e-6) return;
		this.settling = xr.tweens.start({
			duration: 0.25, ease: ease.out,
			step: (k) => { this.doll.zoom = from + (to - from) * k; this.apply(); },
			done: () => { this.settling = null; xr.haptics.play(c, 'tick'); xr.sound.play('tick'); },
		});
	}
}

/**
 * The house in a model (model space; the interaction harmony's conflict 13):
 * the footprint of its covered rooms (the ceilings layer: the deck, the drive
 * and the garden have none), from the bottom of the model up to the highest
 * wall, floor, ceiling or piece (a roof) standing on that footprint. Trees,
 * paving and lawn outside it don't count. A model without ceilings (OBJ, GLB,
 * or a plan with no covered room): its whole box.
 */
export function houseBounds(model) {
	const all = model?.bounds;
	const ceilings = model?.layers?.ceilings;
	if (!all || !model.plan || !ceilings?.children.length) return all?.clone() ?? null;
	const foot = new THREE.Box3();
	for (const m of ceilings.children) { m.geometry.computeBoundingBox(); foot.union(m.geometry.boundingBox); }
	if (foot.isEmpty()) return all.clone();
	const E = 0.01, out = new THREE.Box3(new THREE.Vector3(foot.min.x, all.min.y, foot.min.z), new THREE.Vector3(foot.max.x, foot.max.y, foot.max.z));
	for (const name of ['walls', 'floors', 'main']) for (const m of model.layers[name]?.children ?? []) {
		const pos = m.geometry?.attributes?.position;
		if (!pos) continue;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i), z = pos.getZ(i);
			if (x >= foot.min.x - E && x <= foot.max.x + E && z >= foot.min.z - E && z <= foot.max.z + E) out.max.y = Math.max(out.max.y, pos.getY(i));
		}
	}
	return out;
}
