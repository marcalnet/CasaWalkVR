// The marker (SPEC.md phase 17, milestone F): a thick felt-tip. Hold the
// trigger to draw a stroke in the air from its nib; the stroke is a tube
// about 8 mm thick (to the eye, as drawn), one draw call per stroke, grown in
// place as you draw (a preallocated buffer: nothing rebuilt). Colours: black
// (the default), blue, green, red, all free; press the stick of the hand
// holding it to change colour (its cap shows the colour). A = undo the last
// stroke; hold A = clear all (Y when mirrored).
// With bare hands (js/xr-tools.js): a thumb tap starts a stroke and the next
// tap ends it; a thumb swipe left or right changes colour; a swipe back
// undoes the last stroke.
//
// Strokes live in the tools' annotations, in model space: they move with the
// scale model and stay put while walking. Photos keep them.

import * as THREE from 'three';
import { buildMarker, MARKER_INKS } from './tool-models.js';

export const INKS = ['black', 'blue', 'green', 'red'];
const RADIUS = 0.004; // metres, to the eye when drawn
const STEP = 0.004; // metres, to the eye: a new point every this much movement
const SIDES = 6; // the tube's sides
const MAX_POINTS = 1500; // per stroke (a long stroke ends and a new one begins)

export class MarkerTool {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'marker';
		this.live = true;
		this.controls = ['stickPress']; // the stick press of its hand changes colour
		this.ink = 0;
		this.object = buildMarker({ ink: INKS[this.ink] });
		this.tip = this.object.getObjectByName('tip');
		this.strokes = [];
		this.drawing = null; // the stroke being drawn
		this.held = null;
		this.materials = INKS.map((k) => new THREE.MeshLambertMaterial({ color: MARKER_INKS[k], name: `ink-${k}` }));
		this._p = new THREE.Vector3();
	}

	take(c) { this.held = c; }
	putBack() { this.endStroke(); this.held = null; }

	/** Controllers: down starts a stroke, up ends it. Bare hands: each tap starts or ends one. */
	trigger(c, phase) {
		if (c?.isHand) { if (phase === 'down') (this.drawing ? this.endStroke() : this.startStroke()); return; }
		if (phase === 'down') this.startStroke();
		else this.endStroke();
	}

	/** A: undo the last stroke; hold A: clear all. */
	secondary(c, phase) {
		const xr = this.xr;
		const went = phase === 'hold' ? this.clear() : this.undo();
		if (xr.soundLevel !== 'off') xr.sound.play(went ? 'release' : 'deny');
	}

	/** Bare-hand gestures of the holding hand: a swipe left/right changes colour, back undoes; an open or lost hand ends a stroke. */
	gesture(c, e) {
		if (e.type === 'open' || e.type === 'lost') this.endStroke(); // (like a pinch that is lost: nothing keeps drawing)
		else if (e.type === 'turn') this.nextInk(e.dir);
		else if (e.type === 'step' && e.dir < 0) this.secondary(c, 'press');
	}

	/** The stick press of the holding controller: the next colour. */
	control(c, name) { if (name === 'stickPress') this.nextInk(1); }

	nextInk(dir = 1) {
		this.ink = (this.ink + (dir < 0 ? INKS.length - 1 : 1)) % INKS.length;
		this.object.userData.setInk(INKS[this.ink]);
		if (this.xr.soundLevel !== 'off') this.xr.sound.play('tick');
		if (this.held?.isController) this.xr.haptics.play(this.held, 'tick');
	}

	/** Model-space radius for a stroke drawn now (8 mm thick to the eye). */
	radius() { return RADIUS / Math.max(1e-6, this.xr.anchor.scale.x); }

	startStroke() {
		this.endStroke();
		const n = MAX_POINTS * SIDES;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
		const idx = new Uint32Array((MAX_POINTS - 1) * SIDES * 6);
		let k = 0;
		for (let i = 0; i < MAX_POINTS - 1; i++) for (let s = 0; s < SIDES; s++) {
			const a = i * SIDES + s, b = i * SIDES + (s + 1) % SIDES, c = a + SIDES, d = b + SIDES;
			idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
		}
		geo.setIndex(new THREE.BufferAttribute(idx, 1));
		geo.setDrawRange(0, 0);
		const mesh = new THREE.Mesh(geo, this.materials[this.ink]);
		mesh.name = 'stroke';
		mesh.frustumCulled = false;
		this.xr.tools.annotations.add(mesh);
		this.drawing = { mesh, geo, n: 0, last: null, r: this.radius(), prevDir: null };
		this.strokes.push(this.drawing);
		if (this.xr.soundLevel !== 'off') this.xr.sound.play('squeak', 0.6);
	}

	endStroke() {
		const s = this.drawing;
		this.drawing = null;
		if (s && s.n < 2) this.removeStroke(s); // (a dot too small to see: no stroke)
	}

	/** Adds a ring of the tube at model point p. */
	addPoint(s, p) {
		if (s.n >= MAX_POINTS) { this.startStroke(); return; }
		const dir = s.last ? p.clone().sub(s.last).normalize() : new THREE.Vector3(0, 0, 1);
		if (s.n === 1) this.ring(s, 0, s.last, dir); // (the first ring, now its direction is known)
		const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
		s.u = u; s.v = v;
		this.ring(s, s.n, p, dir);
		s.n++;
		s.last = p.clone();
		if (s.n >= 2) s.geo.setDrawRange(0, (s.n - 1) * SIDES * 6);
		s.geo.attributes.position.needsUpdate = s.geo.attributes.normal.needsUpdate = true;
		s.geo.computeBoundingSphere();
	}

	ring(s, i, p, dir) {
		const pos = s.geo.attributes.position.array, nor = s.geo.attributes.normal.array;
		const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
		for (let k = 0; k < SIDES; k++) {
			const a = (k / SIDES) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
			const nx = u.x * cx + v.x * cy, ny = u.y * cx + v.y * cy, nz = u.z * cx + v.z * cy;
			const o = (i * SIDES + k) * 3;
			pos[o] = p.x + nx * s.r; pos[o + 1] = p.y + ny * s.r; pos[o + 2] = p.z + nz * s.r;
			nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
		}
	}

	removeStroke(s) {
		s.mesh.removeFromParent();
		s.geo.dispose();
		const i = this.strokes.indexOf(s);
		if (i >= 0) this.strokes.splice(i, 1);
	}

	undo() {
		if (this.drawing) this.endStroke();
		const s = this.strokes.pop();
		if (!s) return false;
		this.strokes.push(s);
		this.removeStroke(s);
		return true;
	}

	clear() {
		this.drawing = null;
		const had = this.strokes.length > 0;
		while (this.strokes.length) this.removeStroke(this.strokes[this.strokes.length - 1]);
		return had;
	}

	/** Once a frame while held: the nib draws. */
	update(dt) {
		const s = this.drawing;
		if (!s || !this.held) return;
		// A jump (a teleport's fade, stepping inside or back) or a hand no longer tracked ends the
		// stroke: it never draws a line across the jump (the tester's finding).
		const xr = this.xr;
		if (xr.layerFx || xr.modes?.walk?.fade || (this.held.isHand && !this.held.touch?.tracked)) { this.endStroke(); return; }
		this.object.updateMatrixWorld(true);
		const p = this.xr.centerer.worldToLocal(this.tip.getWorldPosition(this._p).clone());
		const step = STEP / Math.max(1e-6, this.xr.anchor.scale.x);
		if (!s.last || p.distanceTo(s.last) >= step) {
			if (s.n === 0) { s.last = p.clone(); s.n = 1; return; }
			this.addPoint(s, p);
			if (this.held?.isController && s.n % 6 === 0) this.xr.haptics.play(this.held, 'tick');
		}
	}
}
