// The marker (SPEC.md phase 17, milestone F): a thick felt-tip. Hold the
// trigger to draw a stroke in the air from its nib; the stroke is a tube
// about 8 mm thick (to the eye, as drawn), one draw call per stroke, grown in
// place as you draw (a preallocated buffer: nothing rebuilt). Colours: black
// (the default), blue, green, red, all free; press the stick of the hand
// holding it to change colour (its cap shows the colour). A = undo the last
// stroke; hold A = clear all (Y when mirrored).
// Bare hands: not yet (the marker held like a pen, drawing where its nib
// touches, comes with item 11 of the Quest 2 fixes).
//
// Strokes live in the tools' annotations, in model space: they move with the
// scale model and stay put while walking. Photos keep them.

import * as THREE from 'three';
import { HOLD } from './hold.js';
import { buildMarker, MARKER_INKS } from './tool-models.js';
import { readSetting, writeSetting } from './settings.js';

export const INKS = ['black', 'blue', 'green', 'red'];
const RADIUS = 0.004; // metres, to the eye when drawn
const STEP = 0.004; // metres, to the eye: a new point every this much movement
const SIDES = 6; // the tube's sides
const MAX_POINTS = 1500; // per stroke (a long stroke ends and a new one begins)
const START_POINTS = 64; // a stroke's buffers start this big and double when full
const JUMP = 0.3; // metres: the nib moving more than this in a frame ends the stroke
const RIG_JUMP = 0.1; // metres: the rig moving more than this in a frame (a teleport, a step) ends it

export class MarkerTool {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'marker';
		this.live = true;
		this.controls = ['stickPress']; // the stick press of its hand steps its one option: the colour (js/tool-dial.js)
		this.ink = Math.max(0, INKS.indexOf(readSetting('markerColour')));
		this.option = { part: 'cap', at: 'dial', stops: INKS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })), get: () => INKS[this.ink], set: (k) => this.setInk(k) };
		this.object = buildMarker({ ink: INKS[this.ink] });
		this.tip = this.object.getObjectByName('tip');
		this.strokes = [];
		this.drawing = null; // the stroke being drawn
		this.held = null;
		this.materials = INKS.map((k) => new THREE.MeshLambertMaterial({ color: MARKER_INKS[k], name: `ink-${k}` }));
		this._p = new THREE.Vector3(); this._q = new THREE.Vector3(); this._d = new THREE.Vector3(); this._u = new THREE.Vector3(); this._v = new THREE.Vector3(); this._up = new THREE.Vector3();
		this.merged = INKS.map(() => null); // the finished strokes, one mesh per colour
	}

	take(c) { this.held = c; }
	putBack() { this.endStroke(); this.held = null; }

	/** Controllers: down starts a stroke, up ends it. */
	trigger(c, phase) {
		if (phase === 'down') this.startStroke();
		else this.endStroke();
	}

	/** A: undo the last stroke; hold A: clear all. */
	secondary(c, phase) {
		const xr = this.xr;
		const went = phase === 'hold' ? this.clear() : this.undo();
		if (xr.soundLevel !== 'off') xr.sound.play(went ? 'release' : 'deny');
	}

	/** The holding hand lost: a stroke in progress ends (nothing keeps drawing). */
	gesture(c, e) {
		if (e.type === 'lost') this.endStroke();
	}

	/** The stick press of the holding controller: the next colour, the dial shown (js/tool-dial.js). */
	control(c, name) { if (name === 'stickPress') this.xr.dial?.step(this); }

	/** The ink: a colour of INKS, remembered; the cap shows it. */
	setInk(k) {
		const i = INKS.indexOf(k);
		if (i < 0) return;
		this.ink = i;
		this.object.userData.setInk(k);
		writeSetting('markerColour', k);
	}


	/** Model-space radius for a stroke drawn now (8 mm thick to the eye). */
	radius() { return RADIUS / Math.max(1e-6, this.xr.anchor.scale.x); }

	startStroke() {
		this.endStroke();
		const geo = new THREE.BufferGeometry();
		const mesh = new THREE.Mesh(geo, this.materials[this.ink]);
		mesh.name = 'stroke';
		mesh.frustumCulled = false;
		this.xr.tools.annotations.add(mesh);
		this.drawing = { mesh, geo, ink: this.ink, n: 0, cap: 0, last: null, r: this.radius(), age: 0 };
		this.grow(this.drawing, START_POINTS);
		if (this.xr.soundLevel !== 'off') this.xr.sound.play('squeak', 0.6);
	}

	/**
	 * The stroke being drawn grows in place: its buffers start small and double
	 * when full (no large preallocation; the tester's measurement: 430 KB a
	 * stroke), and each new ring uploads only itself.
	 */
	grow(s, cap) {
		const pos = new Float32Array(cap * SIDES * 3), nor = new Float32Array(cap * SIDES * 3);
		if (s.cap) { pos.set(s.geo.attributes.position.array.subarray(0, s.n * SIDES * 3)); nor.set(s.geo.attributes.normal.array.subarray(0, s.n * SIDES * 3)); }
		s.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
		s.geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
		s.geo.setIndex(new THREE.BufferAttribute(tubeIndex(cap), 1));
		s.geo.setDrawRange(0, Math.max(0, s.n - 1) * SIDES * 6);
		s.cap = cap;
	}

	/** The stroke being drawn is finished: it joins its colour's one mesh (a dot too small to see is dropped). */
	endStroke() {
		const s = this.drawing;
		this.drawing = null;
		if (!s) return;
		s.mesh.removeFromParent();
		if (s.n >= 2) {
			const n = s.n * SIDES * 3;
			this.strokes.push({ ink: s.ink, n: s.n, pos: s.geo.attributes.position.array.slice(0, n), nor: s.geo.attributes.normal.array.slice(0, n) });
			this.rebuild(s.ink);
		}
		s.geo.dispose();
	}

	/** Rebuilds one colour's mesh from its finished strokes: one draw call per colour. */
	rebuild(ink) {
		const mine = this.strokes.filter((t) => t.ink === ink);
		let old = this.merged[ink];
		if (old) { old.removeFromParent(); old.geometry.dispose(); this.merged[ink] = null; }
		if (!mine.length) return;
		const points = mine.reduce((a, t) => a + t.n, 0);
		const pos = new Float32Array(points * SIDES * 3), nor = new Float32Array(points * SIDES * 3);
		const idx = [];
		let at = 0;
		for (const t of mine) {
			pos.set(t.pos, at * SIDES * 3); nor.set(t.nor, at * SIDES * 3);
			const base = at * SIDES;
			for (let i = 0; i < t.n - 1; i++) for (let k = 0; k < SIDES; k++) {
				const a = base + i * SIDES + k, b = base + i * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
				idx.push(a, c, b, b, c, d);
			}
			at += t.n;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
		geo.setIndex(points * SIDES > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
		geo.computeBoundingSphere();
		const mesh = new THREE.Mesh(geo, this.materials[ink]);
		mesh.name = `strokes-${INKS[ink]}`;
		this.xr.tools.annotations.add(mesh);
		this.merged[ink] = mesh;
	}

	/** Adds a ring of the tube at model point p (reused vectors: nothing allocated). */
	addPoint(s, p) {
		if (s.n >= MAX_POINTS) { const ink = this.ink; this.endStroke(); this.ink = ink; this.startStroke(); return; }
		if (s.n >= s.cap) this.grow(s, Math.min(MAX_POINTS, s.cap * 2));
		const dir = this._d.copy(p).sub(s.last).normalize();
		if (s.n === 1) this.ring(s, 0, s.last, dir); // (the first ring, now its direction is known)
		this.ring(s, s.n, p, dir);
		const from = (s.n === 1 ? 0 : s.n) * SIDES * 3, count = (s.n === 1 ? 2 : 1) * SIDES * 3;
		s.n++;
		s.last.copy(p);
		s.geo.setDrawRange(0, (s.n - 1) * SIDES * 6);
		for (const a of [s.geo.attributes.position, s.geo.attributes.normal]) { a.clearUpdateRanges?.(); a.addUpdateRange?.(from, count); a.needsUpdate = true; }
	}

	ring(s, i, p, dir) {
		const pos = s.geo.attributes.position.array, nor = s.geo.attributes.normal.array;
		const up = Math.abs(dir.y) < 0.9 ? this._up.set(0, 1, 0) : this._up.set(1, 0, 0);
		const u = this._u.crossVectors(dir, up).normalize(), v = this._v.crossVectors(dir, u);
		for (let k = 0; k < SIDES; k++) {
			const a = (k / SIDES) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
			const nx = u.x * cx + v.x * cy, ny = u.y * cx + v.y * cy, nz = u.z * cx + v.z * cy;
			const o = (i * SIDES + k) * 3;
			pos[o] = p.x + nx * s.r; pos[o + 1] = p.y + ny * s.r; pos[o + 2] = p.z + nz * s.r;
			nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
		}
	}

	/** Undo: the stroke being drawn, else the last finished one. */
	undo() {
		if (this.drawing) { const s = this.drawing; this.drawing = null; s.mesh.removeFromParent(); s.geo.dispose(); return true; }
		const t = this.strokes.pop();
		if (!t) return false;
		this.rebuild(t.ink);
		return true;
	}

	clear() {
		if (this.drawing) { this.drawing.mesh.removeFromParent(); this.drawing.geo.dispose(); this.drawing = null; }
		const had = this.strokes.length > 0;
		this.strokes.length = 0;
		for (let i = 0; i < INKS.length; i++) this.rebuild(i);
		return had;
	}

	/** Once a frame while held: the nib draws. */
	update(dt) {
		const s = this.drawing, xr = this.xr;
		// A jump ends the stroke, so it never draws a line across it (the tester's review): a
		// teleport's fade, stepping inside or back, a snap turn or a thumb step (the rig turns or
		// moves at once), the nib jumping more than JUMP in a frame, or a bare hand no longer tracked.
		const rig = xr.rig;
		const moved = rig && this._rig && (Math.abs(rig.rotation.y - this._rig.yaw) > 0.01 || rig.position.distanceTo(this._rig.pos) > RIG_JUMP);
		if (rig) { this._rig ??= { yaw: 0, pos: new THREE.Vector3() }; this._rig.yaw = rig.rotation.y; this._rig.pos.copy(rig.position); }
		if (!s || !this.held) return;
		if (xr.layerFx || xr.modes?.walk?.fade || moved || (this.held.isHand && !this.held.touch?.tracked)) { this.endStroke(); return; }
		s.age += dt;
		if (this.held.isHand && s.age < HOLD.STROKE_SKIP) return; // (a pinched stroke: its first 30 ms not drawn, the pinch moved the hand: build 215's C2)
		this.object.updateMatrixWorld(true);
		const world = this.tip.getWorldPosition(this._p);
		if (this._nib && world.distanceTo(this._nib) > JUMP) { this._nib.copy(world); this.endStroke(); return; }
		(this._nib ??= new THREE.Vector3()).copy(world);
		const p = xr.centerer.worldToLocal(this._q.copy(world));
		const step = STEP / Math.max(1e-6, xr.anchor.scale.x);
		if (!s.last) { s.last = p.clone(); s.n = 1; return; }
		if (p.distanceTo(s.last) >= step) {
			this.addPoint(s, p);
			if (this.held?.isController && s.n % 6 === 0) xr.haptics.play(this.held, 'tick');
		}
	}
}

/** The triangle list of a tube of `points` rings (SIDES each). */
function tubeIndex(points) {
	const idx = new Uint32Array(Math.max(0, points - 1) * SIDES * 6);
	let k = 0;
	for (let i = 0; i < points - 1; i++) for (let s = 0; s < SIDES; s++) {
		const a = i * SIDES + s, b = i * SIDES + (s + 1) % SIDES, c = a + SIDES, d = b + SIDES;
		idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
	}
	return idx;
}
