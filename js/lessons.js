// The first-time lessons (SPEC.md, C0.5): two messages in all, one per
// place, each a card of steps in front of you and within reach (50 cm ahead,
// 20 cm below the eyes, turned to you), so the card itself is where you learn
// to press. The current step is lit; it ticks itself off when you do it
// (sound press). The first time a hand gesture is taught, a looping 3D hand
// (the hand model, 1.3x, 60 cm away at eye height) shows it in the middle of
// your view, with the card on its right; it goes once the step is done. Got it
// appears once the steps that must not be missed are done. Remembered per
// place and per input kind (bare hands or controllers): someone who later puts
// the controllers down is taught the hand version. The words are in
// js/xr-menus.js (LESSONS); the app tells this module what you did (note()).
//
//   scale  in the scale-model room, on entry (it replaces the welcome card)
//   walk   the first time you step inside: the teleport, with a first target
//          (an orange ring at a hotspot ahead); it follows you after each teleport

import * as THREE from 'three';
import { canvasTexture } from './canvas-card.js';
import { COLOURS, FONT, GUIDE } from './theme.js';
import { KeyPad } from './keys.js';
import { LESSONS } from './xr-menus.js';
import { readSetting, writeSetting } from './settings.js';
import { loadHands, dressHand, presetJoints, mirrorPose } from './hand-model.js';
import { HAND_POSES } from './hand-poses.js';

const PX_W = 1000, ROW = 92, HEAD = 120, FOOT = 140, MAX_STEPS = 6; // canvas pixels
const PX_H = HEAD + MAX_STEPS * ROW + FOOT; // (one fixed size: a GPU texture can't change size once made)
const CARD_W = 0.34; // metres
const AHEAD = 0.5, BELOW = 0.2, SIDE = 0.12; // where the card goes, from the eyes (metres)
const DEMO_AHEAD = 0.6, DEMO_SCALE = 1.3, DEMO_LEFT = 0.14; // the demonstration hand

/** The settings key for a place and input kind ('scale' | 'walk', 'hands' | 'controllers'). */
export const lessonSetting = (place, kind) => `lesson${place === 'scale' ? 'Scale' : 'Walk'}${kind === 'hands' ? 'Hands' : 'Controllers'}`;

/**
 * The first-time cards (the lessons' card and the welcome card), off for now
 * (the user's call, 25 Nov 2026, after a Quest 2 test: they piled up with the
 * guide and the board; the UX/UI Designer is designing a replacement, a
 * looping pinch hand). The code stays; tests switch it on to keep it working.
 */
export const FIRST_TIME_CARDS = { on: false };

export class Lessons {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.place = null; // the lesson shown: 'scale' | 'walk' | null
		this.kind = null; // 'hands' | 'controllers'
		this.done = new Set(); // step ids done
		this.group = new THREE.Group();
		this.group.name = 'lesson';
		this.group.visible = false;
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(PX_W, PX_H));
		this.card = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_W * PX_H / PX_W), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.card.renderOrder = 10;
		this.card.name = 'lesson-card';
		this.group.add(this.card);
		// Keys on the card: Start (step 1 of the first lesson) and Got it.
		this.keys = new KeyPad(xr, 'lesson');
		this.keys.add('start', 0.08, 0.06);
		this.keys.setSpec('start', { id: 'lesson-start', look: 'filled', label: 'Start' });
		this.keys.add('got', 0.05, 0.05);
		this.keys.setSpec('got', { id: 'lesson-got', look: 'plain', label: 'Got it' });
		// The card's own Close key (×), always there in its top-right corner like the board's: closes the card for good.
		this.keys.add('close', 0.038, 0.038);
		this.keys.setSpec('close', { id: 'lesson-close', look: 'plain', label: '×' });
		for (const k of this.keys.keys.values()) this.card.add(k.group);
		// The first target inside: an orange ring on the floor ahead.
		this.target = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.5, 48).rotateX(-Math.PI / 2),
			new THREE.MeshBasicMaterial({ color: COLOURS.primary, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
		this.target.visible = false;
		this.target.name = 'lesson-target';
		// The demonstration hand (loaded with the hand model; none in Node tests).
		this.demo = null;
		this.demoT = 0;
		loadHands().then((h) => {
			if (!h) return;
			this.demo = { left: dressHand(h.left, 'left'), right: dressHand(h.right, 'right') };
			for (const d of Object.values(this.demo)) { d.visible = false; d.scale.setScalar(DEMO_SCALE); xr.scene.add(d); }
			xr.hideFromPhotos(this.demo.left, this.demo.right);
		});
		xr.scene.add(this.group, this.target);
		xr.hideFromPhotos(this.group, this.target);
		globalThis.document?.fonts?.load?.(`700 40px ${GUIDE.font}`).then(() => this.draw()).catch(() => {});
	}

	/** The input kind now: controllers if any is held, else bare hands. */
	inputKind() { return this.xr.input.active().length ? 'controllers' : 'hands'; }

	/** This place's steps for the current input kind (steps without words for it are skipped). */
	steps() { return (LESSONS[this.place]?.steps ?? []).filter((s) => s[this.kind]); }

	/** The step to do now (the first not done), or null. */
	current() { return this.steps().find((s) => s.done && !this.done.has(s.id)) ?? null; }

	/** Starts this place's lesson unless it was done before with this input kind (again: always, for Help). */
	start(place, { again = false } = {}) {
		if (!FIRST_TIME_CARDS.on) return false; // (switched off for now: see FIRST_TIME_CARDS)
		const kind = this.inputKind();
		if (!again && readSetting(lessonSetting(place, kind))) { if (this.place === place) this.stop(); return false; }
		this.place = place; this.kind = kind; this.done.clear();
		this.place3d();
		this.draw();
		this.group.visible = true;
		this.placeTarget();
		return true;
	}

	/** Hides the lesson (leaving the place, or VR); it starts again next time unless finished. */
	stop() {
		this.place = null;
		this.group.visible = false;
		this.target.visible = false;
		if (this.demo) for (const d of Object.values(this.demo)) d.visible = false;
		this.keys.reset();
	}

	/** Finished (all steps, or Got it): remembered for this place and input kind. */
	finish() {
		if (!this.place) return;
		writeSetting(lessonSetting(this.place, this.kind), true);
		this.stop();
	}

	/** The app says what you did: 'start', 'wrist', 'held', 'inside', 'arc', 'teleport', 'turn'. */
	note(event) {
		if (!this.place) return;
		const step = this.current();
		// Steps tick off in order; a later step done early counts too.
		const hit = this.steps().find((s) => s.done === event && !this.done.has(s.id));
		if (!hit) return;
		this.done.add(hit.id);
		if (step === hit && this.xr.soundLevel !== 'off') this.xr.sound.play('press');
		if (event === 'teleport') this.place3d(); // (it follows you)
		if (!this.current() && !this.steps().some((s) => !s.done)) { this.finish(); return; }
		this.draw();
		this.placeTarget();
	}

	/** True once every step that must not be missed is done (Got it shows). */
	canClose() { return this.steps().every((s) => !s.must || this.done.has(s.id)); }

	/** Puts the card in front of you, within reach, turned to your eyes. */
	place3d() {
		const xr = this.xr, head = xr.headWorld(), { right, forward } = xr.viewAxes();
		const p = head.clone().addScaledVector(forward, AHEAD).addScaledVector(right, SIDE);
		p.y -= BELOW;
		this.group.position.copy(p);
		this.group.lookAt(head);
		this.anchor = { head: head.clone(), right: right.clone(), forward: forward.clone() };
	}

	/** The first target inside: an orange ring at the nearest hotspot 1.5-4 m ahead, else 2.5 m ahead. */
	placeTarget() {
		const xr = this.xr, step = this.current();
		this.target.visible = false;
		if (this.place !== 'walk' || !step || (step.id !== 'arc' && step.id !== 'go')) return;
		const head = xr.headWorld(), { forward } = xr.viewAxes();
		let best = null;
		for (const s of xr.model?.hotspots ?? xr.modes.walk.spots?.() ?? []) {
			const p = xr.centerer.localToWorld(new THREE.Vector3(s.x, s.y, s.z));
			const d = Math.hypot(p.x - head.x, p.z - head.z);
			const ahead = (p.x - head.x) * forward.x + (p.z - head.z) * forward.z;
			if (d < 1.5 || d > 4 || ahead < d * 0.7) continue;
			if (!best || Math.abs(d - 2.5) < Math.abs(best.d - 2.5)) best = { p, d };
		}
		const at = best?.p ?? xr.findFloor(head.clone().addScaledVector(forward, 2.5), 0.5);
		if (!at) return;
		this.target.position.copy(at).y += 0.015;
		this.target.visible = true;
	}

	/** Once a frame: the keys, the demonstration hand. Returns an action or null. */
	update(dt) {
		if (!this.place) return null;
		const step = this.current();
		this.keys.keys.get('start').group.visible = this.keys.keys.get('start').out = step?.id === 'start';
		this.keys.keys.get('got').group.visible = this.keys.keys.get('got').out = this.canClose();
		this.keys.keys.get('close').group.visible = this.keys.keys.get('close').out = true;
		const { action } = this.keys.update(dt, { active: this.group.visible });
		if (action?.id === 'lesson-start') this.note('start');
		if (action?.id === 'lesson-got' || action?.id === 'lesson-close') this.finish(); // (Close: not shown again either)
		this.animateDemo(dt, step);
		if (this.target.visible) this.target.material.opacity = 0.6 + 0.3 * Math.sin(this.demoT * 4);
		return null;
	}

	/** The looping demonstration of the current hand step, in the middle of the view, left of the card. */
	animateDemo(dt, step) {
		if (!this.demo) return;
		const side = this.xr.ui?.wrist?.side === 'left' ? 'right' : 'left'; // (the hand that does gestures: the one without the menu? either works; show the free one)
		const show = this.kind === 'hands' && !!step?.demo;
		for (const [k, d] of Object.entries(this.demo)) d.visible = show && k === side;
		if (!show) return;
		this.demoT += dt;
		const d = this.demo[side], a = this.anchor;
		const pose = (name) => (side === 'right' ? (this.mirrored ??= {})[name] ??= mirrorPose(HAND_POSES[name]) : HAND_POSES[name]);
		// Each demo loops over 1.6 s.
		const t = (this.demoT % 1.6) / 1.6;
		const wave = (from, to) => d.userData.pose(presetJoints(pose(from), pose(to), 0.5 - 0.5 * Math.cos(2 * Math.PI * t)));
		if (step.demo === 'hold') wave('open', 'fist');
		// Where: 60 cm ahead at eye height, a little left of the card, turned towards you.
		d.position.copy(a.head).addScaledVector(a.forward, DEMO_AHEAD).addScaledVector(a.right, -DEMO_LEFT);
		d.position.y -= 0.12;
		d.lookAt(a.head);
	}

	/** A step's words, with the sides filled in ({fan}: the tool fan's hand, {take}: the other). */
	words(s) {
		const fan = this.xr.toolFan === 'right' ? 'right' : 'left', take = fan === 'left' ? 'right' : 'left';
		return s[this.kind].replaceAll('{fan}', fan).replaceAll('{take}', take);
	}

	/** Draws the card: the title, each step (the current one lit, done ones ticked). */
	draw() {
		if (!this.canvas || !this.place) return;
		const L = LESSONS[this.place], steps = this.steps(), cur = this.current();
		const h = HEAD + steps.length * ROW + FOOT; // (the card's height on the fixed canvas; below it stays clear)
		const ctx = this.canvas.getContext('2d');
		ctx.clearRect(0, 0, PX_W, PX_H);
		ctx.beginPath(); ctx.roundRect(4, 4, PX_W - 8, h - 8, 40);
		ctx.fillStyle = GUIDE.paper; ctx.fill();
		ctx.lineWidth = 4; ctx.strokeStyle = GUIDE.edge; ctx.stroke();
		ctx.textBaseline = 'middle';
		ctx.fillStyle = COLOURS.text;
		ctx.font = `700 54px ${GUIDE.font}`;
		ctx.fillText(L.title, 44, 66);
		steps.forEach((s, i) => {
			const y = HEAD + i * ROW + ROW / 2, done = this.done.has(s.id), lit = s === cur;
			if (lit) { ctx.beginPath(); ctx.roundRect(24, y - ROW / 2 + 6, PX_W - 48, ROW - 12, 22); ctx.fillStyle = '#e3edfb'; ctx.fill(); }
			ctx.fillStyle = done ? COLOURS.accent : lit ? COLOURS.text : COLOURS.soft;
			ctx.font = `700 38px ${FONT}`;
			ctx.fillText(done ? '✓' : `${i + 1}`, 50, y);
			const words = this.words(s);
			fit(ctx, words, PX_W - 140 - (s.id === 'start' && lit ? 280 : 0), `${lit ? 600 : 400} %px ${FONT}`, 32); // (room for the Start key)
			ctx.fillText(words, 100, y);
		});
		this.texture.needsUpdate = true;
		// The keys: Start on the lit first step's row, right; Got it at the bottom right.
		const H = CARD_W * PX_H / PX_W, px = CARD_W / PX_W;
		this.keys.keys.get('start').group.position.set(CARD_W / 2 - 0.05, H / 2 - (HEAD + ROW / 2) * px - 0.016, 0.002); // (a little low: the Close key sits above it)
		this.keys.keys.get('got').group.position.set(CARD_W / 2 - 0.035, H / 2 - h * px + 0.035, 0.002);
		this.keys.keys.get('close').group.position.set(CARD_W / 2 - 0.03, H / 2 - 0.021, 0.002); // (in the title's row, clear of Start below it)
	}
}

/** Sets the font (font: with % for the size), shrinking it until text fits maxW. */
function fit(ctx, text, maxW, font, px) {
	let size = px;
	do { ctx.font = font.replace('%', size); size -= 2; } while (ctx.measureText(text).width > maxW && size > 16);
}
