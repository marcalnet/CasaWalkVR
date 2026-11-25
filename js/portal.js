// The wall portal (planning: the UX design of 24 Nov 2026, approved by the
// user; SPEC.md, walk mode): a round window that fades open in a wall or a
// closed door where you touch it, so you can peek into the next room.
//
//   Hand portal  an index fingertip (or a controller's tip) within 3 cm in
//                front of a wall or door, or behind its surface, opens a
//                circle there: 0.35 m radius over 0.25 s (ease-out), following
//                the fingertip along the wall (smoothed 0.1 s). It closes over
//                0.4 s once the fingertip is more than 15 cm from the surface.
//                Each hand opens its own (two at most).
//                Never with Solid walls on (a window on a room you can't walk
//                into would be a lie): a touch gives a small ring and a tick
//                instead. Never from a hand holding a tool, or one at a key,
//                the open board or the fan. A soft `portal` sound on opening;
//                closing is silent.
//   Eye portal   the eyes within 0.30 m of a wall or door open a circle round
//                the point of it nearest the eyes, growing with closeness
//                (eased in): 0 at 0.30 m, 0.40 m radius at 0.20 m and closer,
//                so the near plane never cuts the wall in a hard edge. It
//                follows the head (no tween), is silent, and is set at once
//                behind a teleport's fade. Not needed with Solid walls on (the
//                body stops 0.2 m from walls).
//
// How it is drawn: one small shader chunk on the wall and opening materials
// (no extra draw calls, one shader variant), chained after the depth-shading
// hook (js/depth.js). Each portal is a vec4 uniform (centre, radius), shared by
// every hooked material and updated in place once a frame. The cut is a
// sphere whose centre is pushed 0.1 m into the wall, so the hole goes right
// through it; the last 8 cm of the radius fade (alpha-to-coverage, 4x MSAA)
// and a faint 1 cm rim marks the edge. Floors, ceilings, furniture and the
// ground are never cut. Photos and the street camera's viewfinder see the
// walls whole (hide() around their draws). Lasers, the arc and Solid walls
// still meet the wall: the portal is only drawn.

import * as THREE from 'three';
import { ease } from './tween.js';
import { PORTAL as LOOK } from './theme.js';
import { isOpening } from './optimise.js';

export const PORTAL = {
	INSET: 0.1, // the cut sphere's centre this far into the wall (m)
	SOFT: 0.08, // the soft edge's width (m); 0: the hard-cut fallback
	RIM: 0.01, // the rim line's width (m)
	HAND_R: 0.35, HAND_OPEN: 0.25, HAND_CLOSE: 0.4, // radius (m), opening and closing (s)
	TOUCH: 0.03, LEAVE: 0.15, // a fingertip opens it this close (m), and lets go this far
	FOLLOW: 0.1, // seconds: the centre's smoothing
	EYE_OPEN: 0.3, EYE_FULL: 0.2, EYE_R: 0.4, // the eyes this close start it (m), fully open this close, its radius
	TICK_EVERY: 1, // seconds: a touch's vibration at most this often
	RING_TIME: 0.3, // seconds: the Solid walls touch ring
};

/** The uniforms every hooked material shares (one object: updated in place). */
export function portalUniforms() {
	return {
		cwPortalHand: { value: new THREE.Vector4(0, 0, 0, 0) },
		cwPortalHand2: { value: new THREE.Vector4(0, 0, 0, 0) }, // the other hand's own portal
		cwPortalEye: { value: new THREE.Vector4(0, 0, 0, 0) },
		cwPortalRim: { value: new THREE.Color(LOOK.rim) },
		cwPortalLook: { value: new THREE.Vector4(PORTAL.SOFT, PORTAL.RIM, LOOK.rimStrength, PORTAL.INSET) }, // soft edge, rim width, rim strength, inset
	};
}

const VERTEX_HEAD = 'varying vec3 vCwWorld;';
const VERTEX_BODY = 'vCwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;';
const FRAGMENT_HEAD = `uniform vec4 cwPortalHand;
uniform vec4 cwPortalHand2;
uniform vec4 cwPortalEye;
uniform vec3 cwPortalRim;
uniform vec4 cwPortalLook;
varying vec3 vCwWorld;
// Distance along the wall's surface from a portal's middle (its centre is cwPortalLook.w inside the wall).
float cwPortalRho(vec4 p) { vec3 d = vCwWorld - p.xyz; return sqrt(max(dot(d, d) - cwPortalLook.w * cwPortalLook.w, 0.0)); }
// How open the wall is here: 1 inside a portal, 0 outside, soft over the edge (hard with no soft edge).
float cwPortalOpen(vec4 p) {
	if (p.w <= 0.0) return 0.0;
	float rho = cwPortalRho(p);
	return cwPortalLook.x > 0.0 ? 1.0 - smoothstep(p.w - cwPortalLook.x, p.w, rho) : step(rho, p.w);
}
// The rim: a thin line where the edge is half open (just outside a hard cut).
float cwPortalRimAt(vec4 p) {
	if (p.w <= 0.0) return 0.0;
	float at = cwPortalLook.x > 0.0 ? p.w - 0.5 * cwPortalLook.x : p.w + 0.5 * cwPortalLook.y;
	return 1.0 - smoothstep(0.0, 0.5 * cwPortalLook.y, abs(cwPortalRho(p) - at));
}`;
const FRAGMENT_CUT = 'float cwOpen = max(max(cwPortalOpen(cwPortalHand), cwPortalOpen(cwPortalHand2)), cwPortalOpen(cwPortalEye));\nif (cwOpen > 0.999) discard;';
const FRAGMENT_EDGE = `float cwRim = max(max(cwPortalRimAt(cwPortalHand), cwPortalRimAt(cwPortalHand2)), cwPortalRimAt(cwPortalEye)) * cwPortalLook.z;
gl_FragColor.rgb = mix(gl_FragColor.rgb, cwPortalRim, cwRim);
gl_FragColor.a *= max(1.0 - cwOpen, cwRim);`;

/**
 * Adds the portal cut to a material's shader, after whatever hook it already
 * has (the depth shading). `uniforms`: portalUniforms(). Returns the shader
 * text changes as a pure function too (portalShader), for the tests.
 */
export function hookPortal(material, uniforms) {
	const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
	material.onBeforeCompile = (shader, renderer) => {
		prev?.call(material, shader, renderer);
		portalShader(shader, uniforms);
	};
	const key = prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : '';
	material.customProgramCacheKey = () => `${key}-cw-portal`;
	// The soft edge: alpha-to-coverage on opaque walls (the XR framebuffer has 4x MSAA).
	if (!material.transparent && material.colorWrite !== false) material.alphaToCoverage = true;
	material.needsUpdate = true;
}

/** The shader changes (pure: a { uniforms, vertexShader, fragmentShader } in, the same out). */
export function portalShader(shader, uniforms) {
	Object.assign(shader.uniforms, uniforms);
	shader.vertexShader = shader.vertexShader
		.replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
		.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
	shader.fragmentShader = shader.fragmentShader
		.replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
		.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_CUT}`)
		.replace(/(\n\s*)(#include <(?:tonemapping|colorspace)_fragment>)/, `$1${FRAGMENT_EDGE}$1$2`);
	return shader;
}

/**
 * The hand portal's radius over time (pure): opening from `from` to HAND_R
 * over HAND_OPEN with an ease-out, closing to 0 over HAND_CLOSE.
 */
export function handRadius(open, from, t) {
	const P = PORTAL;
	if (open) return from + (P.HAND_R - from) * ease.out(Math.min(1, t / (P.HAND_OPEN * Math.max(0.05, 1 - from / P.HAND_R))));
	return from * (1 - ease.inOut(Math.min(1, t / P.HAND_CLOSE)));
}

/** How open the eye portal is (0..1) with the eyes `d` metres from a wall: eased in from EYE_OPEN, full at EYE_FULL. */
export function eyeOpening(d) {
	const t = THREE.MathUtils.clamp((PORTAL.EYE_OPEN - d) / (PORTAL.EYE_OPEN - PORTAL.EYE_FULL), 0, 1);
	return t * t;
}

const _p = new THREE.Vector3(), _m = new THREE.Matrix4(), _tri = new THREE.Triangle();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * The nearest point of `meshes` (each with a BVH) to world point `world`,
 * within `max` metres: { point, normal (world, the face's outward side),
 * distance, behind (the point is behind that face: inside the wall) } in
 * `out`, or null.
 */
export function nearestSurface(meshes, world, max, out) {
	let best = null;
	for (const mesh of meshes) {
		const g = mesh.geometry, bvh = g?.boundsTree;
		if (!bvh || !mesh.visible || !mesh.parent?.visible) continue;
		mesh.updateWorldMatrix(true, false);
		const scale = mesh.matrixWorld.getMaxScaleOnAxis();
		_p.copy(world).applyMatrix4(_m.copy(mesh.matrixWorld).invert());
		if (!g.boundingBox) g.computeBoundingBox();
		if (g.boundingBox.distanceToPoint(_p) * scale > max) continue;
		const hit = bvh.closestPointToPoint(_p, {}, 0, (best ? best.distance : max) / scale);
		if (!hit) continue;
		const d = hit.distance * scale;
		if (best && d >= best.distance) continue;
		const ix = g.index, i = hit.faceIndex * 3, pos = g.attributes.position;
		const at = (k) => (ix ? ix.getX(i + k) : i + k);
		_tri.set(_a.fromBufferAttribute(pos, at(0)), _b.fromBufferAttribute(pos, at(1)), _c.fromBufferAttribute(pos, at(2)));
		best = out;
		best.point.copy(hit.point).applyMatrix4(mesh.matrixWorld);
		_tri.getNormal(best.normal).transformDirection(mesh.matrixWorld);
		best.distance = d;
		best.mesh = mesh;
	}
	if (best) best.behind = _p.subVectors(world, best.point).dot(best.normal) < 0;
	return best;
}

export class Portals {
	constructor() {
		this.uniforms = portalUniforms();
		this.meshes = []; // walls and openings: what the portals cut and look for
		this.hooked = new WeakSet();
		this.layers = null;
		this.prepared = false;
		// Two hand portals, one for each hand that touches a wall (the first to touch takes the first).
		const state = () => ({ c: null, open: false, from: 0, t: 0, radius: 0, centre: new THREE.Vector3(), target: new THREE.Vector3() });
		this.hands = [state(), state()];
		this.hand = this.hands[0];
		this.touching = new Map(); // controller entry -> true while its tip touches a wall (with the LEAVE hysteresis)
		this.lastTick = -Infinity;
		this.clock = 0;
		this._s = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, mesh: null, behind: false };
		this._e = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, mesh: null, behind: false };
		this._head = new THREE.Vector3();
		this.ring = null;
		this.hidden = 0;
	}

	/**
	 * A new model: the walls and the openings (doors, windows). Their
	 * materials are hooked at prepare() (the session's start), after the depth
	 * shading has hooked them; an opening's material shared with anything that
	 * is not cut (furniture, a floor) gets its own copy first.
	 */
	setModel(layers) {
		this.layers = layers;
		this.prepared = false;
		this.reset();
		const walls = [], openings = [];
		for (const m of collect(layers?.walls)) walls.push(m);
		for (const m of collect(layers?.main)) if (isOpening(m)) openings.push(m);
		this.meshes = [...walls, ...openings];
	}

	/** Hooks the walls' and openings' materials (once per model; call at the session's start). */
	prepare(seeThrough = null) {
		if (this.prepared || !this.layers) return;
		this.prepared = true;
		const cut = new Set(this.meshes);
		const other = new Set();
		for (const layer of Object.values(this.layers)) for (const m of collect(layer)) if (!cut.has(m)) for (const mat of [].concat(m.material)) other.add(mat);
		const copies = new Map();
		const own = (mat) => {
			if (!other.has(mat)) return mat;
			if (!copies.has(mat)) {
				const c = mat.clone();
				c.onBeforeCompile = mat.onBeforeCompile; // (the depth shading's hook)
				c.customProgramCacheKey = mat.customProgramCacheKey;
				copies.set(mat, c);
			}
			return copies.get(mat);
		};
		for (const m of this.meshes) {
			m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
			for (const mat of [].concat(m.material)) this.hook(mat);
		}
		// The Transparent walls depth pass takes the same cut, so the rooms beyond show through the hole.
		if (seeThrough?.depthMat) this.hook(seeThrough.depthMat);
	}

	hook(mat) {
		if (this.hooked.has(mat)) return;
		this.hooked.add(mat);
		hookPortal(mat, this.uniforms);
	}

	/**
	 * The portals open right now, for the teleport arc: [{ x, y, z, w }] (centre
	 * and radius, world), and the set of meshes they cut. An arc passes through
	 * a hole in a wall as the eyes do (a fingertip's portal: build 111's test).
	 */
	holes() {
		const out = this._holes ??= [];
		out.length = 0;
		for (const u of [this.uniforms.cwPortalHand.value, this.uniforms.cwPortalHand2.value, this.uniforms.cwPortalEye.value]) if (u.w > 0.05) out.push(u);
		return out;
	}

	/** The meshes a portal cuts (walls and openings), as a Set. */
	get cutSet() {
		if (this._cutFor !== this.meshes) { this._cut = new Set(this.meshes); this._cutFor = this.meshes; }
		return this._cut;
	}

	/** Every portal shut at once (leaving walk mode). */
	reset() {
		this.resetHand();
		this.uniforms.cwPortalEye.value.w = 0;
		if (this.ring) this.ring.visible = false;
	}

	/** The hand portal shut at once (a jump: never carried across). */
	resetHand() {
		for (const h of this.hands) { h.c = null; h.open = false; h.from = 0; h.t = 0; h.radius = 0; }
		this.touching.clear();
		this.uniforms.cwPortalHand.value.w = this.uniforms.cwPortalHand2.value.w = 0;
	}

	/** The walls whole for one draw (a photo, the viewfinder): call show() after. */
	hide() {
		if (this.hidden++ === 0) { this._hw = this.uniforms.cwPortalHand.value.w; this._h2 = this.uniforms.cwPortalHand2.value.w; this._ew = this.uniforms.cwPortalEye.value.w; this.uniforms.cwPortalHand.value.w = this.uniforms.cwPortalHand2.value.w = this.uniforms.cwPortalEye.value.w = 0; }
	}

	show() {
		if (this.hidden > 0 && --this.hidden === 0) { this.uniforms.cwPortalHand.value.w = this._hw; this.uniforms.cwPortalHand2.value.w = this._h2; this.uniforms.cwPortalEye.value.w = this._ew; }
	}

	/**
	 * Once a frame. `xr`: the experience (mode, input, tools, solid, sound,
	 * haptics, aimBlock). Portals open only while walking (inside, at 1:1).
	 */
	update(xr, dt) {
		this.xr = xr;
		this.clock += dt;
		if (this.hidden) return;
		if (xr.mode !== 'walk' || !this.meshes.length) { if (this.hands.some((h) => h.radius || h.c) || this.touching.size || this.uniforms.cwPortalEye.value.w) this.reset(); return; }
		this.prepare(xr.seeThrough);
		// A jump (the teleport's fade, a layer change): the hand portal shuts at
		// once; the eye portal is set for the new head position behind the fade.
		if (xr.modes.walk?.fade || xr.layerFx) { if (this.hands.some((h) => h.radius || h.c)) this.resetHand(); }
		else this.updateHand(xr, dt);
		this.updateEye(xr);
		this.updateRing(dt);
	}

	updateHand(xr, dt) {
		const P = PORTAL, hs = this.hands, sc = this._s;
		const firsts = []; // hands that have just touched a wall this frame
		for (const c of xr.input.controllers) {
			const tip = c.touch?.tracked ? c.touch.tip : null;
			// (A hand holding a tool, or at a key, the board or the fan, never opens one.)
			const free = tip && !xr.aimBlock(c, tip);
			const near = free ? nearestSurface(this.meshes, tip, P.LEAVE, sc) : null;
			const was = this.touching.get(c) ?? false;
			const now = !!near && (near.behind || near.distance < (was ? P.LEAVE : P.TOUCH));
			if (now) this.touching.set(c, true); else this.touching.delete(c);
			const mine = hs.find((h) => h.c === c);
			if (now && mine) mine.target.copy(near.point).addScaledVector(near.normal, -P.INSET);
			if (now && !was) {
				// A first touch: the vibration (at most once a second), and the portal or, with Solid walls, the ring.
				if (c.isController && this.clock - this.lastTick > P.TICK_EVERY) { xr.haptics?.play(c, 'tick'); this.lastTick = this.clock; }
				if (xr.solid) { xr.sound?.play('tick'); this.showRing(near.point, near.normal); }
				else if (!mine) firsts.push({ c, point: near.point.clone(), normal: near.normal.clone() });
			}
		}
		for (const h of hs) if (h.c && !this.touching.has(h.c)) { h.c = null; h.open = false; h.from = h.radius; h.t = 0; } // let go: it closes
		for (const h of hs) if (xr.solid && h.radius) { h.c = null; h.open = false; h.radius = 0; }
		if (!xr.solid) for (const first of firsts) {
			// The hand's own portal: a free one (preferring one fully shut), else none.
			const h = hs.find((x) => !x.c && x.radius === 0) ?? hs.find((x) => !x.c);
			if (!h) break;
			const target = first.point.addScaledVector(first.normal, -P.INSET);
			// A new touch far from a closing portal starts afresh there; near it, it reopens from where it is.
			if (h.radius > 0 && h.centre.distanceTo(target) > P.HAND_R) h.radius = 0;
			if (h.radius === 0) h.centre.copy(target);
			h.target.copy(target);
			h.c = first.c; h.open = true; h.from = h.radius; h.t = 0;
			xr.sound?.play('portal');
		}
		hs.forEach((h, i) => {
			h.t += dt;
			if (h.c) h.centre.lerp(h.target, 1 - Math.exp(-dt / P.FOLLOW));
			h.radius = h.open || h.from > 0 ? handRadius(h.open, h.from, h.t) : 0;
			if (!h.open && h.t >= P.HAND_CLOSE) { h.radius = 0; h.from = 0; }
			(i ? this.uniforms.cwPortalHand2 : this.uniforms.cwPortalHand).value.set(h.centre.x, h.centre.y, h.centre.z, h.radius);
		});
	}

	/** The eye portal: its size from how close the eyes are to a wall (no tween: it follows the head). */
	updateEye(xr) {
		const P = PORTAL, u = this.uniforms.cwPortalEye.value;
		if (xr.solid) { u.w = 0; return; }
		xr.rig.updateMatrixWorld(true);
		const head = this._head.setFromMatrixPosition(xr.camera.matrix).applyMatrix4(xr.rig.matrixWorld);
		const s = nearestSurface(this.meshes, head, P.EYE_OPEN, this._e);
		const k = s ? eyeOpening(s.behind ? 0 : s.distance) : 0;
		if (!k) { u.w = 0; return; }
		u.set(s.point.x - s.normal.x * P.INSET, s.point.y - s.normal.y * P.INSET, s.point.z - s.normal.z * P.INSET, P.EYE_R * k);
	}

	/** Solid walls on: a small soft ring on the surface where a fingertip touched (0.3 s). */
	showRing(point, normal) {
		if (!this.ring) {
			this.ring = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.02, 32), new THREE.MeshBasicMaterial({ color: LOOK.rim, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
			this.ring.name = 'portal-touch-ring';
			this.ring.raycast = () => {};
			this.ring.visible = false;
		}
		if (this.ring.parent !== this.xr.scene) { this.xr.scene.add(this.ring); this.xr.hideFromPhotos?.(this.ring); }
		this.ring.position.copy(point).addScaledVector(normal, 0.002);
		this.ring.quaternion.setFromUnitVectors(_a.set(0, 0, 1), normal);
		this.ring.visible = true;
		this.ringT = 0;
	}

	updateRing(dt) {
		if (!this.ring?.visible) return;
		this.ringT += dt;
		const k = this.ringT / PORTAL.RING_TIME;
		this.ring.scale.setScalar(1 + k);
		this.ring.material.opacity = LOOK.rimStrength * 2 * (1 - k);
		if (k >= 1) this.ring.visible = false;
	}
}

/** The meshes of a layer (merged: its children; ?nomerge: any depth). */
function collect(layer) {
	const out = [];
	layer?.traverse((m) => { if (m.isMesh && m.material) out.push(m); });
	return out;
}
