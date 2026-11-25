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

const AHEAD = 1.3, DOWN = 15, SPACING = 0.38, BIG = 0.32; // metres (DOWN: degrees below eye level)
const LOOK = THREE.MathUtils.degToRad(30), SETTLE = 1; // it waits until you look towards the model (within this), and this long (s) after you arrive
const MODEL_MIDDLE = 0.8; // metres above the stage floor: about the middle of the model on the plinth
const FAN_OPEN = 2; // seconds the fan opens by itself as the tools land
const HOLD = 5; // seconds before they fly, unless reached for
const REACH = 0.9; // a hand (or a laser's aim) within this of a tool: it starts
const FLY = 0.6, GAP = 0.25; // each flight's length, and the time between them

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
		const down = THREE.MathUtils.degToRad(DOWN);
		this.group.position.copy(head).addScaledVector(forward, AHEAD * Math.cos(down));
		this.group.position.y -= AHEAD * Math.sin(down);
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
	}

	/** True while the head looks towards the scale model (within 30°). */
	lookingAtModel() {
		const xr = this.xr, head = xr.headWorld(), look = this._look ??= new THREE.Vector3(), to = this._to ??= new THREE.Vector3();
		look.setFromMatrixColumn(xr.camera.matrixWorld, 2).negate();
		to.set(0, MODEL_MIDDLE, -xr.plinthDistance); xr.stage.localToWorld(to); to.sub(head).normalize(); // (about the middle of the model, above the plinth's middle)
		return look.angleTo(to) < LOOK;
	}

	stop() {
		this.state = null;
		this.group.visible = false;
	}

	/** Once a frame. Calls onDone() when the last tool has landed. */
	update(dt, onDone) {
		const s = this.state;
		if (!s) return;
		const xr = this.xr;
		s.t += dt;
		// Waiting: once you have been here a second (Help: at once) and look towards the model, they appear.
		if (s.waiting) {
			if (s.t >= (this.again ? 0 : SETTLE) && this.lookingAtModel()) this.begin();
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
			writeSetting('toolsIntro', true);
			onDone?.();
		}
	}
}
