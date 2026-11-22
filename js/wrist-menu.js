// The wrist menu (milestone C0.3; SPEC.md C0 "Hands and touch" and "Layers").
//
// One orb on one wrist: the right one, or the left when the tool fan is set
// to the right hand (the fan takes the other hand, milestone C). Touching the
// orb with the other index (or the other controller's tip), pressing A (X
// when swapped) or pointing at it and pulling the trigger springs out four
// keys in a cross around it, laid out as you see them (view space: right
// stays on your right whichever wrist wears it and however it is turned):
//
//            Settings
//   ← Back     orb     Walk in →        (inside: a flat "Inside" plate
//              Help                      with the room's name)
//
// Left to right is forward: the blue doors go one layer back (outline, left)
// or one layer in (filled, right); no key skips a layer. Keys are pressed by
// touch (js/touch.js) or by another controller's laser; the hand wearing the
// menu cannot press it. While a fingertip is within 10 cm the cross holds
// still in the world, so the wearing hand's jitter cannot move a key under
// the finger. It closes after a key, when the orb is touched again, with B/Y,
// or (opened by a bare hand) when the wrist is out of view for 0.4 s; opened
// by a controller it stays pinned until a key, B/Y or A again.

import * as THREE from 'three';
import { WRIST_ORB } from './xr-input.js';
import { TOUCH, touchState, stepTouch, reset as resetTouch, ringSize } from './touch.js';
import { WRIST, DOOR, COLOURS, KEY, FONT } from './theme.js';
import { ease } from './tween.js';

export const ORB_ON_GRIP = new THREE.Vector3(0, 0.035, 0.115); // the orb on a controller, in its grip space
const ORB_SCALE = 0.5; // the orb drawn at 2.4 cm on the wrist
const ORB_TIP_TOUCH = 0.03, ORB_TIP_RELEASE = 0.07; // a fingertip or controller tip touching the orb
const ORB_GRIP_TOUCH = 0.08, ORB_GRIP_RELEASE = 0.14; // or a whole controller reaching into it
const FREEZE = 0.1; // a fingertip this close: the cross holds still
const CATCH_UP = 0.07; // seconds (time constant): how quickly it follows the wrist again
const OUT_OF_VIEW = 0.4; // seconds with the wrist out of view before it closes
const VIEW_ANGLE = THREE.MathUtils.degToRad(50); // "in view": within this of where the head looks
const SLOTS = { up: [0, 1], right: [1, 0], down: [0, -1], left: [-1, 0] };
const ORDER = ['up', 'right', 'down', 'left']; // the keys spring out clockwise from the top
const PX = 256; // key canvas size

/** What each slot holds at each layer. */
export function keysFor(mode, roomName = '') {
	return {
		up: { id: 'settings', look: 'plain', icon: 'settings', label: 'Settings' },
		right: mode === 'walk'
			? { id: null, look: 'flat', label: 'Inside', caption: roomName } // as deep as it goes: you are here
			: { id: 'in', look: 'filled', icon: 'in', label: 'Walk in →', caption: 'Inside the home' },
		down: { id: 'help', look: 'plain', icon: 'help', label: 'Help' },
		left: { id: 'back', look: 'outline', icon: 'back', label: '← Back', caption: mode === 'walk' ? 'Scale model' : 'Leave VR' },
	};
}

export class WristMenu {
	constructor(xr) {
		this.xr = xr;
		this.orb = makeOrb();
		this.orb.group.scale.setScalar(ORB_SCALE);
		this.side = 'right';
		this.open = false;
		this.pinned = false; // opened by a controller: stays until a key, B/Y or A again
		this.openT = 0;
		this.outT = 0;
		this.frozen = false;
		this.cross = new THREE.Group();
		this.cross.name = 'wrist-menu';
		this.cross.visible = false;
		this.atlas = typeof Image !== 'undefined' ? new Image() : null;
		this.keys = {};
		for (const slot of ORDER) this.keys[slot] = makeKey(slot, this.atlas);
		this.cross.add(...Object.values(this.keys).map((k) => k.group));
		if (this.atlas) {
			this.atlas.onload = () => this.redraw(true);
			this.atlas.src = WRIST.icons;
		}
		// Kalam (the hand-lettered labels) may still be loading: draw again when it is there.
		globalThis.document?.fonts?.load?.(`700 40px ${WRIST.labelFont}`).then(() => this.redraw(true)).catch(() => {});
		this.touches = []; // per input entry and key: touch states
		this.rings = []; // per input entry: the ring under its fingertip
		this.lastClick = [];
		xr.scene.add(this.cross);
		xr.hideFromPhotos(this.cross);
		this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._quat = new THREE.Quaternion();
		this.setSide();
	}

	/** The wrist that wears the menu: the hand that doesn't hold the tool fan. */
	setSide() {
		this.side = this.xr.toolFan === 'right' ? 'left' : 'right';
		this.close();
	}

	/** The input entry wearing the menu (a controller, or a tracked bare hand), or null. */
	get wearer() { return this.orb.holder; }

	/** The keys' content for this layer, redrawn when it changes. */
	redraw(force = false) {
		const spec = keysFor(this.xr.mode, this.roomName ?? '');
		for (const slot of ORDER) {
			const k = this.keys[slot];
			const s = spec[slot];
			const sig = JSON.stringify([s, k.hot, k.flash > 0]);
			if (!force && sig === k.sig) continue;
			k.sig = sig;
			k.spec = s;
			drawKey(k, s, this.atlas);
			k.face.position.z = s.look === 'flat' ? 0.0045 : WRIST.raise;
		}
	}

	toggle(opts) { this.open ? this.close(true) : this.show(opts); }

	/** Opens the cross. pinned: opened by a controller. */
	show({ pinned = false } = {}) {
		if (!this.wearer) return;
		this.open = true;
		this.pinned = pinned;
		this.openT = 0;
		this.outT = 0;
		this.frozen = false;
		this.snap = true;
		this.roomName = this.xr.roomHere?.() ?? '';
		this.redraw(true);
		this.cross.visible = true;
		this.feel('open');
	}

	close(sound = false) {
		if (this.open && sound) this.feel('close');
		this.open = false;
		this.cross.visible = false;
		for (const row of this.touches) for (const st of Object.values(row ?? {})) resetTouch(st);
		for (const r of this.rings) if (r) r.visible = false;
		for (const v of this.xr.handViews ?? []) v.near = false;
	}

	feel(sound, c = null, haptic = null, gain = 1) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound, gain);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/**
	 * Once a frame (before the board): wears the orb, places and animates the
	 * cross, and handles touches and lasers on the orb and the keys. Claims the
	 * trigger of a controller whose laser is on them. Returns { action } for a
	 * pressed key ({ id }), else { action: null }.
	 */
	update(dt) {
		const xr = this.xr, input = xr.input;
		const wearer = input.wearers().find((c) => c.handedness === this.side) ?? null;
		this.wear(wearer);
		const o = this.orb;
		if (!wearer) { if (this.open) this.close(); animateOrb(o, performance.now() / 1000, false); return { action: null }; }
		const p = o.group.getWorldPosition(this._p);
		let hot = false, toggle = false, byController = false, action = null;

		// Touch the orb: another fingertip or controller tip (or a whole controller) reaching into it.
		let touching = false, clear = true;
		for (const c of input.wearers()) {
			if (c === wearer || c.claim.trigger === 'tool') continue;
			const tip = c.touch.tracked ? c.touch.tip.distanceTo(p) : Infinity;
			const grip = c.isController ? (input.pose(c, this._q), this._q.distanceTo(p)) : Infinity;
			if (tip < ORB_TIP_TOUCH || grip < ORB_GRIP_TOUCH) { touching = true; byController ||= c.isController; }
			if (tip < ORB_TIP_RELEASE || grip < ORB_GRIP_RELEASE) clear = false;
		}
		if (touching && o.armed) { toggle = true; o.armed = false; }
		if (clear) o.armed = true;
		if (!clear) hot = true;

		// Place the cross: on the orb, facing the eyes, right as you see it.
		if (this.open) this.place(dt, p);

		// Lasers: another controller pointing at the orb or a key; the trigger presses it.
		const raycaster = xr.raycaster;
		const faces = this.open ? ORDER.map((s) => this.keys[s]).filter((k) => k.out).map((k) => k.face) : [];
		let laserHot = null;
		for (const c of input.active()) {
			if (c === wearer || c.claim.trigger) continue;
			input.setRaycaster(c, raycaster);
			// (While open, only the keys: a laser crossing the orb on its way to a key must not close the menu.)
			const hit = raycaster.intersectObjects(this.open ? faces : [o.target], false)[0];
			if (!hit) continue;
			c.claim.trigger = 'ui';
			input.showHit(c, hit.distance);
			if (hit.object === o.target) {
				hot = true;
				if (c.state.down.trigger) { toggle = true; byController = true; }
			} else {
				const k = hit.object.userData.key;
				laserHot = k;
				if (c.state.down.trigger) action = this.pressKey(k, c) ?? action;
			}
		}

		// Touch keys: every fingertip and controller tip but the wearer's.
		const now = performance.now() / 1000;
		const near = new Set();
		for (const c of input.controllers) {
			const row = this.touches[c.index] ||= {};
			const ring = this.rings[c.index] ||= makeRing(xr);
			ring.visible = false;
			const can = this.open && c !== wearer && c.touch.tracked && c.claim.trigger !== 'tool';
			for (const slot of ORDER) {
				const k = this.keys[slot];
				const st = row[slot] ||= touchState();
				if (!can || !k.out) { if (st.phase !== 'away') resetTouch(st); st.last = null; continue; }
				const L = k.group.worldToLocal(this._q.copy(c.touch.tip));
				const flat = k.spec.look === 'flat';
				const faceZ = flat ? 0.0045 : WRIST.raise;
				const half = WRIST.key / 2 + TOUCH.MARGIN;
				const inside = Math.abs(L.x) <= half && Math.abs(L.y) <= half;
				const depth = L.z - faceZ - TOUCH.RADIUS;
				const lateral = st.last ? Math.hypot(L.x - st.last.x, L.y - st.last.y) : 0;
				st.last = { x: L.x, y: L.y };
				for (const e of stepTouch(st, { depth, inside, lateral, dt })) {
					if (e === 'contact') { if (flat) this.feel('deny', c, 'deny'); else this.feel('tick', c, 'tick', 0.5); }
					else if (e === 'click' && !flat && now - (this.lastClick[c.index] ?? -1) >= TOUCH.PANEL_GAP) {
						this.lastClick[c.index] = now;
						action = this.pressKey(k, c) ?? action;
					} else if (e === 'release') this.feel('release', null, null, 0.6);
				}
				if (st.phase === 'hover' || st.phase === 'contact' || st.phase === 'pressed') {
					near.add(k);
					if (ring.parent !== k.group) k.group.add(ring);
					ring.position.set(L.x, L.y, faceZ + 0.001 - (flat ? 0 : st.push));
					ring.scale.setScalar(ringSize(Math.max(depth, 0)));
					ring.visible = true;
				}
			}
			// The orange fingertip lights up near a key (never on the wearing hand: it can't press its own menu).
			if (xr.handViews?.[c.index]) xr.handViews[c.index].near = c !== wearer && this.open && ring.visible;
		}

		// Keys: pushed in with the finger, tinted when hovered, a flash when pressed.
		for (const slot of ORDER) {
			const k = this.keys[slot];
			let push = 0;
			for (const row of this.touches) if (row?.[slot]) push = Math.max(push, row[slot].push);
			if (k.spec?.look !== 'flat') k.face.position.z = WRIST.raise - Math.min(push, WRIST.raise - 0.001);
			k.hot = near.has(k) || laserHot === k;
			k.flash = Math.max(0, k.flash - dt);
		}
		if (this.open) this.redraw();
		animateOrb(o, now, hot || this.open);

		if (action) this.close(); // after a key
		else if (toggle) {
			if (this.open) this.close(true);
			else this.show({ pinned: byController });
		}
		return { action };
	}

	/** A key pressed (by touch or laser): its action, with feedback. */
	pressKey(k, c) {
		if (!k.spec?.id) { this.feel('deny', c, 'deny'); return null; }
		k.flash = 0.15;
		this.feel('press', c, 'click');
		return { id: k.spec.id };
	}

	/** Puts the orb on the wearer's wrist (or takes it off). */
	wear(c) {
		const o = this.orb, input = this.xr.input;
		const anchor = c ? input.wristOf(c) : null;
		if (c === o.holder && o.group.parent === anchor) return;
		o.group.removeFromParent();
		if (c) { anchor.add(o.group); o.group.position.copy(c.isHand ? WRIST_ORB : ORB_ON_GRIP); }
		if (o.holder !== c && this.open) this.close();
		o.holder = c;
	}

	/** The cross on the orb, facing the eyes, laid out as seen; held still near a fingertip; springing open. */
	place(dt, p) {
		const xr = this.xr, cam = xr.camera;
		cam.updateMatrixWorld(true);
		const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
		// Out of view (a bare hand): close after 0.4 s.
		const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
		const inView = fwd.angleTo(this._q.subVectors(p, eye)) < VIEW_ANGLE;
		this.outT = inView ? 0 : this.outT + dt;
		if (!this.pinned && this.outT > OUT_OF_VIEW) { this.close(true); return; }
		// A fingertip near: hold still.
		const wearer = this.wearer;
		this.frozen = xr.input.touches().some((c) => c !== wearer && c.touch.tip.distanceTo(p) < FREEZE);
		if (!this.frozen || this.snap) {
			const z = this._q.subVectors(eye, p).normalize();
			const right = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
			const x = right.addScaledVector(z, -right.dot(z)).normalize();
			const y = new THREE.Vector3().crossVectors(z, x);
			this._m.makeBasis(x, y, z);
			this._quat.setFromRotationMatrix(this._m);
			const k = this.snap ? 1 : 1 - Math.exp(-dt / CATCH_UP);
			this.cross.position.lerp(p, k);
			this.cross.quaternion.slerp(this._quat, k);
			this.snap = false;
		}
		// Spring out, clockwise from the top.
		this.openT += dt;
		ORDER.forEach((slot, i) => {
			const k = this.keys[slot];
			const t = THREE.MathUtils.clamp((this.openT - 0.05 * i) / 0.1, 0, 1);
			const e = ease.spring(t); // (a small overshoot)
			const [sx, sy] = SLOTS[slot];
			k.group.position.set(sx * WRIST.spacing * e, sy * WRIST.spacing * e, 0);
			k.group.scale.setScalar(0.3 + 0.7 * Math.min(e, 1.1));
			k.out = t >= 1; // pressable once fully out
		});
	}

	/** Leaving VR. */
	reset() {
		this.close();
		this.orb.group.removeFromParent();
		this.orb.holder = null;
	}
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function makeKey(slot, atlas) {
	const group = new THREE.Group();
	group.name = `wrist-key-${slot}`;
	const base = new THREE.Mesh(new THREE.BoxGeometry(WRIST.key, WRIST.key, 0.004), new THREE.MeshLambertMaterial({ color: WRIST.edge }));
	base.position.z = 0.002;
	const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	if (canvas) { canvas.width = PX; canvas.height = PX; }
	const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
	if (texture) { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; }
	const face = new THREE.Mesh(new THREE.PlaneGeometry(WRIST.key, WRIST.key), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
	face.position.z = WRIST.raise;
	face.renderOrder = 40;
	group.add(base, face);
	const k = { slot, group, base, face, canvas, texture, spec: null, sig: '', hot: false, flash: 0, out: false };
	face.userData.key = k;
	return k;
}

/** Draws a key's face: its look (plain, filled door, outline door, flat plate), icon, word and caption. */
function drawKey(k, s, atlas) {
	if (!k.canvas) return;
	const ctx = k.canvas.getContext('2d'), w = PX, r = 44;
	ctx.clearRect(0, 0, w, w);
	const flash = k.flash > 0;
	const fill = s.look === 'filled' ? (k.hot ? '#3f70e0' : DOOR.fill) : s.look === 'flat' ? WRIST.flat : flash ? COLOURS.hover : k.hot ? COLOURS.hover : WRIST.face;
	const ink = s.look === 'filled' ? DOOR.text : s.look === 'outline' ? DOOR.outline : s.look === 'flat' ? WRIST.flatText : WRIST.text;
	roundRect(ctx, 6, 6, w - 12, w - 12, r);
	ctx.fillStyle = flash && s.look === 'filled' ? COLOURS.accent : fill;
	ctx.fill();
	ctx.lineWidth = s.look === 'outline' ? 12 : 4;
	ctx.strokeStyle = s.look === 'outline' ? DOOR.outline : k.hot && s.look !== 'flat' ? COLOURS.hoverEdge : WRIST.edge;
	if (s.look !== 'filled') ctx.stroke();
	// The icon, from the atlas: dark, white (on blue) or blue (on the outline door).
	const row = s.look === 'filled' ? 1 : s.look === 'outline' ? 2 : 0;
	const col = WRIST.iconOrder.indexOf(s.icon);
	const hasText = !!s.caption;
	const iconY = hasText ? 30 : 44, size = hasText ? 92 : 104;
	if (s.icon && atlas?.complete && atlas.naturalWidth && col >= 0) {
		const n = WRIST.iconSize;
		ctx.drawImage(atlas, col * n, row * n, n, n, (w - size) / 2, iconY, size, size);
	}
	ctx.fillStyle = ink;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const labelY = s.look === 'flat' ? (hasText ? 110 : 128) : hasText ? 156 : 186;
	fitText(ctx, s.label, w - 30, s.look === 'flat' ? 50 : 44, `700 %px ${WRIST.labelFont}`);
	ctx.fillText(s.label, w / 2, labelY);
	if (hasText) {
		ctx.globalAlpha = s.look === 'filled' ? 0.92 : 0.85;
		fitText(ctx, s.caption, w - 30, 26, `500 %px ${FONT}`);
		ctx.fillText(s.caption, w / 2, s.look === 'flat' ? 168 : 206);
		ctx.globalAlpha = 1;
	}
	k.texture.needsUpdate = true;
}

function fitText(ctx, text, maxW, px, font) {
	let size = px;
	do { ctx.font = font.replace('%', size); size -= 2; } while (ctx.measureText(text).width > maxW && size > 12);
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32);
function makeRing(xr) {
	const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: KEY.ring, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
	ring.renderOrder = 42;
	ring.visible = false;
	ring.name = 'touch-ring';
	xr.hideFromPhotos(ring);
	return ring;
}

// ---------------------------------------------------------------------------
// The orb
// ---------------------------------------------------------------------------

/**
 * Orb: a glowing core inside a faceted amber crystal, circled by two thin
 * rings. animateOrb() makes it breathe, turn and shimmer, and glow blue when
 * approached.
 */
export function makeOrb() {
	const group = new THREE.Group();
	group.name = 'menu-orb';
	const core = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
	const shellMat = new THREE.MeshLambertMaterial({ color: 0xe99a45, emissive: 0x8a3f0c, flatShading: true, transparent: true, opacity: 0.78, depthWrite: false });
	const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024, 0), shellMat);
	const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd7a3, transparent: true, opacity: 0.9 });
	const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0018, 6, 48), ringMat);
	const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0016, 6, 48), ringMat);
	// A larger invisible target, so the orb is easy to hit with the laser.
	const target = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
	const body = new THREE.Group();
	body.add(core, shell, ring1, ring2);
	group.add(body, target);
	group.position.copy(ORB_ON_GRIP);
	return { group, body, core, shell, shellMat, ring1, ring2, ringMat, target, holder: null, armed: true, glow: 0, phase: Math.random() * 10 };
}

const ORB_AMBER = new THREE.Color(0xe99a45), ORB_BLUE = new THREE.Color(0x4d8dff);
const ORB_EMBER = new THREE.Color(0x8a3f0c), ORB_EMBER_BLUE = new THREE.Color(0x173f8a);

export function animateOrb(o, time, hot) {
	const t = time + o.phase;
	o.glow += ((hot ? 1 : 0) - o.glow) * 0.2;
	// Breathing: two slow waves, so it never looks mechanical.
	const breathe = 1 + 0.1 * Math.sin(t * 2.1) + 0.04 * Math.sin(t * 5.3);
	o.body.scale.setScalar(breathe * (1 + 0.4 * o.glow));
	o.shell.rotation.set(t * 0.5, t * 0.8, 0);
	o.ring1.rotation.set(Math.PI / 2 + 0.5 * Math.sin(t * 0.7), t * 1.3, 0);
	o.ring2.rotation.set(0.6 * Math.sin(t * 0.9), -t * 1.1, Math.PI / 3);
	o.shellMat.color.copy(ORB_AMBER).lerp(ORB_BLUE, o.glow);
	o.shellMat.emissive.copy(ORB_EMBER).lerp(ORB_EMBER_BLUE, o.glow).multiplyScalar(0.8 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.2)));
	o.ringMat.opacity = 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.6));
}
