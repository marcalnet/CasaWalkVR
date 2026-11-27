// The street camera (SPEC.md phase 17, milestone D): a hand-held tool. Its
// trigger is the shutter: the photo is taken from the camera's own position
// and lens, 3:2 (1920 x 1280), level when the camera is held within a few
// degrees of level, and kept in the page's photo roll like any photo taken
// in VR (saved from the page after VR). Photos keep measurements and
// drawings, never the fan, the held tools, menus, lasers or controllers.
//
// The back carries a small viewfinder screen: the view through the lens,
// about 192 x 128, refreshed a few times a second (fewer on Quest 2), and not
// at all when it faces away from you; it shows the lens (e.g. "28 mm").
// After a shot a small print pops out of the camera, floats a moment and
// drifts back into the camera. Lens: wide angle 24 mm (default), medium lens 50 mm or zoom lens 75 mm (the user's
// three, build 215's B3), set in
// on the camera's dial (js/tool-dial.js; remembered: js/settings.js cameraLens).

import * as THREE from 'three';
import { canvasTexture } from './canvas-card.js';
import { DEVICE } from './device.js';
import { buildCamera } from './tool-models.js';
import { COLOURS, FONT, GUIDE } from './theme.js';
import { FramingGuide } from './framing-guide.js';

const SCREEN = [192, 128]; // viewfinder pixels
// Viewfinder frames: 4 a second, 2 on Quest 2 (a phone GPU); a frame after a slow one is skipped;
// it draws only out to VIEW_FAR (the tester's measurement: the whole home every 18th frame was a hitch).
const SLOW_GPU = DEVICE.quest2;
const SCREEN_EVERY = SLOW_GPU ? 0.5 : 0.25;
const VIEW_FAR = 15; // metres
const SLOW_FRAME = 1 / 60; // seconds: the last frame took longer, skip this viewfinder frame
const PRINT_PX = [240, 160]; // the print's picture (a 6 x 4 cm card needs no more)
const LEVEL = THREE.MathUtils.degToRad(4); // held within this of level: the photo is levelled
const PHOTO = [1920, 1280]; // 3:2
const FILM_H = 24; // 35 mm film height (mm): vertical field of view from the focal length

/** Vertical field of view (degrees) of a focal length on 35 mm film (36 x 24). */
/** The three lenses: their focal length (mm) and name (the dial's stops and its label; the viewfinder shows the mm). */
export const LENSES = [{ mm: 24, name: 'Wide angle', key: 'Wide' }, { mm: 50, name: 'Medium lens', key: 'Medium' }, { mm: 75, name: 'Zoom lens', key: 'Zoom' }]; // (key: the word on its key in the options row, js/tool-dial.js)

export const lensFov = (mm) => THREE.MathUtils.radToDeg(2 * Math.atan(FILM_H / 2 / mm));

export class StreetCamera {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.object = buildCamera();
		this.name = 'camera';
		this.live = true;
		this.lensPoint = this.object.getObjectByName('lens');
		this.screenPoint = this.object.getObjectByName('screen');
		// The viewfinder: a render target on a plane over the back screen.
		this.target = typeof document !== 'undefined' ? new THREE.WebGLRenderTarget(...SCREEN) : null;
		this.view = new THREE.PerspectiveCamera(lensFov(xr.cameraLens ?? LENSES[0].mm), SCREEN[0] / SCREEN[1], 0.05, VIEW_FAR);
		this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.032),
			new THREE.MeshBasicMaterial({ map: this.target?.texture ?? null, color: this.target ? 0xffffff : 0x5d6873, toneMapped: false }));
		this.screen.position.copy(this.screenPoint.position).z += 0.0006;
		this.screen.name = 'viewfinder';
		this.object.add(this.screen);
		// The lens, written over the screen's corner.
		this.lensLabel = makeLabel();
		this.lensLabel.mesh.position.copy(this.screenPoint.position).add(new THREE.Vector3(0.016, -0.012, 0.001));
		this.object.add(this.lensLabel.mesh);
		// Its instruction, hand-lettered on the back under the screen (the user: simple, almost no printing).
		this.hint = makeHint();
		this.hint.mesh.position.copy(this.screenPoint.position).add(new THREE.Vector3(0, -0.0225, 0.001));
		this.object.add(this.hint.mesh);
		this.hint.set('Trigger: take a photo');
		this.held = null; // the hand holding it
		this.t = 0;
		this.prints = [];
		this.controls = ['stickPress']; // the stick press of its hand steps its one option: the lens (js/tool-dial.js)
		this.option = { part: 'control', stops: LENSES.map((l) => ({ value: l.mm, label: l.name, key: l.key })), get: () => this.mm, set: (mm) => this.xr.menuAction({ id: 'lens', value: mm }) };
		this.guide = new FramingGuide(xr); // the red frame where the photo's edges fall (js/framing-guide.js)
		this._lens = new THREE.Matrix4(); this._turn = new THREE.Matrix4().makeRotationY(Math.PI);
		this.setLens(xr.cameraLens ?? LENSES[0].mm);
	}

	setLens(mm) {
		this.mm = mm;
		this.view.fov = lensFov(mm);
		this.view.updateProjectionMatrix();
		this.lensLabel.set(`${mm} mm`);
	}

	take(c) {
		this.held = c;
		// (Bare hands: the holding hand's pinch is the shutter, in use mode: build 215's C2, js/xr-tools.js.)
		this.hint.set(c?.isHand ? 'Pinch: take a photo' : 'Trigger: take a photo');
	}
	putBack() { this.held = null; this.guide.reset(); }

	/** The stick press of the holding controller: the next lens, the dial shown (js/tool-dial.js). */
	control(c, name) { if (name === 'stickPress') this.xr.dial?.step(this); } // (put back: the frame goes at once; only a held tool is updated, so it can't fade out)

	/** The shutter. */
	trigger(c, phase) {
		if (phase !== 'down') return;
		this.shoot();
	}

	/** Takes the photo from the lens (as the menu's Photo did from the head). */
	shoot() {
		const xr = this.xr;
		if (xr.soundLevel !== 'off') xr.sound.play('shutter');
		if (this.held?.isController) xr.haptics.play(this.held, 'click');
		this.flash = 0.12;
		this.guide.shutter(); // (hidden while the shutter fires and the print pops)
		this.object.updateMatrixWorld(true);
		// From the same smoothed pose the red frame is drawn from, so the photo matches it (the UX review's C5);
		// before the frame's first pose, the lens (its empty's +Z looks out: turned round, as a photo camera looks along -Z).
		const eye = this.guide.poseMatrix() ?? this.lensPoint.matrixWorld.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI));
		xr.capturePhoto({ eye, width: PHOTO[0], height: PHOTO[1], fov: lensFov(this.mm), level: LEVEL, onBlob: (blob) => this.print(blob) });
	}

	/** A small print pops out of the camera's top, floats a moment, then drifts back in. */
	print(blob) {
		if (typeof createImageBitmap === 'undefined') return;
		createImageBitmap(blob, { resizeWidth: PRINT_PX[0], resizeHeight: PRINT_PX[1], resizeQuality: 'medium' }).then((bmp) => {
			const tex = new THREE.CanvasTexture(bmp);
			tex.colorSpace = THREE.SRGBColorSpace;
			const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
			m.name = 'print';
			this.xr.hideFromPhotos(m);
			this.object.add(m);
			m.position.set(0, 0.04, 0.005);
			this.prints.push({ m, t: 0, tex, bmp });
		}).catch(() => {});
	}

	/** Once a frame (while held, and in the fan): the viewfinder, the flash, the prints. */
	update(dt) {
		const xr = this.xr;
		this.t += dt;
		// The framing guide: only while held (the lens empty's +Z looks out: turned round, as a camera).
		if (this.held || this.guide.group.visible) {
			this.object.updateMatrixWorld(true);
			this.guide.update(dt, !!this.held, this._lens.copy(this.lensPoint.matrixWorld).multiply(this._turn), lensFov(this.mm));
		}
		// The viewfinder: only while held and facing you, a few times a second.
		// (After a slow frame, wait one more frame; never more than once in a row, or a slow device would never see it.)
		const slow = (xr.frameDt ?? 0) > SLOW_FRAME && !this.skipped;
		if (this.target && this.held && this.t >= SCREEN_EVERY && slow) this.skipped = true;
		else if (this.target && this.held && this.t >= SCREEN_EVERY) {
			this.skipped = false;
			this.t = 0;
			this.object.updateMatrixWorld(true);
			const back = new THREE.Vector3(0, 0, 1).transformDirection(this.screenPoint.matrixWorld);
			const toEye = xr.headWorld().sub(this.screenPoint.getWorldPosition(new THREE.Vector3())).normalize();
			if (back.dot(toEye) > 0.2) this.renderView();
		}
		if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt); this.screen.material.color.setScalar(this.flash > 0 ? 3 : 1); }
		for (const p of [...this.prints]) {
			p.t += dt;
			const up = Math.min(1, p.t / 0.3), back = Math.max(0, (p.t - 1.3) / 0.5);
			p.m.position.y = 0.035 + 0.05 * up * (1 - back);
			p.m.scale.setScalar(Math.max(0.01, 1 - back));
			if (back >= 1) { p.m.removeFromParent(); p.m.geometry.dispose(); p.m.material.dispose(); p.tex.dispose(); p.bmp.close?.(); this.prints.splice(this.prints.indexOf(p), 1); }
		}
	}

	/** Removes the prints (the camera went back to the fan: they never stay floating there). */
	clearPrints() {
		for (const p of this.prints) { p.m.removeFromParent(); p.m.geometry.dispose(); p.m.material.dispose(); p.tex.dispose(); p.bmp.close?.(); }
		this.prints.length = 0;
	}

	/**
	 * Builds the drawing programs the viewfinder and the photo need, once, behind
	 * the fade when VR starts: drawing into an image uses other program variants
	 * than the headset's view, and building them on the first shot froze for
	 * about 0.2 s (the tester's measurement).
	 */
	warm() {
		const r = this.xr.renderer;
		if (!this.target || !r.compile || this.warmed) return;
		this.warmed = true;
		const halfFloat = r.extensions?.has?.('EXT_color_buffer_half_float') || r.extensions?.has?.('EXT_color_buffer_float');
		const photo = new THREE.WebGLRenderTarget(4, 4, { type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
		const previous = r.getRenderTarget();
		try {
			for (const t of [this.target, photo]) { r.setRenderTarget(t); r.compile(this.xr.scene, this.view); }
		} catch (e) { console.warn('Camera warm-up skipped', e); } finally {
			r.setRenderTarget(previous);
			photo.dispose();
		}
	}

	/** Draws the view through the lens into the viewfinder (the interface hidden, as in photos). */
	renderView() {
		const xr = this.xr, r = xr.renderer;
		this.frames = (this.frames ?? 0) + 1; // (counted for the tests)
		this.lensPoint.updateMatrixWorld(true);
		this.view.matrixWorld.copy(this.lensPoint.matrixWorld).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
		this.view.matrixWorld.decompose(this.view.position, this.view.quaternion, this.view.scale);
		this.view.updateMatrixWorld(true);
		xr.markInterface(); // (the viewfinder's camera shows the default layer only: no interface, the camera itself included)
		const xrOn = r.xr.enabled, previous = r.getRenderTarget();
		try {
			r.xr.enabled = false;
			xr.portals?.hide(); // (the viewfinder shows the walls whole)
			r.setRenderTarget(this.target);
			r.clear();
			r.render(xr.scene, this.view);
		} finally {
			xr.portals?.show();
			r.setRenderTarget(previous);
			r.xr.enabled = xrOn;
		}
	}
}

/** The camera's instruction: one short hand-lettered line in the orange of the thing to press. */
function makeHint() {
	const { canvas, texture } = canvasTexture(512, 64);
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.00625), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
	mesh.name = 'camera-hint';
	return {
		mesh,
		set(text) {
			if (!canvas) return;
			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, 512, 64);
			ctx.fillStyle = COLOURS.primary; ctx.font = `700 46px ${GUIDE.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText(text, 256, 34);
			texture.needsUpdate = true;
		},
	};
}

/** A small canvas label (the lens, on the viewfinder). */
function makeLabel() {
	const { canvas, texture } = canvasTexture(128, 48, { anisotropy: 1 });
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.006), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
	mesh.name = 'lens-label';
	return {
		mesh,
		set(text) {
			if (!canvas) return;
			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, 128, 48);
			ctx.fillStyle = 'rgba(29,35,41,0.7)';
			ctx.beginPath(); ctx.roundRect(0, 0, 128, 48, 12); ctx.fill();
			ctx.fillStyle = COLOURS.cell; ctx.font = `600 28px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText(text, 64, 25);
			texture.needsUpdate = true;
		},
	};
}
