// XR session (SPEC.md, "Experience and controls"): the headset's two modes,
// the menus and the tools, and the order of work in each frame.
//
//   dollhouse  the home on a plinth in a gallery room (VR view) or floating
//              over passthrough (AR view): js/xr-dollhouse.js
//   walk       the home at 1:1: js/xr-walk.js
//   menus      what they say and do: js/xr-menus.js; the wrist menu:
//              js/wrist-menu.js; the board, help, welcome card and notes:
//              js/xr-ui.js
//   layers     page → scale model → inside, one step at a time: goLayer()
//              (dive and surface transitions, the arrival title)
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
import { Lessons } from './lessons.js';
import { SafetyNet } from './safety.js';
import { Veil } from './veil.js';
import { HandReadout } from './hand-readout.js';
import { FrameStats } from './frame-stats.js';
import { DEV } from './dev.js';
import { ToolsIntro } from './tools-intro.js';
import { attachTransientPointer } from './transient-pointer.js';
import { SeeThrough, SEE_THROUGH_MAX } from './walls.js';
import { Portals } from './portal.js';
import { PinchDemo } from './pinch-demo.js';
import { takePhoto, photoName, saveFile, INTERFACE_LAYER } from './photo.js';
import { readSetting } from './settings.js';
import { buildShowroom, buildStage, fitPlinth, placePlate, buildWalkSky, recolourSphere, PLINTH_HEIGHT } from './xr-scene.js';
import { ScalePlate, Label } from './panel.js';
import { roomAt } from './rooms.js';
import { targetSets, findFloor } from './xr-targets.js';
import { buildMenus, updateLabels, menuAction, SEE_THROUGH_ON } from './xr-menus.js';
import { XRUI } from './xr-ui.js';
import { Dollhouse, roundScale, roundScaleUp } from './xr-dollhouse.js';
import { Walk } from './xr-walk.js';
import { ToolSystem } from './xr-tools.js';
import { ToolFan } from './tool-fan.js';
import { Tweens, ease } from './tween.js';
import { Haptics } from './haptics.js';
import { Sound } from './sound.js';

// Clip planes for the headset, set explicitly: left alone they come from how
// the 2D page framed the model, which can clip things held near the face.
const XR_NEAR = 0.05, XR_FAR = 300;
const DOLLHOUSE_SIZE = 1.4; // metres across at most (build 120's design, item 8: was 1.2 m; wider pushes the wings to their limit)
/** Stepping inside: how long the model grows towards you (s), eased in and out, before the fade. 0.8 is the fallback if the slow growth is uncomfortable (build 111's design, item 4), 0.3 the old blink. */
export const WALK_IN_GROW = 1.3;
/**
 * Stepping inside as a tunnel zoom (build 120, item 7; on since the user's word of 26 Nov 2026, made
 * subtle by the UX/UI Designer's M2): a dim closes in from the view's edge to a clear circle 60°
 * across on the landing spot (dimmed to half, never black: js/veil.js), and inside it the whole room
 * and the model scale up x1 -> x1.4 about that spot (smootherstep: a soft start and stop), then the
 * view fades to black on the dive chime's last ringing note. Off: the model grows (above). The one
 * place it is decided (a Settings switch could set it later). Fallbacks: x1.6 if it feels like too
 * little; x1.25, then off, if anyone feels discomfort. Comfort acceptance: the user, seated and
 * standing, on the Quest 2.
 */
export const WALK_IN_ZOOM = true;
const ZOOM = { close: 0.5, from: 0.2, to: 1.3, x: 1.4, black: 1.25, end: 1.6 }; // (seconds, and the scale at the end)

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
		this.personHeight = readSetting('height');
		// Walking: walls stop you (off by default). Furniture never does.
		this.solid = readSetting('solid');
		// See-through walls and furniture (headset only): 0 = as modelled, 1 = glass house.
		this.seeThroughAmount = readSetting('seeThrough') > 0 ? SEE_THROUGH_ON : 0; // (a switch: an older stored amount counts as on)
		this.seeThrough = new SeeThrough();
		this.portals = new Portals(); // the wall portal (js/portal.js)
		this.soundLevel = readSetting('sound'); // off | effects | all (effects and ambience)
		this.toolFan = readSetting('mainHand') === 'left' ? 'right' : 'left'; // the hand the tool fan floats over: the one that is not the main hand (the main hand wears the wrist menu, takes tools, teleports)
		this.cameraLens = readSetting('cameraLens'); // the street camera's lens, mm (milestone D)
		this.layerFx = null; // a move between layers in progress (goLayer())
		this.frameDt = 1 / 72;
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
			critical: () => !!this.layerFx, // (an error halfway through a move between layers: end cleanly rather than leave a half state)
		});
		this.hidden = false; // the session is covered by Meta's menu (visibilityState not 'visible'): input and sound pause
		this.hideFromPhotos(...this.handViews.map((v) => v.group));
		// Scenery: the gallery and its sky, the stage with the plinth, the walk sky.
		Object.assign(this, buildShowroom(scene)); // showroom, showroomSky
		Object.assign(this, buildStage(scene)); // stage, gallery, pedestal, plinthMaterials
		this.plate = new ScalePlate(); // the model's true scale, on the plinth (SPEC.md B2)
		this.plinthH = PLINTH_HEIGHT; // the plinth's height now: 0.6 m with a controller, 1.24 m with only bare hands (animated between: js/xr-dollhouse.js)
		this.setPlinth(1.2, 0.9);
		this.walkSky = buildWalkSky(camera);
		Object.assign(this, buildMenus(rig)); // menus: the settings boards
		this.hideFromPhotos(...Object.values(this.menus).map((p) => p.mesh), ...Object.values(this.guides).map((p) => p.mesh));
		// The one sphere round the eyes (js/veil.js): the teleport fade, the move between layers
		// (dark for in and back, white for leaving VR) and the photo flash. Then the arrival title.
		this.veil = new Veil(camera);
		this.arrival = new Label({ height: 0.12 });
		this.arrival.mesh.visible = false;
		this.arrival.mesh.material.depthTest = false;
		rig.add(this.arrival.mesh);
		this.hideFromPhotos(this.veil.mesh, this.arrival.mesh);
		this.modes = { dollhouse: new Dollhouse(this), walk: new Walk(this) };
		this.ui = new XRUI(this);
		this.lessons = new Lessons(this); // the first-time lessons (C0.5)
		this.toolsIntro = new ToolsIntro(this); // the tools' first-time introduction (C3)
		this.pinchDemo = new PinchDemo(this); // the looping hand the first time inside (js/pinch-demo.js)
		this.tools = new ToolSystem(this);
		this.fan = new ToolFan(this); // the tool fan over the left hand (milestone C)
		this.tweens = new Tweens();
		this.haptics = new Haptics();
		this.sound = new Sound();
		this.sound.setLevel(this.soundLevel);
	}

	/** The open settings board (a Panel), or null. */
	get menu() { return this.ui.menu; } // the settings wing (right)
	/** True while either wing (Settings, How to move) is open: nothing else claims the hands then. */
	get boardOpen() { return !!(this.ui.menu || this.ui.guide); }

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
		this.plinthBase = { W, D }; // (with a controller's margin: bare hands widen it, js/xr-dollhouse.js setPlinthNow)
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
		this.ui.placeWelcome();
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
		this.introPending = true; // the tools' introduction, the first time, once the head is known (then the lesson)
		this.ui.setWelcome(true); // until the menu is first opened
		// The floor origin is not necessarily where you stand (it can be
		// anywhere in your play area), so place the plinth in front of the
		// head as soon as the first head pose arrives.
		this.pendingRecentre = true;
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
		this.ui.reset(); // menus, welcome card, notes, the wrist menu
		this.lessons.stop();
		this.pinchDemo.stop();
		this.toolsIntro.stop();
		this.layerFx = null;
		this.veil.clear();
		this.arrival.mesh.visible = false;
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
		const was = this.mode;
		if (this.mode && this.mode !== name) this.modes[this.mode].exit();
		this.mode = name; // (set first: applyStoreys() and applyView() read it)
		this.ui.closeAll();
		this.modes[name].enter(...args);
		// The first-time lessons: stepping inside ends the scale model's; each place starts its own (until done).
		if (was === 'dollhouse' && name === 'walk') this.lessons.note('inside');
		this.lessons.stop();
		if (this.session && !(name === 'dollhouse' && this.toolsIntro?.playing)) this.lessons.start(name === 'walk' ? 'walk' : 'scale'); // (the tools' introduction first)
		if (name !== 'dollhouse') this.toolsIntro?.stop();
		if (name === 'walk' && this.session) this.pinchDemo.start(); else this.pinchDemo.stop();
		this.ui.setWelcome(this.ui.welcomeOn);
	}

	// -----------------------------------------------------------------------
	// Layers: page → scale model → inside (SPEC.md C0, "Layers")
	// -----------------------------------------------------------------------

	/**
	 * Moves one layer, running `go` while the view is covered: 'in' (the
	 * scale model grows towards you for 0.3 s, then a short fade; sound dive),
	 * 'back' (a fade, then the home shrinks down onto the plinth; sound
	 * surface) or 'out' (a gentle fade to white, then the page). Menus close;
	 * the modes wait until it is over. The arrival title follows.
	 */
	goLayer(dir, go, spot = null) {
		if (this.layerFx || !this.session) return;
		this.ui.closeAll();
		if (dir !== 'out' && this.soundLevel !== 'off') this.sound.play(dir === 'in' ? 'dive' : 'surface');
		const doll = this.modes.dollhouse.doll;
		this.layerFx = { dir, go, t: 0, done: false, zoom: doll.zoom };
		if (dir === 'in' && WALK_IN_ZOOM && spot && this.mode === 'dollhouse') {
			// (Where the zoom centres: the landing spot in the world, and what it scales from.)
			this.layerFx.tunnel = { at: this.centerer.localToWorld(spot.clone()), stage: this.stage.position.clone(), anchor: this.anchor.position.clone(), scale: this.anchor.scale.x };
		}
		this.layerColour = dir === 'out' ? 0xffffff : 0x000000;
	}

	/**
	 * The tunnel zoom (WALK_IN_ZOOM): the dim closes in to a 60° circle on the
	 * landing spot (0-0.5 s, eased out), the room and the model scale x1 ->
	 * x1.4 about it (0.2-1.3 s, smootherstep), the view fades to black
	 * (1.25-1.6 s), then inside the fade lifts as usual. The floor under your
	 * feet never moves: the spot is ahead of you, below the eyes.
	 */
	runTunnel(f, cover) {
		const z = f.tunnel, t = f.t;
		const k = Math.min(1, Math.max(0, (t - ZOOM.from) / (ZOOM.to - ZOOM.from))), s = 1 + (ZOOM.x - 1) * ease.smooth(k); // (smootherstep: no jolt at either end)
		this.stage.scale.setScalar(s);
		this.stage.position.copy(z.stage).sub(z.at).multiplyScalar(s).add(z.at);
		this.anchor.position.copy(z.anchor).sub(z.at).multiplyScalar(s).add(z.at);
		this.anchor.scale.setScalar(z.scale * s);
		this.anchor.updateMatrixWorld(true);
		this.veil.setTunnel(ease.out(Math.min(1, t / ZOOM.close)), this.camera.worldToLocal(z.at.clone())); // (closes in eased out)
		cover(THREE.MathUtils.clamp((t - ZOOM.black) / (ZOOM.end - ZOOM.black), 0, 1));
		if (t >= ZOOM.end) {
			this.veil.setTunnel(0);
			this.stage.scale.setScalar(1); this.stage.position.copy(z.stage); // (the scale model as you left it)
			this.modes.dollhouse.apply();
			f.done = true; f.t = 0; f.tunnel = null;
			f.go();
			this.showArrival(this.roomHere() || 'Inside');
		}
	}

	/** Advances a move between layers (instead of the mode's update). */
	runLayerFx(dt) {
		const f = this.layerFx, doll = this.modes.dollhouse;
		f.t += dt;
		const GROW = f.dir === 'in' ? WALK_IN_GROW : 0.3, OUT = f.dir === 'in' ? 0.15 : 0.1, IN = f.dir === 'in' ? 0.2 : 0.15, WHITE = 0.3;
		const cover = (v) => this.veil.set('layer', v, this.layerColour);
		if (f.dir === 'out') {
			cover(Math.min(1, f.t / WHITE));
			if (f.t >= WHITE && !f.done) { f.done = true; this.layerFx = null; f.go(); }
			return;
		}
		if (f.dir === 'in') {
			// The model grows towards you, then the fade; inside, the fade lifts.
			if (!f.done && f.tunnel) { this.runTunnel(f, cover); return; }
			if (!f.done) {
				// Only the model grows (the gallery stays still, a fixed frame), eased in and out, with a soft vignette; then the fade.
				const g = Math.min(1, f.t / GROW);
				if (this.mode === 'dollhouse') { doll.doll.zoom = f.zoom * (1 + 0.6 * ease.inOut(g)); doll.apply(); }
				this.veil.setVignette(Math.min(1, f.t / 0.3) * (WALK_IN_GROW > 0.5 ? 1 : 0));
				cover(THREE.MathUtils.clamp((f.t - GROW) / OUT, 0, 1));
				if (f.t >= GROW + OUT) {
					f.done = true; f.t = 0;
					this.veil.setVignette(0);
					doll.doll.zoom = f.zoom; // (the scale model is as you left it when you come back)
					f.go();
					this.showArrival(this.roomHere() || 'Inside');
				}
			} else {
				cover(Math.max(0, 1 - f.t / IN));
				if (f.t >= IN) { cover(0); this.layerFx = null; }
			}
			return;
		}
		// 'back': the fade, then the home settles back onto the plinth.
		if (!f.done) {
			cover(Math.min(1, f.t / OUT));
			if (f.t >= OUT) {
				f.done = true; f.t = 0;
				f.go();
				// Every arrival at the scale model puts the plinth in front of you, the model
				// level on it, here behind the fade (you may have turned and walked inside).
				if (this.mode === 'dollhouse') this.recentreHere();
				this.showArrival(`Scale model 1:${roundScale(1 / (this.baseScale * doll.doll.zoom))}`);
			}
		} else {
			cover(Math.max(0, 1 - f.t / IN));
			const g = Math.min(1, f.t / GROW);
			if (this.mode === 'dollhouse') { doll.doll.zoom = f.zoom * (1 + 0.6 * (1 - ease.out(g))); doll.apply(); }
			if (f.t >= GROW) { doll.doll.zoom = f.zoom; if (this.mode === 'dollhouse') doll.apply(); cover(0); this.layerFx = null; }
		}
	}

	/** The room, plinth and doors in front of where the head is now (behind a fade), the model level on the plinth. */
	recentreHere() {
		const head = this.viewerMatrix() ?? this.camera.matrix.clone();
		this.rig.updateMatrixWorld(true); // (the rig was just reset by the mode's enter(): the head's world place is fresh again)
		this.modes.dollhouse.recentre(head.premultiply(this.rig.matrix));
		if (this.lessons.place === 'scale') this.lessons.place3d(); // (a lesson card in front of you too)
	}

	/** The arrival title: the layer's name, 1.5 m in front of you for 1.5 s, then it fades. */
	showArrival(text) {
		const head = this.camera.matrix;
		const yaw = yawOfMatrix(head);
		const p = new THREE.Vector3().setFromMatrixPosition(head);
		this.arrival.set(text);
		this.arrival.mesh.position.set(p.x - Math.sin(yaw) * 1.5, p.y + 0.05, p.z - Math.cos(yaw) * 1.5);
		this.arrival.mesh.rotation.set(0, yaw, 0);
		this.arrival.mesh.visible = true;
		this.arrivalT = 1.5;
	}

	runArrival(dt) {
		if (!this.arrival.mesh.visible) return;
		this.arrivalT -= dt;
		this.arrival.mesh.material.opacity = Math.min(1, Math.max(0, this.arrivalT / 0.3));
		if (this.arrivalT <= 0) this.arrival.mesh.visible = false;
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
	 * True if world point p is within `margin` of any key you could press (the
	 * orb, the plinth doors and levels, the wrist keys, a lesson's keys, an
	 * open wing): the fan stays closed over a hand reaching for one.
	 */
	nearKey(p, margin, ignoreOrb = false) {
		const wrist = this.ui.wrist, orb = wrist.orb?.group;
		if (!ignoreOrb && orb?.visible && orb.getWorldPosition(this._nk ??= new THREE.Vector3()).distanceTo(p) < margin) return true;
		if (this.modes.dollhouse.doors.near(p, margin)) return true;
		if (wrist.open && wrist.pad.near(p, margin)) return true;
		if (this.lessons?.keys?.near(p, margin)) return true;
		const q = this._nk2 ??= new THREE.Vector3();
		for (const panel of this.ui.openPanels()) {
			panel.mesh.updateMatrixWorld(true);
			const g = panel.mesh.geometry.parameters, L = panel.mesh.worldToLocal(q.copy(p));
			if (Math.abs(L.x) < g.width / 2 + margin && Math.abs(L.y) < g.height / 2 + margin && Math.abs(L.z) < margin) return true;
		}
		return false;
	}

	/**
	 * Bare hands teleport (and point at a room) with ONE hand: the main hand
	 * while it is empty, the other while the main hand holds a tool (Settings,
	 * General: Main hand, right by default). Both may still open a wall portal.
	 */
	teleportHand(c) {
		const main = this.mainHand, held = this.tools?.held?.c;
		// (The main hand takes tools from the fan, so it often holds one: then the other hand teleports. One hand always can.)
		const side = held && held.handedness === main ? this.toolFan : main;
		return c.handedness === side;
	}

	/** The hand that wears the wrist menu, takes tools and teleports ('right' by default; the Main hand setting). */
	get mainHand() { return this.toolFan === 'right' ? 'left' : 'right'; }

	/**
	 * Why bare hand c's pinch may not aim a teleport here (the design of 24
	 * Nov: a pinch near something belongs to it), or null. p: the pinch point
	 * (world). 'board', 'wrist menu', 'key', 'fan', 'model', 'tool'.
	 */
	aimBlock(c, p) {
		const NEAR = 0.15, tools = this.tools, held = tools?.held?.c;
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
		if (this.mode === 'dollhouse' && this.modes.dollhouse.doors.near(p, NEAR)) return 'key';
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
				if (this.introPending) { this.introPending = false; if (this.toolsIntro.start()) this.lessons.stop(); }
				if (this.lessons.place) this.lessons.place3d(); // (in front of you, now that the head is known)
			}
		}
		if (!this.layerFx) this.lessons.update(dt); // (its keys before the mode's lasers)
		this.toolsIntro.update(dt, () => { if (this.mode === 'dollhouse') this.lessons.start('scale', { again: !!this.introAgain }); this.introAgain = false; });
		if (this.layerFx) this.runLayerFx(dt); // moving between layers: the modes wait
		else this.modes[this.mode]?.update(dt);
		this.runArrival(dt);
		this.pinchDemo.update(dt);
		this.portals.update(this, dt); // the wall portal: after the mode, so a jump this frame shuts it
		for (const v of this.handViews) v.update(dt, { passthrough: !this.vrView });
		this.readout?.update();
		this.frameStats?.update(dt);
		this.fan.update(dt); // the tool fan: open, touch, take, swap, put back (milestone C)
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
