// The right hand's keys (build 215's C8, the user's decision; the UX/UI
// Designer's spec): ← Back and Settings, always showing, floating over the
// main hand the way the tools float over the other (js/tool-fan.js). It
// replaces the orb on the wrist and the keys it sprang out (milestone C0.3;
// the arc of 24 Nov): the orb hid the keys behind a touch nobody needed.
//
//   Where    15 cm above the hand (a bare hand: the middle of its palm, the
//            hold frame's origin, js/hold.js; a controller: its grip), world
//            up, over the wrist-to-palm middle, clear of the fingertips:
//            ← Back on the hand's vertical axis, Settings 8.2 cm to its outer
//            side (7 cm keys, 1.2 cm apart), facing the eyes, no roll, no bob.
//   Areas    over the hand while it is in its own area (the right, or the left
//            with Main hand: Left: js/zones.js); in the centre they wait,
//            grouped, at that edge, gliding on the tools' spring. While the
//            other hand's tip is within reach of a key (0.25 m, out at 0.35 m),
//            only their own hand moves them: once they have settled where they
//            go, never on the way there (passing near the fan hand mid-glide,
//            they froze in the middle of the view: the Tester's C8 finding).
//   Touch    every front touch of the other fingertip or controller tip (the
//            touch.js rules) presses a key, whatever the tools' reach, unless
//            that tip is itself on a tool (holding one, or within the fan's take
//            distance of one); their own hand never presses them. A laser click
//            acts as a touch; a laser held on ← Back fills its ring. ← Back is
//            held BACK_HOLD (a ring fills), as are B and Y (js/xr-ui.js).
//   Look     60% at rest, full while a tip is within reach. Over a live key (the
//            doors and levels, an open wing: the orb's old line-of-sight rule)
//            they make room: half size, 30%, touches unchanged. Each key shrinks about its own middle, and
//            never starts or stops making room while a tip is within reach: a
//            key never slides from under a finger. Tracking lost: they stay 1
//            s, then fade.
//
// (The module keeps its name: xr.ui.wrist is these keys.)

import * as THREE from 'three';
import { WRIST } from './theme.js';
import { KeyPad } from './keys.js';
import { SIGHT, covers, TOOLS, edgeSpot, keepFromEyes, dampTowards } from './zones.js';

export const BACK_HOLD = 1; // ← Back, round, is held this long (s), a ring filling; B and Y too (build 215's C8 and C9)
export const KEYS = {
	ABOVE: 0.15, // over the hand (m), as the tools (js/tool-fan.js ABOVE)
	APART: WRIST.key + 0.012, // Settings beside ← Back, to the outer side (m)
	REST: 0.6, // their strength at rest; full while a tip is within reach
	YIELD: { scale: 0.5, opacity: 0.3 }, // making room
	LOST_HOLD: 1, LOST_FADE: 0.2, // tracking lost: they stay, then fade (s)
	TAKE: { hand: 0.07, controller: 0.05 },
	TYPE: { readAt: 0.45, label: [1.4, 1.8], fit: 0.8 }, // the words: Kalam, 1.4° at least, up to 1.8° where the word fits 80% of the key (build 215's C5: 11-14 mm capitals at 0.45 m) // a tip this near a tool in the fan is on it (the fan's take distance)
};

/**
 * What each key shows: ← Back (round, held BACK_HOLD: one key, one
 * behaviour: at the scale model it leaves VR, inside it goes back to the
 * scale model) and Settings (round; help is in Settings, How to move).
 */
export function keysFor(mode) {
	return {
		back: { id: 'back', look: 'outline', icon: 'back', label: '← Back', caption: mode === 'walk' ? 'Scale model' : 'Leave VR', hold: BACK_HOLD },
		settings: { id: 'settings', look: 'plain', icon: 'settings', label: 'Settings', caption: 'and help' },
	};
}

export class WristMenu {
	constructor(xr) {
		this.xr = xr;
		this.side = 'right';
		this.group = new THREE.Group();
		this.group.name = 'hand-keys';
		this.group.visible = false;
		this.pad = new KeyPad(xr, 'hand-key', KEYS.TYPE);
		this.keys = { back: this.pad.add('back', WRIST.key, WRIST.key, { round: true }), settings: this.pad.add('settings', WRIST.key, WRIST.key, { round: true }) };
		for (const k of Object.values(this.keys)) this.group.add(k.group);
		this.holder = null; // the input entry they float over, while tracked
		this.alpha = 0; // shown 0..1 (tracking found or lost)
		this.lost = 0;
		this.reach = false; // the other tip within reach of a key
		this.sightYield = false; this.sightClear = 0; this.yieldK = 0; this.yieldTo = 0; this.settled = false;
		this.keysHot = false;
		this.backProgress = 0; // B or Y held (xr-ui.js), 0..1
		xr.scene.add(this.group);
		xr.hideFromPhotos(this.group);
		this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._t = new THREE.Vector3(); this._head = new THREE.Vector3();
		this.setSide();
	}

	/** The hand that wears the keys: the main hand (the tool fan floats over the other). */
	setSide() {
		this.side = this.xr.toolFan === 'right' ? 'left' : 'right';
		const outer = this.side === 'right' ? 1 : -1; // (the group faces you: +X is your right)
		this.keys.back.group.position.set(0, 0, 0);
		this.keys.settings.group.position.set(outer * KEYS.APART, 0, 0);
		this.redraw();
	}

	/** The input entry the keys float over (a tracked bare hand or a controller in use), or null. */
	get wearer() { return this.holder; }

	/** True while they make room (over a live key). */
	get yielded() { return this.sightYield; }

	/** The keys' content for this layer. */
	redraw() {
		const spec = keysFor(this.xr.mode);
		for (const [slot, k] of Object.entries(this.keys)) this.pad.setSpec(slot, spec[slot]);
	}

	/** Where the keys rest over their hand (world): 15 cm above its palm's middle (a bare hand) or its grip (a controller). */
	anchorOf(c, out) {
		const input = this.xr.input;
		if (c.isHand) {
			const w = input.joint(c, 'wrist', out), k = w && input.joint(c, 'middle-finger-phalanx-proximal', this._b);
			if (!k) return null;
			out.add(k).multiplyScalar(0.5);
		} else { c.grip.updateMatrixWorld(true); out.setFromMatrixPosition(c.grip.matrixWorld); }
		out.y += KEYS.ABOVE;
		return out;
	}

	/** True if input c may not press the keys this frame: their own hand, or a tip on a tool (holding one, or at one in the fan). */
	onTool(c) {
		const xr = this.xr, fan = xr.fan;
		if (xr.tools?.held?.c === c) return true;
		if (!fan || fan.alpha <= 0.5 || !c.touch?.tracked) return false;
		const reach = c.isHand ? KEYS.TAKE.hand : KEYS.TAKE.controller;
		return fan.slots.some((s, i) => !s.held && fan.restWorld(i, this._t).distanceTo(c.touch.tip) < reach);
	}

	/**
	 * Once a frame (before the wing): where the keys float, their look, and
	 * touches and lasers on them. Returns { action } for a pressed key ({ id }),
	 * else { action: null }.
	 */
	update(dt) {
		const xr = this.xr, input = xr.input, head = xr.headWorld();
		if (this.drawnFor !== xr.mode) { this.drawnFor = xr.mode; this.redraw(); } // (← Back's caption: Leave VR at the scale model, Scale model inside)
		const holder = input.wearers().find((c) => c.handedness === this.side) ?? null;
		const at = holder ? this.anchorOf(holder, this._a) : null;
		if (holder && at) { this.holder = holder; this.lost = 0; this.aim(holder, at, head, dt); } else this.lost += dt;
		const shown = !!xr.session && this.holder && this.lost < KEYS.LOST_HOLD + KEYS.LOST_FADE;
		this.alpha = shown ? (this.lost > KEYS.LOST_HOLD ? 1 - (this.lost - KEYS.LOST_HOLD) / KEYS.LOST_FADE : Math.min(1, this.alpha + dt / 0.2)) : 0;
		if (!shown && this.lost > KEYS.LOST_HOLD + KEYS.LOST_FADE) this.holder = null;
		this.group.visible = this.alpha > 0.01;
		if (!this.group.visible) { this.pad.update(dt, { active: false }); this.keysHot = false; return { action: null }; }
		this.group.position.copy(this.pos);
		this.group.lookAt(head);
		// The look: making room over a live key; full strength while a tip is within reach.
		this.sightYield = this.sightYieldNow(head, dt);
		if (!this.reach) this.yieldTo = this.yielded ? 1 : 0; // (held while a tip is within reach: a key never shrinks from under a finger)
		this.yieldK += (this.yieldTo - this.yieldK) * (1 - Math.exp(-dt / 0.15));
		const y = this.yieldK, strength = (this.reach ? 1 : KEYS.REST) * (1 - (1 - KEYS.YIELD.opacity) * y) * this.alpha;
		for (const k of Object.values(this.keys)) {
			k.group.scale.setScalar(1 - (1 - KEYS.YIELD.scale) * y); // (each about its own middle: Settings stays beside ← Back)
			k.face.material.opacity = strength;
			if (!k.base.material.transparent) { k.base.material.transparent = true; k.base.material.depthWrite = false; }
			k.base.material.opacity = strength;
		}
		// Touches and lasers (never their own hand; never a tip on a tool).
		const { action, hot } = this.pad.update(dt, { active: true, exclude: this.holder, skip: (c) => this.onTool(c), progress: { back: this.backProgress } });
		this.keysHot = hot.size > 0;
		return { action };
	}

	/**
	 * Where the keys go this frame, as the tools (js/tool-fan.js aim): over
	 * their hand while it is in its own area, else waiting at that edge of the
	 * centre; the glide between on the tools' spring; while the other tip is
	 * within reach, only their own hand moves them.
	 */
	aim(holder, anchor, head, dt) {
		const xr = this.xr, areas = xr.areas, side = this.side === 'right' ? -1 : 1; // (zones' side: +1 the left)
		const area = areas?.hands[xr.input.controllers.indexOf(holder)] ?? null;
		let near = Infinity;
		for (const c of xr.input.touches()) if (c !== holder) for (const k of Object.values(this.keys)) near = Math.min(near, k.group.getWorldPosition(this._t).distanceTo(c.touch.tip));
		// Within reach only once settled where they go (then until the tip is 0.35 m away): never frozen mid-glide.
		this.reach = near < TOOLS.REACH_CLEAR && (this.reach || (this.settled && near < TOOLS.REACH));
		const home = !areas?.centre || area === null || area === this.side;
		if (!this.reach) this.mode = home ? 'home' : 'edge';
		this.mode ??= 'home';
		this.pos ??= anchor.clone(); this.vel ??= new THREE.Vector3();
		const target = this._head.copy(anchor);
		if (this.mode === 'edge') { if (this.reach) target.copy(this.pos); else edgeSpot(head, areas.centre, side, anchor, target); }
		keepFromEyes(target, head);
		if (this.mode !== this.was) this.gliding = true;
		this.was = this.mode;
		if (this.gliding || this.mode === 'edge') {
			dampTowards(this.pos, this.vel, target, dt);
			if (this.mode === 'home' && this.pos.distanceTo(target) < 0.01) this.gliding = false;
		} else { this.pos.copy(target); this.vel.set(0, 0, 0); }
		this.settled = !this.gliding || this.pos.distanceTo(target) < 0.01; // (home: over the hand; at the edge: arrived)
	}

	/**
	 * The keys between the eyes and a live key (the orb's old rule, the
	 * next-build asks 5.8): they make room at once, and come back once clear
	 * for SIGHT.CLEAR_FOR. A live key behind them always wins.
	 */
	sightYieldNow(eye, dt) {
		const xr = this.xr, live = xr.liveKeys?.() ?? [], r = WRIST.key / 2;
		const mine = Object.values(this.keys).map((k) => k.group.getWorldPosition(new THREE.Vector3()));
		const covering = live.some((k) => mine.some((p) => covers(eye, p, r, k.p, k.r, this.sightYield)));
		if (covering) { this.sightClear = 0; return true; }
		if (!this.sightYield) return false;
		this.sightClear += dt;
		return this.sightClear < SIGHT.CLEAR_FOR;
	}

	/** B or Y held (js/xr-ui.js): ← Back's ring shows how far (0..1). */
	setBackProgress(p) { this.backProgress = p; }

	/** Full: ← Back's ring flashes (its hold done). */
	flashBack() { this.keys.back.ring?.flash(); }

	/** Leaving VR. */
	reset() {
		this.pad.reset();
		this.holder = null;
		this.alpha = 0; this.lost = 0; this.reach = false; this.backProgress = 0;
		this.pos = this.vel = null; this.mode = this.was = null; this.gliding = false; this.settled = false; this.yieldTo = 0; this.yieldK = 0;
		for (const k of Object.values(this.keys)) k.group.scale.setScalar(1);
		this.group.visible = false;
	}
}

