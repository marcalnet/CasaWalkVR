// The laser meter (SPEC.md phase 17, milestone E): a hand-held tool that
// looks like a roll tape (the designer's model) and measures by laser. While
// held, a red beam runs from its laser window to a dot where it hits (the
// model's BVH raycasts), and its screen reads the distance to the dot.
// Trigger (or a bare hand's pinch, in use mode: js/hold.js) on one point, then
// on another: a line between them with a label of its real length, turned
// towards you; lines within 3° of vertical or level snap straight
// (js/measure.js), with a small mark at the end. Several at once. Between the
// two, a dashed line runs from the first point to the dot. Undo: the second
// button (A, or Y mirrored); hold it a second: clear all. Bare hands: no
// undo (the user's simpler tools, 27 Nov 2026).
//
// Build 215's C4 (the user's decisions): the labels about 5x bigger (20 cm at
// 1:1), each 10 cm over its line's middle; the screen almost covers the top,
// the value on one line and its unit on the next (no hint line: the dashed
// line shows the next step).
//
// Lines and labels live in the tools' annotations, in model space: they move
// with the scale model and stay put while walking; their thickness and the
// labels' size are kept the same to the eye whatever the zoom. Photos keep them.

import * as THREE from 'three';
import { HOLD } from './hold.js';
import { canvasTexture } from './canvas-card.js';
import { buildMeter } from './tool-models.js';
import { Measurements, readingParts, formatLength, defaultUnits } from './measure.js';
import { readSetting, writeSetting } from './settings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLOURS, FONT } from './theme.js';
import { RAMP, CAP, pxFor } from './type-ramp.js';

const REACH = 20; // metres: the laser's reach (in the world)
const LINE_R = 0.002; // metres, to the eye: a measuring line's radius
// The screen (build 215's C4): 256 x 480 px over 3.2 x 6.0 cm, read from about 0.45 m; its unit never under the label's 0.6° (C5).
export const SCREEN = { W: 256, H: 480, size: [0.032, 0.060], readAt: 0.45 };
SCREEN.unitMin = pxFor(RAMP.label, 'ui', SCREEN.size[1] / SCREEN.H, SCREEN.readAt);
export const LABEL_H = 0.20; // metres, to the eye, at 1:1 (a label's height: 5x, build 215's C4)
const LABEL_LIFT = 0.10; // metres, to the eye: a label's lower edge over its line's middle, never on it
// A label's text, as seen (the Designer's angular cap, after the Tester's C4 review: at the scale model a 20 cm label covered the
// floor you measured): the user's 20 cm at 1:1, its capitals never under 0.8° from the eyes, and at the scale model never over
// 2.0° (about 2.8 cm of capitals at 0.8 m). Inside there is no cap: the user's 5x holds at any distance (about 7 cm of capitals,
// 4° at 1 m). The lift scales with it. Each frame.
export const LABEL_DEG = [0.8, 2.0];
const LABEL_TEXT_PX = 40; // the text's size in its slot (canvas px of SLOT[1])
const DASH = { on: 0.02, off: 0.01, opacity: 0.5, MAX: 400 }; // the dashed line to the dot (to the eye): 2 cm on, 1 cm off, half strength
const BEAM = 0xe5484d, LINE = 0xe07a1f; // red laser; the measured lines in the orange accent
export const LABEL_SLOTS = 32, SLOT = [256, 80], ATLAS = [1024, 640]; // the labels' shared picture: 4 x 8 slots

export class LaserMeter {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.name = 'meter';
		this.live = true;
		this.object = buildMeter();
		this.tip = this.object.getObjectByName('tip');
		this.screenPoint = this.object.getObjectByName('screen');
		this.m = new Measurements();
		this.m.units = readSetting('meterUnits') ?? defaultUnits(globalThis.navigator?.languages?.[0] ?? ''); // (remembered; at first from the browser's region)
		this.controlPart = 'hook'; // (its quiet ring: js/control-cue.js)
		this.held = null;
		this.hitDistance = null;
		this.marks = []; // per line: { a, b, text, snap } (model space)
		this.lineMat = new THREE.MeshBasicMaterial({ color: LINE });
		this.labels = new LabelLayer();
		this._hits = [];
		// The beam and its dot (world space, never in photos).
		this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: 0.75, depthWrite: false }));
		this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 6), new THREE.MeshBasicMaterial({ color: BEAM }));
		this.beam.visible = this.dot.visible = false;
		this.beam.name = 'meter-beam'; this.dot.name = 'meter-dot';
		xr.scene.add(this.beam, this.dot);
		xr.hideFromPhotos(this.beam, this.dot);
		// The waiting first point.
		this.pendingMark = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: LINE }));
		this.pendingMark.visible = false;
		// The screen on its top: the live reading and what the trigger does next.
		this.screen = makeScreen();
		// (Centred on the flat top, covering it with a 2 mm border.)
		const top = new THREE.Box3().setFromObject(this.object);
		this.screen.mesh.position.set((top.min.x + top.max.x) / 2, this.screenPoint.position.y + 0.0006, (top.min.z + top.max.z) / 2);
		this.screen.mesh.rotation.x = -Math.PI / 2;
		this.object.add(this.screen.mesh);
		// The dashed line from the first point to the dot (world space, never in photos: a step in progress).
		this.dashes = new THREE.InstancedMesh(new THREE.CylinderGeometry(LINE_R, LINE_R, 1, 6, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: LINE, transparent: true, opacity: DASH.opacity, depthWrite: false }), DASH.MAX);
		this.dashes.name = 'meter-dashes';
		this.dashes.count = 0;
		this.dashes.frustumCulled = false;
		this.dashes.visible = false;
		xr.scene.add(this.dashes);
		xr.hideFromPhotos(this.dashes);
		this.ray = new THREE.Raycaster();
		this.ray.firstHitOnly = true;
		this.ray.layers.enableAll(); // (it names what it may hit)
		this._o = new THREE.Vector3(); this._d = new THREE.Vector3(); this._q = new THREE.Quaternion();
	}

	take(c) { this.held = c; }
	putBack() { this.held = null; this.beam.visible = this.dot.visible = this.dashes.visible = false; }

	/**
	 * Trigger: a point where the dot is. A bare hand's pinch: where the dot was
	 * HOLD.PINCH_BACK before the pinch closed (pinching moves the hand: build
	 * 215's C2).
	 */
	trigger(c, phase) {
		if (phase !== 'down') return;
		const xr = this.xr;
		const at = c?.isHand ? this.hitBefore(HOLD.PINCH_BACK) : this.hit;
		if (!at) { if (xr.soundLevel !== 'off') xr.sound.play('deny'); return; }
		const p = xr.centerer.worldToLocal(at.clone());
		const r = this.m.point(p);
		if (xr.soundLevel !== 'off') xr.sound.play('beep');
		if (c?.isController) xr.haptics.play(c, 'tick');
		if (r.kind === 'line') { this.pendingMark.visible = false; this.addLine(r.line); }
		else this.showPending(p);
	}

	/** Where the dot was `back` seconds ago (its oldest kept, at most 0.15 s; null if it had no hit then). */
	hitBefore(back) {
		const h = this.history ?? [];
		let best = null;
		for (const e of h) if (this.clock - e.t <= back + 1e-6) { best = e; break; }
		return (best ?? h[h.length - 1])?.hit ?? this.hit;
	}

	/** Second button: press = undo, hold = clear all. */
	secondary(c, phase) {
		const xr = this.xr;
		const went = phase === 'hold' ? (this.clear() ? 'all' : null) : this.m.undo();
		if (went === 'line') this.removeLast();
		if (went === 'point') this.pendingMark.visible = false;
		if (xr.soundLevel !== 'off') xr.sound.play(went ? 'release' : 'deny');
	}

	/** The meter's units ('cm' | 'ftin'): remembered; every line's label and the live reading in them. */
	setUnits(units) {
		this.m.units = units;
		writeSetting('meterUnits', units);
		this.m.lines.forEach((line, i) => { line.label = formatLength(line.length, units); if (this.marks[i]) this.marks[i].text = line.label; });
		this.redraw();
	}

	showPending(p) {
		const a = this.xr.tools.annotations;
		if (this.pendingMark.parent !== a) a.add(this.pendingMark);
		this.pendingMark.position.copy(p);
		this.pendingMark.visible = true;
	}

	/** A measured line: drawn with the others in one mesh, its label with the others in one mesh. */
	addLine(line) {
		this.marks.push({ a: new THREE.Vector3(line.a.x, line.a.y, line.a.z), b: new THREE.Vector3(line.b.x, line.b.y, line.b.z), text: line.label, snap: !!line.snap });
		this.redraw();
	}

	removeLast() {
		if (this.marks.pop()) this.redraw();
	}

	/** Forgets every measurement (the clear-all hold, leaving VR, another model). */
	clear() {
		const had = this.m.clear();
		this.marks.length = 0;
		this.pendingMark.visible = false;
		this.redraw();
		return had;
	}

	/**
	 * Rebuilds the one mesh of all the lines (rods and end dots, at today's
	 * thickness to the eye) and the labels' picture. Called when a line comes
	 * or goes and when the zoom changes; never per frame otherwise (the
	 * tester's review: each line was 4 draw calls).
	 */
	redraw() {
		const xr = this.xr, a = xr.tools.annotations, s = 1 / Math.max(1e-6, xr.anchor.scale.x);
		this.drawnScale = xr.anchor.scale.x;
		if (this.linesMesh) { this.linesMesh.removeFromParent(); this.linesMesh.geometry.dispose(); this.linesMesh = null; }
		if (this.marks.length) {
			const parts = [], up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion();
			for (const k of this.marks) {
				const len = k.a.distanceTo(k.b);
				q.setFromUnitVectors(up, dir.subVectors(k.b, k.a).normalize());
				parts.push(new THREE.CylinderGeometry(LINE_R * s, LINE_R * s, len, 8, 1, true).applyMatrix4(m.compose(k.a.clone().add(k.b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))));
				for (const [p, big] of [[k.a, false], [k.b, k.snap]]) parts.push(new THREE.SphereGeometry(LINE_R * s * (big ? 3 : 2), 10, 6).translate(p.x, p.y, p.z));
			}
			const geo = mergeGeometries(parts.map((g) => { const n = g.toNonIndexed(); g.dispose(); n.deleteAttribute('uv'); return n; }), false);
			this.linesMesh = new THREE.Mesh(geo, this.lineMat);
			this.linesMesh.name = 'measurements';
			a.add(this.linesMesh);
		}
		this.labels.set(this.marks.map((k) => ({ text: k.text, at: k.a.clone().add(k.b).multiplyScalar(0.5) })));
		if (this.labels.mesh.parent !== a) a.add(this.labels.mesh);
	}

	/** Each frame: rebuilt if the zoom changed; the labels turned to you, the same size to the eye. */
	fit() {
		const xr = this.xr;
		if (this.marks.length && Math.abs(xr.anchor.scale.x - this.drawnScale) > this.drawnScale * 0.01) this.redraw();
		this.labels.face(xr, 1 / Math.max(1e-6, xr.anchor.scale.x));
		this.pendingMark.scale.setScalar(LINE_R * 2.5 / Math.max(1e-6, xr.anchor.scale.x));
	}

	/** Once a frame while held: the beam, the dot, the screen (reused vectors: nothing allocated). */
	update(dt, c) {
		const xr = this.xr;
		if (!this.held) return;
		this.object.updateMatrixWorld(true);
		const o = this.tip.getWorldPosition(this._o), d = this._d.set(0, 0, 1).applyQuaternion(this.tip.getWorldQuaternion(this._q));
		this.ray.set(o, d);
		this.ray.far = REACH;
		this._hits.length = 0;
		this.ray.intersectObjects(xr.targets().pointable, false, this._hits);
		const hit = this._hits[0];
		this.hit = hit ? (this._hit ??= new THREE.Vector3()).copy(hit.point) : null;
		// The last 0.15 s of the dot (oldest first), for a pinch's point (trigger).
		this.clock = (this.clock ?? 0) + dt;
		const hist = this.history ??= [];
		hist.push({ t: this.clock, hit: this.hit?.clone() ?? null });
		while (hist.length > 1 && this.clock - hist[0].t > 0.15) hist.shift();
		const dist = hit ? hit.distance / Math.max(1e-6, xr.anchor.scale.x) : null; // (real metres, in the scale model too)
		this.beam.visible = true;
		this.beam.position.copy(o);
		this.beam.quaternion.setFromUnitVectors(Z, d);
		this.beam.scale.set(1, 1, hit ? hit.distance : REACH);
		this.dot.visible = !!hit;
		if (hit) this.dot.position.copy(hit.point);
		this.screen.set(readingParts(dist, this.m.units));
		this.drawDashes(hit ? hit.point : null);
	}
}

const Z = new THREE.Vector3(0, 0, 1);

/**
 * (LaserMeter) The dashed line while a measurement is half made: from the
 * first point to the dot, DASH.on drawn and DASH.off empty to the eye, the
 * measured lines' width at half strength; none without a first point or a dot.
 */
LaserMeter.prototype.drawDashes = function (dot) {
	const xr = this.xr, p = this.m.pending;
	if (!p || !dot) { this.dashes.visible = false; return; }
	const a = xr.centerer.localToWorld((this._da ??= new THREE.Vector3()).set(p.x, p.y, p.z)); // (the first point, model space to world)
	const len = a.distanceTo(dot), dir = (this._dd ??= new THREE.Vector3()).subVectors(dot, a).normalize(), step = DASH.on + DASH.off;
	const n = Math.min(DASH.MAX, Math.ceil(len / step)), q = (this._dq ??= new THREE.Quaternion()).setFromUnitVectors(Z, dir), m = this._dm ??= new THREE.Matrix4(), c = this._dc ??= new THREE.Vector3(), sc = this._ds ??= new THREE.Vector3();
	for (let i = 0; i < n; i++) {
		const from = i * step, to = Math.min(len, from + DASH.on);
		c.copy(a).addScaledVector(dir, (from + to) / 2);
		this.dashes.setMatrixAt(i, m.compose(c, q, sc.set(1, 1, Math.max(1e-4, to - from))));
	}
	this.dashes.count = n;
	this.dashes.instanceMatrix.needsUpdate = true;
	this.dashes.visible = n > 0;
};

/**
 * All the labels in one mesh: their words drawn into one shared picture (an
 * atlas of LABEL_SLOTS slots), each a quad turned to you every frame.
 */
class LabelLayer {
	constructor() {
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(ATLAS[0], ATLAS[1]));
		const n = LABEL_SLOTS;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 4 * 2), 2));
		const idx = new Uint16Array(n * 6);
		for (let i = 0; i < n; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
		geo.setIndex(new THREE.BufferAttribute(idx, 1));
		geo.setDrawRange(0, 0);
		this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.mesh.name = 'measurement-labels';
		this.mesh.renderOrder = 12;
		this.mesh.frustumCulled = false;
		this.items = [];
		this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._e = new THREE.Vector3();
	}

	/** The labels: [{ text, at (model space) }] (the oldest give way past LABEL_SLOTS). */
	set(items) {
		this.items = items.slice(-LABEL_SLOTS);
		const ctx = this.canvas?.getContext('2d');
		const [sw, sh] = SLOT, cols = ATLAS[0] / sw;
		if (ctx) ctx.clearRect(0, 0, ATLAS[0], ATLAS[1]);
		const uv = this.mesh.geometry.attributes.uv.array;
		this.items.forEach((it, i) => {
			const x = (i % cols) * sw, y = Math.floor(i / cols) * sh;
			if (ctx) {
				ctx.fillStyle = '#ffffff'; // (opaque: build 215's C4)
				ctx.beginPath(); ctx.roundRect(x + 4, y + 4, sw - 8, sh - 8, 24); ctx.fill();
				ctx.strokeStyle = COLOURS.primary; ctx.lineWidth = 4; ctx.stroke();
				ctx.fillStyle = COLOURS.text; ctx.font = `700 ${LABEL_TEXT_PX}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
				ctx.fillText(it.text, x + sw / 2, y + sh / 2 + 2);
			}
			const u0 = x / ATLAS[0], u1 = (x + sw) / ATLAS[0], v1 = 1 - y / ATLAS[1], v0 = 1 - (y + sh) / ATLAS[1];
			uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
		});
		this.mesh.geometry.attributes.uv.needsUpdate = true;
		this.mesh.geometry.setDrawRange(0, this.items.length * 6);
		if (this.texture) this.texture.needsUpdate = true;
	}

	/** Turns every label to you, LABEL_H tall to the eye, its capitals clamped to LABEL_DEG as seen (k: model units per metre). */
	face(xr, k) {
		if (!this.items.length) return;
		const parent = this.mesh.parent;
		if (!parent) return;
		parent.updateMatrixWorld(true);
		const inv = this._m.copy(parent.matrixWorld).invert();
		const cam = xr.camera.matrixWorld;
		const r = this._r.setFromMatrixColumn(cam, 0).transformDirection(inv), u = this._u.setFromMatrixColumn(cam, 1).transformDirection(inv);
		const eye = this._eye ??= new THREE.Vector3(), at = this._at ??= new THREE.Vector3();
		eye.setFromMatrixPosition(cam);
		const pos = this.mesh.geometry.attributes.position.array, e = this._e;
		this.items.forEach((it, i) => {
			const c = it.at, s = labelScale(at.copy(c).applyMatrix4(parent.matrixWorld).distanceTo(eye), xr.mode);
			const h = LABEL_H * s * k, w = h * SLOT[0] / SLOT[1];
			for (const [j, sx, sy] of [[0, -1, -1], [1, 1, -1], [2, 1, 1], [3, -1, 1]]) {
				e.copy(c).addScaledVector(r, sx * w / 2).addScaledVector(u, sy * h / 2 + h / 2 + LABEL_LIFT * s * k); // (its lower edge LABEL_LIFT over the line's middle, scaled with it)
				pos.set([e.x, e.y, e.z], (i * 4 + j) * 3);
			}
		});
		this.mesh.geometry.attributes.position.needsUpdate = true;
	}
}

/**
 * A label's scale (1: the user's LABEL_H) for a label d metres from the eyes
 * in mode ('dollhouse' | 'walk'): its capitals (LABEL_TEXT_PX of SLOT[1],
 * times the font's cap ratio) never under LABEL_DEG[0] as seen, and at the
 * scale model never over LABEL_DEG[1].
 */
export function labelScale(d, mode = 'walk') {
	const cap = CAP.ui * LABEL_TEXT_PX / SLOT[1] * LABEL_H, t = (deg) => Math.tan(THREE.MathUtils.degToRad(deg)) * Math.max(d, 1e-3);
	return THREE.MathUtils.clamp(cap, t(LABEL_DEG[0]), mode === 'dollhouse' ? t(LABEL_DEG[1]) : Infinity) / cap;
}

/**
 * The meter's screen (build 215's C4): 3.2 x 6.0 cm, almost the whole top,
 * read along the meter's length: the value on one line, as large as fits 3 cm
 * wide, and its unit on the next at 60%, in the screen's soft colour.
 * 256 x 480 px, mipmapped.
 */
function makeScreen() {
	const { W, H } = SCREEN;
	const { canvas, texture } = canvasTexture(W, H);
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...SCREEN.size), new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0x5d6873, toneMapped: false }));
	mesh.name = 'meter-screen';
	let last = '';
	return {
		mesh,
		set({ value, unit }) {
			const key = value + '|' + unit;
			if (!canvas || key === last) return;
			last = key;
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = '#20262c'; ctx.fillRect(0, 0, W, H);
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			let px = 150;
			do ctx.font = `700 ${px}px ${FONT}`; while (ctx.measureText(value).width > W * 30 / 32 && --px > 40);
			ctx.fillStyle = '#e8f4e8'; ctx.fillText(value, W / 2, H * 0.42);
			const unitPx = Math.max(Math.round(px * 0.6), SCREEN.unitMin); // (60% of the value, never under the label's 0.6°: a long "12' 4½\"" made "ft in" 0.47°, build 215's C5)
			ctx.fillStyle = '#9fb3a5'; ctx.font = `600 ${unitPx}px ${FONT}`; ctx.fillText(unit, W / 2, H * 0.42 + px * 0.95);
			texture.needsUpdate = true;
			this.px = px; this.unitPx = unitPx; // (the sizes drawn: the tests read them)
		},
	};
}
