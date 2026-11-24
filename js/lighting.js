// Lights, time of day and shadows (SPEC.md, "Performance").
//
// One hemisphere light and one directional light (the sun, or the moon at
// night). The sun's direction comes from the home's compass (north direction
// and latitude) for a spring/autumn day (equinox), so morning light comes in
// through the east-facing windows.
//
// Shadows are optional and off by default. The scene only moves when the
// dollhouse is moved, so the shadow map is rendered once and again only
// when something changes (shadowMap.autoUpdate = false): at walking time it
// costs one texture lookup per pixel, not a second render of the house.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TIMES = ['morning', 'noon', 'sunset', 'night'];
export const DEFAULT_TIME = 'morning'; // on the page and in the headset, until the user picks another
const DEG = Math.PI / 180;
const SHADOW_SIZE = 2048;

// Colours and strengths per time of day. Morning is the default.
// sky/ground: hemisphere light; top/horizon: sky dome gradient (null = the home's sky colour).
const PRESETS = {
	// Calm and true to the file's colours (the Graphic Designer's values, 25 Nov 2026, after a beta
	// tester found colours oversaturated: the old warm morning, orange sunset and dark shade were the
	// cause). Near-white light; more and paler sky fill, so shade lifts and whites stay white.
	morning: { hourAngle: -45 * DEG, sun: 0xfff9f2, sunI: 1.3, sky: 0xf3f5f8, ground: 0xd5d2cc, hemiI: 2.55, top: 0xa9c6e6, horizon: 0xf6f2ea },
	noon: { hourAngle: 0, sun: 0xffffff, sunI: 1.25, sky: 0xffffff, ground: 0xd2cfc8, hemiI: 2.45, top: null, horizon: 0xf5f7f9 },
	// Sunset: still evening (a low peach sun, a dimmer room, the lamps on), no longer orange.
	sunset: { elevation: 5 * DEG, sun: 0xffe0c4, sunI: 1.5, sky: 0xf8efe6, ground: 0xc2b8ae, hemiI: 2.3, top: 0x8494c4, horizon: 0xf6cfae },
	// Night: a dim, soft moon and a warm fill, as if the lamps were on.
	night: { hourAngle: 0, elevation: 35 * DEG, sun: 0xc4d0f4, sunI: 0.35, sky: 0xfaf0e2, ground: 0x6a645e, hemiI: 1.15, top: 0x0a1222, horizon: 0x223150 },
};

/**
 * Sun elevation and azimuth (radians; azimuth from north, clockwise) for a
 * latitude and solar hour angle (0 = solar noon, negative = morning).
 */
export function sunAngles(latitude, hourAngle, declination = 0) {
	const sinE = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
	const elevation = Math.asin(THREE.MathUtils.clamp(sinE, -1, 1));
	const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(declination) * Math.cos(latitude) - Math.sin(latitude) * Math.cos(hourAngle));
	return { elevation, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) };
}

/** Afternoon hour angle at which the sun is at `elevation` (or noon if it never gets that low). */
export function hourAngleAt(latitude, elevation, declination = 0) {
	const c = (Math.sin(elevation) - Math.sin(latitude) * Math.sin(declination)) / (Math.cos(latitude) * Math.cos(declination));
	return Math.acos(THREE.MathUtils.clamp(c, -1, 1));
}

/**
 * Unit vector towards the sun (or moon) in model space for a time of day.
 * Plan axes: x right, y down the page; in 3D, plan (x, y) is (x, z) and y is
 * up. compass.northDirection turns plan "up" clockwise to north.
 */
export function sunDirection(compass, time) {
	const p = PRESETS[time] || PRESETS.noon;
	const lat = compass?.latitude ?? Math.PI / 4;
	const hour = p.elevation !== undefined && p.hourAngle === undefined ? hourAngleAt(lat, p.elevation) : p.hourAngle;
	let { elevation, azimuth } = sunAngles(lat, hour);
	if (p.elevation !== undefined) elevation = p.elevation;
	const n = compass?.northDirection ?? 0;
	const north = new THREE.Vector3(Math.sin(n), 0, -Math.cos(n));
	const east = new THREE.Vector3(Math.cos(n), 0, Math.sin(n));
	return north.multiplyScalar(Math.cos(azimuth)).addScaledVector(east, Math.sin(azimuth))
		.multiplyScalar(Math.cos(elevation)).add(new THREE.Vector3(0, Math.sin(elevation), 0)).normalize();
}

const CEILING_LIFT = 0.22; // ceilings: this much of their own colour added as emission (lifts the muddy taupe)

export class Lighting {
	constructor(scene, renderer) {
		this.scene = scene;
		this.renderer = renderer;
		this.hemi = new THREE.HemisphereLight(0xffffff, 0xb4b0a8, 2.2);
		this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
		this.sun.target = new THREE.Object3D();
		this.sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
		scene.add(this.hemi, this.sun, this.sun.target);
		renderer.shadowMap.type = THREE.PCFShadowMap;
		renderer.shadowMap.autoUpdate = false; // rendered on demand: see fit()
		this.time = DEFAULT_TIME;
		this.shadows = false;
		this.compass = null;
		this.homeSky = 0xcce4fc;
		this.subject = null; // { object, box }: what the sun follows and the shadow covers
		this.onChange = null;
		this.apply();
	}

	/** The home's compass and sky colour. */
	setHome({ compass, skyColor }) {
		this.compass = compass || null;
		this.homeSky = skyColor ?? 0xcce4fc;
		this.apply();
	}

	/**
	 * Glowing bulbs for the home's light pieces (from sh3d.js: position and
	 * radius in metres, storey). Returns a group to add to the model, or null.
	 * Each storey gets two meshes: bright cores and soft additive halos. They
	 * show at sunset and at night; no real light sources are added, which a
	 * Quest 2 could not afford.
	 */
	setLamps(lamps) {
		this.lamps = null;
		if (!lamps?.length) return null;
		const group = new THREE.Group();
		group.name = 'lamps';
		const core = new THREE.MeshBasicMaterial({ color: 0xfff3d6 });
		// The halo: a soft glow, brightest at its middle and fading to nothing at its edge (no
		// hard-edged ball), smaller than before (at eye level the glows read too large: the
		// user's Quest 2 note), and gone from inside it (front faces only).
		const halo = new THREE.ShaderMaterial({
			uniforms: { color: { value: new THREE.Color(0xffb968) }, strength: { value: 0.55 } },
			vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 p = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }',
			fragmentShader: 'uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV; void main() { float f = max(dot(normalize(vN), normalize(vV)), 0.0); gl_FragColor = vec4(color * pow(f, 3.0) * strength, 1.0); }',
			transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
		});
		for (const storey of new Set(lamps.map((l) => l.storey))) {
			const mine = lamps.filter((l) => l.storey === storey);
			const spheres = (scale, min) => mergeGeometries(mine.map((l) => {
				const r = Math.max(l.radius * scale, min);
				return new THREE.SphereGeometry(r, 14, 10).translate(l.position.x, l.position.y, l.position.z);
			}));
			for (const [geo, mat, order] of [[spheres(1, 0.02), core, 0], [spheres(2.5, 0.07), halo, 2]]) {
				const m = new THREE.Mesh(geo, mat);
				m.userData.storey = storey;
				m.renderOrder = order;
				group.add(m);
			}
		}
		this.lamps = group;
		this.showLamps();
		return group;
	}

	showLamps() { if (this.lamps) this.lamps.visible = this.time === 'night' || this.time === 'sunset'; }

	/**
	 * Ceilings face down, so the sky light gives them its dull ground colour: at
	 * eye level they read a muddy taupe (the user's Quest 2 note). A small lift
	 * of their own (a little emission of their colour), on their own copy of
	 * the material, so walls and floors that share it don't change.
	 */
	liftCeilings(layer, amount = CEILING_LIFT) {
		if (!layer) return;
		const copies = new Map();
		layer.traverse((m) => {
			if (!m.isMesh) return;
			const lift = (mat) => {
				if (!mat?.emissive) return mat;
				if (!copies.has(mat)) {
					const c = mat.clone();
					c.emissive.copy(mat.color).multiplyScalar(amount);
					if (mat.map) c.emissiveMap = mat.map;
					c.userData = { ...mat.userData, ceilingLift: amount };
					copies.set(mat, c);
				}
				return copies.get(mat);
			};
			m.material = Array.isArray(m.material) ? m.material.map(lift) : lift(m.material);
		});
	}

	/** Something that casts shadows was shown or hidden: render the shadow map again. */
	refresh() {
		if (this._lastFit) this._lastFit.box = null;
		this.fit();
	}

	/** What to light: an object and a box in its local space (the model bounds). */
	setSubject(object, box) {
		this.subject = object && box ? { object, box } : null;
		this.fit();
	}

	setTime(time) {
		if (!PRESETS[time]) return;
		this.time = time;
		this.apply();
	}

	nextTime() { this.setTime(TIMES[(TIMES.indexOf(this.time) + 1) % TIMES.length]); }

	setShadows(on) {
		on = !!on;
		if (on === this.shadows) return;
		this.shadows = on;
		this.renderer.shadowMap.enabled = on;
		this.sun.castShadow = on;
		// Materials compile differently with shadows: rebuild them once.
		this.scene.traverse((o) => {
			for (const m of [].concat(o.material || [])) m.needsUpdate = true;
		});
		this.apply();
	}

	apply() {
		const p = PRESETS[this.time];
		this.hemi.color.set(p.sky);
		this.hemi.groundColor.set(p.ground);
		// With shadows on, less fill light and more sun, so the shadows read.
		this.hemi.intensity = p.hemiI * (this.shadows ? 0.9 : 1);
		this.sun.color.set(p.sun);
		this.sun.intensity = p.sunI * (this.shadows ? 1.6 : 1);
		this.showLamps();
		this.fit();
		this.onChange?.();
	}

	/** Sky gradient for the current time: { top, horizon } colours. */
	skyColors() {
		const p = PRESETS[this.time];
		return { top: p.top ?? this.homeSky, horizon: p.horizon };
	}

	/** Plain background colour for the 2D view. */
	background() {
		const p = PRESETS[this.time];
		return new THREE.Color(p.top ?? this.homeSky).lerp(new THREE.Color(p.horizon), { noon: 0, morning: 0.35, sunset: 0.6, night: 0.2 }[this.time]);
	}

	/**
	 * Points the sun at the subject from the time-of-day direction (turning
	 * with the model, so the light keeps coming through the same windows),
	 * fits the shadow camera around it, and asks for one shadow render.
	 * Call whenever the model is moved, turned or scaled.
	 */
	fit() {
		const s = this.subject;
		if (!s) return;
		s.object.updateMatrixWorld(true);
		// Nothing moved and nothing changed: keep the current shadow map. This
		// runs every frame in the dollhouse, so it compares numbers in place
		// rather than building a string.
		const e = s.object.matrixWorld.elements;
		const last = (this._lastFit ||= { time: null, shadows: null, box: null, m: new Float64Array(16) });
		let same = last.time === this.time && last.shadows === this.shadows && last.box === s.box;
		for (let i = 0; same && i < 16; i++) same = last.m[i] === e[i];
		if (same) return;
		last.time = this.time; last.shadows = this.shadows; last.box = s.box;
		last.m.set(e);
		const sphere = s.box.clone().applyMatrix4(s.object.matrixWorld).getBoundingSphere(new THREE.Sphere());
		const r = Math.max(sphere.radius * 1.3, 0.05);
		const dir = sunDirection(this.compass, this.time).transformDirection(s.object.matrixWorld);
		this.sun.target.position.copy(sphere.center);
		this.sun.position.copy(sphere.center).addScaledVector(dir, r * 3);
		this.sun.target.updateMatrixWorld();
		this.sun.updateMatrixWorld();
		const cam = this.sun.shadow.camera;
		cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
		cam.near = r * 0.5; cam.far = r * 5;
		cam.updateProjectionMatrix();
		const texel = (2 * r) / SHADOW_SIZE;
		this.sun.shadow.normalBias = texel * 1.5; // world units: grows with the subject
		this.sun.shadow.bias = -0.0002;
		this.renderer.shadowMap.needsUpdate = true;
	}
}
