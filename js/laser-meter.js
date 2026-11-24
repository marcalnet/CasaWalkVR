// The laser meter (SPEC.md phase 17, milestone E): a hand-held tool that
// looks like a roll tape (the designer's model) and measures by laser. While
// held, a red beam runs from its laser window to a dot where it hits (the
// model's BVH raycasts), and its screen reads the distance to the dot.
// Trigger on one point, then on another: a line between them with a label of
// its real length, turned towards you; lines within 3° of vertical or level
// snap straight (js/measure.js), with a small mark at the end. Several at
// once. Second button (A, or Y mirrored): undo the last; hold it a second:
// clear all. Bare hands: not yet (its own measure and undo buttons, pressed by
// the other index, come with item 11 of the Quest 2 fixes).
//
// Lines and labels live in the tools' annotations, in model space: they move
// with the scale model and stay put while walking; their thickness and the
// labels' size are kept the same to the eye whatever the zoom. Photos keep them.

import * as THREE from 'three';
import { buildMeter } from './tool-models.js';
import { Measurements, liveReading } from './measure.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLOURS, FONT } from './theme.js';

const REACH = 20; // metres: the laser's reach (in the world)
const LINE_R = 0.002; // metres, to the eye: a measuring line's radius
const LABEL_H = 0.04; // metres, to the eye, at 1:1 (a label's height)
const BEAM = 0xe5484d, LINE = 0xe07a1f; // red laser; the measured lines in the orange accent
const LABEL_SLOTS = 32, SLOT = [256, 80], ATLAS = [1024, 640]; // the labels' shared picture: 4 x 8 slots

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
		this.screen.mesh.position.copy(this.screenPoint.position).y += 0.0006;
		this.screen.mesh.rotation.x = -Math.PI / 2;
		this.object.add(this.screen.mesh);
		this.ray = new THREE.Raycaster();
		this.ray.firstHitOnly = true;
		this._o = new THREE.Vector3(); this._d = new THREE.Vector3(); this._q = new THREE.Quaternion();
	}

	take(c) { this.held = c; }
	putBack() { this.held = null; this.beam.visible = this.dot.visible = false; }

	/** Trigger: a point where the dot is. */
	trigger(c, phase) {
		if (phase !== 'down') return;
		const xr = this.xr;
		if (!this.hit) { if (xr.soundLevel !== 'off') xr.sound.play('deny'); return; }
		const p = xr.centerer.worldToLocal(this.hit.clone());
		const r = this.m.point(p);
		if (xr.soundLevel !== 'off') xr.sound.play('beep');
		if (c?.isController) xr.haptics.play(c, 'tick');
		if (r.kind === 'line') { this.pendingMark.visible = false; this.addLine(r.line); }
		else this.showPending(p);
	}

	/** Second button: press = undo, hold = clear all. */
	secondary(c, phase) {
		const xr = this.xr;
		const went = phase === 'hold' ? (this.clear() ? 'all' : null) : this.m.undo();
		if (went === 'line') this.removeLast();
		if (went === 'point') this.pendingMark.visible = false;
		if (xr.soundLevel !== 'off') xr.sound.play(went ? 'release' : 'deny');
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
		const dist = hit ? hit.distance / Math.max(1e-6, xr.anchor.scale.x) : null; // (real metres, in the scale model too)
		this.beam.visible = true;
		this.beam.position.copy(o);
		this.beam.quaternion.setFromUnitVectors(Z, d);
		this.beam.scale.set(1, 1, hit ? hit.distance : REACH);
		this.dot.visible = !!hit;
		if (hit) this.dot.position.copy(hit.point);
		this.screen.set(liveReading(dist), this.m.pending ? 'Trigger: second point' : 'Trigger: first point');
	}
}

const Z = new THREE.Vector3(0, 0, 1);

/**
 * All the labels in one mesh: their words drawn into one shared picture (an
 * atlas of LABEL_SLOTS slots), each a quad turned to you every frame.
 */
class LabelLayer {
	constructor() {
		this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
		if (this.canvas) { this.canvas.width = ATLAS[0]; this.canvas.height = ATLAS[1]; }
		this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
		if (this.texture) { this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; }
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
				ctx.fillStyle = 'rgba(255,255,255,0.94)';
				ctx.beginPath(); ctx.roundRect(x + 4, y + 4, sw - 8, sh - 8, 24); ctx.fill();
				ctx.strokeStyle = COLOURS.primary; ctx.lineWidth = 4; ctx.stroke();
				ctx.fillStyle = COLOURS.text; ctx.font = `700 40px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
				ctx.fillText(it.text, x + sw / 2, y + sh / 2 + 2);
			}
			const u0 = x / ATLAS[0], u1 = (x + sw) / ATLAS[0], v1 = 1 - y / ATLAS[1], v0 = 1 - (y + sh) / ATLAS[1];
			uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
		});
		this.mesh.geometry.attributes.uv.needsUpdate = true;
		this.mesh.geometry.setDrawRange(0, this.items.length * 6);
		if (this.texture) this.texture.needsUpdate = true;
	}

	/** Turns every label to you, LABEL_H tall to the eye (k: model units per metre). */
	face(xr, k) {
		if (!this.items.length) return;
		const parent = this.mesh.parent;
		if (!parent) return;
		parent.updateMatrixWorld(true);
		const inv = this._m.copy(parent.matrixWorld).invert();
		const cam = xr.camera.matrixWorld;
		const r = this._r.setFromMatrixColumn(cam, 0).transformDirection(inv), u = this._u.setFromMatrixColumn(cam, 1).transformDirection(inv);
		const h = LABEL_H * k, w = h * SLOT[0] / SLOT[1];
		const pos = this.mesh.geometry.attributes.position.array, e = this._e;
		this.items.forEach((it, i) => {
			const c = it.at;
			for (const [j, sx, sy] of [[0, -1, -1], [1, 1, -1], [2, 1, 1], [3, -1, 1]]) {
				e.copy(c).addScaledVector(r, sx * w / 2).addScaledVector(u, sy * h / 2 + h * 0.8);
				pos.set([e.x, e.y, e.z], (i * 4 + j) * 3);
			}
		});
		this.mesh.geometry.attributes.position.needsUpdate = true;
	}
}

/** The meter's little screen: the reading, big, and the trigger's next job, small. */
function makeScreen() {
	const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	if (canvas) { canvas.width = 256; canvas.height = 170; }
	const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
	if (texture) texture.colorSpace = THREE.SRGBColorSpace;
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.023, 0.0153), new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xffffff : 0x5d6873, toneMapped: false }));
	mesh.name = 'meter-screen';
	let last = '';
	return {
		mesh,
		set(reading, hint) {
			const key = reading + '|' + hint;
			if (!canvas || key === last) return;
			last = key;
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = '#20262c'; ctx.fillRect(0, 0, 256, 170);
			ctx.fillStyle = '#e8f4e8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.font = `700 64px ${FONT}`; ctx.fillText(reading || '—', 128, 70);
			ctx.fillStyle = COLOURS.primary; ctx.font = `600 22px ${FONT}`; ctx.fillText(hint, 128, 138);
			texture.needsUpdate = true;
		},
	};
}
