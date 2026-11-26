// Keys you press like real keys (milestone C0; SPEC.md "C0. Hands and touch"):
// a raised face with an icon, a hand-lettered word and a small caption,
// pressed by a fingertip or a controller's tip (js/touch.js), or by a
// controller's laser and trigger. Used by the wrist menu (js/wrist-menu.js)
// and by the doors at the scale model (js/xr-dollhouse.js).
//
// A KeyPad holds a few keys. Its owner places each key's group, sets what it
// shows (setSpec), and calls update() once a frame; update() returns the id of
// a pressed key. A key's look:
//   plain     white face (Settings, Help)
//   filled    filled blue door: one layer in (Walk in →)
//   outline   blue-outlined door: one layer back (← Back)
//   chosen    the board's accent colour, white words: the level chosen in the stack beside the doors
//   flat      not a key: flat, greyed (the "Inside" plate); touching it says no

import * as THREE from 'three';
import { canvasTexture } from './canvas-card.js';
import { TOUCH, touchState, stepTouch, reset as resetTouch, ringSize } from './touch.js';
import { WRIST, DOOR, COLOURS, KEY, FONT } from './theme.js';

const PX_H = 256; // canvas height of a key face; the width follows its proportions
const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32); // the hover ring: 1 m across, scaled to ringSize()

const LASER_REST = 0.15; // seconds a laser rests on a key before its trigger can arm it (laserOnRelease keys)

export class KeyPad {
	/** xr: the XRExperience; name: for the scene graph. */
	constructor(xr, name = 'keys') {
		this.xr = xr;
		this.name = name;
		this.keys = new Map(); // slot -> key
		this.touches = []; // per input entry: { slot: touch state }
		this.rings = []; // per input entry: the ring under its fingertip
		this.lastClick = [];
		this.atlas = sharedAtlas();
		this.atlas?.addEventListener?.('load', () => this.redraw(true));
		globalThis.document?.fonts?.load?.(`700 40px ${WRIST.labelFont}`).then(() => this.redraw(true)).catch(() => {});
		this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
		this.list = []; // the keys, as a list (no per-frame copies)
		this._faces = []; this._hot = new Set(); this._hits = [];
		this.armed = []; // per controller: the key its trigger went down on (laserOnRelease)
		this.hover = []; // per controller: { k, t }: the key its laser rests on, and for how long
	}

	/** Adds a key of w x h metres; returns it (place its group yourself). round: a round key (w across: the held ← Back). */
	add(slot, w = WRIST.key, h = WRIST.key, { round = false } = {}) {
		const k = makeKey(`${this.name}-${slot}`, w, round ? w : h, round);
		k.slot = slot; k.w = w; k.h = round ? w : h;
		this.keys.set(slot, k);
		this.list = [...this.keys.values()];
		return k;
	}

	/** True if world point p is within margin (metres) of a shown key's face (the nearest point of its rectangle). */
	near(p, margin) {
		for (const k of this.list) {
			let o = k.group, shown = true;
			while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
			if (!shown) continue;
			const L = k.group.worldToLocal(this._v.copy(p)); // (keys are never scaled: local metres are world metres)
			const dx = Math.max(0, Math.abs(L.x) - k.w / 2), dy = Math.max(0, Math.abs(L.y) - k.h / 2);
			if (Math.hypot(dx, dy, L.z) < margin) return true;
		}
		return false;
	}

	/** What a key shows: { id (null: not pressable), look, icon, label, caption, hold (seconds: pressed only when held this long, a ring filling) }. */
	setSpec(slot, spec) {
		const k = this.keys.get(slot);
		if (k) { k.spec = spec; this.redrawKey(k); }
	}

	redraw(force = false) { for (const k of this.keys.values()) this.redrawKey(k, force); }

	redrawKey(k, force = false) {
		if (!k.spec) return;
		const sig = `${k.spec.id}|${k.spec.look}|${k.spec.label}|${k.spec.caption ?? ''}|${k.hot}|${k.flash > 0}`;
		if (!force && sig === k.sig) return;
		k.sig = sig;
		drawKey(k, k.spec, this.atlas);
		k.face.position.z = k.spec.look === 'flat' ? 0.0045 : WRIST.raise;
	}

	/** A sound (if sound is on) and, on a controller, a vibration. */
	feel(sound, c = null, haptic = null, gain = 1) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound, gain);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/**
	 * Once a frame. active: the keys can be pressed now; exclude: an input
	 * entry that may not press them (the hand wearing them). Lasers claim the
	 * trigger of a controller pointing at a key. Returns { action: { id } | null, near }.
	 * Options for keys that sit where hands rest (the doors at the scale model,
	 * the tester's finding): rules (js/touch.js DELIBERATE: a push from the
	 * front with some speed); tips 'hands' (a controller's tip never presses
	 * them); blockers (meshes that, hit first, take the laser: the model behind);
	 * laserOnRelease (a laser presses when the trigger goes down and is let go
	 * over the same key). A key with spec.hold is pressed only once held that
	 * long, by touch or laser (a ring fills; letting go early does nothing).
	 */
	update(dt, { active = true, exclude = null, tips = 'all', blockers = null, laserOnRelease = false, rules = TOUCH } = {}) {
		const xr = this.xr, input = xr.input, now = performance.now() / 1000;
		let action = null, laserHot = null;
		const keys = this.list;
		for (const k of keys) k.progress = 0;
		// Lasers: a controller pointing at a key; the trigger presses it.
		if (active) {
			const faces = this._faces;
			faces.length = 0;
			for (const k of keys) if (k.out && k.group.visible) faces.push(k.face);
			for (const c of input.active()) {
				if (c === exclude || c.claim.trigger || !faces.length) { this.armed[c.index] = null; continue; }
				input.setRaycaster(c, xr.raycaster);
				const hits = this._hits;
				hits.length = 0;
				xr.raycaster.intersectObjects(faces, false, hits);
				const hit = hits[0];
				if (hit && blockers?.length) {
					hits.length = 0;
					xr.raycaster.intersectObjects(blockers, false, hits);
					if (hits[0] && hits[0].distance < hit.distance) { this.armed[c.index] = null; continue; } // (the model is in front)
				}
				if (!hit) { if (!c.state.trigger) this.armed[c.index] = null; if (this.hover[c.index]) this.hover[c.index].k = null; continue; }
				c.claim.trigger = 'ui';
				input.showHit(c, hit.distance);
				const k = hit.object.userData.key;
				laserHot = k;
				const hv = this.hover[c.index] ??= { k: null, t: 0 };
				if (hv.k === k) hv.t += dt; else { hv.k = k; hv.t = 0; }
				if (k.spec?.hold) {
					// Held: the trigger goes down over the key and stays down for spec.hold.
					const a = this.armed[c.index];
					if (c.state.down.trigger) this.armed[c.index] = { k, t: 0, done: false };
					else if (a?.k === k && c.state.trigger && !a.done) {
						a.t += dt;
						k.progress = Math.max(k.progress, a.t / k.spec.hold);
						if (a.t >= k.spec.hold) { a.done = true; action = this.press(k, c) ?? action; }
					} else if (a && (a.k !== k || !c.state.trigger)) this.armed[c.index] = null;
					continue;
				}
				if (!laserOnRelease) { if (c.state.down.trigger) action = this.press(k, c) ?? action; continue; }
				// (Armed only if the laser rested on the key before the trigger went down: a pull
				// aimed through the doors at the model never presses one; the tester's finding.)
				if (c.state.down.trigger) this.armed[c.index] = hv.t >= LASER_REST ? k : null;
				if (c.state.up.trigger) { if (this.armed[c.index] === k) action = this.press(k, c) ?? action; this.armed[c.index] = null; }
			}
		}
		// Touch: every fingertip and controller tip but the excluded one.
		let near = false;
		const hot = this._hot;
		hot.clear();
		for (const c of input.controllers) {
			const row = this.touches[c.index] ||= {};
			const ring = this.rings[c.index] ||= makeRing(xr);
			ring.visible = false;
			const can = active && c !== exclude && c.touch.tracked && c.claim.trigger !== 'tool' && (tips !== 'hands' || c.isHand);
			for (const k of keys) {
				const st = row[k.slot] ||= Object.assign(touchState(), { lx: 0, ly: 0, seen: false });
				if (!can || !k.out || !k.group.visible) { if (st.phase !== 'away') resetTouch(st); st.seen = false; continue; }
				const L = k.group.worldToLocal(this._v.copy(c.touch.tip));
				const flat = k.spec?.look === 'flat';
				const faceZ = flat ? 0.0045 : WRIST.raise;
				const inside = Math.abs(L.x) <= k.w / 2 + TOUCH.MARGIN && Math.abs(L.y) <= k.h / 2 + TOUCH.MARGIN;
				const depth = (L.z - faceZ) - TOUCH.RADIUS / k.group.getWorldScale(this._s).x;
				const lateral = st.seen ? Math.hypot(L.x - st.lx, L.y - st.ly) : 0;
				st.lx = L.x; st.ly = L.y; st.seen = true;
				for (const e of stepTouch(st, { depth, inside, lateral, dt }, rules)) {
					if (e === 'contact') { if (flat) this.feel('deny', c, 'deny'); else this.feel('tick', c, 'tick', 0.5); }
					else if (e === 'click' && !flat && k.spec?.hold) st.holdT = 0; // (held: counted below)
					else if (e === 'click' && !flat && now - (this.lastClick[c.index] ?? -1) >= TOUCH.PANEL_GAP) {
						this.lastClick[c.index] = now;
						action = this.press(k, c) ?? action;
					} else if (e === 'release') this.feel('release', null, null, 0.6);
				}
				// A held key: pressed once it has stayed pushed in for spec.hold.
				if (st.holdT != null) {
					if (st.phase !== 'pressed') st.holdT = null;
					else if (st.holdT >= 0) {
						st.holdT += dt;
						k.progress = Math.max(k.progress, st.holdT / k.spec.hold);
						if (st.holdT >= k.spec.hold) { st.holdT = -1; action = this.press(k, c) ?? action; } // (-1: done until released)
					}
				}
				if (st.phase === 'hover' || st.phase === 'contact' || st.phase === 'pressed') {
					hot.add(k);
					if (ring.parent !== k.group) k.group.add(ring);
					ring.position.set(L.x, L.y, faceZ + 0.001 - (flat ? 0 : st.push));
					ring.scale.setScalar(ringSize(Math.max(depth, 0)));
					ring.visible = true;
				}
			}
			// The blue fingertip lights up near a key.
			if (ring.visible) { near = true; if (xr.handViews?.[c.index]) xr.handViews[c.index].near = true; }
		}
		// Keys: pushed in with the finger, tinted when hovered, a flash when pressed.
		for (const k of keys) {
			let push = 0;
			for (const row of this.touches) if (row?.[k.slot]) push = Math.max(push, row[k.slot].push);
			if (k.spec?.look !== 'flat') k.face.position.z = WRIST.raise - Math.min(push, WRIST.raise - 0.001);
			k.hot = hot.has(k) || laserHot === k;
			k.flash = Math.max(0, k.flash - dt);
			this.redrawKey(k);
			if (k.spec?.hold) this.showProgress(k, dt);
		}
		return { action, near: near || !!laserHot, hot };
	}

	/** A held key's ring round its edge (HoldRing): its track while touched or aimed at, filling while held (k.progress 0..1). */
	showProgress(k, dt) {
		if (!k.ring) {
			k.ring = new HoldRing(Math.min(k.w, k.h) / 2 + 0.001);
			k.ring.group.position.z = WRIST.raise + 0.002;
			k.group.add(k.ring.group);
		}
		k.ring.update(dt, Math.min(1, k.progress), k.hot || k.progress > 0);
	}

	/** A key pressed (by touch or laser): its action, with feedback. */
	press(k, c) {
		if (!k.spec?.id) { this.feel('deny', c, 'deny'); return null; }
		k.flash = 0.15;
		k.ring?.flash();
		this.feel('press', c, 'click');
		return { id: k.spec.id };
	}

	/** Forgets every touch in progress (closing, leaving VR): nothing completes. */
	reset() {
		for (const row of this.touches) for (const st of Object.values(row ?? {})) { resetTouch(st); st.seen = false; st.holdT = null; }
		this.armed.length = 0;
		for (const r of this.rings) if (r) r.visible = false;
	}
}

let atlas = null;
/** The icon atlas (assets/ui/wrist-keys.png), loaded once for every pad. */
function sharedAtlas() {
	if (typeof Image === 'undefined') return null;
	if (!atlas) { atlas = new Image(); atlas.src = WRIST.icons; }
	return atlas;
}

/**
 * The ring of a held key (the next-build asks 3.2): just outside its edge, a 4 mm
 * line in the theme's text colour; its track (25%) shows as soon as a fingertip
 * or laser is on the key, the fill (90%) grows clockwise from the top while it
 * is held, drains back in 0.2 s if let go early, and flashes once (0.1 s) when
 * full. The same ring circles the orb while B or Y is held (js/wrist-menu.js).
 */
export class HoldRing {
	/** r: the inner radius (m), just outside what it circles. */
	constructor(r) {
		const mat = (opacity) => new THREE.MeshBasicMaterial({ color: COLOURS.text, transparent: true, opacity, depthTest: false, depthWrite: false });
		this.group = new THREE.Group();
		this.group.name = 'hold-ring';
		this.track = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.004, 64), mat(0.25));
		this.fill = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.004, 64, 1, Math.PI / 2, -Math.PI * 2), mat(0.9));
		for (const m of [this.track, this.fill]) { m.renderOrder = 43; m.raycast = () => {}; this.group.add(m); }
		this.group.visible = false;
		this.shown = 0; // the fill drawn (it drains back after an early let-go)
		this.flashT = 0;
	}

	/** Once a frame: progress (0..1) held so far; on (a fingertip or laser on it, or held). */
	update(dt = 1 / 72, progress = 0, on = false) {
		this.shown = progress > 0 ? progress : Math.max(0, this.shown - dt / 0.2);
		this.flashT = Math.max(0, this.flashT - dt);
		this.group.visible = on || this.shown > 0 || this.flashT > 0;
		this.fill.geometry.setDrawRange(0, Math.floor(64 * Math.min(1, this.flashT > 0 ? 1 : this.shown)) * 6);
		this.fill.material.opacity = this.flashT > 0 ? (Math.sin(this.flashT / 0.1 * Math.PI) > 0 ? 1 : 0.5) : 0.9;
	}

	/** Full: one flash (0.1 s). */
	flash() { this.flashT = 0.1; }
}

/** A key: a thin base and a raised face, w x h metres (round: a disc w across). */
function makeKey(name, w, h, round = false) {
	const group = new THREE.Group();
	group.name = name;
	const base = new THREE.Mesh(round ? new THREE.CylinderGeometry(w / 2, w / 2, 0.004, 40).rotateX(Math.PI / 2) : new THREE.BoxGeometry(w, h, 0.004), new THREE.MeshLambertMaterial({ color: WRIST.edge }));
	base.position.z = 0.002;
	const pxW = Math.round(PX_H * w / h);
	const { canvas, texture } = canvasTexture(pxW, PX_H);
	const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
	face.position.z = WRIST.raise;
	face.renderOrder = 40;
	group.add(base, face);
	const k = { group, base, face, canvas, texture, w, h, round, spec: null, sig: '', hot: false, flash: 0, out: true };
	face.userData.key = k;
	return k;
}

/**
 * Draws a key's face: its look, icon, word and caption. Square keys stack
 * them (icon above the word); wide keys put the icon on the left.
 */
function drawKey(k, s, atlas) {
	if (!k.canvas) return;
	const ctx = k.canvas.getContext('2d'), w = k.canvas.width, h = k.canvas.height, r = k.round ? h / 2 - 6 : 44; // (round: a disc, so the shape itself says "hold")
	ctx.clearRect(0, 0, w, h);
	const flash = k.flash > 0;
	const fill = s.look === 'chosen' ? COLOURS.accent : s.look === 'filled' ? (k.hot ? '#3f70e0' : DOOR.fill) : s.look === 'flat' ? WRIST.flat : flash || k.hot ? COLOURS.hover : WRIST.face;
	const ink = s.look === 'chosen' ? COLOURS.accentText : s.look === 'filled' ? DOOR.text : s.look === 'outline' ? DOOR.outline : s.look === 'flat' ? WRIST.flatText : WRIST.text;
	roundRect(ctx, 6, 6, w - 12, h - 12, r);
	ctx.fillStyle = flash && s.look === 'filled' ? COLOURS.accent : fill;
	ctx.fill();
	ctx.lineWidth = s.look === 'outline' ? 12 : 4;
	ctx.strokeStyle = s.look === 'outline' ? DOOR.outline : k.hot && s.look !== 'flat' ? COLOURS.hoverEdge : WRIST.edge;
	if (s.look !== 'filled' && s.look !== 'chosen') ctx.stroke();
	// The icon, from the atlas: dark, white (on blue) or blue (on the outline door).
	const row = s.look === 'filled' ? 1 : s.look === 'outline' ? 2 : 0;
	const col = WRIST.iconOrder.indexOf(s.icon);
	const icon = s.icon && atlas?.complete && atlas.naturalWidth && col >= 0;
	const n = WRIST.iconSize, hasText = !!s.caption, wide = w > h * 1.3;
	ctx.fillStyle = ink;
	ctx.textBaseline = 'middle';
	if (wide) {
		// Icon on the left, the word and caption beside it.
		const size = 120, x0 = icon ? 40 + size + 24 : 40;
		if (icon) ctx.drawImage(atlas, col * n, row * n, n, n, 40, (h - size) / 2, size, size);
		ctx.textAlign = 'left';
		fitText(ctx, s.label, w - x0 - 30, 70, `700 %px ${WRIST.labelFont}`);
		ctx.fillText(s.label, x0, hasText ? h * 0.42 : h / 2);
		if (hasText) {
			ctx.globalAlpha = 0.9;
			fitText(ctx, s.caption, w - x0 - 30, 34, `500 %px ${FONT}`);
			ctx.fillText(s.caption, x0, h * 0.72);
			ctx.globalAlpha = 1;
		}
	} else {
		const iconY = hasText ? 30 : 44, size = hasText ? 92 : 104;
		if (icon) ctx.drawImage(atlas, col * n, row * n, n, n, (w - size) / 2, iconY, size, size);
		ctx.textAlign = 'center';
		const labelY = s.look === 'flat' ? (hasText ? 110 : 128) : hasText ? 156 : 186;
		fitText(ctx, s.label, w - 30, s.look === 'flat' ? 50 : 44, `700 %px ${WRIST.labelFont}`);
		ctx.fillText(s.label, w / 2, labelY);
		if (hasText) {
			ctx.globalAlpha = s.look === 'filled' ? 0.92 : 0.85;
			fitText(ctx, s.caption, w - 30, 26, `500 %px ${FONT}`);
			ctx.fillText(s.caption, w / 2, s.look === 'flat' ? 168 : 206);
			ctx.globalAlpha = 1;
		}
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

function makeRing(xr) {
	const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: KEY.ring, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
	ring.renderOrder = 42;
	ring.visible = false;
	ring.name = 'touch-ring';
	xr.hideFromPhotos(ring);
	return ring;
}
