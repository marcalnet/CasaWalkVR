// XR controllers: laser rays, the controllers drawn (the real model for the
// device, js/controller-model.js, or plain bars until it loads or if the
// device has none), and per-frame button/thumbstick state with press/release edges.
//
// Quest controllers use the WebXR "xr-standard" gamepad mapping:
//   buttons[0] trigger, [1] grip (squeeze), [3] thumbstick press,
//   [4] A (right) / X (left), [5] B (right) / Y (left)
//   axes[2], axes[3] thumbstick x / y (y is negative when pushed forward)
// TeleportArc draws the parabolic teleport arc and its landing ring.
//
// Claims: each frame, every controller's c.claim says who owns its trigger,
// grip and buttons this frame: null (free: the mode uses it), 'ui' (the laser
// is on the menu or an orb) or 'tool' (a hand-held tool, milestones C-F). They
// are taken in this order: a held tool, then the UI, then the mode, which
// only uses what is still free. Sticks are never claimed. Cleared by update().
//
// Bare hands: the Quest turns a pinch into a "select" of a hand input source
// whose gamepad looks like a controller's (the pinch on button 0). Such
// sources are not controllers here: their buttons are never read (a pinch
// never clicks anything), they get no laser or body. With joints (the
// session asks for hand tracking) a hand presses keys with its fingertip
// (js/touch.js) and wears the orb on c.wrist; without joints, handsOnly()
// tells the UI to ask for the controllers (C0.1).
//
// Touch (milestone C0 groundwork, read by nothing yet): every entry also has
// c.touch, the same for a hand and a controller, so the touch menus and the
// tools of C0 can treat them alike:
//   kind     'hand', 'controller' or null (nothing connected)
//   tracked  false while the headset has lost the hand (or nothing is there)
//   tip      the poke point in world space: the index fingertip, or a point
//            just in front of a controller (c.tipOffset in its grip space:
//            the real model's nose once measured, TIP_OFFSET before)
//   radius   how big the poke point is (the fingertip joint's radius)
//   select   { value 0..1, held, down, up, lost }: a pinch for a hand (thumb
//            and index tips together), the trigger for a controller. A pinch
//            starts below PINCH_ON and ends above PINCH_OFF, so a shaky pinch
//            never flickers. down/up are this frame's edges; when tracking is
//            lost mid-pinch, held ends with no up and lost = true (until the
//            next pinch starts): a hand that vanishes never clicks. A hand
//            (or controller) found again with the pinch (trigger) already
//            closed gives no down until it has been seen open.
// joint(c, name, out) gives any hand joint's world position (WebXR joint
// names, such as 'wrist' or 'index-finger-tip').
//
// A hand reported but not seen (build 215's A1 and A2): the Quest can go on
// reporting a hand it does not see, its joints frozen at their last pose
// (often the pinch that pressed Enter VR). Drawn, it floated where the real
// hand was not: in the face once inside, wearing the orb and the tools, its
// aim ray pointing at the ceiling. Real tracking never holds a joint still to
// the hundredth of a millimetre, so a bare hand counts as tracked only once
// its wrist has been seen moving, and stops counting when it holds perfectly
// still (in the room, or with the head) for STALE.AFTER: see staleStep().
//
// Gestures (C0.4): readGestures() runs each bare hand's gesture reader
// (js/gestures.js: the pinch-and-hold teleport, the wrist flick, the closed hand) and
// leaves this frame's events on c.gestures (an array) and the reader on
// c.gesture. Controllers have c.gestures = [].

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOUCH } from './touch.js';
import { KEY } from './theme.js';
import { HandGestures, JOINTS } from './gestures.js';
import { loadControllerModel, LOOK } from './controller-model.js';

const DEADZONE = 0.2;
const REST_MOVE = 0.002, REST_TURN = THREE.MathUtils.degToRad(1.5), REST_AFTER = 1.5; // a controller this still (m, rad) this long (s) while a bare hand is tracked has been put down
const RAY_LENGTH = 5;
const NO_EVENTS = Object.freeze([]);
export const PINCH_ON = 0.015; // metres between thumb and index tips: a pinch starts
export const PINCH_OFF = 0.03; // and ends (more than PINCH_ON: hysteresis)
const PINCH_OPEN = 0.07; // select.value is 0 from here, 1 at PINCH_ON
const TIP_OFFSET = new THREE.Vector3(0, -0.01, -0.045); // a controller's poke point, in its grip space
const TIP_RADIUS = TOUCH.RADIUS; // the poke point's size, fingertip and controller tip alike
const WRIST_ORB = new THREE.Vector3(0, 0.035, 0.01); // the orb over the back of a bare wrist, in the wrist joint's space
/** A frozen hand (see the top of the file): its wrist within MOVE (m) of where it was, in the room or relative to the head, for AFTER s. */
export const STALE = { MOVE: 1e-5, AFTER: 0.3 };

export class XRInput {
	constructor(renderer, rig) {
		this.renderer = renderer;
		this.hands = { left: null, right: null };
		this.controllers = [];
		const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
		const bodyGeo = new THREE.BoxGeometry(0.035, 0.03, 0.11).translate(0, -0.005, 0.03);
		const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b3036 });
		const nubGeo = new THREE.CylinderGeometry(0.004, 0.005, 0.024, 10), nubMat = new THREE.MeshLambertMaterial({ color: KEY.nub });
		const nubEndGeo = new THREE.SphereGeometry(TIP_RADIUS * 0.7, 12, 8), nubEndMat = new THREE.MeshBasicMaterial({ color: KEY.nubEnd });

		for (let i = 0; i < 2; i++) {
			const ray = renderer.xr.getController(i); // target-ray space
			const grip = renderer.xr.getControllerGrip(i); // where the hand holds it
			const hand = renderer.xr.getHand(i); // hand joints (three.js fills hand.joints while a hand is tracked)
			rig.add(ray, grip, hand);

			const line = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
			line.scale.z = RAY_LENGTH;
			line.visible = false;
			ray.add(line);
			const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd9822b }));
			dot.visible = false;
			ray.add(dot);
			const body = new THREE.Mesh(bodyGeo, bodyMat);
			grip.add(body);
			// The tip nub that presses keys by touch (milestone C0.2): a small rod with an orange end.
			const nub = new THREE.Mesh(nubGeo, nubMat);
			nub.position.copy(TIP_OFFSET).add(new THREE.Vector3(0, 0, 0.012));
			nub.rotation.x = Math.PI / 2;
			const nubEnd = new THREE.Mesh(nubEndGeo, nubEndMat);
			nubEnd.position.copy(TIP_OFFSET);
			body.add(nub);
			grip.add(nubEnd); // (on the grip: it stays with the real model, at its nose)
			// Where a bare hand wears the orb: follows the wrist joint (controllers wear it on the grip).
			const wrist = new THREE.Group();
			wrist.name = 'wrist';
			rig.add(wrist);

			const c = { index: i, ray, grip, hand, wrist, line, dot, body, nubEnd, model: null, tipOffset: TIP_OFFSET.clone(), touch: emptyTouch(), gesture: null, gestures: [], source: null, handedness: null, isController: false, isHand: false, state: emptyState(), claim: { trigger: null, grip: null, a: null, b: null, stickPress: null } };
			ray.addEventListener('connected', (e) => {
				c.source = e.data;
				c.handedness = e.data.handedness;
				c.isHand = isHandSource(e.data);
				c.isController = !c.isHand;
				line.visible = c.isController;
				body.visible = c.isController;
				nubEnd.visible = c.isController;
				this.dropModel(c);
				if (c.isController) this.loadModel(c, e.data);
				c.state = emptyState();
				c.touch = emptyTouch();
				c.stale = freshStale(); // (a hand just connected counts once seen moving)
				c.gesture = c.isHand ? new HandGestures(c.handedness) : null;
				c.gestures = [];
				if (c.isController) this.hands[c.handedness] = c;
			});
			ray.addEventListener('disconnected', () => {
				if (this.hands[c.handedness] === c) this.hands[c.handedness] = null;
				c.source = null;
				c.isController = c.isHand = false;
				c.state = emptyState();
				c.touch = emptyTouch(c.touch.select.held); // a hand that goes away mid-pinch never clicks
				line.visible = false;
				dot.visible = false;
				nubEnd.visible = false;
				this.dropModel(c);
			});
			this.controllers.push(c);
		}
		this._m = new THREE.Matrix4();
	}

	/** Reads gamepads; call once per frame. head: the head pose this frame (rig space: the camera's matrix), for frozen hands. */
	update(head = null) {
		this._headInv = head ? (this._headInv ?? new THREE.Matrix4()).copy(head).invert() : null;
		for (const c of this.controllers) {
			const gp = c.isController ? c.source?.gamepad : null; // a hand's pinch is never read
			const prev = c.state;
			const s = emptyState();
			if (gp) {
				const pressed = (i) => !!gp.buttons[i]?.pressed;
				s.trigger = pressed(0);
				s.grip = pressed(1);
				s.stickPress = pressed(3);
				s.a = pressed(4); // A or X
				s.b = pressed(5); // B or Y
				const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
				const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
				s.stick.set(Math.abs(ax) > DEADZONE ? ax : 0, Math.abs(ay) > DEADZONE ? ay : 0);
			}
			for (const k of ['trigger', 'grip', 'stickPress', 'a', 'b']) {
				s.down[k] = s[k] && !prev[k];
				s.up[k] = !s[k] && prev[k];
			}
			c.state = s;
			const k = c.claim;
			k.trigger = k.grip = k.a = k.b = k.stickPress = null;
			this.updateTouch(c);
		}
	}

	/** The touch state (poke point and select) of one entry; see the top of this file. */
	updateTouch(c) {
		const t = c.touch, sel = t.select, was = sel.held;
		sel.down = sel.up = false;
		t.kind = c.isHand ? 'hand' : c.isController ? 'controller' : null;
		let held = false;
		if (c.isHand) {
			const tip = c.hand.joints['index-finger-tip'], thumb = c.hand.joints['thumb-tip'], wrist = c.hand.joints.wrist;
			t.tracked = !!(c.hand.visible && tip?.visible && thumb?.visible && wrist?.visible);
			if (t.tracked) {
				// (Rig space is the headset's own: a hand the headset froze holds still here, or with the head.)
				const atHead = this._headInv ? _w.copy(wrist.position).applyMatrix4(this._headInv) : null;
				t.tracked = staleStep(c.stale ??= freshStale(), wrist.position, atHead, performance.now() / 1000);
			}
			if (t.tracked) {
				// The orb's anchor follows the wrist joint (its +Y is out of the back of the hand).
				c.wrist.position.copy(wrist.position);
				c.wrist.quaternion.copy(wrist.quaternion);
				c.hand.updateMatrixWorld(true);
				t.tip.setFromMatrixPosition(tip.matrixWorld);
				_v.setFromMatrixPosition(thumb.matrixWorld);
				const d = t.tip.distanceTo(_v) / c.hand.matrixWorld.getMaxScaleOnAxis(); // in real metres, whatever the rig's scale
				t.radius = TIP_RADIUS;
				sel.value = pinchValue(d);
				held = nextPinch(was, d);
			}
		} else if (c.isController) {
			c.grip.updateMatrixWorld(true);
			this.updateResting(c);
			t.tracked = c.grip.visible !== false && !c.resting;
			t.tip.copy(c.tipOffset).applyMatrix4(c.grip.matrixWorld);
			t.radius = TIP_RADIUS;
			sel.value = c.source?.gamepad?.buttons[0]?.value ?? (c.state.trigger ? 1 : 0);
			held = c.state.trigger;
		} else t.tracked = false;
		if (!t.tracked) {
			// Lost: a pinch in progress ends without a click.
			if (was) sel.lost = true;
			sel.held = false;
			sel.value = 0;
			sel.blocked = true; // found again: no new press until seen let go
			return;
		}
		// Found again after a loss (or a switch): a pinch or trigger already closed
		// is not a new press; it counts only once it has been seen open.
		if (sel.blocked) {
			if (held) { sel.held = false; return; }
			sel.blocked = false;
		}
		sel.held = held;
		sel.down = held && !was;
		sel.up = !held && was;
		if (sel.down) sel.lost = false;
	}

	/** Entries with a tracked poke point (hands and controllers alike). */
	touches() { return this.controllers.filter((c) => c.touch.tracked); }

	/** World position of a hand joint (WebXR name), or null if not tracked. */
	joint(c, name, out = new THREE.Vector3()) {
		const j = c.isHand ? c.hand.joints[name] : null;
		if (!j?.visible || !c.hand.visible) return null;
		c.hand.updateMatrixWorld(true);
		return out.setFromMatrixPosition(j.matrixWorld);
	}

	/** Runs each bare hand's gesture reader for this frame (see the top of the file). head: the eyes' world position. */
	readGestures(dt, head = null, headYaw = 0) {
		this._gh = this._gh ?? [];
		this._gh.length = 0;
		for (const c of this.controllers) {
			if (!c.gesture) { c.gestures = NO_EVENTS; continue; }
			this._gh.push(c);
			let joints = null;
			if (c.touch.tracked && c.hand.visible) {
				// (The hand's matrices once, then each joint into a reused vector: nothing allocated per frame.)
				c.hand.updateMatrixWorld(true);
				joints = c._joints ??= {};
				for (const n of JOINTS) {
					const j = c.hand.joints[n];
					if (!j?.visible) { joints = null; break; }
					(joints[n] ??= new THREE.Vector3()).setFromMatrixPosition(j.matrixWorld);
				}
			}
			c.gestures = c.gesture.step(joints, dt, head, headYaw);
		}
	}

	/** Bare hands with gesture readers (tracked or not), as of this frame's readGestures(). */
	gestureHands() { return this._gh ?? this.controllers.filter((c) => c.gesture); }

	/** Active controllers (connected, with a gamepad, not put down: updateResting). */
	active() { return this.controllers.filter((c) => c.source && c.isController && !c.resting); }

	/**
	 * A controller put down while a bare hand is tracked (build 120's B3: the
	 * Quest still reports it for a while; its laser pointed at the ceiling and
	 * the orb floated where it lay): still within 2 mm and 1.5° for 1.5 s (a held one always drifts more), it
	 * counts as resting (no laser, no orb, not active) until it moves.
	 */
	updateResting(c) {
		const now = performance.now() / 1000, r = c.rest ??= { p: new THREE.Vector3(), q: new THREE.Quaternion(), since: now };
		const p = _v.setFromMatrixPosition(c.grip.matrixWorld), q = _q.setFromRotationMatrix(c.grip.matrixWorld);
		const scale = c.grip.matrixWorld.getMaxScaleOnAxis() || 1; // (real metres, whatever the rig's scale)
		if (p.distanceTo(r.p) / scale > REST_MOVE || r.q.angleTo(q) > REST_TURN || c.state.trigger || c.state.grip || c.state.stick.lengthSq() > 0) {
			r.p.copy(p); r.q.copy(q); r.since = now;
		}
		const handIn = this.controllers.some((h) => h.isHand && h.touch.tracked);
		const was = c.resting;
		c.resting = handIn && now - r.since > REST_AFTER;
		if (c.resting && !was) { c.line.visible = false; c.dot.visible = false; }
	}

	/**
	 * True while the Quest reports bare hands without joints (hand tracking not
	 * given) and no controller: the "Pick up your controllers" note (C0.1).
	 */
	handsOnly() {
		const hands = this.controllers.filter((c) => c.source && c.isHand);
		return hands.length > 0 && hands.every((c) => !c.source.hand) && this.active().length === 0;
	}

	/** Entries that wear an orb: controllers, and bare hands with tracked joints. */
	wearers() { return this.controllers.filter((c) => c.source && ((c.isController && !c.resting) || (c.isHand && c.touch.tracked))); }

	/** Where an entry wears the orb: a controller's grip, or a bare hand's wrist anchor. */
	wristOf(c) { return c.isHand ? c.wrist : c.grip; }

	/** Sets a raycaster from a controller's laser. */
	setRaycaster(c, raycaster) {
		c.ray.updateMatrixWorld(true);
		this._m.identity().extractRotation(c.ray.matrixWorld);
		raycaster.ray.origin.setFromMatrixPosition(c.ray.matrixWorld);
		raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._m).normalize();
		raycaster.far = RAY_LENGTH;
	}

	/** Shortens a laser to its hit distance and shows the hit dot (or hides it). */
	showHit(c, distance) {
		if (distance == null) {
			c.line.scale.z = RAY_LENGTH;
			c.dot.visible = false;
		} else {
			c.line.scale.z = distance;
			c.dot.position.set(0, 0, -distance);
			c.dot.visible = true;
		}
	}

	/** Controller world position and yaw (rotation about the vertical axis). */
	pose(c, outPos) {
		c.grip.updateMatrixWorld(true);
		outPos.setFromMatrixPosition(c.grip.matrixWorld);
		return yawOf(c.grip.matrixWorld);
	}

	/** Shows or hides one controller's laser (walk mode hides it unless pointing at the menu). */
	setLaser(c, v) {
		c.line.visible = v && c.isController && !c.resting;
		if (!v) c.dot.visible = false;
	}

	setVisible(v) {
		for (const c of this.controllers) { c.ray.visible = v; c.grip.visible = v; c.body.visible = v && c.isController && !c.model; }
	}

	/** Loads the real controller for a source; it replaces the bars when it arrives (if that source is still there). */
	loadModel(c, source) {
		loadControllerModel(source).then((m) => {
			if (!m || c.source !== source || !c.isController) return;
			c.model = m;
			m.opacity = 0; // (it fades in: the bars go at once, the model comes in LOOK.FADE)
			m.apply();
			c.grip.add(m.root);
			c.body.visible = false;
		});
	}

	/** Back to the bars (a new source, or none). */
	dropModel(c) {
		if (c.model) c.model.root.removeFromParent();
		c.model = null;
		c.tipOffset.copy(TIP_OFFSET);
		c.nubEnd.position.copy(TIP_OFFSET);
	}

	/**
	 * Once a frame, after the tools: the real controllers' buttons move, and
	 * their look follows what they do (next-build asks §6). holder: the entry
	 * holding a tool (or null); dialOpen: its dial is open (full again);
	 * buttons: the held tool's buttons, which glow. A controller put down
	 * (updateResting) fades out, the bare hand drawn instead.
	 */
	updateModels(dt, holder = null, dialOpen = false, buttons = []) {
		for (const c of this.controllers) {
			const m = c.model;
			if (!m) continue;
			if (m.tip === undefined && c.ray.visible && c.grip.visible) {
				c.ray.updateMatrixWorld(true);
				const rel = this._m.copy(c.grip.matrixWorld).invert().multiply(c.ray.matrixWorld); // (the rig cancels: real metres)
				m.measureTip(rel);
			}
			if (m.tip !== undefined) {
				c.tipOffset.copy(m.tip ?? TIP_OFFSET);
				c.nubEnd.position.copy(c.tipOffset);
			}
			c.nubEnd.visible = !c.resting; // (put down: the bare hand is drawn instead)
			const held = holder === c;
			m.setLook(c.resting ? 0 : held && !dialOpen ? LOOK.FADED : 1, held ? buttons : []);
			m.update(dt);
		}
	}
}

/**
 * Whether an XRInputSource is a bare hand (or a gaze or a transient pinch, as
 * on Apple Vision Pro), not a controller: it has hand joints, a hand profile,
 * no gamepad, no thumbstick axes, or a ray that is not a tracked pointer.
 * Quest Browser reports hands with an xr-standard gamepad (the pinch on
 * button 0) but no axes, and profiles such as 'oculus-hand', 'generic-hand'.
 */
export function isHandSource(source) {
	if (!source) return false;
	if (source.hand) return true;
	if ((source.profiles || []).some((p) => /hand/i.test(p))) return true;
	if (source.targetRayMode && source.targetRayMode !== 'tracked-pointer') return true;
	const gp = source.gamepad;
	return !gp || (gp.axes?.length ?? 0) === 0;
}

export { WRIST_ORB };

/** A frozen-hand record that has seen nothing yet (staleStep). */
export function freshStale() {
	return { room: null, head: null, since: 0, live: false };
}

/**
 * One frame of a bare hand's frozen check (see the top of the file). s: the
 * hand's record (freshStale()); room: the wrist in rig space; head: the wrist
 * relative to the head (or null); now: seconds. Returns whether the hand is
 * live: it has moved since it was first reported, and not held perfectly
 * still, in the room or with the head, for STALE.AFTER since.
 */
export function staleStep(s, room, head, now) {
	const still = (a, b) => !!a && a.distanceTo(b) <= STALE.MOVE;
	if (!s.room) { s.room = room.clone(); s.head = head?.clone() ?? null; s.since = now; return s.live; }
	if (still(s.room, room) || (head && still(s.head, head))) {
		if (now - s.since >= STALE.AFTER) s.live = false;
	} else {
		s.room.copy(room);
		if (head) (s.head ??= new THREE.Vector3()).copy(head);
		s.since = now;
		s.live = true;
	}
	return s.live;
}

/** Pinch with hysteresis: held from PINCH_ON, until the tips are more than PINCH_OFF apart. */
export function nextPinch(held, distance) {
	return held ? distance <= PINCH_OFF : distance <= PINCH_ON;
}

/** How closed a pinch is, 0 (open, PINCH_OPEN apart or more) to 1 (PINCH_ON). */
export function pinchValue(distance) {
	return THREE.MathUtils.clamp((PINCH_OPEN - distance) / (PINCH_OPEN - PINCH_ON), 0, 1);
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

function emptyTouch(lost = false) {
	return { kind: null, tracked: false, tip: new THREE.Vector3(), radius: TIP_RADIUS, select: { value: 0, held: false, down: false, up: false, lost, blocked: true } };
}

function emptyState() {
	return { trigger: false, grip: false, stickPress: false, a: false, b: false, stick: new THREE.Vector2(), down: {}, up: {} };
}

const _fwd = new THREE.Vector3();
/** Yaw (like Object3D.rotation.y) of a world matrix's forward (-Z) direction. */
export function yawOf(matrixWorld) {
	_fwd.set(0, 0, -1).transformDirection(matrixWorld);
	return Math.atan2(-_fwd.x, -_fwd.z);
}

// ---------------------------------------------------------------------------
// Teleport arc (SPEC.md, walk mode): a parabola from the controller, drawn as
// a row of small dots (one instanced draw call), with a landing ring that is
// blue on walkable floor (normal.y > 0.7) and red elsewhere.
// ---------------------------------------------------------------------------

const ARC_SPEED = 7; // m/s launch speed
const GRAVITY = 9.8;
const ARC_STEP = 0.03; // s per segment
const ARC_STEPS = 60; // up to 1.8 s of flight
const DOTS = 40;
const OK_COLOR = new THREE.Color(0x3d8bfd), BAD_COLOR = new THREE.Color(0xe5484d), PENDING_COLOR = new THREE.Color(0xffffff);

const UP_Y = new THREE.Vector3(0, 1, 0);

export class TeleportArc {
	constructor(scene) {
		this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), DOTS);
		this.dots.frustumCulled = false;
		this.dots.name = 'teleport-arc';
		const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false });
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2), ringMat);
		const disc = new THREE.Mesh(new THREE.CircleGeometry(0.22, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false }));
		this.ring.add(disc);
		// An × in the ring where you can't go (red), so it never reads as a landing by colour alone.
		const bar = new THREE.PlaneGeometry(0.34, 0.035).rotateX(-Math.PI / 2);
		const cross = mergeGeometries([bar.clone().rotateY(Math.PI / 4), bar.rotateY(-Math.PI / 4)]);
		this.cross = new THREE.Mesh(cross, new THREE.MeshBasicMaterial({ color: BAD_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
		this.cross.position.y = 0.002;
		this.cross.renderOrder = 6;
		this.cross.name = 'teleport-cross';
		this.ring.add(this.cross);
		this.ring.renderOrder = 5;
		disc.renderOrder = 5;
		this.ring.name = 'teleport-ring';
		this.points = [];
		this.hide();
		scene.add(this.dots, this.ring);
		this._a = new THREE.Vector3();
		this._b = new THREE.Vector3();
		this._m = new THREE.Matrix4();
	}

	/**
	 * Traces the arc from `origin` along `dir` and draws it.
	 * hitSegment(a, b) returns { point, normal (world), valid? } for the first
	 * hit between a and b, or null (valid defaults to an upward-facing normal). Returns { valid, point } (point may be null).
	 * snap(point): a better landing for a valid one (a hotspot), or null. pending: a valid
	 * landing shows white, not yet blue (a bare hand's aim settling).
	 */
	update(origin, dir, hitSegment, { ceiling, snap, pending = false } = {}) {
		const v = dir.clone().normalize().multiplyScalar(ARC_SPEED);
		// ceiling (world y): the arc never rises above it, so it passes under
		// door frames instead of hitting the wall over a doorway. Aiming higher
		// than that allows keeps the steepest launch that fits (the longest jump).
		if (ceiling !== undefined) {
			const vyMax = Math.sqrt(2 * GRAVITY * Math.max(0.02, ceiling - origin.y));
			const flat = Math.hypot(v.x, v.z);
			if (v.y > vyMax && vyMax < ARC_SPEED && flat > 1e-6) {
				const k = Math.sqrt(ARC_SPEED * ARC_SPEED - vyMax * vyMax) / flat;
				v.set(v.x * k, vyMax, v.z * k);
			}
		}
		const pts = [origin.clone()];
		let hit = null;
		const a = this._a.copy(origin), b = this._b;
		for (let i = 1; i <= ARC_STEPS && !hit; i++) {
			const t = i * ARC_STEP;
			b.set(origin.x + v.x * t, origin.y + v.y * t - 0.5 * GRAVITY * t * t, origin.z + v.z * t);
			hit = hitSegment(a, b);
			pts.push(hit ? hit.point.clone() : b.clone());
			a.copy(b);
		}
		this.points = pts;
		const valid = !!hit && (hit.valid ?? hit.normal.y > 0.7);
		const color = valid ? (pending ? PENDING_COLOR : OK_COLOR) : BAD_COLOR;
		const landing = hit?.land ?? hit?.point; // (where you will land: beside what you can't stand on, js/landing.js; the arc ends at the hit)
		const snapped = valid && snap ? snap(landing) : null; // (the ring moves to a hotspot; the arc stays where you point)

		// Dots evenly spaced along the polyline.
		const lengths = [0];
		for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
		const total = lengths[lengths.length - 1];
		let seg = 1;
		for (let k = 0; k < DOTS; k++) {
			const d = (k / (DOTS - 1)) * total;
			while (seg < pts.length - 1 && lengths[seg] < d) seg++;
			const f = (d - lengths[seg - 1]) / Math.max(1e-6, lengths[seg] - lengths[seg - 1]);
			this._m.makeTranslation(this._a.lerpVectors(pts[seg - 1], pts[seg], Math.min(1, Math.max(0, f))));
			this.dots.setMatrixAt(k, this._m);
		}
		this.dots.instanceMatrix.needsUpdate = true;
		this.dots.material.color.copy(color);
		this.dots.visible = true;

		this.ring.visible = !!hit;
		if (hit) {
			const flat = snapped || hit.land;
			this.ring.position.copy(snapped ?? landing).addScaledVector(flat ? UP_Y : hit.normal, 0.01);
			this.ring.quaternion.setFromUnitVectors(UP_Y, flat ? UP_Y : hit.normal);
			this.ring.material.color.copy(color);
			this.ring.children[0].material.color.copy(color);
			this.cross.visible = !valid;
		}
		return { valid, point: hit ? (snapped ?? landing).clone() : null, snapped: !!snapped };
	}

	hide() {
		this.dots.visible = false;
		this.ring.visible = false;
	}
}
