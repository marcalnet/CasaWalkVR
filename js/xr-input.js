// XR controllers: laser rays, simple controller bodies, and per-frame
// button/thumbstick state with press/release edges.
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
// Bare hands (milestone C0.1, a stop-gap until hands are supported in C0):
// the Quest turns a pinch into a "select" of a hand input source whose
// gamepad looks like a controller's (the pinch on button 0). Such sources are
// not controllers here: their buttons are never read, they get no laser or
// body, and handsOnly() tells the UI to ask for the controllers.

import * as THREE from 'three';

const DEADZONE = 0.2;
const RAY_LENGTH = 5;

export class XRInput {
	constructor(renderer, rig) {
		this.renderer = renderer;
		this.hands = { left: null, right: null };
		this.controllers = [];
		const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
		const bodyGeo = new THREE.BoxGeometry(0.035, 0.03, 0.11).translate(0, -0.005, 0.03);
		const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b3036 });

		for (let i = 0; i < 2; i++) {
			const ray = renderer.xr.getController(i); // target-ray space
			const grip = renderer.xr.getControllerGrip(i); // where the hand holds it
			rig.add(ray, grip);

			const line = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
			line.scale.z = RAY_LENGTH;
			line.visible = false;
			ray.add(line);
			const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd9822b }));
			dot.visible = false;
			ray.add(dot);
			const body = new THREE.Mesh(bodyGeo, bodyMat);
			grip.add(body);

			const c = { index: i, ray, grip, line, dot, body, source: null, handedness: null, isController: false, isHand: false, state: emptyState(), claim: { trigger: null, grip: null, a: null, b: null, stickPress: null } };
			ray.addEventListener('connected', (e) => {
				c.source = e.data;
				c.handedness = e.data.handedness;
				c.isHand = isHandSource(e.data);
				c.isController = !c.isHand;
				line.visible = c.isController;
				body.visible = c.isController;
				c.state = emptyState();
				if (c.isController) this.hands[c.handedness] = c;
			});
			ray.addEventListener('disconnected', () => {
				if (this.hands[c.handedness] === c) this.hands[c.handedness] = null;
				c.source = null;
				c.isController = c.isHand = false;
				c.state = emptyState();
				line.visible = false;
				dot.visible = false;
			});
			this.controllers.push(c);
		}
		this._m = new THREE.Matrix4();
	}

	/** Reads gamepads; call once per frame. */
	update() {
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
		}
	}

	/** Active controllers (connected, with a gamepad). */
	active() { return this.controllers.filter((c) => c.source && c.isController); }

	/** True while the Quest reports bare hands and no controller (the "Pick up your controllers" note). */
	handsOnly() { return this.controllers.some((c) => c.source && c.isHand) && this.active().length === 0; }

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
		c.line.visible = v && c.isController;
		if (!v) c.dot.visible = false;
	}

	setVisible(v) {
		for (const c of this.controllers) { c.ray.visible = v; c.grip.visible = v; c.body.visible = v && c.isController; }
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
const OK_COLOR = new THREE.Color(0x3d8bfd), BAD_COLOR = new THREE.Color(0xe5484d);

export class TeleportArc {
	constructor(scene) {
		this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), DOTS);
		this.dots.frustumCulled = false;
		this.dots.name = 'teleport-arc';
		const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false });
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2), ringMat);
		const disc = new THREE.Mesh(new THREE.CircleGeometry(0.22, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false }));
		this.ring.add(disc);
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
	 */
	update(origin, dir, hitSegment, { ceiling } = {}) {
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
		const color = valid ? OK_COLOR : BAD_COLOR;

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
			this.ring.position.copy(hit.point).addScaledVector(hit.normal, 0.01);
			this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.normal);
			this.ring.material.color.copy(color);
			this.ring.children[0].material.color.copy(color);
		}
		return { valid, point: hit ? hit.point.clone() : null };
	}

	hide() {
		this.dots.visible = false;
		this.ring.visible = false;
	}
}
