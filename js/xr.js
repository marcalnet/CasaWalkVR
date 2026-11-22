// XR session (SPEC.md, "Experience and controls"): the headset's two modes,
// the menus and the tools, and the order of work in each frame.
//
//   dollhouse  the home on a plinth in a gallery room (VR view) or floating
//              over passthrough (AR view): js/xr-dollhouse.js
//   walk       the home at 1:1: js/xr-walk.js
//   menus      what they say and do: js/xr-menus.js; orbs, opening, closing,
//              pointing, the welcome card and the photo note: js/xr-ui.js
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
//   ├─ stage ─ gallery room, plinth      what Recentre moves
//   └─ anchor ─ centerer ─ model         anchor: dollhouse position/yaw/scale
//                                        centerer: puts the model's bottom-centre at the origin
//
// The parts (modes, ui, menus, tools) are given this XRExperience. They may
// use its scene objects (renderer scene camera rig anchor centerer stage
// showroom gallery pedestal walkSky), input and raycaster, shared state
// (session sessionMode model mode menu menus view vrView lift maxStorey
// baseScale plinthSize plinthDistance and the settings snapAngle personHeight
// solid seeThroughAmount), its services (lighting depth seeThrough ui
// modes tools tweens haptics sound) and its methods. Each part owns what it
// creates and reads shared values when it needs them, never keeping copies.

import * as THREE from 'three';
import { XRInput } from './xr-input.js';
import { SeeThrough, SEE_THROUGH_MAX } from './walls.js';
import { takePhoto, photoName, saveFile, withHidden } from './photo.js';
import { readSetting } from './settings.js';
import { buildShowroom, buildStage, fitPlinth, placePlate, buildWalkSky, recolourSphere } from './xr-scene.js';
import { ScalePlate } from './panel.js';
import { targetSets, findFloor } from './xr-targets.js';
import { buildMenus, updateLabels, menuAction } from './xr-menus.js';
import { XRUI } from './xr-ui.js';
import { Dollhouse } from './xr-dollhouse.js';
import { Walk } from './xr-walk.js';
import { ToolSystem } from './xr-tools.js';
import { Tweens } from './tween.js';
import { Haptics } from './haptics.js';
import { Sound } from './sound.js';

// Clip planes for the headset, set explicitly: left alone they come from how
// the 2D page framed the model, which can clip things held near the face.
const XR_NEAR = 0.05, XR_FAR = 300;
const DOLLHOUSE_SIZE = 1.2; // metres across

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
		this.snapAngle = readSetting('turn');
		this.personHeight = readSetting('height');
		// Walking: walls stop you (off by default). Furniture never does.
		this.solid = readSetting('solid');
		// See-through walls and furniture (headset only): 0 = as modelled, 1 = glass house.
		this.seeThroughAmount = readSetting('seeThrough');
		this.seeThrough = new SeeThrough();
		this.soundLevel = readSetting('sound'); // off | effects | all (effects and ambience)
		this.maxStorey = null; // dollhouse: highest storey shown (null = all)
		this.pendingRecentre = false;
		this.photoPending = false;
		this.photoHidden = new Set(); // never in a photo: see hideFromPhotos()
		this.raycaster = new THREE.Raycaster();
		this.raycaster.firstHitOnly = true;
		this.floorRay = new THREE.Raycaster(); // all hits, so the first upward face is found
		this.input = new XRInput(renderer, rig);
		this.input.setVisible(false);
		this.hideFromPhotos(...this.input.controllers.flatMap((c) => [c.ray, c.grip])); // lasers, controllers, and what they carry (orbs, tools)
		// Scenery: the gallery and its sky, the stage with the plinth, the walk sky.
		Object.assign(this, buildShowroom(scene)); // showroom, showroomSky
		Object.assign(this, buildStage(scene)); // stage, gallery, pedestal, plinthMaterials
		this.plate = new ScalePlate(); // the model's true scale, on the plinth (SPEC.md B2)
		this.setPlinth(1.2, 0.9);
		this.walkSky = buildWalkSky(camera);
		this.menus = buildMenus(rig);
		this.hideFromPhotos(...Object.values(this.menus).map((p) => p.mesh));
		this.modes = { dollhouse: new Dollhouse(this), walk: new Walk(this) };
		this.ui = new XRUI(this);
		this.tools = new ToolSystem(this);
		this.tweens = new Tweens();
		this.haptics = new Haptics();
		this.sound = new Sound();
		this.sound.setLevel(this.soundLevel);
	}

	/** The open menu (a Panel), or null. */
	get menu() { return this.ui.menu; }

	/** Objects never drawn in a photo (the interface); hiding one hides what it carries. */
	hideFromPhotos(...objects) { for (const o of objects) this.photoHidden.add(o); }

	/** Sizes the plinth for a model footprint of w x d metres, with the scale plate on it. */
	setPlinth(w, d) {
		this.plate.mesh.removeFromParent(); // (fitPlinth rebuilds the plinth's parts)
		const { W, D, distance } = fitPlinth(this, w, d);
		this.plinthSize = { W, D };
		this.plinthDistance = distance; // from where you stand to the plinth's centre
		placePlate(this.plate.mesh, this.pedestal, W, D);
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
		this.baseScale = DOLLHOUSE_SIZE / Math.max(size.x, size.z, 0.01);
		this.setPlinth(size.x * this.baseScale, size.z * this.baseScale);
		this.ui.placeWelcome();
		// Everything casts and receives shadows (used only when shadows are on),
		// except the ground (nothing below it) and glass, so sun comes in
		// through the windows.
		for (const [name, layer] of Object.entries(model.layers)) {
			for (const m of layer.children) {
				const glass = [].concat(m.material).some((mat) => mat.transparent && mat.opacity < 0.9);
				m.castShadow = name !== 'ground' && !glass;
				m.receiveShadow = true;
			}
		}
		this.seeThrough.setModel(model.layers);
		this.applySeeThrough();
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
		const init = { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'] };
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
		this.ui.setWelcome(true); // until the menu is first opened
		// The floor origin is not necessarily where you stand (it can be
		// anywhere in your play area), so place the plinth in front of the
		// head as soon as the first head pose arrives.
		this.pendingRecentre = true;
	}

	end() { this.session?.end(); }

	handleEnd() {
		for (const m of Object.values(this.modes)) m.exit(); // (drops grabs, aims, pulls and any teleport)
		this.session = null;
		this.depth?.setActive(false);
		this.applySeeThrough(); // the 2D page shows the model as modelled
		this.mode = null;
		this.pendingRecentre = false;
		this.ui.reset(); // menu, welcome card, photo note, orbs
		this.photoPending = false;
		this.tools.end(); // tools back in the fan; measurements and drawings cleared
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
		this.ui.closeMenu();
		this.modes[name].enter(...args);
	}

	/** The head pose for this frame (rig space), straight from WebXR. */
	viewerMatrix() {
		const frame = this.renderer.xr.getFrame?.();
		const space = this.renderer.xr.getReferenceSpace();
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
	 * controllers, orbs or arc (everything in photoHidden), as a JPEG
	 * (js/photo.js), kept in the page's photo roll (onPhoto).
	 */
	async capturePhoto() {
		this.photoPending = false;
		if (this.photoBusy) return;
		this.photoBusy = true;
		// (Drawn at once; only reading the image back waits.)
		const job = withHidden(this.photoHidden, () => {
			this.rig.updateMatrixWorld(true);
			return takePhoto(this.renderer, this.scene, this.camera.matrixWorld.clone(), { near: XR_NEAR, far: XR_FAR });
		});
		let error = null, kept = null;
		try {
			const blob = await job;
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
		this.input.update(); // (also clears every controller's claims)
		this.ui.placeOrbs();
		this.ui.showHandsNote(); // bare hands: "Pick up your controllers" (their pinches are never read)
		this.tools.claim(); // a held tool's buttons are its own, before the menu and the mode
		if (this.pendingRecentre && this.mode === 'dollhouse') {
			const head = this.viewerMatrix();
			if (head) {
				this.pendingRecentre = false;
				this.modes.dollhouse.measureLift(head); // the tall view, from where the head really is
				this.modes.dollhouse.recentre(head.clone().premultiply(this.rig.matrix));
			}
		}
		this.modes[this.mode]?.update(dt);
		this.tools.update(dt);
		this.tweens.update(dt);
		this.haptics.update(dt);
		this.sound.update(dt);
		if (this.photoPending) this.capturePhoto();
		this.ui.runPhotoFx(dt);
	}
}
