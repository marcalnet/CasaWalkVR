// The tools' first-time introduction (SPEC.md phase 17, milestone C3; placed
// by the UX design of 25 Nov 2026): the first time someone is at the scale
// model (remembered on the device), once they look towards it, the three
// tools hang above the model, 1.3 m away and 15° below eye level (so they
// never hide it), each about 32 cm long, slowly turning, with their names
// hand-lettered underneath. After about five seconds, or as soon as a hand or
// a laser reaches towards them, they shrink and fly one after another to the
// fan's wrist (a whoosh, a tick as each arrives), and the fan opens by itself
// for 2 s so you see where they live (the one time it opens without a look).
// Help replays it.
//
// The tools themselves stay in the fan the whole time: the introduction
// flies copies (never in photos).

import * as THREE from 'three';
import { buildCamera, buildMeter, buildMarker } from './tool-models.js';
import { Label } from './panel.js';
import { readSetting, writeSetting } from './settings.js';
import { zoneOf, zoneHull } from './wings.js';
import { handAimRay } from './gestures.js';

const AHEAD = 1.3, DOWN = 15, SPACING = 0.38, BIG = 0.32; // metres (DOWN: degrees below eye level)
// Above the model as seen (the interaction harmony's conflict 3: on the bare-hands plinth it hung inside the model):
// its lower edge (the name tags' foot, LOWER below its middle) at least CLEAR_TOP above the model's highest point,
// its middle between UP_MOST and DOWN below eye level; if that can't clear, BACK further away at the same angle.
const LOWER = 0.345, CLEAR_TOP = 3, UP_MOST = 5, BACK = 0.3;
const LOOK = THREE.MathUtils.degToRad(30), LOOK_WIDE = THREE.MathUtils.degToRad(60), SETTLE = 1; // it starts when you look towards the model (within 30°) a second after arriving, within 60° after 4 s, and by itself after 10 s
const WIDE_AFTER = 4, TIMED_AFTER = 10; // (seconds; the Tester's finding: waiting for a look within 30° it might never be seen)
const MODEL_MIDDLE = 0.2; // metres above the plinth's top: about the middle of the model on it (0.6 m or 1.3 m high)
const FAN_OPEN = 2; // seconds the fan opens by itself as the tools land
const HOLD = 5; // seconds before they fly, unless reached for
const REACH = 0.9; // a hand (or a laser's aim) within this of a tool: it starts
const FLY = 0.6, GAP = 0.25; // each flight's length, and the time between them
const AT_TOOLS = THREE.MathUtils.degToRad(15); // a trigger or a pinch aimed within this of a tool starts their flight (the interaction harmony's conflict 7)

export class ToolsIntro {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.group = new THREE.Group();
		this.group.name = 'tools-intro';
		this.group.visible = false;
		this.items = [['Street camera', buildCamera()], ['Meter', buildMeter()], ['Marker', buildMarker({ ink: 'black' })]].map(([name, o]) => {
			const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
			const scale = BIG / Math.max(size.x, size.y, size.z);
			const holder = new THREE.Group();
			holder.add(o);
			const label = new Label({ height: 0.09 });
			label.set(name);
			label.mesh.position.y = -0.3;
			holder.add(label.mesh);
			this.group.add(holder);
			return { name, o, holder, label, scale };
		});
		xr.scene.add(this.group);
		xr.hideFromPhotos(this.group);
		this.state = null; // { t, flying (time since the flights began) }
		this._v = new THREE.Vector3();
	}

	/** True while it plays (the lesson waits for it). */
	get playing() { return !!this.state; }

	/** True while the tools hang in view or fly (not while it waits to be looked at): a teacher is on, so the aims wait. */
	get showing() { return !!this.state && !this.state.waiting; }

	/** Plays it the first time (or always, for Help). Returns true if it plays. */
	start({ again = false } = {}) {
		if (!again && readSetting('toolsIntro')) return false;
		this.again = again;
		this.state = { t: 0, flying: null, waiting: true }; // (it waits to be looked at: begin())
		return true;
	}

	/** Puts the tools above the model, in front of you, and starts them turning. */
	begin() {
		const xr = this.xr, head = xr.headWorld(), { forward, right } = xr.viewAxes();
		const { el, dist } = this.where(head);
		this.group.position.copy(head).addScaledVector(forward, dist * Math.cos(el));
		this.group.position.y += dist * Math.sin(el);
		this.group.lookAt(head);
		this.items.forEach((it, i) => {
			it.holder.position.set((i - 1) * SPACING, 0, 0);
			it.holder.scale.setScalar(1);
			it.o.scale.setScalar(it.scale);
			it.label.mesh.visible = true;
			it.holder.visible = true;
			it.from = null;
		});
		this.right = right.clone();
		this.state = { t: 0, flying: null };
		this.group.visible = true;
		// Seen once is seen: remembered as it appears, not when the last tool lands (build 120:
		// stepping inside during it, it played again by itself at the next visit).
		if (!this.again) writeSetting('toolsIntro', true);
	}

	/**
	 * Where it floats, from the eyes: { el (radians, below is negative), dist }.
	 * DOWN below eye level, AHEAD away; raised (to UP_MOST at most) so its lower
	 * edge clears the model's highest point as seen by CLEAR_TOP; BACK further
	 * away when that is not enough (the angle it shrinks to does the rest).
	 */
	where(head) {
		const xr = this.xr, D = THREE.MathUtils.degToRad;
		let el = -D(DOWN), dist = AHEAD;
		const box = xr.mode === 'dollhouse' && xr.model ? xr.modes.dollhouse.houseBox() : null; // (the house, not its lawn)
		const hull = box ? zoneHull(zoneOf(box, head, xr.viewYaw()) ?? []) : [];
		if (!hull.length) return { el, dist };
		const top = Math.max(...hull.map((p) => p.el));
		const need = (d) => top + D(CLEAR_TOP) + Math.atan(LOWER / d); // (the middle's angle that puts the lower edge clear)
		if (need(dist) > -D(UP_MOST)) dist += BACK;
		el = Math.min(-D(UP_MOST), Math.max(el, need(dist)));
		return { el, dist };
	}

	/** True while the head looks towards the scale model (within `limit`, 30° by default). */
	lookingAtModel(limit = LOOK) {
		const xr = this.xr, head = xr.headWorld(), look = this._look ??= new THREE.Vector3(), to = this._to ??= new THREE.Vector3();
		look.setFromMatrixColumn(xr.camera.matrixWorld, 2).negate();
		to.set(0, xr.plinthH + MODEL_MIDDLE, -xr.plinthDistance); xr.stage.localToWorld(to); to.sub(head).normalize(); // (about the middle of the model, above the plinth's middle)
		return look.angleTo(to) < limit;
	}

	stop() {
		this.state = null;
		this.group.visible = false;
	}

	/**
	 * A trigger pulled, or a pinch made, aimed within AT_TOOLS of a tool this
	 * frame: the trigger is used up (claimed) so it never also steps inside.
	 */
	aimedAt() {
		const xr = this.xr, input = xr.input, at = this._at2 ??= new THREE.Vector3(), dir = this._d2 ??= new THREE.Vector3();
		const towards = (origin, d) => this.items.some((it) => dir.copy(it.holder.getWorldPosition(at)).sub(origin).normalize().angleTo(d) < AT_TOOLS);
		let hit = false;
		for (const c of input.active()) {
			if (!c.state.down.trigger || c.claim.trigger) continue;
			input.setRaycaster(c, xr.raycaster);
			if (towards(xr.raycaster.ray.origin, xr.raycaster.ray.direction)) { c.claim.trigger = 'ui'; hit = true; }
		}
		for (const c of input.gestureHands?.() ?? []) {
			const at3 = c.gesture?.shape?.pinchAt;
			if (!at3 || !c.gestures.some((e) => e.type === 'pinch' || e.type === 'tap')) continue;
			const { origin, dir: d } = handAimRay(xr.headWorld(), xr.viewAxes().right, at3, c.handedness);
			if (towards(origin, d)) hit = true;
		}
		return hit;
	}

	/** Once a frame. Calls onDone() when the last tool has landed. */
	update(dt, onDone) {
		const s = this.state;
		if (!s) return;
		const xr = this.xr;
		s.t += dt;
		// Waiting: once you have been here a second (Help: at once) and look towards the model, they appear.
		if (s.waiting) {
			// (Never while the board or the wrist menu is open: it would play unseen behind it. One teacher at a time:
			// the arrival title first, then a second's pause; the interaction harmony's conflict 12.)
			if (xr.boardOpen || xr.ui.wrist.open) return;
			if (xr.arrival?.mesh.visible) { s.t = 0; return; }
			const seen = this.lookingAtModel() && s.t >= (this.again ? 0 : SETTLE) || this.lookingAtModel(LOOK_WIDE) && s.t >= WIDE_AFTER || s.t >= TIMED_AFTER;
			if (seen) this.begin();
			return;
		}
		// Slowly turning, until they fly.
		for (const it of this.items) if (!it.from) it.o.rotation.y += dt * 0.6;
		// Reached for (a fingertip, a controller's tip, or a laser's aim): they fly now.
		if (s.flying === null) {
			let near = s.t >= HOLD;
			for (const it of this.items) {
				const p = it.holder.getWorldPosition(this._v);
				for (const c of xr.input.touches?.() ?? []) if (c.touch.tip.distanceTo(p) < REACH * 0.4) near = true;
			}
			if (this.aimedAt()) near = true; // (a trigger or a pinch towards them: the aims wait while they show)
			if (near) { s.flying = 0; if (xr.soundLevel !== 'off') xr.sound.play('whoosh'); if (xr.fan) xr.fan.force = FLY + 2 * GAP + FAN_OPEN; }
			return;
		}
		s.flying += dt;
		// One after another to the fan's wrist, shrinking.
		const fan = xr.fan, target = fan?.group.getWorldPosition(new THREE.Vector3()) ?? xr.headWorld();
		if (fan) { const h = fan.hands().fan; if (h) xr.input.wristOf(h).getWorldPosition(target).y += 0.15; }
		let done = 0;
		this.items.forEach((it, i) => {
			const k = THREE.MathUtils.clamp((s.flying - i * GAP) / FLY, 0, 1);
			if (k <= 0) return;
			if (!it.from) { it.from = it.holder.getWorldPosition(new THREE.Vector3()); it.label.mesh.visible = false; }
			const e = k * k * (3 - 2 * k);
			const p = it.from.clone().lerp(target, e);
			p.y += Math.sin(Math.PI * e) * 0.25;
			it.holder.position.copy(this.group.worldToLocal(p));
			it.o.scale.setScalar(it.scale * (1 - e) + (it.o.userData.fanScale ?? 0.8) * e);
			if (k >= 1 && it.holder.visible) {
				it.holder.visible = false;
				if (xr.soundLevel !== 'off') xr.sound.play('tick');
				const c = fan?.hands().fan;
				if (c?.isController) xr.haptics.play(c, 'tick');
			}
			if (k >= 1) done++;
		});
		if (done === this.items.length) {
			this.stop();
			onDone?.();
		}
	}
}
