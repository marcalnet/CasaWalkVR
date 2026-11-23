// The laser meter (SPEC.md phase 17, milestone E): a hand-held tool that
// looks like a roll tape (the designer's model) and measures by laser. While
// held, a red beam runs from its laser window to a dot where it hits (the
// model's BVH raycasts), and its screen reads the distance to the dot.
// Trigger on one point, then on another: a line between them with a label of
// its real length, turned towards you; lines within 3° of vertical or level
// snap straight (js/measure.js), with a small mark at the end. Several at
// once. Second button (A, or Y mirrored): undo the last; hold it a second:
// clear all. With bare hands, a thumb tap of the holding hand is the trigger
// (js/xr-tools.js); undo and clear wait for a hand gesture.
//
// Lines and labels live in the tools' annotations, in model space: they move
// with the scale model and stay put while walking; their thickness and the
// labels' size are kept the same to the eye whatever the zoom. Photos keep them.

import * as THREE from 'three';
import { buildMeter } from './tool-models.js';
import { Measurements, liveReading } from './measure.js';
import { Label } from './panel.js';
import { COLOURS, FONT } from './theme.js';

const REACH = 20; // metres: the laser's reach (in the world)
const LINE_R = 0.002; // metres, to the eye: a measuring line's radius
const LABEL_H = 0.04; // metres, to the eye, at 1:1 (a label's height)
const BEAM = 0xe5484d, LINE = 0xe07a1f; // red laser; the measured lines in the orange accent

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
		this.marks = []; // per line: { group, line }
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

	/** A measured line: a thin cylinder, a mark at a snapped end, and its label. */
	addLine(line) {
		const group = new THREE.Group();
		group.name = 'measurement';
		const a = new THREE.Vector3(line.a.x, line.a.y, line.a.z), b = new THREE.Vector3(line.b.x, line.b.y, line.b.z);
		const len = a.distanceTo(b);
		const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: LINE }));
		rod.position.copy(a).add(b).multiplyScalar(0.5);
		rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
		rod.userData.len = len;
		group.add(rod);
		const ends = [a, b].map((p) => { const e = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), rod.material); e.position.copy(p); group.add(e); return e; });
		if (line.snap) ends[1].userData.snapMark = true; // (a bigger dot: it was snapped straight)
		const label = new Label({ height: LABEL_H });
		label.set(line.label);
		label.mesh.position.copy(rod.position);
		label.mesh.renderOrder = 12;
		group.add(label.mesh);
		this.xr.tools.annotations.add(group);
		this.marks.push({ group, rod, ends, label });
		this.fit();
	}

	removeLast() {
		const m = this.marks.pop();
		if (!m) return;
		m.group.removeFromParent();
		m.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); } });
		m.rod.material.dispose();
	}

	/** Forgets every measurement (the clear-all hold, leaving VR, another model). */
	clear() {
		const had = this.m.clear();
		while (this.marks.length) this.removeLast();
		this.pendingMark.visible = false;
		return had;
	}

	/** Keeps lines and labels the same size to the eye whatever the zoom; labels face you. */
	fit() {
		const xr = this.xr, s = 1 / Math.max(1e-6, xr.anchor.scale.x);
		const eye = xr.headWorld();
		for (const m of this.marks) {
			m.rod.scale.set(LINE_R * s, m.rod.userData.len, LINE_R * s);
			for (const e of m.ends) e.scale.setScalar(LINE_R * s * (e.userData.snapMark ? 3 : 2));
			m.label.mesh.scale.setScalar(s);
			m.label.mesh.lookAt(eye);
		}
		this.pendingMark.scale.setScalar(LINE_R * s * 2.5);
	}

	/** Once a frame while held: the beam, the dot, the screen; and the lines' size. */
	update(dt, c) {
		const xr = this.xr;
		this.fit();
		if (!this.held) return;
		this.object.updateMatrixWorld(true);
		const o = this.tip.getWorldPosition(this._o), d = this._d.set(0, 0, 1).applyQuaternion(this.tip.getWorldQuaternion(this._q));
		this.ray.set(o, d);
		this.ray.far = REACH;
		const hit = this.ray.intersectObjects(xr.targets().pointable, false)[0];
		this.hit = hit ? hit.point.clone() : null;
		const dist = hit ? hit.distance / Math.max(1e-6, xr.anchor.scale.x) : null; // (real metres, in the scale model too)
		this.beam.visible = true;
		this.beam.position.copy(o);
		this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
		this.beam.scale.set(1, 1, hit ? hit.distance : REACH);
		this.dot.visible = !!hit;
		if (hit) this.dot.position.copy(hit.point);
		this.screen.set(liveReading(dist), this.m.pending ? 'Trigger: second point' : 'Trigger: first point');
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
