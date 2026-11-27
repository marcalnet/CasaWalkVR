// The headset's floating interface (SPEC.md, "Experience and controls" and
// C0 "Hands and touch"):
//
//   Keys     the main hand's keys (js/wrist-menu.js): ← Back and Settings,
//            always showing over that hand (build 215's C8; the orb went).
//   Wing     Settings opens the one settings wing beside the model, on the
//            main hand's side (js/wings.js: 0.55 m, 40-50° out, never over
//            the model), pressed by touch (js/touch.js) or by a controller's
//            laser. What it says and does: js/xr-menus.js. Its tabs: How to
//            move (js/guide.js: how to move here, for controllers or bare
//            hands, the build at its foot), View and General. The first
//            opening at each place in a session shows How to move; after
//            that, the last other tab used there (View at first; the
//            next-build asks 3.3, kept in xr.store.tabs). It closes with the
//            Settings key again, B/Y, moving between layers, or a press at
//            empty space (build 120's M1: a trigger pull, or a quick pinch,
//            aimed at nothing you can use: emptyPress()); there is no Close key.
//   Photo    the flash and note of a photo (the street camera, milestone D).
//   Hands    without hand joints: "Pick up your controllers" (C0.1).
//
// Each frame the mode calls buttons() and point(); point() claims the
// trigger of every controller whose laser is on the menus (c.claim.trigger =
// 'ui'), so the mode leaves those alone.

import * as THREE from 'three';
import { NoteCard, Label, NOTE_W } from './panel.js';
import { RAMP, pxFor } from './type-ramp.js';
import { BUILD } from './version.js';
import { buildLabel } from './build-label.js';
import { headHeading } from './xr-dollhouse.js';
import { TOUCH, touchState, stepTouch, reset as resetTouch, ringSize } from './touch.js';
import { KEY } from './theme.js';
import { WING, placeWing, zoneOf } from './wings.js';
import { guideSheet } from './guide.js';
import { WristMenu, BACK_HOLD } from './wrist-menu.js';
import { handAimRay, pinchGate } from './gestures.js';
import { CLAIM } from './xr-targets.js';
import { CLOSE_HINT } from './xr-menus.js';

const KEEP_CLEAR = CLAIM.near; // a press with the hand this near a live key or a wing is never "empty" (m)

// The note after a photo. Photos are kept in the app and saved from the page
// after VR (a download in VR would end the session).
export const PHOTO_TEXT = {
	kept: { title: 'Nice shot!', line: 'It\'s on the page when you leave VR' }, // (one short line each: build 215's C5)
	full: { title: 'Nice shot!', line: 'Only the last 50 are kept' },
	failed: { title: 'The photo didn\'t work', line: 'Try again, or use the Quest\'s own screenshot.' },
};

/**
 * Where the photo note shows (in front of the eyes) and its type, in degrees
 * at that distance (build 215's C5, js/type-ramp.js): the title hand-lettered
 * at 1.4°, its line at 0.9°, a longer one (the failed photo) fitted down to
 * no less than the body's 0.7°.
 */
export const NOTES = { hands: { width: 0.6, at: [0, -0.08, -0.85] }, error: { width: 0.6, at: [0, -0.05, -0.8] } }; // the other notes: width (m), where in front of the eyes
export const PHOTO_NOTE = { width: 0.34, at: [0, -0.16, -0.7], title: RAMP.kalam, line: 0.9 };
export function photoNoteType() {
	const m = PHOTO_NOTE.width / NOTE_W, d = Math.hypot(...PHOTO_NOTE.at), line = pxFor(PHOTO_NOTE.line, 'ui', m, d);
	return { width: PHOTO_NOTE.width, titleFont: 'kalam', titlePx: pxFor(PHOTO_NOTE.title, 'kalam', m, d), smallPx: line, minPx: pxFor(RAMP.body, 'ui', m, d) };
}

// The note while the Quest reports bare hands (milestone C0.1): their pinches
// do nothing until hands are supported (C0), so it says what will work.
export const HANDS_TEXT = { title: 'Pick up your controllers', line: 'This headset gives no hand tracking to CasaWalk.' };

// The safety net's card (js/safety.js): calm, honest, and always a way out.
export const LABEL_PX_LASER = Math.round(32 * 1.15); // the controllers' wing: row labels 15% larger (it may sit up to 0.75 m away)
export const ERROR_TEXT = {
	title: 'Something went wrong',
	line: '\u2190 Back returns to the page. The Meta button always leaves VR.',
	ending: 'Returning to the page\u2026',
};


export class XRUI {
	/** xr: the XRExperience (rig, camera, input, menus, mode, model, stage, ...). */
	constructor(xr) {
		this.xr = xr;
		this.menu = null; // the open settings wing (a Panel), or null
		this.menuPlace = null; // the place it opened at ('dollhouse' or 'walk')
		this.wrist = new WristMenu(xr);
		guideSheet.onLoad = () => this.menu?.draw(); // (the How to move pictures, once loaded)
		this.touches = []; // per input entry: its touch on the open board (js/touch.js)
		this.spent = new Set(); // controllers whose trigger closed the wings: claimed until let go
		this.buildPhotoFeedback();
		this.buildHandsNote();
		this.buildErrorNote();
		xr.hideFromPhotos(this.photoNote.mesh, this.handsNote.mesh, this.errorNote.mesh);
	}

	// -----------------------------------------------------------------------
	// Notes and photo feedback
	// -----------------------------------------------------------------------

	/** The "Pick up your controllers" note, a little below eye level, in front of you. */
	buildHandsNote() {
		this.handsNote = new NoteCard(HANDS_TEXT.title, [{ small: true, text: HANDS_TEXT.line }], { width: NOTES.hands.width });
		this.handsNote.mesh.name = 'hands-note';
		this.handsNote.mesh.position.fromArray(NOTES.hands.at);
		this.handsNote.mesh.visible = false;
		this.xr.camera.add(this.handsNote.mesh);
	}

	/** The safety net's card, in front of you at eye level, over everything (it must show even when the world is broken). */
	buildErrorNote() {
		this.errorNote = new NoteCard(ERROR_TEXT.title, [{ small: true, text: ERROR_TEXT.line }], { width: NOTES.error.width });
		this.errorNote.mesh.name = 'error-note';
		this.errorNote.mesh.position.fromArray(NOTES.error.at);
		this.errorNote.mesh.renderOrder = 1004; // (over the veil round the eyes, 1002, and the ?stats line, 1003)
		this.errorNote.mesh.visible = false;
		this.xr.camera.add(this.errorNote.mesh);
	}

	/** Shows the error card; ending: the session is about to end. */
	showError(ending = false) {
		this.errorNote.lines = [{ small: true, text: ending ? ERROR_TEXT.ending : ERROR_TEXT.line }];
		this.errorNote.draw();
		this.errorNote.mesh.visible = true;
	}

	hideError() { this.errorNote.mesh.visible = false; }

	/** Shows the hands note while only bare hands are reported (called every frame). */
	showHandsNote() {
		this.handsNote.mesh.visible = this.xr.input.handsOnly();
	}

	/** Photo feedback: a short white flash (the veil, js/veil.js), and a note in front of you for a few seconds. */
	buildPhotoFeedback() {
		const camera = this.xr.camera;
		this.photoNote = new NoteCard(PHOTO_TEXT.kept.title, [{ small: true, text: PHOTO_TEXT.kept.line }], photoNoteType());
		this.photoNote.mesh.position.fromArray(PHOTO_NOTE.at);
		this.photoNote.mesh.visible = false;
		camera.add(this.photoNote.mesh);
		this.photoFx = null; // { t, error }
	}

	/**
	 * After a photo: the flash (if it worked) and the note saying where it
	 * went, or that it failed. kept: { dropped } from the photo roll.
	 */
	showPhotoResult(error, kept = null) {
		const t = error ? PHOTO_TEXT.failed : kept?.dropped ? PHOTO_TEXT.full : PHOTO_TEXT.kept;
		this.photoNote.title = t.title;
		this.photoNote.lines = [{ small: true, text: t.line }];
		this.photoNote.draw();
		this.photoFx = { t: 0, error };
	}

	/** Advances the flash and the photo note. */
	runPhotoFx(dt) {
		const f = this.photoFx;
		if (!f) return;
		f.t += dt;
		this.xr.veil.set('flash', f.error ? 0 : Math.max(0, 0.75 * (1 - f.t / 0.3)), 0xffffff);
		this.photoNote.mesh.visible = f.t < 2.5;
		if (f.t >= 2.5) { this.photoFx = null; this.xr.veil.set('flash', 0); }
	}

	// -----------------------------------------------------------------------
	// The board
	// -----------------------------------------------------------------------

	/**
	 * Puts the wing (a Panel) beside the model: 45° to the main hand's side
	 * (wingSide()), 15° below eye level, 0.55 m from the eyes, leaned back
	 * 20°, and out of the way of the model (js/wings.js: moves outward, then
	 * up, if it would cover it). side: +1 left, -1 right. The heading is where
	 * the head faces even looking down at the wrist (headHeading: a bare
	 * forward direction flattened is unstable then, and put a wing in front: build 120).
	 */
	placeWing(panel, side, headMatrix = this.xr.camera.matrix) {
		const xr = this.xr, mesh = panel.mesh, g = mesh.geometry.parameters;
		const head = new THREE.Vector3().setFromMatrixPosition(headMatrix);
		const yaw = this.wingYaw = headHeading(headMatrix); // (kept: the tests check the wing against this front)
		let zone = null;
		if (xr.mode === 'dollhouse' && xr.model) {
			// The model's box in the rig's space (where the wings live), seen from the eyes.
			const box = xr.modes.dollhouse.houseBox(), pts = [], rigBox = new THREE.Box3(); // (the house, not its lawn: conflict 13)
			xr.rig.updateMatrixWorld(true);
			for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(xr.rig.worldToLocal(new THREE.Vector3(x, y, z)));
			rigBox.setFromPoints(pts);
			zone = zoneOf(rigBox, head, yaw);
		}
		const { az, el, dist, margin, clear } = placeWing(side, g.width, g.height, zone, { laser: xr.input.active().length > 0 }); // (controllers: lower, never up: build 215's B5)
		panel.placed = { az, el, dist, margin, clear }; // (for the tests: where it went, and whether the model stays uncovered)
		const heading = yaw + az; // (a positive angle turns left)
		mesh.position.set(-Math.sin(heading) * Math.cos(el), Math.sin(el), -Math.cos(heading) * Math.cos(el)).multiplyScalar(dist).add(head);
		xr.rig.updateMatrixWorld(true);
		mesh.lookAt(xr.rig.localToWorld(head.clone()));
		mesh.rotateX(-WING.tilt);
	}

	/**
	 * Opens this layer's settings wing (on the main hand's side) on `tab` if
	 * given; else, the first time at this place this session, on How to move,
	 * and after that on the last other tab used here (View at first: the
	 * next-build asks 3.3; per session, xr.store.tabs).
	 */
	openMenu(headMatrix, tab = null) {
		const xr = this.xr;
		this.closeMenu();
		const panel = xr.menus[xr.mode];
		if (!panel) return;
		const tabs = xr.store.tabs, place = xr.mode, first = !(place in tabs);
		if (first) tabs[place] = 'view';
		this.placeWing(panel, this.wingSide(), headMatrix);
		panel.labelPx = xr.input.active().length ? LABEL_PX_LASER : 32; // (the controllers' wing sits further away: its row labels 15% larger, build 215's B5)
		panel.setTab(tab ?? (first ? 'move' : tabs[place]));
		this.prepareGuide(panel);
		panel.hint = this.closeHint();
		panel.draw();
		panel.setHover(null);
		panel.mesh.visible = true;
		this.menu = panel;
		this.menuPlace = xr.mode;
		this.feel(null, 'open');
	}

	/** Which side the wing opens on: the main hand's (+1 left, -1 right). */
	wingSide() { return this.xr.mainHand === 'left' ? 1 : -1; }

	/** Closes the settings wing; the tab it showed (unless How to move) is the one it opens on next time at this place. */
	closeMenu() {
		if (this.menu) {
			if (this.menu.tab !== 'move') this.xr.store.tabs[this.menuPlace] = this.menu.tab;
			this.menu.mesh.visible = false;
			this.feel(null, 'close');
		}
		this.menu = null;
	}

	/** How to move (js/guide.js): for the input in hand, at this layer, and which build is running at its foot. */
	prepareGuide(panel) {
		const xr = this.xr, cell = panel.cells.get('guide');
		if (!cell) return;
		cell.kind = `${xr.mode === 'walk' ? 'walk' : 'dollhouse'}-${xr.input.active().length ? 'controllers' : 'hands'}`;
		// (A newer build live on the site: one calm line, here only; reloading is yours to choose, after VR.)
		cell.foot = buildLabel(BUILD) + (xr.newerBuild > BUILD.number ? ' · Newer version: reload after VR' : '');
	}

	/** The wing's close line: how to close it with the input in hand (CLOSE_HINT). */
	closeHint() { return this.xr.input.active().length ? CLOSE_HINT.controllers : CLOSE_HINT.hands; }

	/**
	 * Whether a press (a trigger pull, or a quick pinch) along the raycaster's
	 * ray lands on nothing you can use, so it closes the wings (build 120, M1).
	 * Usable: a wing, a key (the main hand's keys too), the fan, a tool, the doors and levels
	 * keys, the model's box, the plinth. Never empty with a tool in that hand,
	 * the fan open, or the hand (points: its fingertip, its pinch) within
	 * KEEP_CLEAR of a key or a wing. Gallery walls, the floor, the sky,
	 * and inside the home its walls and floors are empty.
	 */
	emptyPress(c, points = []) { return this.notEmpty(c, points) === null; }

	/** Why a press is not at empty space ('tool', 'fan', 'near', 'wing', 'keys', 'doors', 'plinth', 'model'), or null: it is (emptyPress). */
	notEmpty(c, points = []) {
		const xr = this.xr, r = xr.raycaster;
		if (xr.tools?.held?.c === c) return 'tool';
		const tools = (xr.claims ?? xr.claimSnapshot()).tools; // (the tools always show: a press is theirs only within reach of one, ladder rule 5)
		for (const p of points) if (p && tools.some((t) => t.distanceTo(p) < KEEP_CLEAR)) return 'fan';
		for (const p of points) if (p && xr.nearKey(p, KEEP_CLEAR, { by: c })) return 'near';
		for (const panel of this.openPanels()) if (r.intersectObject(panel.mesh, false).length) return 'wing';
		if (this.wrist.wearer !== c && this.wrist.group.visible && r.intersectObject(this.wrist.group, true).length) return 'keys'; // (their own hand's: the ray starts beside them)
		if (xr.mode === 'dollhouse' && xr.model) {
			const doll = xr.modes.dollhouse;
			if (doll.doorsLive && r.intersectObject(doll.doorGroup, true).length) return 'doors'; // (only live keys: faded doors take no presses, so they guard nothing)
			if (xr.pedestal?.visible && r.intersectObject(xr.pedestal, true).length) return 'plinth';
			if (r.ray.intersectsBox(doll.modelBox(this._box ??= new THREE.Box3()))) return 'model';
		}
		return null;
	}

	/** A press at empty space: closes what is open, like the orb (sound close; a controller's vibration close). */
	closeOnEmpty(c) {
		const wings = !!this.menu;
		this.closeAll(); // (the wing makes its own close sound)
		this.feel(c, wings ? null : 'close', 'close');
	}

	/**
	 * Bare hands: a quick pinch (gestures' tap) in front of you, aimed (the
	 * hand's aim ray) at nothing you can use, closes what is open. Never a
	 * closed hand, never a fingertip touch.
	 */
	handTaps() {
		const xr = this.xr, raycaster = xr.raycaster;
		for (const c of xr.input.controllers) {
			if (!c.isHand || !c.gesture || c.gesture.fist || !xr.emptyHand(c) || !c.gestures.some((e) => e.type === 'tap')) continue; // (a hand holding a tool never closes the wing: harmony rule 2)
			const s = c.gesture.shape;
			if (!s) continue;
			const head = xr.headWorld(), axes = xr.viewAxes();
			if (!pinchGate(s, head, axes.forward)) continue;
			const { origin, dir } = handAimRay(head, axes.right, s.pinchAt, c.handedness);
			raycaster.set(origin, dir);
			raycaster.far = 20;
			if (this.emptyPress(c, [c.touch.tracked ? c.touch.tip : null, s.pinchAt])) { this.closeOnEmpty(c); return true; }
		}
		return false;
	}

	/** Closes everything: the wing (moving between layers). */
	closeAll() {
		this.closeMenu();
	}

	/** The wing, if open, as a list (what a press may land on). */
	openPanels() { return this.menu ? [this.menu] : []; }

	/** True while the wing is open. */
	get anyOpen() { return !!this.menu; }

	/** Settings (the main hand's key): opens the wing, or closes it. */
	toggleBoard() { if (this.menu) this.closeMenu(); else this.openMenu(); }

	/** A sound (if sound is on) and, on a controller, a vibration. */
	feel(c, sound, haptic = null, gain = 1) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound, gain);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/**
	 * The main hand's keys, then lasers and touch on the board.
	 * Claims the trigger of every controller whose laser is on the menus this
	 * frame (c.claim.trigger = 'ui'), and returns the action to run, if any:
	 * { action }. (A controller whose trigger a held tool owns is skipped.)
	 */
	point(dt = this.xr.frameDt ?? 1 / 72) {
		const xr = this.xr, input = xr.input, raycaster = xr.raycaster;
		let hover = null;
		let { action } = this.wrist.update(dt);
		const active = input.active();
		let panels = this.openPanels();
		let closable = panels.length > 0;
		for (const c of active) {
			// (A pull that closed the wings is used up: never also an aim or a click, until let go.)
			// (A new pull means it was let go meanwhile, even unseen: frames between layers skip the menus.)
			if (this.spent.has(c)) { if (c.state.trigger && !c.state.down.trigger) { c.claim.trigger = 'ui'; continue; } this.spent.delete(c); }
			if (c.claim.trigger) continue;
			input.setRaycaster(c, raycaster);
			// The nearest wing the laser hits.
			let menuHit = null, panel = null;
			for (const p of panels) {
				const h = raycaster.intersectObject(p.mesh, false)[0];
				if (h && (!menuHit || h.distance < menuHit.distance)) { menuHit = h; panel = p; }
			}
			if (menuHit) {
				c.claim.trigger = 'ui';
				input.showHit(c, menuHit.distance);
				const target = panel.hitTest(menuHit.uv);
				if (target && !hover) hover = { ...target, panel };
				if (c.state.down.trigger) {
					if (target) {
						action = panel.press(target) ?? action;
						this.feel(c, 'press', 'click');
					} else if (panel.disabledAt(menuHit.uv)) this.feel(c, 'deny', 'deny');
				}
			} else if (closable && c.state.down.trigger) {
				// A pull elsewhere while the wing is open: at
				// empty space it closes them all (build 120, M1); at the model, the
				// plinth, a key, it does nothing. Either way it is used up.
				c.claim.trigger = 'ui';
				this.spent.add(c);
				if (this.emptyPress(c, [c.touch.tracked ? c.touch.tip : null])) {
					this.closeOnEmpty(c);
					panels = []; closable = false;
				}
			}
		}
		if (closable && this.handTaps()) panels = [];
		// Touch keys: fingertips and controller tips press the open board.
		const touched = this.touchMenu();
		hover ||= touched.hover;
		action ||= touched.action;
		for (const p of panels) p.setHover(hover?.panel === p ? hover : null);
		return { action };
	}

	/**
	 * Every fingertip and controller tip against the open board: hover ring,
	 * contact, click, release (js/touch.js). Returns { hover, action }.
	 */
	touchMenu() {
		const xr = this.xr, now = performance.now() / 1000;
		let hover = null, action = null;
		const panels = this.openPanels();
		// (A wing that closed: its touches forget what was in progress.)
		for (const row of this.touches) {
			if (!row) continue;
			for (const [panel, st] of row) if (!panels.includes(panel)) { resetTouch(st.s); st.ring.visible = false; st.last = null; }
		}
		for (const c of xr.input.controllers) {
			const row = this.touches[c.index] ||= new Map();
			for (const panel of panels) {
				const st = row.get(panel) ?? row.set(panel, this.newTouch()).get(panel);
				const busy = c.claim.trigger === 'tool';
				if (!c.touch.tracked || busy || st.kind !== c.touch.kind) {
					// Gone, or switched: nothing in progress completes.
					resetTouch(st.s);
					st.kind = c.touch.kind; st.last = null;
					st.ring.visible = false;
					if (!c.touch.tracked || busy) continue;
				}
				const geo = panel.mesh.geometry.parameters;
				panel.mesh.updateMatrixWorld(true);
				const L = panel.mesh.worldToLocal(st.local.copy(c.touch.tip));
				const inside = Math.abs(L.x) <= geo.width / 2 + TOUCH.MARGIN && Math.abs(L.y) <= geo.height / 2 + TOUCH.MARGIN;
				const depth = L.z - TOUCH.RADIUS;
				const lateral = st.last ? Math.hypot(L.x - st.last.x, L.y - st.last.y) : 0;
				const dt = st.t ? Math.min(now - st.t, 0.1) : 1 / 72;
				st.t = now;
				st.last = (st.last ?? new THREE.Vector2()).set(L.x, L.y);
				const uv = { x: L.x / geo.width + 0.5, y: L.y / geo.height + 0.5 };
				const target = inside ? panel.hitTest(uv) : null;
				for (const e of stepTouch(st.s, { depth, inside, lateral, dt })) {
					if (e === 'contact') this.feel(c, 'tick', 'tick', 0.5);
					else if (e === 'click') {
						const key = target ? `${target.id}|${target.value ?? ''}` : null;
						if (now - st.lastClick < TOUCH.PANEL_GAP || (key && key === st.lastKey && now - st.lastClick < TOUCH.KEY_GAP)) continue;
						if (target) {
							st.lastClick = now; st.lastKey = key;
							action = panel.press(target) ?? action;
							this.feel(c, 'press', 'click');
						} else if (panel.disabledAt(uv)) this.feel(c, 'deny', 'deny');
					} else if (e === 'release') this.feel(c, 'release', null, 0.6);
				}
				const live = st.s.phase === 'hover' || st.s.phase === 'contact' || st.s.phase === 'pressed';
				if (live && target) hover ||= { ...target, panel };
				// The ring under the fingertip shows where it will land.
				if (live) {
					if (st.ring.parent !== panel.mesh) panel.mesh.add(st.ring);
					st.ring.position.set(L.x, L.y, 0.002);
					st.ring.scale.setScalar(ringSize(Math.max(depth, 0)));
				}
				st.ring.visible = live;
				if (live && xr.handViews?.[c.index]) xr.handViews[c.index].near = true; // (the wrist menu set it first this frame)
			}
		}
		return { hover, action };
	}

	newTouch() {
		const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: KEY.ring, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
		ring.renderOrder = 12;
		ring.visible = false;
		ring.name = 'touch-ring';
		this.xr.hideFromPhotos(ring);
		return { s: touchState(), ring, kind: null, last: null, local: new THREE.Vector3(), t: 0, lastClick: -1, lastKey: null };
	}

	/**
	 * Controller buttons for the menus: B or Y closes the wing if it is open;
	 * with nothing open, held BACK_HOLD it is ← Back (the same rule as the
	 * key: its ring fills on ← Back; a short press does nothing). (A no longer
	 * opens anything: the keys always show, build 215's C8.) Returns true if
	 * a button was used.
	 */
	buttons() {
		const xr = this.xr, dt = xr.frameDt ?? 1 / 72;
		for (const c of xr.input.active()) {
			if (c.state.down.b && !c.claim.b && this.anyOpen) { this.closeMenu(); return true; }
			if (c.state.down.b && !c.claim.b) { this.backHold = { c, t: 0 }; xr.haptics.play(c, 'tick'); } // (a light tick on the press: the hold has begun; the UX review's S4)
		}
		const h = this.backHold;
		if (h && (!h.c.state.b || !h.c.source)) this.backHold = null; // (let go early: it drains back)
		else if (h) {
			h.c.claim.b = 'ui';
			h.t += dt;
			if (h.t >= BACK_HOLD) {
				this.backHold = null;
				this.wrist.flashBack();
				this.wrist.setBackProgress(0);
				this.feel(h.c, 'press', 'click');
				xr.menuAction('back');
				return true;
			}
		}
		this.wrist.setBackProgress(this.backHold ? this.backHold.t / BACK_HOLD : 0);
		return false;
	}

	/** Leaving VR: everything closed and put away. */
	/** The session ends (js/xr.js handleEnd): the wing, the notes and the main hand's keys put away. */
	end() { this.reset(); }

	reset() {
		this.spent.clear();
		this.closeMenu();
		this.photoFx = null;
		this.xr.veil.set('flash', 0);
		this.photoNote.mesh.visible = false;
		this.handsNote.mesh.visible = false;
		this.errorNote.mesh.visible = false;
		this.wrist.reset();
		for (const row of this.touches) for (const st of row?.values() ?? []) { resetTouch(st.s); st.ring.visible = false; }
	}
}

// The hover ring under a fingertip: 1 m across, scaled to its size (ringSize()).
const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32);
