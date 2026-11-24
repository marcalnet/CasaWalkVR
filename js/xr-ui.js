// The headset's floating interface (SPEC.md, "Experience and controls" and
// C0 "Hands and touch"):
//
//   Wrist    the wrist menu (js/wrist-menu.js): an orb on one wrist, and
//            four keys in a cross: Settings, Help, ← Back, Walk in →.
//   Board    Settings opens the settings board within reach (50 cm ahead,
//            25 cm below the eyes, tilted back 20°; at the scale model 45° to
//            the left, clear of the model), pressed by touch (js/touch.js) or
//            by a controller's laser; its handle moves it (a controller's
//            grip). What it says and does: js/xr-menus.js. It closes with its
//            Close key, Settings again, B/Y, or by moving between layers,
//            never on a touch elsewhere.
//   Help     a card where the board opens: what each control does, for
//            controllers or for bare hands.
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
import { yawOf } from './xr-input.js';
import { TOUCH, touchState, stepTouch, reset as resetTouch, ringSize } from './touch.js';
import { KEY, BOARD, GUIDE } from './theme.js';
import { Guide } from './guide.js';
import { readSetting, writeSetting } from './settings.js';
import { PLINTH_REST } from './xr-scene.js';
import { WristMenu } from './wrist-menu.js';
import { handsHelp } from './xr-menus.js';

// The board within reach: 40 cm in front, 30 cm below the eyes, tilted back
// 25° like a lectern; at the scale model 30° to the left.
// (Closer and less to the side than the first draft: the user had to use the laser to reach it.)
const BOARD_NEAR = 0.4, BOARD_DROP = 0.3, BOARD_TILT = THREE.MathUtils.degToRad(25), BOARD_SIDE = THREE.MathUtils.degToRad(30);
const HELP_WIDTH = 0.32; // the help card beside the wrist menu, metres
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
		this.menu = null; // the open settings board (a Panel), or null
		this.help = null; // the open help card, or null
		this.tab = null; // the board's tab last shown (kept between the two layers' boards)
		this.drag = null; // a slider being dragged: { c, id }
		this.boardDrag = null; // a controller holding the board's handle: { c, offset }
		this.wrist = new WristMenu(xr);
		this.wrist.onClose = () => this.hideHelp(); // (Help lives beside the wrist menu)
		this.guide = new Guide(xr); // how to move, beside the wrist menu or the board (C0.4)
		xr.hideFromPhotos(this.guide.group);
		this.touches = []; // per input entry: its touch on the open board (js/touch.js)
		this.buildWelcome();
		this.buildPhotoFeedback();
		this.buildHandsNote();
		this.buildErrorNote();
		xr.hideFromPhotos(this.welcome.mesh, this.flash, this.photoNote.mesh, this.handsNote.mesh, this.errorNote.mesh);
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
		this.welcome.mesh.visible = on && this.xr.mode === 'dollhouse' && !this.xr.lessons?.place;
	}

	/**
	 * Puts the welcome card over the back half of the plinth, well above the
	 * model's top, so from where you stand it shows above the home, not on it.
	 */
	placeWelcome() {
		const xr = this.xr, card = this.welcome.mesh;
		const size = xr.model ? xr.model.bounds.getSize(new THREE.Vector3()).multiplyScalar(xr.baseScale) : new THREE.Vector3(1, 0.4, 1);
		const top = PLINTH_REST + size.y;
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
		this.errorNote.mesh.renderOrder = 1002;
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

	/** Photo feedback: a short white flash, and a note in front of you for a few seconds. */
	buildPhotoFeedback() {
		const camera = this.xr.camera;
		this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
		this.flash.renderOrder = 1001;
		this.flash.visible = false;
		this.flash.name = 'photo-flash';
		camera.add(this.flash);
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
		this.flash.material.opacity = f.error ? 0 : Math.max(0, 0.75 * (1 - f.t / 0.3));
		this.flash.visible = this.flash.material.opacity > 0;
		this.photoNote.mesh.visible = f.t < 2.5;
		if (f.t >= 2.5) { this.photoFx = null; this.flash.visible = false; }
	}

	// -----------------------------------------------------------------------
	// The board and the help card
	// -----------------------------------------------------------------------

	/** Where the board (or the help card) opens: within reach, tilted back; 45° left at the scale model. */
	placeNear(mesh, headMatrix = this.xr.camera.matrix) {
		const xr = this.xr;
		const head = new THREE.Vector3().setFromMatrixPosition(headMatrix);
		const yaw = yawOf(headMatrix);
		const towards = yaw + (xr.mode === 'dollhouse' ? BOARD_SIDE : 0); // (a positive angle turns left)
		mesh.position.copy(head).add(new THREE.Vector3(-Math.sin(towards), 0, -Math.cos(towards)).multiplyScalar(BOARD_NEAR));
		mesh.position.y -= BOARD_DROP;
		xr.rig.updateMatrixWorld(true);
		mesh.lookAt(xr.rig.localToWorld(head.clone().setY(mesh.position.y)));
		mesh.rotateX(-BOARD_TILT);
	}

	/** Opens this layer's settings board. */
	openMenu(headMatrix) {
		const xr = this.xr;
		this.closeMenu();
		const panel = xr.menus[xr.mode];
		if (!panel) return;
		this.placeNear(panel.mesh, headMatrix);
		if (this.tab) panel.setTab(this.tab);
		panel.setHover(null);
		panel.mesh.visible = true;
		this.menu = panel;
		this.feel(null, 'open');
	}

	/** Closes the board and the help card. */
	closeMenu() {
		if (this.menu) { this.tab = this.menu.tab; this.menu.closeDropdown(); this.menu.mesh.visible = false; this.feel(null, 'close'); }
		this.menu = null;
		this.boardDrag = null;
		this.drag = null;
	}

	/**
	 * The guide beside the menu (js/guide.js): on the right of the open board,
	 * or of the wrist menu (not while Help is there). Bare hands or controllers,
	 * for the layer you are in; folded into its tab if you hid it.
	 */
	placeGuide() {
		const xr = this.xr, guide = this.guide;
		const at = this.menu ? this.menu.mesh : this.wrist.open && !this.help ? this.wrist.cross : null;
		if (!at || !xr.mode) { guide.hide(); return; }
		if (guide.group.parent !== at) at.add(guide.group);
		const kind = `${xr.mode === 'walk' ? 'walk' : 'dollhouse'}-${xr.input.active().length ? 'controllers' : 'hands'}`;
		const folded = readSetting('guide') === 'tab';
		if (at === this.wrist.cross) {
			guide.show(kind, folded, GUIDE.width);
			guide.group.position.copy(this.wrist.besideRight(GUIDE.width));
		} else {
			const bw = this.menu.mesh.geometry.parameters.width, w = 0.3;
			guide.show(kind, folded, w);
			guide.group.position.set(bw / 2 + 0.03 + w / 2, 0, 0.002);
		}
		guide.group.rotation.set(0, 0, 0);
	}

	/** Counts teleports: after the 5th, the guide folds into its tab by itself (once; remembered). */
	onTeleport(n) {
		if (n >= 5 && readSetting('guide') === 'auto') writeSetting('guide', 'tab');
	}

	/** Hides the help card beside the wrist menu. */
	hideHelp() {
		if (this.help) this.help.mesh.visible = false;
		this.help = null;
		if (this.buildTag) this.buildTag.mesh.visible = false;
	}

	/** Closes everything: board, help, the wrist menu (moving between layers). */
	closeAll() {
		this.closeMenu();
		this.wrist.close();
		this.guide.hide();
	}

	/** True while the board, the help card or the wrist menu is open. */
	get anyOpen() { return !!this.menu || !!this.help || this.wrist.open; }

	toggleBoard() { this.menu ? this.closeMenu() : this.openMenu(); }

	/** Help: what each control does here, for controllers, or for bare hands when no controller is held. */
	toggleHelp() {
		if (this.help) { this.hideHelp(); this.feel(null, 'close'); return; }
		this.closeMenu();
		const xr = this.xr;
		// Help replays this place's lesson (and, at the scale model, the tools' introduction first).
		if (xr.mode === 'dollhouse' && xr.toolsIntro?.start({ again: true })) { xr.lessons.stop(); xr.introAgain = true; }
		else xr.lessons?.start(xr.mode === 'walk' ? 'walk' : 'scale', { again: true });
		const card = xr.input.active().length ? xr.help[xr.mode] : xr.help.hands;
		if (!card || !this.wrist.open) return;
		if (card === xr.help.hands) { card.lines = handsHelp(this.wrist.side); card.draw(); }
		// Beside the wrist menu, on its right (menu left, help right), in its plane; the menu stays open.
		const w = card.mesh.geometry.parameters.width;
		card.mesh.scale.setScalar(HELP_WIDTH / w);
		card.mesh.position.copy(this.wrist.besideRight(HELP_WIDTH));
		card.mesh.rotation.set(0, 0, 0);
		card.mesh.visible = true;
		this.help = card;
		// Which build is running, small, under the card (the same as the page's, bottom left).
		// (A newer build live on the site: one calm line, here only; reloading is yours to choose, after VR.)
		if (!this.buildTag) { this.buildTag = new Label({ height: 0.018 }); this.buildTag.mesh.name = 'build'; this.wrist.cross.add(this.buildTag.mesh); this.xr.hideFromPhotos(this.buildTag.mesh); }
		this.buildTag.set(buildLabel(BUILD) + (this.xr.newerBuild > BUILD.number ? ' · Newer version: reload after VR' : ''));
		const h = card.mesh.geometry.parameters.height * card.mesh.scale.y;
		this.buildTag.mesh.position.copy(card.mesh.position).y -= h / 2 + 0.016;
		this.buildTag.mesh.visible = true;
		this.feel(null, 'open');
	}

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
		let { action } = this.wrist.update(dt);
		// The guide beside the menu: its Hide key and its tab.
		this.placeGuide();
		const g = this.guide.update(dt, { active: true });
		if (g.action?.id === 'guide-hide' || g.action?.id === 'guide-show') {
			writeSetting('guide', g.action.id === 'guide-hide' ? 'tab' : 'full');
			this.placeGuide();
			g.action = null;
		}
		action ??= g.action;
		if (this.wrist.open) { this.setWelcome(false); this.xr.lessons?.note('wrist'); } // found it: the welcome card has done its job
		const active = input.active();
		if (this.drag && (!this.menu || !this.drag.c.source || !this.drag.c.state.trigger)) this.drag = null; // let go
		this.moveBoard();
		for (const c of active) {
			if (c.claim.trigger) continue;
			input.setRaycaster(c, raycaster);
			const menuHit = this.menu ? raycaster.intersectObject(this.menu.mesh, false)[0] : null;
			if (this.drag?.c === c) {
				// Dragging a slider: follow the laser along the track while the trigger is held.
				c.claim.trigger = 'ui';
				input.showHit(c, menuHit?.distance ?? null);
				const value = menuHit ? this.menu.sliderValue(this.drag.id, menuHit.uv) : null;
				if (value !== null) action = { id: this.drag.id, value };
				hover = { id: this.drag.id, slider: true };
				continue;
			}
			if (menuHit) {
				c.claim.trigger = 'ui';
				input.showHit(c, menuHit.distance);
				const target = this.menu.hitTest(menuHit.uv);
				hover ||= target;
				if (c.state.down.trigger) {
					if (target) {
						// (Opening or closing a dropdown's list is handled by the panel itself.)
						action = this.menu.press(target) ?? action;
						if (action?.slider) this.drag = { c, id: action.id };
						this.feel(c, 'press', 'click');
					} else if (this.menu.disabledAt(menuHit.uv)) this.feel(c, 'deny', 'deny');
				}
			} else if ((this.menu || this.help || (this.wrist.open && this.wrist.pinned)) && c.state.down.trigger) {
				// A pull elsewhere while a menu is open does nothing (the board never
				// closes on it); a pinned wrist menu closes.
				c.claim.trigger = 'ui';
				if (!this.menu && !this.help) this.wrist.close(true);
			}
		}
		// Touch keys: fingertips and controller tips press the open board.
		const touched = this.touchMenu();
		hover ||= touched.hover;
		action ||= touched.action;
		this.menu?.setHover(hover);
		return { action };
	}

	/** A controller's grip on the board's handle (its tip near it, or its laser on it) carries the board. */
	moveBoard() {
		const xr = this.xr, input = xr.input, panel = this.menu;
		if (!panel) { this.boardDrag = null; return; }
		const grip = (c) => { c.grip.updateMatrixWorld(true); return c.grip.matrixWorld; };
		if (this.boardDrag) {
			const { c, offset } = this.boardDrag;
			if (!c.source || !c.isController || !c.state.grip) { this.boardDrag = null; return; }
			c.claim.grip = 'ui';
			const world = grip(c).clone().multiply(offset);
			xr.rig.updateMatrixWorld(true);
			const local = xr.rig.matrixWorld.clone().invert().multiply(world);
			local.decompose(panel.mesh.position, panel.mesh.quaternion, new THREE.Vector3());
			return;
		}
		const h = panel.handle, [hw, hh] = BOARD.handle;
		for (const c of input.active()) {
			if (!c.state.down.grip || c.claim.grip) continue;
			h.updateMatrixWorld(true);
			const L = h.worldToLocal(c.touch.tip.clone());
			const near = Math.abs(L.x) < hw / 2 + 0.03 && Math.abs(L.y) < hh / 2 + 0.04 && Math.abs(L.z) < 0.06;
			input.setRaycaster(c, xr.raycaster);
			const pointed = xr.raycaster.intersectObject(h, false).length > 0;
			if (!near && !pointed) continue;
			c.claim.grip = 'ui';
			panel.mesh.updateMatrixWorld(true);
			this.boardDrag = { c, offset: grip(c).clone().invert().multiply(panel.mesh.matrixWorld) };
			this.feel(c, 'grab', 'click');
			return;
		}
	}

	/**
	 * Every fingertip and controller tip against the open board: hover ring,
	 * contact, click, release (js/touch.js). Returns { hover, action }.
	 */
	touchMenu() {
		const xr = this.xr, panel = this.menu, now = performance.now() / 1000;
		let hover = null, action = null;
		for (const c of xr.input.controllers) {
			const st = this.touches[c.index] ||= this.newTouch();
			const busy = c.claim.trigger === 'tool' || c.claim.trigger === 'ui' && this.drag?.c === c;
			if (!panel || !c.touch.tracked || busy || st.panel !== panel || st.kind !== c.touch.kind) {
				// Gone, switched, or another menu: nothing in progress completes.
				resetTouch(st.s);
				st.panel = panel; st.kind = c.touch.kind; st.last = null; st.slider = null;
				st.ring.visible = false;
				if (!panel || !c.touch.tracked || busy) continue;
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
				hover = { id: st.slider, slider: true };
			} else if (live) hover ||= target;
			// The ring under the fingertip shows where it will land.
			if (live) {
				if (st.ring.parent !== panel.mesh) panel.mesh.add(st.ring);
				st.ring.position.set(L.x, L.y, 0.002);
				st.ring.scale.setScalar(ringSize(Math.max(depth, 0)));
			}
			st.ring.visible = live;
			if (live && xr.handViews?.[c.index]) xr.handViews[c.index].near = true; // (the wrist menu set it first this frame)
		}
		return { hover, action };
	}

	newTouch() {
		const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: KEY.ring, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
		ring.renderOrder = 12;
		ring.visible = false;
		ring.name = 'touch-ring';
		this.xr.hideFromPhotos(ring);
		return { s: touchState(), ring, panel: null, kind: null, last: null, local: new THREE.Vector3(), t: 0, slider: null, lastClick: -1, lastKey: null };
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
			if (c.state.down.a && !c.claim.a && c === wearer) { this.wrist.toggle({ pinned: true }); if (this.wrist.open) { this.setWelcome(false); this.xr.lessons?.note('wrist'); } return true; }
			if (c.state.down.b && !c.claim.b && this.anyOpen) { this.closeMenu(); this.hideHelp(); this.wrist.close(true); return true; }
		}
		return false;
	}

	/** Leaving VR: everything closed and put away. */
	reset() {
		this.drag = null;
		this.closeMenu();
		this.setWelcome(false);
		this.photoFx = null;
		this.flash.visible = false;
		this.photoNote.mesh.visible = false;
		this.handsNote.mesh.visible = false;
		this.errorNote.mesh.visible = false;
		this.wrist.reset();
		this.guide.hide();
		for (const st of this.touches) { if (!st) continue; resetTouch(st.s); st.ring.visible = false; st.panel = null; st.slider = null; }
	}
}

// The hover ring under a fingertip: 1 m across, scaled to its size (ringSize()).
const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32);
