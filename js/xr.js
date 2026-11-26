// XR session (SPEC.md, "Experience and controls"): the headset's two modes,
// the menus and the tools, and the order of work in each frame.
//
//   dollhouse  the home on a plinth in a gallery room (VR view) or floating
//              over passthrough (AR view): js/xr-dollhouse.js
//   walk       the home at 1:1: js/xr-walk.js
//   menus      what they say and do: js/xr-menus.js; the wrist menu:
//              js/wrist-menu.js; the board, help and notes:
//              js/xr-ui.js
//   layers     page → scale model → inside, one step at a time: goLayer()
//              (the moves and the tips on the way: js/pause.js)
//   tools      hand-held tools (milestones C-F): js/xr-tools.js
//   scenery    gallery, plinth, skies, markers: js/xr-scene.js
//   rules      what lasers, the arc and the feet may hit: js/xr-targets.js
//   feel       tweens, vibration and sound for feedback: js/tween.js,
//              js/haptics.js, js/sound.js
//
// See-through (both modes, headset only) fades walls and furniture towards
// a glass house: js/walls.js.
//
// One session for both views: when the browser supports it, an
// immersive-ar session is used and "VR" simply draws an opaque world over
// the passthrough, so the menu can switch between them.
//
// Scene graph (owned by main.js):
//   scene
//   ├─ rig ─ camera, controllers, menu   moved to place the user
//   ├─ stage ─ gallery room, plinth      what recentring moves
//   └─ anchor ─ centerer ─ model         anchor: dollhouse position/yaw/scale
//                                        centerer: puts the model's bottom-centre at the origin
//
// The parts (modes, ui, menus, tools) are given this XRExperience. They may
// use its scene objects (renderer scene camera rig anchor centerer stage
// showroom gallery pedestal walkSky), input and raycaster, shared state
// (session sessionMode model mode menu menus view vrView lift maxStorey
// baseScale plinthSize plinthDistance and the settings snapAngle personHeight
// solid seeThroughAmount toolFan), its services (lighting depth seeThrough ui
// modes tools tweens haptics sound) and its methods. Each part owns what it
// creates and reads shared values when it needs them, never keeping copies.

import * as THREE from 'three';
import { XRInput } from './xr-input.js';
import { HandView } from './hands.js';
import { SafetyNet } from './safety.js';
import { Veil } from './veil.js';
import { HandReadout } from './hand-readout.js';
import { FrameStats } from './frame-stats.js';
import { DEV } from './dev.js';
import { attachTransientPointer } from './transient-pointer.js';
import { SeeThrough, SEE_THROUGH_MAX } from './walls.js';
import { Portals } from './portal.js';
import { Pause } from './pause.js';
import { SessionStore } from './session-store.js';
import { scaleCentre, walkCentre, followBody, areaOf, yawTo } from './zones.js';
import { takePhoto, photoName, saveFile, INTERFACE_LAYER } from './photo.js';
import { readSetting } from './settings.js';
import { buildShowroom, buildStage, fitPlinth, placePlate, buildWalkSky, recolourSphere, PLINTH_HEIGHT } from './xr-scene.js';
import { ScalePlate } from './panel.js';
import { roomAt } from './rooms.js';
import { targetSets, findFloor, CLAIM } from './xr-targets.js';
import { buildMenus, updateLabels, menuAction, SEE_THROUGH_ON } from './xr-menus.js';
import { XRUI } from './xr-ui.js';
import { Dollhouse, roundScaleUp } from './xr-dollhouse.js';
import { Walk } from './xr-walk.js';
import { ToolSystem } from './xr-tools.js';
import { ToolFan } from './tool-fan.js';
import { Tweens } from './tween.js';
import { Haptics } from './haptics.js';
import { Sound } from './sound.js';

// Clip planes for the headset, set explicitly: left alone they come from how
// the 2D page framed the model, which can clip things held near the face.
const XR_NEAR = 0.05, XR_FAR = 300;
const DOLLHOUSE_SIZE = 1.4; // metres across at most (build 120's design, item 8: was 1.2 m; wider pushes the wings to their limit)
export class XRExperience {
	/**
	 * @param opts.renderer, opts.scene, opts.camera, opts.rig, opts.anchor, opts.centerer
	 * @param opts.lighting  Lighting (time of day, shadows): the menu changes it
	 * @param opts.depth     DepthShading (corner gradients, headset only): the menu switches it
	 * @param opts.onEnd()  called after the session ends (2D page restores its view)
	 * @param opts.onPhoto(blob, name) -> Promise<{ dropped }|null>  keeps a photo taken in VR
	 *        (the page's photo roll: nothing is downloaded during VR, where the
	 *        browser's download prompt would end the session); without it, the
	 *        photo is downloaded at once
	 */
	constructor({ renderer, scene, camera, rig, anchor, centerer, lighting, depth, onEnd, onPhoto }) {
		Object.assign(this, { renderer, scene, camera, rig, anchor, centerer, lighting, depth, onEnd, onPhoto });
		this.model = null; // { group, layers, bounds, observer, skyColor }
		this.session = null;
		this.sessionMode = null; // 'vr' | 'ar' (the session type)
		this.view = readSetting('view'); // what is shown (AR sessions only)
		this.mode = null; // 'dollhouse' | 'walk': which of this.modes runs
		this.lift = 0; // the rig's height above the floor the user stands on
		this.snapAngle = 30; // snap turn, degrees (fixed: the Turn setting left the board, the user's call)
		this.personHeight = readSetting('height'); // (per session: 'Yours' at every Enter VR)
		this.store = new SessionStore(); // what belongs to this VR session only: the tips, the first tabs (js/session-store.js)
		// See-through walls and furniture (headset only): 0 = as modelled, 1 = glass house.
		this.seeThroughAmount = readSetting('seeThrough') > 0 ? SEE_THROUGH_ON : 0; // (a switch: an older stored amount counts as on)
		this.seeThrough = new SeeThrough();
		this.portals = new Portals(); // the wall portal (js/portal.js)
		this.soundLevel = readSetting('sound'); // off | effects | all (effects and ambience)
		this.toolFan = readSetting('mainHand') === 'left' ? 'right' : 'left'; // the hand the tool fan floats over: the one that is not the main hand (the main hand wears the wrist menu and takes tools)
		this.cameraLens = readSetting('cameraLens'); // the street camera's lens, mm (milestone D)
		this.frameDt = 1 / 72;
		this.body = null; // inside: the body's direction ({ yaw, following }), following the head slowly (js/zones.js)
		this.areas = null; // { centre, hands }: updateAreas()
		this.maxStorey = null; // dollhouse: highest storey shown (null = all)
		this.pendingRecentre = false;
		this.photoPending = false;
		this.photoHidden = new Set(); // never in a photo: see hideFromPhotos()
		camera.layers.enable(INTERFACE_LAYER); // (the headset shows the interface; photos don't: js/photo.js)
		this.raycaster = new THREE.Raycaster();
		this.raycaster.firstHitOnly = true;
		this.raycaster.layers.enableAll(); // (lasers hit the interface too; every cast names what it may hit)
		this.floorRay = new THREE.Raycaster(); // all hits, so the first upward face is found
		this.floorRay.layers.enableAll();
		this.input = new XRInput(renderer, rig);
		this.input.setVisible(false);
		this.hideFromPhotos(...this.input.controllers.flatMap((c) => [c.ray, c.grip, c.wrist])); // lasers, controllers, and what they carry (orbs, tools)
		this.handViews = this.input.controllers.map((c) => new HandView(c)); // bare hands, drawn (milestone C0.2)
		this.readout = DEV.hands ? new HandReadout(this) : null; // (?hands: the bare-hand tuning readout, for development)
		this.frameStats = DEV.stats ? new FrameStats(this) : null; // (?stats: fps and draw calls in the headset, for measuring)
		// The safety net (js/safety.js): errors show a calm card; repeated ones end the session.
		this.safety = new SafetyNet({
			showCard: (ending) => this.ui?.showError(ending),
			hideCard: () => this.ui?.hideError(),
			endSession: () => this.end(),
			critical: () => !!this.layerFx, // (an error halfway through a move between places: end cleanly rather than leave a half state)
		});
		this.hidden = false; // the session is covered by Meta's menu (visibilityState not 'visible'): input and sound pause
		this.hideFromPhotos(...this.handViews.map((v) => v.group));
		// Scenery: the gallery and its sky, the stage with the plinth, the walk sky.
		Object.assign(this, buildShowroom(scene)); // showroom, showroomSky
		Object.assign(this, buildStage(scene)); // stage, gallery, pedestal, plinthMaterials
		this.plate = new ScalePlate(); // the model's true scale, on the plinth (SPEC.md B2)
		this.plinthH = PLINTH_HEIGHT; // the plinth's height (one for both inputs since 26 Nov 2026; never changes)
		this.setPlinth(1.2, 0.9);
		this.walkSky = buildWalkSky(camera);
		Object.assign(this, buildMenus(rig)); // menus: the settings boards
		this.hideFromPhotos(...Object.values(this.menus).map((p) => p.mesh), ...Object.values(this.guides).map((p) => p.mesh));
		// The one sphere round the eyes (js/veil.js): the teleport fade, the move between places
		// (dark for in and back, white for leaving VR) and the photo flash.
		this.veil = new Veil(camera);
		this.hideFromPhotos(this.veil.mesh);
		this.modes = { dollhouse: new Dollhouse(this), walk: new Walk(this) };
		this.ui = new XRUI(this);
		this.tools = new ToolSystem(this);
		this.fan = new ToolFan(this); // the tool fan over the left hand (milestone C)
		this.tweens = new Tweens();
		this.pause = new Pause(this); // every move between places, and the tips on the way (js/pause.js)
		this.haptics = new Haptics();
		this.sound = new Sound();
		this.sound.setLevel(this.soundLevel);
	}

	/** The open settings board (a Panel), or null. */
	get menu() { return this.ui.menu; } // the settings wing (right)
	/** True while either wing (Settings, How to move) is open: nothing else claims the hands then. */
	get boardOpen() { return !!(this.ui.menu || this.ui.guide); }

	/** A move between places in progress (js/pause.js), or null: the modes wait meanwhile. */
	get layerFx() { return this.pause?.fx ?? null; }
	/** The room's name inside (js/pause.js). */
	get arrival() { return this.pause.arrival; }

	/** Objects never drawn in a photo (the interface); hiding one hides what it carries. */
	/**
	 * The interface: never in a photo. Puts the objects and everything under
	 * them on the interface layer (js/photo.js, INTERFACE_LAYER). What is added
	 * under them later (a key's ring, a tool in a hand, a print) is moved there
	 * by markInterface(), run before every photo and viewfinder frame.
	 */
	hideFromPhotos(...objects) {
		for (const o of objects) { this.photoHidden.add(o); o.traverse((c) => c.layers.set(INTERFACE_LAYER)); }
	}

	/** Every object under the interface's roots on the interface layer (cheap: a few hundred objects). */
	markInterface() {
		for (const o of this.photoHidden) o.traverse((c) => c.layers.set(INTERFACE_LAYER));
	}

	/** Sizes the plinth for a model footprint of w x d metres, with the scale plate on it. */
	setPlinth(w, d) {
		this.plate.mesh.removeFromParent(); // (fitPlinth rebuilds the plinth's parts)
		const { W, D, distance } = fitPlinth(this, w, d, this.plinthH);
		this.plinthSize = { W, D };
		this.plinthDistance = distance; // from where you stand to the plinth's centre
		placePlate(this.plate.mesh, this.pedestal, W, D, this.plinthH);
	}

	// -----------------------------------------------------------------------
	// Model and session
	// -----------------------------------------------------------------------

	/** model: { group, layers, bounds (Box3, model space, no ground), observer, skyColor, multiLevel, plan (rooms and walls, js/sh3d.js; null for OBJ and GLB) } */
	setModel(model) {
		this.model = model;
		this._targets = null; // mesh sets for raycasts, rebuilt on demand
		this.maxStorey = null;
		this.modes.dollhouse.setModel(model); // the landing markers
		const size = model.bounds.getSize(new THREE.Vector3());
		this.baseScale = 1 / roundScaleUp(Math.max(size.x, size.z, 0.01) / DOLLHOUSE_SIZE); // a round scale (1:25, not 1:23) that still fits the plinth
		this.setPlinth(size.x * this.baseScale, size.z * this.baseScale);
		// Everything casts and receives shadows (used only when shadows are on),
		// except the ground (nothing below it) and glass, so sun comes in
		// through the windows.
		// (Every mesh at any depth: merged, a layer holds meshes; with ?nomerge it holds the pieces' groups.)
		for (const [name, layer] of Object.entries(model.layers)) {
			layer.traverse((m) => {
				if (!m.isMesh || !m.material) return;
				const glass = [].concat(m.material).some((mat) => mat?.transparent && mat.opacity < 0.9);
				m.castShadow = name !== 'ground' && !glass;
				m.receiveShadow = true;
			});
		}
		this.seeThrough.setModel(model.layers);
		this.applySeeThrough();
		this.portals.setModel(model.layers);
		this.tools.setModel(); // nothing the tools made carries over to another model
		this.updateSky();
		this.updateLabels();
	}

	static async supported() {
		const xr = navigator.xr;
		if (!xr) return { vr: false, ar: false };
		const check = (m) => xr.isSessionSupported(m).catch(() => false);
		const [vr, ar] = await Promise.all([check('immersive-vr'), check('immersive-ar')]);
		return { vr, ar };
	}

	/** kind: 'ar' (both views, switchable in the menu) or 'vr' (VR only). */
	async start(kind) {
		if (!this.model || this.session || this.starting) return;
		this.starting = true;
		this.sound.unlock(); // (still inside the Enter VR click: browsers allow sound only after one)
		// hand-tracking: hand joints for touch (milestone C0); bare hands still do nothing until the touch menus exist (C0.1).
		const init = { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking'] };
		let session;
		try {
			try {
				session = await navigator.xr.requestSession(kind === 'ar' ? 'immersive-ar' : 'immersive-vr', init);
			} catch (e) {
				// Passthrough refused or unavailable: plain VR still works.
				if (kind !== 'ar') throw e;
				kind = 'vr';
				session = await navigator.xr.requestSession('immersive-vr', init);
			}
		} catch (e) {
			this.sound.suspend(); // (no session: no sound left running on the page)
			throw e;
		} finally {
			this.starting = false;
		}
		this.renderer.xr.setReferenceSpaceType('local-floor');
		this.renderer.xr.setFramebufferScaleFactor(1);
		await this.renderer.xr.setSession(session);
		this.renderer.xr.setFoveation(1);
		this.session = session;
		this.sessionMode = kind;
		this.depth?.setActive(true); // depth shading shows in the headset only
		this.saved = { background: this.scene.background };
		this.applySeeThrough(); // (headset only, like depth shading)
		this.camera.near = XR_NEAR;
		this.camera.far = XR_FAR;
		this.camera.updateProjectionMatrix();
		this.scene.background = null; // the sky spheres draw the VR view; null shows passthrough
		session.addEventListener('end', () => this.handleEnd());
		this.safety.begin();
		// Meta's menu over the app: hands and lasers must not act behind it, and the sound pauses.
		session.addEventListener('visibilitychange', () => this.setHidden(session.visibilityState !== 'visible'));
		this.hidden = false;
		this.setHidden(!!session.visibilityState && session.visibilityState !== 'visible'); // (it may start covered)
		attachTransientPointer(this, session); // (Apple Vision Pro's look-and-pinch; nothing on a Quest)
		// Holding the Meta button re-centres the headset: follow it.
		this.renderer.xr.getReferenceSpace()?.addEventListener?.('reset', () => {
			if (this.mode === 'dollhouse') this.pendingRecentre = true;
		});
		this.input.setVisible(true);
		this.stage.position.set(0, 0, 0);
		this.stage.rotation.set(0, 0, 0);
		this.updateLabels();
		this.modes.dollhouse.begin();
		this.setMode('dollhouse', { measure: false }); // no head pose yet: measured below, with the first one
		this.fan.camera.warm(); // the camera's drawing programs, before anyone takes it (behind the start)
		// The floor origin is not necessarily where you stand (it can be
		// anywhere in your play area), so place the plinth in front of the
		// head as soon as the first head pose arrives.
		this.pendingRecentre = true;
		this.store.start(); // (each Enter VR starts fresh: the headset passes from person to person)
		this.personHeight = readSetting('height');
		this.pause.enter(); // the pause from the first frame: the dark until the room draws smoothly (js/pause.js)
	}

	end() { this.session?.end()?.catch?.(() => {}); } // (ending twice, or a session already gone, is not an error)

	/**
	 * The session is covered (Meta's menu) or shown again. While covered, no
	 * input is read (XRExperience.update returns early), an aim or a hold in
	 * progress is dropped (nothing happens on return), the sound and the
	 * vibration stop, and nothing of yours stays drawn frozen in the world:
	 * hands, controllers and what they carry (the orb, a held tool), the
	 * wrist menu and the tool fan (a store check, Input.4). Shown again, the
	 * controllers come back here and the rest with the next frame's update.
	 */
	setHidden(hidden) {
		if (hidden === this.hidden) return;
		this.hidden = hidden;
		if (hidden) {
			this.sound.suspend();
			this.haptics.stop();
			for (const m of Object.values(this.modes)) m.drop?.();
			this.ui.wrist.close();
			this.input.setVisible(false);
			for (const c of this.input.controllers) c.wrist.visible = false; // (a bare hand's orb and held tool)
			for (const v of this.handViews) v.hide();
			if (this.fan) this.fan.group.visible = false;
		} else {
			this.sound.wake();
			this.input.setVisible(true);
			for (const c of this.input.controllers) c.wrist.visible = true;
		}
	}

	/** One headset frame, inside the safety net: errors show the card instead of freezing the view. */
	frame(dt, more) {
		this.safety.frame(dt, () => { this.update(dt); more?.(); });
	}

	handleEnd() {
		for (const m of Object.values(this.modes)) m.exit(); // (drops grabs, aims, pulls and any teleport)
		this.session = null;
		this.hidden = false;
		this.depth?.setActive(false);
		this.applySeeThrough(); // the 2D page shows the model as modelled
		this.mode = null;
		this.pendingRecentre = false;
		this.ui.reset(); // menus, notes, the wrist menu
		this.pause.stop();
		this.veil.clear();
		this.body = null; this.areas = null;
		for (const v of this.handViews) v.hide();
		this.readout?.hide();
		this.frameStats?.reset();
		this.photoPending = false;
		this.tools.end(); // tools back in the fan; measurements and drawings cleared
		this.fan.reset();
		this.tweens.clear();
		this.haptics.stop();
		this.sound.suspend();
		this.walkSky.visible = false;
		this.input.setVisible(false);
		this.showroom.visible = false;
		this.stage.visible = false;
		this.applyStoreys(); // the 2D page shows every storey
		this.rig.position.set(0, 0, 0);
		this.rig.rotation.set(0, 0, 0);
		this.lift = 0;
		this.anchor.position.set(0, 0, 0);
		this.anchor.rotation.set(0, 0, 0);
		this.anchor.scale.setScalar(1);
		if (this.model) this.model.layers.ground.visible = true;
		this.scene.background = this.saved?.background ?? null;
		this.onEnd?.();
	}

	/**
	 * Switches mode: leaves the current one, closes the menu and enters
	 * `name` with `args` (dollhouse: { measure }; walk: model-space floor
	 * point and heading).
	 */
	setMode(name, ...args) {
		if (this.mode && this.mode !== name) this.modes[this.mode].exit();
		this.mode = name; // (set first: applyStoreys() and applyView() read it)
		this.ui.closeAll();
		this.modes[name].enter(...args);
	}

	// -----------------------------------------------------------------------
	// Layers: page → scale model → inside (SPEC.md C0, "Layers")
	// -----------------------------------------------------------------------

	/**
	 * The areas (js/zones.js), once a frame: the centre (at the scale model the
	 * model, the plinth and its keys as seen; inside, ±20° about the body's
	 * direction, which follows the head slowly) and which area each hand is in,
	 * by its wrist (or grip) seen from the eyes. this.areas = { centre, hands:
	 * [area per input entry] }.
	 */
	updateAreas(dt) {
		const head = this.headWorld(), prev = this.areas?.hands ?? [];
		let centre = null;
		if (this.mode === 'dollhouse' && this.model) {
			const plinth = this.stage.localToWorld((this._pc ??= new THREE.Vector3()).set(0, this.plinthH, -this.plinthDistance));
			centre = scaleCentre(head, plinth, this.modes.dollhouse.clearPoints());
		} else if (this.mode === 'walk') {
			this.body = followBody(this.body, this.viewYaw(), dt);
			centre = walkCentre(this.body.yaw);
		}
		const w = this._aw ??= new THREE.Vector3();
		const hands = this.input.controllers.map((c, i) => {
			if (!centre || !(c.isHand ? c.touch.tracked : c.isController && !c.resting)) return null;
			return areaOf(yawTo(head, this.input.wristOf(c).getWorldPosition(w)), centre, prev[i]);
		});
		this.areas = { centre, hands };
	}

	/**
	 * New visitor (How to move's foot; the shared-headset principle): the
	 * session starts over for the next person while the headset stays on: the
	 * tips, the tab each board opens on, Height back to "Yours", the
	 * first-target ring. What you see stays (it is remembered).
	 */
	newVisitor() {
		this.store.start();
		this.ui.tab = null;
		this.personHeight = readSetting('height');
		if (this.mode === 'walk') this.setLift(this.modes.walk.personLift());
		this.pause.target.visible = false;
		this.ui.closeAll();
		if (this.soundLevel !== 'off') this.sound.play('press');
		this.updateLabels();
	}

	/** Moves one layer (js/pause.js: the move, and the tips on the way). */
	goLayer(dir, go, spot = null) { this.pause.go(dir, go, spot); }

	/** The room, plinth and doors in front of where the head is now (behind a fade), the model level on the plinth. */
	recentreHere() {
		const head = this.viewerMatrix() ?? this.camera.matrix.clone();
		this.rig.updateMatrixWorld(true); // (the rig was just reset by the mode's enter(): the head's world place is fresh again)
		this.modes.dollhouse.recentre(head.premultiply(this.rig.matrix));
	}

	/** The name of the room you are standing in (walking), or ''. */
	roomHere() {
		if (this.mode !== 'walk' || !this.model?.plan) return '';
		this.rig.updateMatrixWorld(true);
		const head = this.camera.getWorldPosition(new THREE.Vector3());
		const feet = this.centerer.worldToLocal(new THREE.Vector3(head.x, this.rig.position.y - this.lift, head.z));
		return roomAt(this.model.plan, feet.x, feet.y, feet.z)?.name ?? '';
	}

	/** The head pose for this frame (rig space), straight from WebXR. */
	viewerMatrix() {
		const frame = this.renderer.xr.getFrame?.();
		const space = this.renderer.xr.getReferenceSpace?.();
		const pose = frame && space ? frame.getViewerPose(space) : null;
		return pose ? new THREE.Matrix4().fromArray(pose.transform.matrix) : null;
	}

	/** True when the opaque VR world is shown (always, in a VR-only session). */
	get vrView() { return this.sessionMode !== 'ar' || this.view === 'vr'; }

	/** Shows the VR world or the passthrough for the current mode. */
	applyView() {
		const vr = this.vrView;
		if (this.mode === 'dollhouse') {
			this.showroom.visible = vr;
			this.gallery.visible = vr;
			this.pedestal.visible = vr;
			this.walkSky.visible = false;
			this.model.layers.ground.visible = false;
			this.setLift(this.modes.dollhouse.viewLift()); // (the same in passthrough: the model stays put)
		} else if (this.mode === 'walk') {
			this.showroom.visible = false;
			this.walkSky.visible = vr;
			this.model.layers.ground.visible = vr;
		}
	}

	/**
	 * Dollhouse level picker: shows the storeys up to `maxStorey` and takes the
	 * ceilings off the highest one shown, so you look straight into it. Walk
	 * mode and the 2D page always show every storey.
	 */
	applyStoreys() {
		if (!this.model) return;
		const count = this.model.storeys ?? 1;
		const max = this.maxStorey;
		const filtered = this.mode === 'dollhouse' && max !== null && max < count - 1;
		const groups = [...Object.entries(this.model.layers), ['lamps', this.model.lamps]];
		for (const [name, group] of groups) {
			for (const m of group?.children ?? []) {
				const s = m.userData.storey ?? 0;
				m.visible = !filtered || s < max || (s === max && name !== 'ceilings');
			}
		}
		this._targets = null; // hidden storeys cannot be pointed at
		this.lighting?.refresh(); // and cast no shadows
	}

	/** Raises the rig by `lift` above the floor the user stands on. */
	setLift(lift) {
		this.rig.position.y += lift - this.lift;
		this.lift = lift;
		this.rig.updateMatrixWorld(true);
	}

	/** Shows the current settings in both menus (js/xr-menus.js). */
	updateLabels() { updateLabels(this); }

	/** Runs a menu target: { id }, { id, value } or a bare id (js/xr-menus.js). */
	menuAction(target) { menuAction(this, target); }

	/**
	 * See-through, in the headset only (the 2D page shows the model as
	 * modelled). Faded walls and furniture stop casting shadows, like glass.
	 */
	applySeeThrough() {
		const amount = this.session ? this.seeThroughAmount : 0;
		this.seeThrough.set(amount);
		const faded = 1 - SEE_THROUGH_MAX * amount < 0.9;
		let changed = false;
		for (const m of this.seeThrough.meshes) {
			const glass = [].concat(m.material).some((mat) => { const b = mat.userData.cwBase ?? mat; return b.transparent && b.opacity < 0.9; });
			const cast = !glass && !faded;
			if (m.castShadow !== cast) { m.castShadow = cast; changed = true; }
		}
		if (changed) this.lighting?.refresh();
	}

	/** Recolours the gallery sky and the walk-mode sky for the time of day. */
	updateSky() {
		const { top, horizon } = this.lighting?.skyColors() ?? { top: this.model?.skyColor ?? 0xcce4fc, horizon: 0xf5f7f9 };
		recolourSphere(this.showroomSky.geometry, 40, top, horizon);
		recolourSphere(this.walkSky.geometry, 200, top, horizon);
	}

	/**
	 * What the lasers, the arc and the feet may hit (js/xr-targets.js), built
	 * once per model and storey choice: this is asked for several times every
	 * frame. Only what is shown.
	 */
	targets() {
		this._targets ??= targetSets(this.model);
		return this._targets;
	}

	/** Floor under a world point (cast down from `lift` above it): a world point or null. */
	findFloor(worldPoint, lift) { return findFloor(this.raycaster, this.targets().floors, worldPoint, lift); }

	/** Head position in the world (from the rig and this frame's head pose). */
	headWorld() {
		this.rig.updateMatrixWorld(true);
		return new THREE.Vector3().setFromMatrixPosition(this.camera.matrix).applyMatrix4(this.rig.matrixWorld);
	}

	/**
	 * The live keys the orb must never hide (the next-build asks 5.8): the
	 * doors and level keys while they take presses, and each open wing (as one
	 * key: its cells, tabs and close line). Not the wrist's own keys. Each
	 * { p (world centre), r (half-diagonal, m) }.
	 */
	liveKeys() {
		const out = [];
		if (this.mode === 'dollhouse' && this.modes.dollhouse.doorsLive) {
			for (const k of this.modes.dollhouse.doors.list) {
				let o = k.group, shown = true;
				while (o) { if (!o.visible) { shown = false; break; } o = o.parent; }
				if (shown) out.push({ p: k.face.getWorldPosition(new THREE.Vector3()), r: Math.hypot(k.w, k.h) / 2 });
			}
		}
		for (const panel of this.ui.openPanels()) {
			const g = panel.mesh.geometry.parameters;
			out.push({ p: panel.mesh.getWorldPosition(new THREE.Vector3()), r: Math.hypot(g.width, g.height) / 2 });
		}
		return out;
	}

	/**
	 * True if world point p is within `margin` of any key you could press (the
	 * orb, the plinth doors and levels, the wrist keys, an
	 * open wing): the fan stays closed over a hand reaching for one.
	 */
	nearKey(p, margin, { orb: withOrb = true, wristKeys = true } = {}) {
		const wrist = this.ui.wrist, orb = wrist.orb?.group;
		if (withOrb && orb?.visible && orb.getWorldPosition(this._nk ??= new THREE.Vector3()).distanceTo(p) < margin) return true;
		if (this.mode === 'dollhouse' && this.modes.dollhouse.doorsLive && this.modes.dollhouse.doors.near(p, margin)) return true; // (only live keys: faded doors guard nothing)
		if (wristKeys && wrist.open && wrist.pad.near(p, margin)) return true;
		const q = this._nk2 ??= new THREE.Vector3();
		for (const panel of this.ui.openPanels()) {
			panel.mesh.updateMatrixWorld(true);
			const g = panel.mesh.geometry.parameters, L = panel.mesh.worldToLocal(q.copy(p));
			if (Math.abs(L.x) < g.width / 2 + margin && Math.abs(L.y) < g.height / 2 + margin && Math.abs(L.z) < margin) return true;
		}
		return false;
	}

	/**
	 * Bare hands teleport (and point at a room) with either empty hand: one
	 * that holds no tool (the user's decision, 26 Nov 2026; until then only the
	 * main hand). Keys, the model and the wings still claim a hand first
	 * (aimBlock, the places' own checks); while one hand aims, the other's
	 * pinch does nothing.
	 */
	emptyHand(c) { return this.tools?.held?.c !== c; }

	/** The hand that wears the wrist menu and takes tools ('right' by default; the Main hand setting). */
	get mainHand() { return this.toolFan === 'right' ? 'left' : 'right'; }

	/**
	 * Why bare hand c's pinch may not aim a teleport here (the design of 24
	 * Nov: a pinch near something belongs to it), or null. p: the pinch point
	 * (world). 'board', 'wrist menu', 'key', 'fan', 'model', 'tool'.
	 */
	aimBlock(c, p) {
		const NEAR = CLAIM.near, tools = this.tools, held = tools?.held?.c;
		if (held === c) return 'tool'; // (a hand holding a tool never aims)
		if (this.boardOpen) return 'board';
		if (this.ui.wrist.open) return 'wrist menu';
		if (!p) return null;
		if (held) {
			const q = held.isHand ? this.input.joint(held, 'wrist') : held.grip.getWorldPosition(new THREE.Vector3());
			if (q && q.distanceTo(p) < NEAR + 0.05) return 'tool';
		}
		if (this.handViews[c.index]?.near) return 'key';
		const orb = this.ui.wrist.orb?.group; // (only the other hand: the orb rides the wearer's own wrist)
		if (orb?.visible && this.ui.wrist.wearer !== c && orb.getWorldPosition(new THREE.Vector3()).distanceTo(p) < NEAR) return 'wrist menu';
		if (this.mode === 'dollhouse' && this.modes.dollhouse.doorsLive && this.modes.dollhouse.doors.near(p, NEAR)) return 'key';
		const fan = this.fan?.group;
		if (fan?.visible && fan.getWorldPosition(new THREE.Vector3()).distanceTo(p) < NEAR + 0.1) return 'fan'; // (the fan's tools spread about 10 cm round its middle)
		if (this.mode === 'dollhouse' && this.modes.dollhouse.modelBox().distanceToPoint(p) < NEAR) return 'model';
		return null;
	}

	/** The head's yaw in the world (radians, + = turning left): the flick gesture subtracts its change. */
	viewYaw() { this.rig.updateMatrixWorld(true); return yawOfMatrix((this._viewM2 ??= new THREE.Matrix4()).copy(this.camera.matrix).premultiply(this.rig.matrixWorld)); }

	/** The viewer's horizontal right and forward axes (world, unit). */
	viewAxes() {
		this.rig.updateMatrixWorld(true);
		const yaw = yawOfMatrix((this._viewM ??= new THREE.Matrix4()).copy(this.camera.matrix).premultiply(this.rig.matrixWorld));
		const a = this._axes ??= { right: new THREE.Vector3(), forward: new THREE.Vector3() }; // (reused: callers copy what they keep)
		a.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
		a.forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
		return a;
	}

	/** Turns the user by `angle` (radians, + = left) about their head. */
	turn(angle) {
		this.pause?.note('turn'); // (the turn tip is learnt: js/pause.js)
		if (this.body) this.body.yaw += angle; // (a snap turn turns the body at once: js/zones.js)
		const before = this.headWorld();
		this.rig.rotation.y += angle;
		const after = this.headWorld();
		this.rig.position.x += before.x - after.x;
		this.rig.position.z += before.z - after.z;
		this.rig.updateMatrixWorld(true);
	}

	/**
	 * Photo button: the view from your head, level, without the menu, lasers,
	 * controllers, orbs or arc (the interface layer: the photo's camera
	 * leaves it out), as a JPEG (js/photo.js), kept in the page's photo roll
	 * (onPhoto).
	 */
	async capturePhoto({ eye = null, width, height, fov, level, onBlob } = {}) {
		this.photoPending = false;
		if (this.photoBusy) return;
		this.photoBusy = true;
		// (Drawn at once; only reading the image back waits.) From your head, or the
		// street camera's lens (eye: its world matrix; 3:2, its field of view).
		this.markInterface();
		this.rig.updateMatrixWorld(true);
		this.portals.hide(); // (the photo shows the walls whole: a portal is the viewer's peek; drawn before takePhoto's first wait)
		let job;
		try { job = takePhoto(this.renderer, this.scene, eye ?? this.camera.matrixWorld.clone(), { near: XR_NEAR, far: XR_FAR, width, height, fov, level }); } finally { this.portals.show(); }
		let error = null, kept = null;
		try {
			const blob = await job;
			onBlob?.(blob);
			if (this.onPhoto) {
				kept = await this.onPhoto(blob, photoName());
				if (!kept) throw new Error('The photo could not be kept');
			} else {
				saveFile(blob, photoName());
			}
		} catch (e) {
			console.warn('Photo failed', e);
			error = e;
		}
		this.photoBusy = false;
		this.ui.showPhotoResult(error, kept);
	}

	// -----------------------------------------------------------------------
	// Each frame
	// -----------------------------------------------------------------------

	update(dt) {
		if (!this.session || !this.model) return;
		if (this.hidden) return; // (Meta's menu covers the app: nothing reads input behind it)
		this.frameDt = dt;
		this.input.update(); // (also clears every controller's claims)
		this.input.readGestures(dt, this.headWorld(), this.viewYaw()); // bare hands: the teleport gesture, the closed hand (C0.4)
		for (const v of this.handViews) v.near = false; // (a key or the board near a fingertip lights it up again this frame)
		this.ui.showHandsNote(); // bare hands: "Pick up your controllers" (their pinches are never read)
		this.tools.claim(); // a held tool's buttons are its own, before the menu and the mode
		this.fan.claim(); // (a squeeze on a tool in the fan takes it: never the model)
		if (this.pendingRecentre && this.mode === 'dollhouse') {
			const head = this.viewerMatrix();
			if (head) {
				this.pendingRecentre = false;
				this.modes.dollhouse.measureLift(head); // the tall view, from where the head really is
				this.modes.dollhouse.recentre(head.clone().premultiply(this.rig.matrix));
			}
		}
		const moving = !!this.layerFx;
		this.pause.update(dt); // a move between places (the modes wait), the room's name, the first-target ring
		if (!moving) this.modes[this.mode]?.update(dt);
		this.portals.update(this, dt); // the wall portal: after the mode, so a jump this frame shuts it
		for (const v of this.handViews) v.update(dt, { passthrough: !this.vrView });
		this.readout?.update();
		this.frameStats?.update(dt);
		this.updateAreas(dt); // left, centre, right: where each hand is (js/zones.js)
		this.fan.update(dt); // the tool fan: home or waiting at the edge, touch, take, swap, put back (milestone C)
		this.tools.update(dt);
		this.tweens.update(dt);
		this.haptics.update(dt);
		this.sound.update(dt);
		if (this.photoPending) this.capturePhoto();
		this.ui.runPhotoFx(dt);
	}
}

const _fwd = new THREE.Vector3();
/** Yaw of a matrix's forward (-Z) direction. */
function yawOfMatrix(m) {
	_fwd.set(0, 0, -1).transformDirection(m);
	return Math.atan2(-_fwd.x, -_fwd.z);
}
