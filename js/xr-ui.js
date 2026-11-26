// The headset's floating interface (SPEC.md, "Experience and controls" and
// C0 "Hands and touch"):
//
//   Wrist    the wrist menu (js/wrist-menu.js): an orb on one wrist, and
//            four keys in a cross: Settings, Help, ← Back, Walk in →.
//   Board    Settings opens the settings board within reach (50 cm ahead,
//            25 cm below the eyes, tilted back 20°; at the scale model 45° to
//            the left, clear of the model), pressed by touch (js/touch.js) or
//            by a controller's laser; its handle moves it (a controller's
//            grip). What it says and does: js/xr-menus.js. Both wings close
//            with the orb, Settings again, B/Y, moving between layers, or a
//            press at empty space (build 120's M1: a trigger pull, or a quick
//            pinch, aimed at nothing you can use: emptyPress()); there is no
//            Close key, and "? How to move" closes How to move alone.
//   Help     opens the board on its first tab, How to move (js/guide.js):
//            how to move here, for controllers or bare hands, and the build
//            at its foot. (The help cards beside the wrist menu went on 25
//            Nov 2026: one panel instead of two, the Quest 2 design's item 6.)
//   Welcome  a card above the scale model on every entry, until the wrist
//            menu is first opened.
//   Photo    the flash and note of a photo (the street camera, milestone D).
//   Hands    without hand joints: "Pick up your controllers" (C0.1).
//
// Each frame the mode calls buttons() and point(); point() claims the
// trigger of every controller whose laser is on the menus (c.claim.trigger =
// 'ui'), so the mode leaves those alone.

import * as THREE from 'three';
import { WelcomeCard, Label } from './panel.js';
import { BUILD } from './version.js';
import { buildLabel } from './build-label.js';
import { headHeading } from './xr-dollhouse.js';
import { TOUCH, touchState, stepTouch, reset as resetTouch, ringSize } from './touch.js';
import { KEY } from './theme.js';
import { WING, placeWing, zoneOf } from './wings.js';
import { guideSheet } from './guide.js';
import { WristMenu } from './wrist-menu.js';
import { FIRST_TIME_CARDS } from './lessons.js';
import { handAimRay, pinchGate } from './gestures.js';
import { CLAIM } from './xr-targets.js';
import { CLOSE_HINT } from './xr-menus.js';

const KEEP_CLEAR = CLAIM.near; // a press with the hand this near a live key, the orb or a wing is never "empty" (m)

// The note after a photo. Photos are kept in the app and saved from the page
// after VR (a download in VR would end the session).
const PHOTO_TEXT = {
	kept: { title: 'Nice shot!', line: 'It waits on the page for when you leave VR.' },
	full: { title: 'Nice shot!', line: 'Only the last 50 are kept: the oldest made room.' },
	failed: { title: 'The photo didn\'t work', line: 'Try again, or use the Quest\'s own screenshot.' },
};

// The note while the Quest reports bare hands (milestone C0.1): their pinches
// do nothing until hands are supported (C0), so it says what will work.
const HANDS_TEXT = { title: 'Pick up your controllers', line: 'This headset gives no hand tracking to CasaWalk.' };

// The safety net's card (js/safety.js): calm, honest, and always a way out.
const ERROR_TEXT = {
	title: 'Something went wrong',
	line: '\u2190 Back returns to the page. The Meta button always leaves VR.',
	ending: 'Returning to the page\u2026',
};

export class XRUI {
	/** xr: the XRExperience (rig, camera, input, menus, mode, model, stage, ...). */
	constructor(xr) {
		this.xr = xr;
		this.menu = null; // the open settings wing, on the right (a Panel), or null
		this.guide = null; // the open How to move wing, on the left (a Panel), or null
		this.tab = null; // the settings tab last shown (kept between the two layers' boards); null: none yet this session
		this.opened = false; // Settings has opened this session
		this.pinchNotes = 0; // the wrong-hand notes shown this session (at most 3)
		this.pinchNote = null;
		this.teleports = 0; // this session's teleports
		this.drag = null; // a slider being dragged: { c, id }
		this.wrist = new WristMenu(xr);
		guideSheet.onLoad = () => this.guide?.draw(); // (the How to move pictures, once loaded)
		this.touches = []; // per input entry: its touch on the open board (js/touch.js)
		this.spent = new Set(); // controllers whose trigger closed the wings: claimed until let go
		this.buildWelcome();
		this.buildPhotoFeedback();
		this.buildHandsNote();
		this.buildErrorNote();
		this.pinchLabel = new Label({ height: 0.035 });
		this.pinchLabel.mesh.visible = false;
		xr.hideFromPhotos(this.pinchLabel.mesh, this.welcome.mesh, this.photoNote.mesh, this.handsNote.mesh, this.errorNote.mesh);
	}

	// -----------------------------------------------------------------------
	// Welcome card and photo feedback
	// -----------------------------------------------------------------------

	/**
	 * Welcome card above the dollhouse (replaces the menu opening by itself):
	 * how to open the menu, shown on every entry until the menu is opened.
	 */
	buildWelcome() {
		this.welcome = new WelcomeCard('Welcome to CasaWalk', this.welcomeLines(), { width: 1.1 }); // (read from as far as the model)
		this.welcome.mesh.visible = false;
		this.welcomeOn = false; // until the menu is first opened
	}

	/** The welcome card's lines, for the wrist that wears the menu. */
	welcomeLines() {
		const side = this.wrist?.side ?? 'right', other = side === 'right' ? 'left' : 'right';
		// (Minimal until the first-time message with the hand animation replaces it, C0.5.)
		return [
			{ key: 'Wrist', kind: 'orb', text: `Touch your ${side} wrist with your ${other} hand: menu` },
			{ key: 'Trigger', kind: 'trigger', text: 'Point at a room and pull: step inside' },
		];
	}

	/** Shows or hides the welcome card (only ever in the dollhouse). */
	setWelcome(on) {
		if (on) { this.welcome.lines = this.welcomeLines(); this.welcome.draw(); }
		this.welcomeOn = on;
		// (A first-time lesson replaces it: js/lessons.js.)
		this.welcome.mesh.visible = on && FIRST_TIME_CARDS.on && this.xr.mode === 'dollhouse' && !this.xr.lessons?.place; // (off for now: js/lessons.js)
	}

	/**
	 * Puts the welcome card over the back half of the plinth, well above the
	 * model's top, so from where you stand it shows above the home, not on it.
	 */
	placeWelcome() {
		const xr = this.xr, card = this.welcome.mesh;
		const size = xr.model ? xr.model.bounds.getSize(new THREE.Vector3()).multiplyScalar(xr.baseScale) : new THREE.Vector3(1, 0.4, 1);
		const top = xr.plinthH + 0.004 + size.y;
		const h = card.geometry.parameters.height;
		// As far away as the model, floating well above its back edge (not in front of the eyes).
		card.position.set(0, top + 0.45 + h / 2, -xr.plinthDistance - (xr.plinthSize?.D ?? size.z) / 2);
		if (card.parent !== xr.stage) xr.stage.add(card);
	}

	/** The welcome card turns to face you (called every dollhouse frame). */
	faceWelcome() {
		if (this.welcome.mesh.visible) this.welcome.mesh.lookAt(this.xr.camera.getWorldPosition(new THREE.Vector3()));
	}

	/** The "Pick up your controllers" note, a little below eye level, in front of you. */
	buildHandsNote() {
		this.handsNote = new WelcomeCard(HANDS_TEXT.title, [{ small: true, text: HANDS_TEXT.line }], { width: 0.6 });
		this.handsNote.mesh.name = 'hands-note';
		this.handsNote.mesh.position.set(0, -0.08, -0.85);
		this.handsNote.mesh.visible = false;
		this.xr.camera.add(this.handsNote.mesh);
	}

	/** The safety net's card, in front of you at eye level, over everything (it must show even when the world is broken). */
	buildErrorNote() {
		this.errorNote = new WelcomeCard(ERROR_TEXT.title, [{ small: true, text: ERROR_TEXT.line }], { width: 0.6 });
		this.errorNote.mesh.name = 'error-note';
		this.errorNote.mesh.position.set(0, -0.05, -0.8);
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

	/**
	 * A pinch from the hand that does not teleport right now: a quiet no and a
	 * small note at that hand for 1.5 s, saying which hand to use ("Pinch with
	 * your right hand to move"); only the first 3 times in a session, then silent.
	 */
	noteWrongHand(c, at) {
		const xr = this.xr;
		if (this.pinchNotes >= 3 || this.pinchNote?.visible) return;
		this.pinchNotes++;
		const label = this.pinchLabel;
		label.set(`Pinch with your ${xr.teleportHand({ handedness: 'left' }) ? 'left' : 'right'} hand to move`); // (the hand that can: the main hand, or the other while it holds a tool)
		label.mesh.position.copy(at).y += 0.12;
		label.mesh.lookAt(xr.headWorld());
		if (label.mesh.parent !== xr.scene) xr.scene.add(label.mesh);
		label.mesh.visible = true;
		this.pinchNote = { visible: true, t: 0 };
		if (xr.soundLevel !== 'off') xr.sound.play('deny', 0.5);
	}

	/** Advances the wrong-hand note. */
	runPinchNote(dt) {
		const n = this.pinchNote;
		if (!n) return;
		n.t += dt;
		if (n.t > 1.5) { n.visible = false; this.pinchNote = null; if (this.pinchLabel) this.pinchLabel.mesh.visible = false; }
	}

	/** Shows the hands note while only bare hands are reported (called every frame). */
	showHandsNote() {
		this.handsNote.mesh.visible = this.xr.input.handsOnly();
	}

	/** Photo feedback: a short white flash (the veil, js/veil.js), and a note in front of you for a few seconds. */
	buildPhotoFeedback() {
		const camera = this.xr.camera;
		this.photoNote = new WelcomeCard(PHOTO_TEXT.kept.title, [{ small: true, text: PHOTO_TEXT.kept.line }], { width: 0.34 });
		this.photoNote.mesh.position.set(0, -0.16, -0.7);
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
	 * Puts a wing (a Panel) beside the model: 45° to its side (Settings on
	 * the main hand's side, How to move on the other: wingSide()), 15° below eye
	 * level, 0.55 m from the eyes, leaned back 20°, and out of the way of the
	 * model (js/wings.js: moves outward, then up, if it would cover it).
	 * side: +1 the left wing, -1 the right. The heading is where the head
	 * faces even looking down at the wrist (headHeading: a bare forward
	 * direction flattened is unstable then, and put a wing in front: build 120).
	 */
	placeWing(panel, side, headMatrix = this.xr.camera.matrix) {
		const xr = this.xr, mesh = panel.mesh, g = mesh.geometry.parameters;
		const head = new THREE.Vector3().setFromMatrixPosition(headMatrix);
		// The second wing shares the first's heading: they open as a pair round one front (the
		// Tester's B8: looking at Settings and opening How to move put it over the model).
		const yaw = this.menu || this.guide ? this.wingYaw : (this.wingYaw = headHeading(headMatrix));
		let zone = null;
		if (xr.mode === 'dollhouse' && xr.model) {
			// The model's box in the rig's space (where the wings live), seen from the eyes.
			const box = xr.modes.dollhouse.houseBox(), pts = [], rigBox = new THREE.Box3(); // (the house, not its lawn: conflict 13)
			xr.rig.updateMatrixWorld(true);
			for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(xr.rig.worldToLocal(new THREE.Vector3(x, y, z)));
			rigBox.setFromPoints(pts);
			zone = zoneOf(rigBox, head, yaw);
		}
		const { az, el, dist, clear } = placeWing(side, g.width, g.height, zone);
		panel.placed = { az, el, dist, clear }; // (for the tests: where it went, and whether the model stays uncovered)
		const heading = yaw + az; // (a positive angle turns left)
		mesh.position.set(-Math.sin(heading) * Math.cos(el), Math.sin(el), -Math.cos(heading) * Math.cos(el)).multiplyScalar(dist).add(head);
		xr.rig.updateMatrixWorld(true);
		mesh.lookAt(xr.rig.localToWorld(head.clone()));
		mesh.rotateX(-WING.tilt);
	}

	/**
	 * Opens this layer's settings wing (on the main hand's side) on `tab` if
	 * given, else the tab last shown (View at first). The wrist key opens it
	 * with How to move (toggleBoard).
	 */
	openMenu(headMatrix, tab = null) {
		const xr = this.xr;
		this.closeMenu();
		const panel = xr.menus[xr.mode];
		if (!panel) return;
		this.placeWing(panel, this.wingSide('settings'), headMatrix);
		panel.setTab(tab ?? this.tab ?? 'view');
		panel.lead.on = !!this.guide;
		panel.hint = this.closeHint();
		panel.draw();
		panel.setHover(null);
		panel.mesh.visible = true;
		this.menu = panel;
		this.feel(null, 'open');
		this.opened = true;
	}

	/** Which side a wing opens on: Settings on the main hand's (+1 left, -1 right), How to move on the other. */
	wingSide(which) {
		const main = this.xr.mainHand === 'left' ? 1 : -1;
		return which === 'settings' ? main : -main;
	}

	/** Closes the settings wing. */
	closeMenu() {
		if (this.menu) { this.tab = this.menu.tab; this.menu.closeDropdown(); this.menu.mesh.visible = false; this.feel(null, 'close'); }
		this.menu = null;
		this.drag = null;
	}

	/** Opens How to move, the left wing: the pictures for the input in hand, here, the replay keys, the build at its foot. */
	openGuide(headMatrix) {
		const xr = this.xr;
		this.closeGuide();
		const panel = xr.guides[xr.mode];
		if (!panel) return;
		this.placeWing(panel, this.wingSide('guide'), headMatrix);
		this.prepareGuide(panel);
		panel.hint = this.closeHint();
		panel.draw();
		panel.setHover(null);
		panel.mesh.visible = true;
		this.guide = panel;
		if (this.menu?.lead) { this.menu.lead.on = true; this.menu.draw(); }
		this.feel(null, 'open');
	}

	/** Closes the How to move wing. */
	closeGuide() {
		if (this.guide) { this.guide.mesh.visible = false; this.feel(null, 'close'); }
		this.guide = null;
		if (this.menu?.lead) { this.menu.lead.on = false; this.menu.draw(); }
	}

	/** The How to move wing (js/guide.js): for the input in hand, at this layer, and which build is running at its foot. */
	prepareGuide(panel) {
		const xr = this.xr, cell = panel.cells.get('guide');
		if (!cell) return;
		cell.kind = `${xr.mode === 'walk' ? 'walk' : 'dollhouse'}-${xr.input.active().length ? 'controllers' : 'hands'}`;
		// (A newer build live on the site: one calm line, here only; reloading is yours to choose, after VR.)
		cell.foot = buildLabel(BUILD) + (xr.newerBuild > BUILD.number ? ' · Newer version: reload after VR' : '');
	}

	/** The wings' foot line: how to close them with the input in hand (CLOSE_HINT). */
	closeHint() { return this.xr.input.active().length ? CLOSE_HINT.controllers : CLOSE_HINT.hands; }

	/**
	 * Whether a press (a trigger pull, or a quick pinch) along the raycaster's
	 * ray lands on nothing you can use, so it closes the wings (build 120, M1).
	 * Usable: a wing, a key, the orb, the fan, a tool, the doors and levels
	 * keys, the model's box, the plinth. Never empty with a tool in that hand,
	 * the fan open, or the hand (points: its fingertip, its pinch) within
	 * KEEP_CLEAR of a key, the orb or a wing. Gallery walls, the floor, the sky,
	 * and inside the home its walls and floors are empty.
	 */
	emptyPress(c, points = []) { return this.notEmpty(c, points) === null; }

	/** Why a press is not at empty space ('tool', 'fan', 'near', 'wing', 'wrist', 'orb', 'doors', 'plinth', 'model'), or null: it is (emptyPress). */
	notEmpty(c, points = []) {
		const xr = this.xr, r = xr.raycaster;
		if (xr.tools?.held?.c === c) return 'tool';
		if (xr.fan?.alpha > 0.5) return 'fan'; // (the fan open: the bare-hand docked row is never live, the Tester's finding)
		for (const p of points) if (p && this.nearUsable(c, p)) return 'near';
		for (const panel of this.openPanels()) if (r.intersectObject(panel.mesh, false).length) return 'wing';
		if (this.wrist.cross.visible && r.intersectObject(this.wrist.cross, true).length) return 'wrist';
		if (this.wrist.wearer !== c && this.wrist.orb.group.visible && r.intersectObject(this.wrist.orb.group, true).length) return 'orb'; // (its own wrist's orb: the ray starts beside it)
		if (xr.mode === 'dollhouse' && xr.model) {
			const doll = xr.modes.dollhouse;
			if (doll.doorsLive && r.intersectObject(doll.doorGroup, true).length) return 'doors'; // (only live keys: faded doors take no presses, so they guard nothing)
			if (xr.pedestal?.visible && r.intersectObject(xr.pedestal, true).length) return 'plinth';
			if (r.ray.intersectsBox(doll.modelBox(this._box ??= new THREE.Box3()))) return 'model';
		}
		return null;
	}

	/** True if world point p (of input c) is within KEEP_CLEAR of a wing, the wrist keys or the orb (on the other wrist: they ride the wearer's own) or a door. */
	nearUsable(c, p) {
		const xr = this.xr, v = this._near ??= new THREE.Vector3();
		for (const panel of this.openPanels()) {
			const g = panel.mesh.geometry.parameters;
			panel.mesh.updateMatrixWorld(true);
			const L = panel.mesh.worldToLocal(v.copy(p));
			if (Math.hypot(Math.max(0, Math.abs(L.x) - g.width / 2), Math.max(0, Math.abs(L.y) - g.height / 2), L.z) < KEEP_CLEAR) return true;
		}
		if (this.wrist.wearer !== c) {
			if (this.wrist.cross.visible && this.wrist.pad.near(p, KEEP_CLEAR)) return true;
			const orb = this.wrist.orb.group;
			if (orb.visible && orb.getWorldPosition(v).distanceTo(p) < KEEP_CLEAR) return true;
		}
		if (xr.mode === 'dollhouse' && xr.modes.dollhouse?.doorsLive && xr.modes.dollhouse.doors.near(p, KEEP_CLEAR)) return true;
		return false;
	}

	/** A press at empty space: closes what is open, like the orb (sound close; a controller's vibration close). */
	closeOnEmpty(c) {
		const wings = !!(this.menu || this.guide);
		this.closeAll(); // (the wings make their own close sound)
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
			if (!c.isHand || !c.gesture || c.gesture.fist || !c.gestures.some((e) => e.type === 'tap')) continue;
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

	/** Counts this session's teleports. */
	onTeleport() { this.teleports++; } // (walk mode's own count runs across sessions: this one is per session)

	/** Closes everything: both wings and the wrist menu (moving between layers). */
	closeAll() {
		this.closeMenu();
		this.closeGuide();
		this.wrist.close();
	}

	/** The wings open now. */
	openPanels() { return this.guide ? (this.menu ? [this.menu, this.guide] : [this.guide]) : this.menu ? [this.menu] : []; }

	/** True while a wing or the wrist menu is open. */
	get anyOpen() { return !!this.menu || !!this.guide || this.wrist.open; }

	/**
	 * "Settings, and help" on the wrist: opens both wings; with either open,
	 * closes both (build 120's design: help closed alone was never found again).
	 */
	toggleBoard() { if (this.menu || this.guide) { this.closeMenu(); this.closeGuide(); } else { this.openMenu(); this.openGuide(); } }

	/** How to move: opens the left wing, or closes it. */
	toggleHelp() { if (this.guide) this.closeGuide(); else this.openGuide(); }

	/** A sound (if sound is on) and, on a controller, a vibration. */
	feel(c, sound, haptic = null, gain = 1) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound, gain);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/**
	 * The wrist menu, then lasers and touch on the board, and its handle.
	 * Claims the trigger of every controller whose laser is on the menus this
	 * frame (c.claim.trigger = 'ui'), and returns the action to run, if any:
	 * { action }. (A controller whose trigger a held tool owns is skipped.)
	 */
	point(dt = this.xr.frameDt ?? 1 / 72) {
		const xr = this.xr, input = xr.input, raycaster = xr.raycaster;
		let hover = null;
		this.runPinchNote(dt);
		let { action } = this.wrist.update(dt);
		if (this.wrist.open) { this.setWelcome(false); this.xr.lessons?.note('wrist'); } // found it: the welcome card has done its job
		const active = input.active();
		if (this.drag && (!this.menu || !this.drag.c.source || !this.drag.c.state.trigger)) this.drag = null; // let go
		let panels = this.openPanels();
		let closable = panels.length > 0 || (this.wrist.open && this.wrist.pinned);
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
			if (this.drag?.c === c) {
				// Dragging a slider: follow the laser along the track while the trigger is held.
				c.claim.trigger = 'ui';
				const hit = menuHit && panel === this.menu ? menuHit : null;
				input.showHit(c, hit?.distance ?? null);
				const value = hit ? this.menu.sliderValue(this.drag.id, hit.uv) : null;
				if (value !== null) action = { id: this.drag.id, value };
				hover = { id: this.drag.id, slider: true, panel: this.menu };
				continue;
			}
			if (menuHit) {
				c.claim.trigger = 'ui';
				input.showHit(c, menuHit.distance);
				const target = panel.hitTest(menuHit.uv);
				if (target && !hover) hover = { ...target, panel };
				if (c.state.down.trigger) {
					if (target) {
						// (Opening or closing a dropdown's list is handled by the panel itself.)
						action = panel.press(target) ?? action;
						if (action?.slider) this.drag = { c, id: action.id };
						this.feel(c, 'press', 'click');
					} else if (panel.disabledAt(menuHit.uv)) this.feel(c, 'deny', 'deny');
				}
			} else if (closable && c.state.down.trigger) {
				// A pull elsewhere while a wing or the pinned wrist menu is open: at
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
			for (const [panel, st] of row) if (!panels.includes(panel)) { resetTouch(st.s); st.ring.visible = false; st.last = null; st.slider = null; }
		}
		for (const c of xr.input.controllers) {
			const row = this.touches[c.index] ||= new Map();
			for (const panel of panels) {
				const st = row.get(panel) ?? row.set(panel, this.newTouch()).get(panel);
				const busy = c.claim.trigger === 'tool' || c.claim.trigger === 'ui' && this.drag?.c === c;
				if (!c.touch.tracked || busy || st.kind !== c.touch.kind) {
					// Gone, or switched: nothing in progress completes.
					resetTouch(st.s);
					st.kind = c.touch.kind; st.last = null; st.slider = null;
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
							if (action?.slider) st.slider = action.id;
							this.feel(c, 'press', 'click');
						} else if (panel.disabledAt(uv)) this.feel(c, 'deny', 'deny');
					} else if (e === 'release') { st.slider = null; this.feel(c, 'release', null, 0.6); }
				}
				const live = st.s.phase === 'hover' || st.s.phase === 'contact' || st.s.phase === 'pressed';
				if (st.s.phase === 'pressed' && st.slider) {
					const value = panel.sliderValue(st.slider, uv);
					if (value !== null) action = { id: st.slider, value };
					hover = { id: st.slider, slider: true, panel };
				} else if (live && target) hover ||= { ...target, panel };
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
		return { s: touchState(), ring, kind: null, last: null, local: new THREE.Vector3(), t: 0, slider: null, lastClick: -1, lastKey: null };
	}

	/**
	 * Controller buttons for the menus: A (X when the tool fan is on the right
	 * hand), on the controller wearing the wrist menu, opens or closes it
	 * (pinned); B or Y closes whatever is open. Returns true if a button was
	 * used. (Inside, B / Y with nothing open is Back: js/xr-walk.js.)
	 */
	buttons() {
		const wearer = this.wrist.wearer;
		for (const c of this.xr.input.active()) {
			if (c.state.down.a && !c.claim.a && c === wearer && (this.menu || this.guide)) { this.closeAll(); this.feel(c, 'close'); return true; } // (with a wing open, like the orb: closes everything)
			if (c.state.down.a && !c.claim.a && c === wearer) { this.wrist.toggle({ pinned: true }); if (this.wrist.open) { this.setWelcome(false); this.xr.lessons?.note('wrist'); } return true; }
			if (c.state.down.b && !c.claim.b && this.anyOpen) { this.closeMenu(); this.closeGuide(); this.wrist.close(true); return true; }
		}
		return false;
	}

	/** Leaving VR: everything closed and put away. */
	reset() {
		this.drag = null;
		this.spent.clear();
		this.closeMenu();
		this.closeGuide();
		this.setWelcome(false);
		this.photoFx = null;
		this.xr.veil.set('flash', 0);
		this.photoNote.mesh.visible = false;
		this.handsNote.mesh.visible = false;
		this.errorNote.mesh.visible = false;
		this.wrist.reset();
		this.tab = null;
		this.opened = false;
		this.teleports = 0;
		this.pinchNotes = 0;
		this.pinchNote = null;
		if (this.pinchLabel) this.pinchLabel.mesh.visible = false;
		for (const row of this.touches) for (const st of row?.values() ?? []) { resetTouch(st.s); st.ring.visible = false; st.slider = null; }
	}
}

// The hover ring under a fingertip: 1 m across, scaled to its size (ringSize()).
const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32);
