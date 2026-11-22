// The headset's floating interface (SPEC.md, "Experience and controls"):
//
//   Orbs     a living orb on each wrist. Point at one with the other hand's
//            laser and pull the trigger, touch it with the other controller,
//            or press A / X, to open this mode's menu; B / Y closes it, and
//            so does a click anywhere else (which does nothing else).
//   Menu     opens facing you: walking, in front of the head and a little to
//            the left; in the dollhouse, well to the left and further away,
//            clear of the model. What it says and does: js/xr-menus.js.
//   Welcome  a card above the dollhouse on every entry, until the menu is
//            first opened.
//   Photo    a short white flash and a note in front of you after the Photo
//            button (the picture itself: XRExperience.capturePhoto()).
//   Hands    bare hands wear the orb on the wrist; touching it with the
//            other index opens the menu within reach, and its keys are
//            pressed by touch (js/touch.js), as controllers can with their
//            tip. A pinch never clicks. Without hand joints: "Pick up your
//            controllers" in front of you (C0.1).
//
// Each frame the mode calls buttons() and point(); point() claims the
// trigger of every controller whose laser is on the menu or an orb
// (c.claim.trigger = 'ui'), so the mode leaves those alone.

import * as THREE from 'three';
import { WelcomeCard } from './panel.js';
import { yawOf, WRIST_ORB } from './xr-input.js';
import { TOUCH, touchState, stepTouch, reset as resetTouch, ringSize } from './touch.js';
import { KEY } from './theme.js';
import { PLINTH_REST } from './xr-scene.js';

const MENU_DISTANCE = 0.75, MENU_DROP = 0.1, MENU_LEFT = 0.1; // summoned menu, relative to the eyes (controls card to its left)
// In the dollhouse the menu opens off to the left and further away, so it
// never sits between you and the model (it used to appear right in front of
// the face on entry), and you can watch the model while changing a setting.
const MENU_DOLL_DISTANCE = 0.95, MENU_DOLL_SIDE = THREE.MathUtils.degToRad(34);
const ORB_TOUCH = 0.08, ORB_RELEASE = 0.14; // touching an orb with the other controller
const ORB_TIP_TOUCH = 0.03, ORB_TIP_RELEASE = 0.07; // touching an orb with a bare fingertip
const ORB_ON_GRIP = new THREE.Vector3(0, 0.035, 0.115); // a controller's orb, in its grip space
// The menu opened by a bare hand comes within reach (milestone C0.2): 50 cm in
// front, 25 cm below the eyes, tilted back 20° like a lectern; in the scale
// model 45° to the left, clear of the model.
const MENU_NEAR = 0.5, MENU_NEAR_DROP = 0.25, MENU_NEAR_TILT = THREE.MathUtils.degToRad(20), MENU_NEAR_SIDE = THREE.MathUtils.degToRad(45);
// The note after a photo. Photos are kept in the app and saved from the page
// after VR (a download in VR would end the session).
const PHOTO_TEXT = {
	kept: { title: 'Nice shot!', line: 'It waits on the page for when you leave VR.' },
	full: { title: 'Nice shot!', line: 'Only the last 50 are kept: the oldest made room.' },
	failed: { title: 'The photo didn\'t work', line: 'Try again, or use the Quest\'s own screenshot.' },
};

// The note while the Quest reports bare hands (milestone C0.1): their pinches
// do nothing until hands are supported (C0), so it says what will work.
const HANDS_TEXT = { title: 'Pick up your controllers', line: 'Bare hands don\'t work in CasaWalk yet.' };

export class XRUI {
	/** xr: the XRExperience (rig, camera, input, menus, mode, model, stage, ...). */
	constructor(xr) {
		this.xr = xr;
		this.menu = null; // the open Panel, or null
		this.tab = null; // the menu's tab last shown (kept between the two modes' menus)
		this.drag = null; // a slider being dragged: { c, id }
		this.orbs = [0, 1].map(() => makeOrb());
		this.touches = []; // per input entry: its touch on the open menu (js/touch.js)
		this.nearMenu = false; // the open menu was opened by a bare hand, within reach
		this.buildWelcome();
		this.buildPhotoFeedback();
		this.buildHandsNote();
		xr.hideFromPhotos(this.welcome.mesh, this.flash, this.photoNote.mesh, this.handsNote.mesh);
	}

	// -----------------------------------------------------------------------
	// Welcome card and photo feedback
	// -----------------------------------------------------------------------

	/**
	 * Welcome card above the dollhouse (replaces the menu opening by itself):
	 * how to open the menu, shown on every entry until the menu is opened.
	 */
	buildWelcome() {
		this.welcome = new WelcomeCard('Welcome to CasaWalk', [
			{ key: 'Wrist', kind: 'orb', text: 'Touch a wrist with the other hand: menu' },
			{ small: true, text: 'Or press A or X, or point at the glowing orb on a wrist.' },
			{ key: 'Trigger', kind: 'trigger', text: 'Point at a room and pull: step inside' },
			{ small: true, text: 'The orange marker shows where you\'ll land.' },
		], { width: 0.9 });
		this.welcome.mesh.visible = false;
		this.welcomeOn = false; // until the menu is first opened
	}

	/** Shows or hides the welcome card (only ever in the dollhouse). */
	setWelcome(on) {
		this.welcomeOn = on;
		this.welcome.mesh.visible = on && this.xr.mode === 'dollhouse';
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
		card.position.set(0, top + 0.3 + h / 2, -xr.plinthDistance - size.z / 4);
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
	// Menu and orbs
	// -----------------------------------------------------------------------

	/**
	 * Opens this mode's menu facing the eyes (yaw only), with the controls card
	 * on its left: walking, in front of the head and a little to the left; in
	 * the dollhouse, well to the left and further away, clear of the model.
	 */
	openMenu(headMatrix = this.xr.camera.matrix, { near = false } = {}) {
		const xr = this.xr;
		this.closeMenu();
		const panel = xr.menus[xr.mode];
		if (!panel) return;
		const head = new THREE.Vector3().setFromMatrixPosition(headMatrix);
		const yaw = yawOf(headMatrix);
		const doll = xr.mode === 'dollhouse';
		const towards = yaw + (near ? (doll ? MENU_NEAR_SIDE : 0) : doll ? MENU_DOLL_SIDE : 0); // (a positive angle turns left)
		const dir = new THREE.Vector3(-Math.sin(towards), 0, -Math.cos(towards));
		const left = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
		if (near) {
			// Within reach of a bare hand, below the eyes, tilted back like a lectern.
			panel.mesh.position.copy(head).addScaledVector(dir, MENU_NEAR);
			panel.mesh.position.y -= MENU_NEAR_DROP;
		} else {
			panel.mesh.position.copy(head).addScaledVector(dir, doll ? MENU_DOLL_DISTANCE : MENU_DISTANCE).addScaledVector(left, doll ? 0 : MENU_LEFT);
			panel.mesh.position.y -= MENU_DROP;
		}
		xr.rig.updateMatrixWorld(true);
		panel.mesh.lookAt(xr.rig.localToWorld(head.clone().setY(panel.mesh.position.y)));
		panel.mesh.rotateX(near ? -MENU_NEAR_TILT : 0);
		this.nearMenu = near;
		if (panel.card) panel.card.mesh.visible = !near; // (the controls card shows the controllers: not for hands)
		if (this.tab) panel.setTab(this.tab);
		panel.setHover(null);
		panel.mesh.visible = true;
		this.menu = panel;
		this.setWelcome(false); // found it: the welcome card has done its job
	}

	closeMenu() {
		if (this.menu) { this.tab = this.menu.tab; this.menu.closeDropdown(); this.menu.mesh.visible = false; }
		this.menu = null;
	}

	toggleMenu() { this.menu ? this.closeMenu() : this.openMenu(); }

	/** Puts an orb on each controller's grip, or on each tracked bare hand's wrist. */
	placeOrbs() {
		const input = this.xr.input, wearers = input.wearers();
		this.orbs.forEach((o, i) => {
			const holder = wearers[i] ?? null;
			const anchor = holder ? input.wristOf(holder) : null;
			if (holder === o.holder && o.group.parent === anchor) return;
			o.group.removeFromParent();
			if (holder) { anchor.add(o.group); o.group.position.copy(holder.isHand ? WRIST_ORB : ORB_ON_GRIP); }
			o.holder = holder;
		});
	}

	/**
	 * Laser vs. orbs and menu, for every controller; touching an orb with
	 * the other hand. Clicks are handled here. Claims the trigger of every
	 * controller whose laser is on the UI this frame (c.claim.trigger =
	 * 'ui'), and returns the menu action to run, if any: { action }.
	 * (A controller whose trigger a held tool owns is skipped: its laser is
	 * hidden.)
	 */
	point() {
		const xr = this.xr, input = xr.input, raycaster = xr.raycaster;
		let hover = null, action = null, toggle = false, close = false;
		const hot = new Set();
		const active = input.active();
		if (this.drag && (!this.menu || !this.drag.c.source || !this.drag.c.state.trigger)) this.drag = null; // let go
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
			let orbHit = null, orb = null;
			for (const o of this.orbs) {
				if (!o.holder || o.holder === c) continue;
				const h = raycaster.intersectObject(o.target, false)[0];
				if (h && (!orbHit || h.distance < orbHit.distance)) { orbHit = h; orb = o; }
			}
			if (menuHit) {
				c.claim.trigger = 'ui';
				input.showHit(c, menuHit.distance);
				const target = this.menu.hitTest(menuHit.uv);
				hover ||= target;
				if (c.state.down.trigger && target) {
					// (Opening or closing a dropdown's list is handled by the panel itself.)
					action = this.menu.press(target);
					if (action?.slider) this.drag = { c, id: action.id };
				}
			} else if (orbHit) {
				c.claim.trigger = 'ui';
				hot.add(orb);
				input.showHit(c, orbHit.distance);
				if (c.state.down.trigger) toggle = true;
			} else if (this.menu && c.state.down.trigger) {
				// Clicking anywhere else closes the menu (and does nothing else).
				c.claim.trigger = 'ui';
				close = true;
			}
		}
		// Touch: the other controller, or the other hand's index fingertip, reaches into an orb.
		const p = new THREE.Vector3(), q = new THREE.Vector3();
		let byHand = false;
		for (const o of this.orbs) {
			if (!o.holder) continue;
			o.group.getWorldPosition(p);
			let touching = false, hand = false, clear = true;
			for (const c of input.wearers()) {
				if (c === o.holder) continue;
				const d = c.isHand ? c.touch.tip.distanceTo(p) : (input.pose(c, q), q.distanceTo(p));
				const [on, off] = c.isHand ? [ORB_TIP_TOUCH, ORB_TIP_RELEASE] : [ORB_TOUCH, ORB_RELEASE];
				if (d < on) { touching = true; hand ||= c.isHand; }
				if (d < off) clear = false;
			}
			if (touching && o.armed) { toggle = true; o.armed = false; byHand ||= hand; }
			if (clear) o.armed = true;
			if (!clear) hot.add(o);
		}
		// Touch keys: fingertips and controller tips press the open menu (milestone C0.2).
		const touched = this.touchMenu();
		hover ||= touched.hover;
		action ||= touched.action;
		this.menu?.setHover(hover);
		const t = performance.now() / 1000;
		for (const o of this.orbs) animateOrb(o, t, hot.has(o));
		if (toggle) {
			if (this.menu) this.closeMenu();
			else this.openMenu(undefined, { near: byHand });
			if (byHand) this.feel(null, this.menu ? 'open' : 'close');
		} else if (close) this.closeMenu();
		return { action };
	}

	/** A sound (if sound is on) and, on a controller, a vibration. */
	feel(c, sound, haptic = null, gain = 1) {
		const xr = this.xr;
		if (sound && xr.soundLevel !== 'off') xr.sound.play(sound, gain);
		if (haptic && c?.isController) xr.haptics.play(c, haptic);
	}

	/**
	 * Every fingertip and controller tip against the open menu: hover ring,
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
				xr.handViews?.[c.index] && (xr.handViews[c.index].near = false);
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
			if (xr.handViews?.[c.index]) xr.handViews[c.index].near = live;
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

	/** A / X toggles the menu; B / Y closes it. Returns true if a button was used. */
	buttons() {
		for (const c of this.xr.input.active()) {
			if (c.state.down.a && !c.claim.a) { this.toggleMenu(); return true; }
			if (c.state.down.b && !c.claim.b && this.menu) { this.closeMenu(); return true; }
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
		for (const o of this.orbs) { o.group.removeFromParent(); o.holder = null; }
		for (const st of this.touches) { if (!st) continue; resetTouch(st.s); st.ring.visible = false; st.panel = null; st.slider = null; }
	}
}

/**
 * Orb: a glowing core inside a faceted amber crystal, circled by two thin
 * rings. animateOrb() makes it breathe, turn and shimmer.
 */
// The hover ring under a fingertip: 1 m across, scaled to its size (ringSize()).
const RING_GEO = new THREE.RingGeometry(0.4, 0.5, 32);

function makeOrb() {
	const group = new THREE.Group();
	group.name = 'menu-orb';
	const core = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
	const shellMat = new THREE.MeshLambertMaterial({ color: 0xe99a45, emissive: 0x8a3f0c, flatShading: true, transparent: true, opacity: 0.78, depthWrite: false });
	const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024, 0), shellMat);
	const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd7a3, transparent: true, opacity: 0.9 });
	const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0018, 6, 48), ringMat);
	const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0016, 6, 48), ringMat);
	// Larger invisible target so the orb is easy to hit with the laser.
	const target = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
	const body = new THREE.Group();
	body.add(core, shell, ring1, ring2);
	group.add(body, target);
	group.position.copy(ORB_ON_GRIP); // on the wrist: touch it with the other hand to open the menu (a bare wrist: WRIST_ORB)
	return { group, body, core, shell, shellMat, ring1, ring2, ringMat, target, holder: null, armed: true, glow: 0, phase: Math.random() * 10 };
}

const ORB_AMBER = new THREE.Color(0xe99a45), ORB_BLUE = new THREE.Color(0x4d8dff);
const ORB_EMBER = new THREE.Color(0x8a3f0c), ORB_EMBER_BLUE = new THREE.Color(0x173f8a);

function animateOrb(o, time, hot) {
	const t = time + o.phase;
	o.glow += ((hot ? 1 : 0) - o.glow) * 0.2;
	// Breathing: two slow waves, so it never looks mechanical.
	const breathe = 1 + 0.1 * Math.sin(t * 2.1) + 0.04 * Math.sin(t * 5.3);
	o.body.scale.setScalar(breathe * (1 + 0.4 * o.glow));
	o.shell.rotation.set(t * 0.5, t * 0.8, 0);
	o.ring1.rotation.set(Math.PI / 2 + 0.5 * Math.sin(t * 0.7), t * 1.3, 0);
	o.ring2.rotation.set(0.6 * Math.sin(t * 0.9), -t * 1.1, Math.PI / 3);
	o.shellMat.color.copy(ORB_AMBER).lerp(ORB_BLUE, o.glow);
	o.shellMat.emissive.copy(ORB_EMBER).lerp(ORB_EMBER_BLUE, o.glow).multiplyScalar(0.8 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.2)));
	o.ringMat.opacity = 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.6));
}
