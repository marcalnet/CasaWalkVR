// The pause (the next-build asks, "Tip screens"; the code audit's step 2): it
// owns every move between places (Enter VR, Walk in, ← Back, leaving VR) and,
// while there is something left to learn, holds a short pause in the dark on
// the way: a floor ring, one short tip, and for the moves a looping hand.
//
//   Enter VR  the pause from the first frame (the void, the floor ring, the
//             "walk in" tip), until the scale-model room is ready (ready:
//             below); then a fade into it.
//   Walk in   the tunnel to black (or the model grows: WALK_IN_ZOOM), then
//             the pause with the room's name over the tip; the teleport tip
//             can be practised on the floor ring: the practice jump is the
//             step inside. With no tip left: the room's name for 1.5 s, after it.
//   ← Back    a fade; the grab tip while it is unlearnt and unseen this
//             session; then the home settles onto the plinth.
//   leaving   a gentle fade to white, then the page. Never a tip.
//
// Ready (the next-build asks §1, revised 26 Nov): the place has drawn behind
// the veil and its last 10 frames are steady, each within ±25% of their
// median and none of 100 ms or more (a shader compile or a texture upload
// restarts the count). Steady, not fast: a home running at an even 36 fps is
// ready. At most 3 s from its first draw, then it fades in anyway. Every move
// waits for it; with no tip left that is the plain fade's dark gap, and only
// past 0.3 s does the wait show the void, the rings and the place's name (the
// home's at Enter VR and ← Back, the room's at Walk in): never plain black.
//
// A tip is learnt once you have done its action (anywhere: note()); each
// shows at most once a session, learnt or not; each Enter VR starts fresh
// (nothing about tips is stored: the headset passes from person to person).
// A tip learnt with controllers is still shown once for bare hands. With no
// tip left a move is today's plain fade: no ring, no wait.
//
// The pause draws over the veil's dark (js/veil.js: renderOrder 1002; the
// tip, the ring, the hand and the practice arc are 1003): everything else,
// the orb, the tools and the lasers, stays hidden behind it. Timings are data
// (PAUSE); which tip is next is pure (nextTip), and so is "ready".

import * as THREE from 'three';
import { ease } from './tween.js';
import { Label } from './panel.js';
import { VOID } from './theme.js';
import { TIPS } from './xr-menus.js';
import { TipDemo } from './tip-demo.js';
import { handAimRay } from './gestures.js';
import { DEV } from './dev.js';

/** The pause's timings (seconds) and places (metres, degrees). */
export const PAUSE = {
	TIP_IN: 0.3, // the tip fades in, once the view is black
	SHOWN: 3.5, // fully visible this long, it ends on its own (if the next place is ready)
	NEXT: 8, MAX_TIPS: 2, // still loading after this long: the next tip of the transition cross-fades in (two at most)
	SKIP_AFTER: 0.8, // a press (or the tip's own action) ends it from then on
	TIP_OUT: 0.3, REVEAL: 0.2, // the tip fades out, then the place fades in
	CHOOSE_WAIT: 0.3, // Enter VR: the tip is chosen once the head has a pose and a controller is in, or this long after the pose (bare hands)
	READY_LIMIT: 3, READY_FRAMES: 10, READY_SPREAD: 0.25, READY_SPIKE: 0.1, // ready: drawn once and the last 10 frames steady (each within 25% of their median, none 100 ms or more); never more than 3 s from the first draw
	GAP: 0.3, // with no tip, the dark gap a plain fade has anyway: only a longer wait shows the void, the rings and the place's name
	AHEAD: 1.4, BELOW: 10, NAME_ABOVE: 0.8, // the tip: 1.4 m ahead, its centre 10° below eye level; the room's name 0.8° above it
	AWAY: 40, AWAY_FOR: 1, FOLLOW: 0.4, // turned more than 40° away for over 1 s: the tip glides back in front of you over 0.4 s
	RINGS: [[0.75, 0.25], [2, 0.1]], // the floor rings: radius (m), opacity
	PRACTICE_SHOWN: 0.3, // the practice arc shown this long before letting go jumps (as inside)
	ARRIVAL: 1.5, // the room's name inside, with no tip left
};

/**
 * Stepping inside as a tunnel zoom (build 120, item 7; on since the user's word of 26 Nov 2026, made
 * subtle by the UX/UI Designer's M2): a dim closes in from the view's edge to a clear circle 60°
 * across on the landing spot (dimmed to half, never black: js/veil.js), and inside it the whole room
 * and the model scale up x1 -> x1.4 about that spot (smootherstep: a soft start and stop), then the
 * view fades to black on the dive chime's last ringing note. Off: the model grows (WALK_IN_GROW).
 */
export const WALK_IN_ZOOM = true;
/** Stepping inside without the tunnel: how long the model grows towards you (s), eased in and out, before the fade. */
export const WALK_IN_GROW = 1.3;
const ZOOM = { close: 0.5, from: 0.2, to: 1.3, x: 1.4, black: 1.25, end: 1.6 }; // (seconds, and the scale at the end)

/** A tip's key in the session's record: its id and the input kind ('hands' | 'controllers'). */
export const tipKey = (id, kind) => `${id}:${kind}`;

/**
 * The tip to show for a transition ('enter' | 'in' | 'back'), or null: the
 * first in TIPS order not yet seen or learnt this session for this input kind
 * (store: the session's, js/session-store.js). all (?tips): every move shows
 * the next tip of all of them, in turn, never retiring one.
 */
export function nextTip(transition, store, kind, { all = false } = {}) {
	if (all) {
		const every = Object.values(TIPS).flat();
		return every[store.cycle++ % every.length];
	}
	const { seen, learnt } = store.tips;
	return (TIPS[transition] ?? []).find((t) => !seen.has(tipKey(t.id, kind)) && !learnt.has(tipKey(t.id, kind))) ?? null;
}

/**
 * Ready (pure): drawn at least once, and the last READY_FRAMES frame times are
 * steady: each within READY_SPREAD of their median, none READY_SPIKE or more
 * (the frame clock caps a frame at 0.1 s, so a longer spike reads 0.1).
 */
export function isReady(frameTimes) {
	const n = PAUSE.READY_FRAMES;
	if (frameTimes.length < n) return false;
	const last = frameTimes.slice(-n), median = [...last].sort((a, b) => a - b)[n >> 1];
	return last.every((dt) => dt < PAUSE.READY_SPIKE && Math.abs(dt - median) <= PAUSE.READY_SPREAD * median);
}

/**
 * The practice arc (pure): from `origin` along `dir` (world), thrown at 6 m/s
 * under gravity, down to the floor at height floorY. Returns the points and
 * where it lands (null if it never comes down within 2 s).
 */
export function practiceArc(origin, dir, floorY, out = []) {
	const v = 6, g = 9.8, dt = 0.04;
	out.length = 0;
	const p = origin.clone(), vel = dir.clone().normalize().multiplyScalar(v);
	for (let t = 0; t < 2; t += dt) {
		out.push(p.clone());
		const next = p.clone().addScaledVector(vel, dt);
		next.y -= g * dt * dt / 2;
		vel.y -= g * dt;
		if (next.y <= floorY) {
			const k = (p.y - floorY) / (p.y - next.y);
			const land = p.clone().lerp(next, k);
			out.push(land.clone());
			return { points: out, land };
		}
		p.copy(next);
	}
	return { points: out, land: null };
}

export class Pause {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.fx = null; // the move between places in progress (was XRExperience.layerFx)
		this.tipsOn = true; // (the tests switch the tips off, but for their own checks)
		this.colour = 0x000000;
		// The tip and the room's name over it, world-locked (in the rig).
		this.group = new THREE.Group();
		this.group.name = 'pause';
		this.group.visible = false;
		this.tipLabel = new Label({ height: 0.07 });
		this.nameLabel = new Label({ height: 0.05 });
		for (const l of [this.tipLabel, this.nameLabel]) { l.mesh.renderOrder = 1003; l.mesh.material.depthTest = false; this.group.add(l.mesh); }
		// The floor rings: lines, one draw call (opacity per vertex).
		this.floor = buildRings();
		xr.rig.add(this.group, this.floor);
		// The practice arc.
		this.arcPts = [];
		this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
			new THREE.LineBasicMaterial({ color: 0x4d8dff, depthTest: false, transparent: true }));
		this.arc.renderOrder = 1003;
		this.arc.frustumCulled = false;
		this.arc.visible = false;
		xr.scene.add(this.arc);
		// The room's name inside with no tip left (the arrival title), and the first-target ring.
		this.arrival = new Label({ height: 0.12 });
		this.arrival.mesh.visible = false;
		this.arrival.mesh.material.depthTest = false;
		xr.rig.add(this.arrival.mesh);
		this.target = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 48).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: 0xe07a1f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
		this.target.name = 'first-target';
		this.target.visible = false;
		this.target.raycast = () => {};
		xr.scene.add(this.target);
		this.demo = new TipDemo(xr);
		xr.hideFromPhotos(this.group, this.floor, this.arc, this.arrival.mesh, this.target);
		this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
	}

	/** This session's record (js/session-store.js): cleared at Enter VR and by New visitor. */
	get record() { return this.xr.store; }

	/** The input in use: controllers if any is held, else bare hands. */
	kind() { return this.xr.input.active().length ? 'controllers' : 'hands'; }

	/**
	 * You did something a tip teaches ('walkin', 'teleport', 'turn', 'portal',
	 * 'grab'), anywhere: that tip is learnt for this session and input kind. In
	 * the pause, doing the tip on show ends it at once (the press sound).
	 */
	note(event) {
		this.record.tips.learnt.add(tipKey(event, this.kind()));
		if (event === 'teleport') this.target.visible = false;
		const p = this.fx?.pause;
		if (p?.tip?.id === event && p.t >= PAUSE.SKIP_AFTER && !p.ending) this.endTip(true);
	}

	/** Leaving VR: everything put away. */
	stop() {
		this.fx = null;
		this.group.visible = this.floor.visible = this.arc.visible = this.target.visible = false;
		this.arrival.mesh.visible = false;
		this.demo.stop();
	}

	/**
	 * Enter VR: the dark from the first frame, the tip if any, until the
	 * scale-model room draws smoothly (at most READY_LIMIT), then a fade in.
	 */
	enter() {
		this.colour = VOID.color;
		this.fx = { dir: 'enter', go: () => {}, t: 0, done: true };
		this.xr.veil.set('layer', 1, this.colour);
		this.startPause('enter');
	}

	/**
	 * Moves one layer, running `go` while the view is covered: 'in' (the
	 * tunnel, or the model grows, then the dark; sound dive), 'back' (a fade,
	 * then the home shrinks down onto the plinth; sound surface) or 'out' (a
	 * gentle fade to white, then the page). Menus close; the modes wait until
	 * it is over (was XRExperience.goLayer).
	 */
	go(dir, go, spot = null) {
		const xr = this.xr;
		if (this.fx || !xr.session) return;
		xr.ui.closeAll();
		if (dir !== 'out' && xr.soundLevel !== 'off') xr.sound.play(dir === 'in' ? 'dive' : 'surface');
		if (dir === 'in') this.note('walkin');
		this.fx = { dir, go, t: 0, done: false };
		if (dir === 'in' && WALK_IN_ZOOM && spot && xr.mode === 'dollhouse') {
			// (Where the zoom centres: the landing spot in the world, and what it scales from.)
			this.fx.tunnel = { at: xr.centerer.localToWorld(spot.clone()), stage: xr.stage.position.clone(), anchor: xr.anchor.position.clone(), scale: xr.anchor.scale.x };
		}
		this.colour = dir === 'out' ? 0xffffff : VOID.color;
	}

	/** Once a frame: the move in progress (the modes wait meanwhile), the room's name, the first-target ring. */
	update(dt) {
		if (this.fx) this.run(dt);
		this.runArrival(dt);
		this.runTarget(dt);
	}

	cover(v) { this.xr.veil.set('layer', v, this.colour); }

	run(dt) {
		const xr = this.xr, f = this.fx, doll = xr.modes.dollhouse;
		f.t += dt;
		if (f.pause) { this.runPause(dt); return; }
		const GROW = f.dir === 'in' ? WALK_IN_GROW : 0.3, OUT = f.dir === 'in' ? 0.15 : 0.1, IN = f.dir === 'in' ? PAUSE.REVEAL : 0.15, WHITE = 0.3;
		if (f.dir === 'out') {
			this.cover(Math.min(1, f.t / WHITE));
			if (f.t >= WHITE && !f.done) { f.done = true; this.fx = null; f.go(); }
			return;
		}
		if (f.dir === 'in') {
			if (!f.done && f.tunnel) { this.runTunnel(f); return; }
			if (!f.done) {
				// Only the model grows (the gallery stays still, a fixed frame), eased in and out, with a soft vignette; then the dark.
				const g = Math.min(1, f.t / GROW);
				if (xr.mode === 'dollhouse') { doll.doll.zoom = 1 + 0.6 * ease.inOut(g); doll.apply(); }
				xr.veil.setVignette(Math.min(1, f.t / 0.3) * (WALK_IN_GROW > 0.5 ? 1 : 0));
				this.cover(THREE.MathUtils.clamp((f.t - GROW) / OUT, 0, 1));
				if (f.t >= GROW + OUT) {
					xr.veil.setVignette(0);
					doll.doll.zoom = 1; // (the scale model is as you left it when you come back)
					this.arrived(f);
				}
			} else {
				this.cover(Math.max(0, 1 - f.t / IN));
				if (f.t >= IN) { this.cover(0); this.fx = null; }
			}
			return;
		}
		// 'back': the fade, then (a pause, then) the home settles back onto the plinth.
		if (!f.done) {
			this.cover(Math.min(1, f.t / OUT));
			if (f.t >= OUT) this.arrived(f);
		} else {
			this.cover(Math.max(0, 1 - f.t / IN));
			const g = Math.min(1, f.t / GROW);
			if (xr.mode === 'dollhouse') { doll.doll.zoom = 1 + 0.6 * (1 - ease.out(g)); doll.apply(); }
			if (f.t >= GROW) { doll.doll.zoom = 1; if (xr.mode === 'dollhouse') doll.apply(); this.cover(0); this.fx = null; }
		}
	}

	/** The view is covered: run the move, then the pause (a tip left) or straight on. */
	arrived(f) {
		const xr = this.xr;
		f.done = true; f.t = 0;
		f.go();
		// Every arrival at the scale model puts the plinth in front of you, the model
		// level on it, here behind the dark (you may have turned and walked inside).
		if (f.dir === 'back' && xr.mode === 'dollhouse') xr.recentreHere();
		this.startPause(f.dir); // (with a tip, or only until the place is ready: the plain fade's dark gap)
	}

	/**
	 * The tunnel zoom (WALK_IN_ZOOM): the dim closes in to a 60° circle on the
	 * landing spot (0-0.5 s, eased out), the room and the model scale x1 ->
	 * x1.4 about it (0.2-1.3 s, smootherstep), the view fades to black
	 * (1.25-1.6 s), then inside the pause or the fade lifts. The floor under
	 * your feet never moves: the spot is ahead of you, below the eyes.
	 */
	runTunnel(f) {
		const xr = this.xr, z = f.tunnel, t = f.t;
		const k = Math.min(1, Math.max(0, (t - ZOOM.from) / (ZOOM.to - ZOOM.from))), s = 1 + (ZOOM.x - 1) * ease.smooth(k); // (smootherstep: no jolt at either end)
		xr.stage.scale.setScalar(s);
		xr.stage.position.copy(z.stage).sub(z.at).multiplyScalar(s).add(z.at);
		xr.anchor.position.copy(z.anchor).sub(z.at).multiplyScalar(s).add(z.at);
		xr.anchor.scale.setScalar(z.scale * s);
		xr.anchor.updateMatrixWorld(true);
		xr.veil.setTunnel(ease.out(Math.min(1, t / ZOOM.close)), xr.camera.worldToLocal(z.at.clone())); // (closes in eased out)
		this.cover(THREE.MathUtils.clamp((t - ZOOM.black) / (ZOOM.end - ZOOM.black), 0, 1));
		if (t >= ZOOM.end) {
			xr.veil.setTunnel(0);
			xr.stage.scale.setScalar(1); xr.stage.position.copy(z.stage); // (the scale model as you left it)
			xr.modes.dollhouse.apply();
			f.tunnel = null;
			this.arrived(f);
		}
	}

	// -----------------------------------------------------------------------
	// The pause itself
	// -----------------------------------------------------------------------

	/**
	 * Begins the pause for a transition: with a tip if one is left, else only
	 * until the place is ready (the plain fade's dark gap; past it, the void,
	 * the rings and the place's name). Returns true if a tip shows.
	 */
	startPause(transition) {
		const f = this.fx;
		f.pause = { transition, tip: null, kind: this.kind(), t: 0, count: 0, shown: 0, tips: 0, frames: [], waited: 0, ending: null, aim: null, away: 0, follow: null, waiting: false };
		this.cover(1);
		this.floor.visible = false;
		// Enter VR: nothing to place yet. The 2D page's camera is still the camera, and no controller has
		// connected: the tip is chosen and placed once the head has a pose (choose(), from runPause).
		if (transition === 'enter') { f.pause.choosing = { poses: 0, since: 0 }; return false; }
		return this.chooseTip(f.pause);
	}

	/** Chooses the pause's tip for the input in hand, and shows it in front of the head. Returns true if one shows. */
	chooseTip(p) {
		const xr = this.xr, kind = this.kind(), transition = p.transition;
		const tip = this.tipsOn ? nextTip(transition, this.record, kind, { all: DEV.tips }) : null;
		Object.assign(p, { tip, kind, tips: tip ? 1 : 0 });
		if (tip) {
			this.record.tips.seen.add(tipKey(tip.id, kind));
			this.placeTip(transition === 'in' ? xr.roomHere() : '');
			this.showTip(tip, kind);
		}
		this.floor.visible = !!tip;
		return !!tip;
	}

	/**
	 * Enter VR, each frame until chosen: the head needs a pose that has been
	 * drawn once (the camera then follows it), and the input a moment to
	 * connect (a controller, or CHOOSE_WAIT for bare hands). Then the tip.
	 * Returns true while still waiting.
	 */
	choose(p, dt) {
		const c = p.choosing;
		if (!this.xr.viewerMatrix()) return true;
		c.poses++;
		c.since += dt;
		if (c.poses < 2 || (!this.xr.input.controllers.some((k) => k.source) && c.since < PAUSE.CHOOSE_WAIT)) return true;
		p.choosing = null;
		p.t = 0; // (the tip's own clock: its fade in, its 2.0-3.5 s, the skip after 0.8 s)
		this.chooseTip(p);
		return false;
	}

	/** The place's name, shown while a tip-less wait runs long: the room's at Walk in, the home's otherwise. */
	placeName(transition) {
		const xr = this.xr;
		return (transition === 'in' ? xr.roomHere() : '') || xr.model?.name || '';
	}

	/** The tip in front of you, world-locked: 1.4 m ahead, 10° below eye level; the room's name above it. */
	placeTip(name = this.nameLabel.text) {
		const xr = this.xr, head = xr.camera.matrix, yaw = yawOf(head), below = THREE.MathUtils.degToRad(PAUSE.BELOW);
		const p = this._v.setFromMatrixPosition(head);
		this.group.position.set(p.x - Math.sin(yaw) * PAUSE.AHEAD * Math.cos(below), p.y - PAUSE.AHEAD * Math.sin(below), p.z - Math.cos(yaw) * PAUSE.AHEAD * Math.cos(below));
		this.group.rotation.set(0, yaw, 0);
		this.nameLabel.set(name || '');
		this.nameLabel.mesh.visible = !!name;
		this.nameLabel.mesh.position.set(0, PAUSE.AHEAD * Math.tan(THREE.MathUtils.degToRad(PAUSE.NAME_ABOVE)) + 0.06, 0);
		// The floor rings: at your real floor, centred under you.
		this.floor.position.set(p.x, 0.002, p.z);
	}

	/** Shows a tip's words (and its demonstration, if it has one). */
	showTip(tip, kind) {
		const xr = this.xr;
		this.tipLabel.set(tip[kind] ?? tip.hands);
		this.tipLabel.mesh.material.opacity = 0;
		this.group.visible = true;
		this.demo.stop();
		if (tip.demo) {
			// (The demonstration's arc lands on the floor ring ahead: 2 m ahead at your real floor.)
			const yaw = xr.viewYaw(), head = xr.headWorld(); // (in the world: the rig may be turned)
			const floorY = xr.rig.localToWorld(this._w.set(0, 0, 0)).y;
			const to = new THREE.Vector3(head.x - Math.sin(yaw) * 2, floorY + 0.01, head.z - Math.cos(yaw) * 2);
			this.demo.play(kind, to, { demo: tip.demo });
		}
	}

	runPause(dt) {
		const xr = this.xr, f = this.fx, p = f.pause;
		p.t += dt;
		p.count++;
		p.frames.push(dt);
		if (p.frames.length > PAUSE.READY_FRAMES) p.frames.shift();
		if (p.choosing && this.choose(p, dt)) return; // (Enter VR: the dark until the head has a pose)
		const ready = isReady(p.frames) || p.t >= PAUSE.READY_LIMIT;
		this.demo.update(dt);
		if (!p.tip) { // (no tip: the dark until the place is ready)
			if (ready) { this.reveal(); return; }
			// Longer than the plain fade's dark gap: the void, the rings and the place's name where a tip would be (never plain black).
			if (p.t > PAUSE.GAP && !p.waiting) {
				p.waiting = true;
				this.placeTip('');
				this.tipLabel.set(this.placeName(p.transition));
				this.group.visible = this.floor.visible = true;
			}
			if (p.waiting) this.setTipAlpha(Math.min(1, (p.t - PAUSE.GAP) / PAUSE.TIP_IN));
			return;
		}
		// The tip fades in, is shown, fades out; the place then fades in.
		if (p.ending) {
			p.ending.t += dt;
			const a = Math.max(0, 1 - p.ending.t / PAUSE.TIP_OUT);
			this.setTipAlpha(a);
			if (a <= 0 && ready) this.reveal();
			return;
		}
		const a = Math.min(1, p.t / PAUSE.TIP_IN);
		this.setTipAlpha(a);
		if (a >= 1) p.shown += dt;
		this.follow(dt);
		this.practise(dt);
		if (p.ending) return;
		if (p.shown >= PAUSE.SHOWN && ready) { this.endTip(false); return; }
		// Still loading: after NEXT, the next tip of this transition cross-fades in (two at most).
		if (!ready && p.t >= PAUSE.NEXT * p.tips && p.tips < PAUSE.MAX_TIPS) {
			const next = this.tipsOn ? nextTip(p.transition, this.record, p.kind) : null;
			if (next) { p.tips++; p.tip = next; this.record.tips.seen.add(tipKey(next.id, p.kind)); this.showTip(next, p.kind); p.shown = 0; }
		}
	}

	setTipAlpha(a) {
		this.tipLabel.mesh.material.opacity = a;
		this.nameLabel.mesh.material.opacity = a;
		this.floor.material.opacity = a;
	}

	/** The tip ends: learnt (you did it: the press sound) or not (its time, or a skip). */
	endTip(learnt) {
		const xr = this.xr, p = this.fx?.pause;
		if (!p || p.ending) return;
		if (learnt && xr.soundLevel !== 'off') xr.sound.play('press');
		p.ending = { t: 0, learnt };
		this.demo.fadeOut();
		this.arc.visible = false;
	}

	/** The pause is over: the place fades in. */
	reveal() {
		const f = this.fx, p = f.pause;
		// How long the dark lasted (frame time, frames) and whether the room was ready or the cap ended it: read by the emulator test.
		this.last = { transition: p.transition, t: p.t, frames: p.count, capped: !isReady(p.frames) && p.t >= PAUSE.READY_LIMIT };
		f.pause = null;
		f.t = 0;
		this.group.visible = this.floor.visible = this.arc.visible = false;
		this.demo.stop();
		if (f.dir === 'enter') f.dir = 'in'; // (the same fade in as stepping inside)
		else if (p.transition === 'in' && !p.tip) this.showArrival(this.xr.roomHere() || 'Inside'); // (no tip left: the room's name, 1.5 s)
	}

	/**
	 * Turned away more than AWAY degrees for over AWAY_FOR s: the tip glides
	 * back in front of you over FOLLOW s. Never head-locked.
	 */
	follow(dt) {
		const xr = this.xr, p = this.fx.pause;
		if (p.follow) {
			p.follow.t += dt;
			const k = ease.inOut(Math.min(1, p.follow.t / PAUSE.FOLLOW));
			this.group.position.lerpVectors(p.follow.from, p.follow.to, k);
			this.group.rotation.y = p.follow.yaw0 + angleDiff(p.follow.yaw0, p.follow.yaw1) * k;
			if (k >= 1) p.follow = null;
			return;
		}
		const yaw = yawOf(xr.camera.matrix), at = this.group.position, head = this._v.setFromMatrixPosition(xr.camera.matrix);
		const off = Math.abs(angleDiff(yaw, Math.atan2(-(at.x - head.x), -(at.z - head.z))));
		p.away = off > THREE.MathUtils.degToRad(PAUSE.AWAY) ? p.away + dt : 0;
		if (p.away > PAUSE.AWAY_FOR) {
			const from = this.group.position.clone(), yaw0 = this.group.rotation.y;
			this.placeTip();
			p.follow = { t: 0, from, to: this.group.position.clone(), yaw0, yaw1: this.group.rotation.y };
			this.group.position.copy(from); this.group.rotation.y = yaw0;
			p.away = 0;
			if (p.tip?.demo) this.showTip(p.tip, p.kind);
		}
	}

	/**
	 * The pause's input: the teleport tip can be practised (pinch and hold,
	 * or hold a trigger: an arc onto the floor ring; let go once it has shown
	 * PRACTICE_SHOWN: learnt, and the jump is the step inside). Any other
	 * press after SKIP_AFTER ends the tip (seen, not learnt).
	 */
	practise(dt) {
		const xr = this.xr, p = this.fx.pause, input = xr.input;
		const canSkip = p.t >= PAUSE.SKIP_AFTER;
		for (const c of input.active()) {
			c.claim.trigger = 'ui'; // (nothing else acts during the pause)
			if (c.state.down.trigger) p.aim = { c, age: 0 };
			if (p.aim?.c === c && !c.state.trigger) { this.letGo(canSkip); return; }
		}
		for (const c of input.gestureHands?.() ?? []) {
			for (const e of c.gestures ?? []) {
				if (e.type === 'pinch') p.aim = { c, age: 0 };
				else if (e.type === 'tap' && !p.aim && canSkip) { this.endTip(false); return; }
				else if ((e.type === 'pinchEnd' || e.type === 'open' || e.type === 'lost') && p.aim?.c === c) { if (e.type === 'pinchEnd') this.letGo(canSkip); else { p.aim = null; this.arc.visible = false; } return; }
			}
		}
		if (!p.aim) return;
		p.aim.age += dt;
		if (!p.tip?.practise) return; // (other tips are only watched)
		// The arc: from the pinch (aimed from the shoulder through it) or along the controller's ray, onto your real floor.
		const c = p.aim.c, head = xr.headWorld(), floorY = xr.rig.localToWorld(this._w.set(0, 0, 0)).y;
		let origin, dir;
		if (c.isHand) {
			const at = c.gesture?.shape?.pinchAt;
			if (!at) return;
			({ origin, dir } = handAimRay(head, xr.viewAxes().right, at, c.handedness));
		} else {
			input.setRaycaster(c, xr.raycaster);
			origin = xr.raycaster.ray.origin; dir = xr.raycaster.ray.direction;
		}
		const { points, land } = practiceArc(origin, dir, floorY, this.arcPts);
		p.aim.land = land;
		this.arc.geometry.setFromPoints(points);
		this.arc.visible = !!land;
	}

	/** Letting go in the pause: a practice jump (learnt), else a skip once allowed. */
	letGo(canSkip) {
		const p = this.fx.pause, aim = p.aim;
		p.aim = null;
		this.arc.visible = false;
		if (p.tip?.practise && aim?.land && aim.age >= PAUSE.PRACTICE_SHOWN) { this.note(p.tip.id); this.endTip(true); return; }
		if (canSkip) this.endTip(false);
	}

	// -----------------------------------------------------------------------
	// Inside: the room's name, and the first-target ring
	// -----------------------------------------------------------------------

	/**
	 * The arrival title inside (no tip left): the room's name, 1.5 m in front of
	 * you for 1.5 s, just above eye level, then it fades. (The scale model's
	 * went on 26 Nov 2026.)
	 */
	showArrival(text) {
		const head = this.xr.camera.matrix, yaw = yawOf(head);
		const p = this._v.setFromMatrixPosition(head);
		this.arrival.set(text);
		this.arrival.mesh.position.set(p.x - Math.sin(yaw) * 1.5, p.y + 0.05, p.z - Math.cos(yaw) * 1.5);
		this.arrival.mesh.rotation.set(0, yaw, 0);
		this.arrival.mesh.visible = true;
		this.arrivalT = PAUSE.ARRIVAL;
	}

	runArrival(dt) {
		if (!this.arrival.mesh.visible) return;
		this.arrivalT -= dt;
		this.arrival.mesh.material.opacity = Math.min(1, Math.max(0, this.arrivalT / 0.3));
		if (this.arrivalT <= 0) this.arrival.mesh.visible = false;
	}

	/**
	 * The first-target ring: the first time inside each session, an orange
	 * ring on a spot ahead (the nearest hotspot 1.5-4 m ahead, else 2.5 m
	 * ahead) until your first teleport. In place, no card.
	 */
	runTarget(dt) {
		const xr = this.xr, t = this.target;
		if (xr.mode !== 'walk') { t.visible = false; return; }
		if (!this.record.target && !this.fx && this.tipsOn) {
			this.record.target = true;
			if (!this.record.tips.learnt.has(tipKey('teleport', 'hands')) && !this.record.tips.learnt.has(tipKey('teleport', 'controllers'))) {
				t.position.copy(findTarget(xr));
				t.visible = true;
				this.targetT = 0;
			}
		}
		if (t.visible) t.material.opacity = 0.55 + 0.35 * Math.sin((this.targetT += dt) * 4);
	}
}

/** The floor rings (PAUSE.RINGS): one line object, opacity per vertex. */
function buildRings() {
	const pts = [], cols = [], line = new THREE.Color(VOID.line);
	for (const [r, a] of PAUSE.RINGS) {
		const n = 96;
		for (let i = 0; i < n; i++) {
			for (const k of [i, i + 1]) {
				const u = (k / n) * Math.PI * 2;
				pts.push(Math.cos(u) * r, 0, Math.sin(u) * r);
				cols.push(line.r, line.g, line.b, a);
			}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
	const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false }));
	m.renderOrder = 1003;
	m.frustumCulled = false;
	m.visible = false;
	m.name = 'pause-floor';
	return m;
}

/** The orange ring's spot: the nearest hotspot 1.5-4 m ahead, else a floor point 2.5 m ahead (else just ahead of you). */
function findTarget(xr) {
	const head = xr.headWorld(), { forward } = xr.viewAxes();
	let best = null;
	for (const s of xr.model?.hotspots ?? xr.modes.walk.spots?.() ?? []) {
		const p = xr.centerer.localToWorld(new THREE.Vector3(s.x, s.y, s.z));
		const d = Math.hypot(p.x - head.x, p.z - head.z);
		const ahead = (p.x - head.x) * forward.x + (p.z - head.z) * forward.z;
		if (d < 1.5 || d > 4 || ahead < d * 0.7) continue;
		if (!best || Math.abs(d - 2.5) < Math.abs(best.d - 2.5)) best = { p, d };
	}
	const at = best?.p ?? xr.findFloor(head.clone().addScaledVector(forward, 2.5), 0.5) ?? head.clone().addScaledVector(forward, 2.5).setY(head.y - xr.lift);
	return at.clone().setY(at.y + 0.015);
}

/** The heading of a camera matrix (radians about the vertical; 0 looks along -Z), as XRExperience's yawOfMatrix. */
const _f = new THREE.Vector3();
function yawOf(m) {
	_f.set(0, 0, -1).transformDirection(m);
	return Math.atan2(-_f.x, -_f.z);
}

/** The shortest signed angle from a to b (radians). */
function angleDiff(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
