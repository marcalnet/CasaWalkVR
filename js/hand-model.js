// The hand model (C0.5): the generic hand of the WebXR Input Profiles (MIT,
// © 2019 Amazon; vendor/generic-hand/, never the CDN path three.js's
// XRHandMeshModel uses), dressed in CasaWalk's hand look: frosted paper
// white, a light rim, the thumb and index blue (about half of each), fading out behind the wrist. Its
// bones carry the 25 WebXR joint names, so posing it is copying each joint's
// pose into the bone of the same name (as XRHandMeshModel does). Two passes
// like js/hands.js's capsule hand (depth, then colour where the hand is the
// front surface). The capsule hand stays as the fallback behind
// theme.HAND.model ('generic' | 'capsules'), and while the files load.
//
// Also poses a hand from the preset poses of js/hand-poses.js: the looping
// demonstration hand of the first-time lessons.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { HAND } from './theme.js';

export const JOINT_NAMES = [
	'wrist',
	'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
	...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap((f) => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((p) => `${f}-${p}`)),
];

// How far the glow reaches down each pinching finger from its tip (m; about half the finger), and its soft edge.
const HAND_GLOW = { 'index-finger': { reach: 0.045, soft: 0.01 }, thumb: { reach: 0.038, soft: 0.01 } };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The hand look as a material: Lambert with the blue tip, the rim, and the fade at the wrist (vertex masks). */
export function handMaterial() {
	const m = new THREE.MeshLambertMaterial({
		color: HAND.fill, emissive: HAND.fill, emissiveIntensity: 0.35, transparent: true, opacity: HAND.opacity, depthWrite: false,
		// (LessEqual, not Equal: the two passes use different shaders; see js/hands.js.)
		depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide,
	});
	m.userData.uniforms = {
		tipColor: { value: new THREE.Color(HAND.tip) }, tipStrength: { value: HAND.tipIdle },
		rimColor: { value: new THREE.Color('#ffffff') }, rimStrength: { value: 0.55 },
	};
	m.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, m.userData.uniforms);
		sh.vertexShader = sh.vertexShader
			.replace('#include <common>', '#include <common>\nattribute float tip;\nattribute float fade;\nvarying float vTip;\nvarying float vFade;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTip = tip; vFade = fade;');
		sh.fragmentShader = sh.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform vec3 tipColor; uniform float tipStrength; uniform vec3 rimColor; uniform float rimStrength;\nvarying float vTip;\nvarying float vFade;')
			.replace('#include <color_fragment>', '#include <color_fragment>\nfloat tipK = vTip * tipStrength;\ndiffuseColor.rgb = mix(diffuseColor.rgb, tipColor, tipK);\ndiffuseColor.a = mix(diffuseColor.a, 1.0, tipK * 0.8) * vFade;')
			.replace('#include <opaque_fragment>', 'float rimK = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\noutgoingLight += rimColor * pow(rimK, 2.5) * rimStrength + tipColor * tipK * 0.3;\n#include <opaque_fragment>');
	};
	return m;
}

/**
 * Dresses a loaded generic-hand GLB in the hand look. Returns a group (put it
 * where the hand joints live: the rig) with userData { bones (by joint name),
 * pose(joints), setTip(0..1), setOpacity(a), triangles }.
 */
export function dressHand(gltf, handedness) {
	// (A copy each time: both hand views and the lessons' demonstration hand dress the same file.)
	const scene = clone(gltf.scene);
	const object = scene.getObjectByName('Armature') ?? scene;
	const source = object.getObjectByProperty('type', 'SkinnedMesh');
	const skeleton = source.skeleton;
	const geometry = source.geometry.clone();
	// The two masks the material reads: the pinching fingers' glow, and the fade behind the wrist.
	// The glow covers about half of the index and of the thumb, the same blue on both (the
	// user's decision after build 120: they are the teleport fingers; before, only the
	// index's last 1.5 cm).
	const bindPos = (name) => {
		const i = skeleton.bones.findIndex((b) => b.name === name);
		return new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[i].clone().invert());
	};
	const wristP = bindPos('wrist'), along = bindPos('middle-finger-metacarpal').sub(wristP).normalize();
	const pos = geometry.attributes.position, si = geometry.attributes.skinIndex, sw = geometry.attributes.skinWeight;
	const boneIds = (names) => new Set(names.map((n) => skeleton.bones.findIndex((b) => b.name === n)));
	const fingers = Object.entries(HAND_GLOW).map(([finger, g]) => ({
		...g, tipP: bindPos(`${finger}-tip`),
		bones: boneIds(['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((p) => `${finger}-${p}`)),
	}));
	const tip = new Float32Array(pos.count), fade = new Float32Array(pos.count), v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		for (const f of fingers) {
			let on = 0;
			for (let k = 0; k < 4; k++) if (f.bones.has(si.getComponent(i, k))) on += sw.getComponent(i, k);
			if (on > 0.5) tip[i] = Math.max(tip[i], 1 - smooth(f.reach - f.soft, f.reach, v.distanceTo(f.tipP)));
		}
		fade[i] = smooth(-0.028, -0.004, v.clone().sub(wristP).dot(along));
	}
	geometry.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
	geometry.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
	// Depth first (transparent, drawn with the hands, after the menus: see js/hands.js), then colour.
	const depth = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, transparent: true }));
	const colour = new THREE.SkinnedMesh(geometry, handMaterial());
	source.parent.add(depth, colour);
	source.removeFromParent();
	for (const [mesh, order] of [[depth, 30], [colour, 31]]) {
		mesh.bind(skeleton, source.bindMatrix);
		mesh.frustumCulled = false;
		mesh.renderOrder = order;
	}
	for (const o of object.children) if (!o.isBone && o !== depth && o !== colour) o.visible = false; // (the profile's other nodes)
	const group = new THREE.Group();
	group.name = `hand-model-${handedness}`;
	group.add(object);
	const bones = Object.fromEntries(skeleton.bones.map((b) => [b.name, b]));
	const u = colour.material.userData.uniforms;
	group.userData = {
		bones, colour, depth,
		/** joints: { name: { position, quaternion } } in the group's space (three.js's hand.joints). */
		pose: (joints) => {
			for (const n of JOINT_NAMES) {
				const j = joints[n], b = bones[n];
				if (!j || !b || j.visible === false) continue; // (a joint the headset does not report keeps its last pose: never a stray bone)
				b.position.copy(j.position);
				b.quaternion.copy(j.quaternion);
			}
		},
		setTip: (k) => { u.tipStrength.value = THREE.MathUtils.lerp(HAND.tipIdle, 1, k); },
		setOpacity: (a) => { colour.material.opacity = a; depth.visible = colour.visible = a > 0.01; },
		triangles: (geometry.index ? geometry.index.count : pos.count) / 3,
	};
	return group;
}

let loading = null;
/**
 * Loads both hands once (vendor/generic-hand/). Resolves to { left, right }
 * (GLTF results), or null when they can't be loaded (the capsules stay).
 */
export function loadHands() {
	if (loading) return loading;
	if (typeof document === 'undefined') return (loading = Promise.resolve(null)); // (Node tests: the capsules)
	const loader = new GLTFLoader();
	const one = (side) => new Promise((res, rej) => loader.load(`vendor/generic-hand/${side}.glb`, res, undefined, rej));
	loading = Promise.all([one('left'), one('right')]).then(([left, right]) => ({ left, right })).catch((e) => { console.warn('Hand model not loaded; capsules instead', e); return null; });
	return loading;
}

/** A right hand's pose from a left hand's (presets are left hands): the mirror image. */
export function mirrorPose(pose) {
	const S = [1, -1, -1, 0, -1, 1, 1, 0, -1, 1, 1, 0, -1, 1, 1, 1];
	return Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, { m: v.m.map((x, i) => x * S[i]), r: v.r }]));
}

/**
 * Joint poses ({ name: { position, quaternion } }) from a preset pose, or
 * between two (k 0..1), in the hand's own space.
 */
export function presetJoints(a, b = a, k = 0) {
	const out = {}, m = new THREE.Matrix4(), pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), s = new THREE.Vector3();
	for (const n of JOINT_NAMES) {
		if (!a[n] || !b[n]) continue;
		m.fromArray(a[n].m).decompose(pa, qa, s);
		m.fromArray(b[n].m).decompose(pb, qb, s);
		out[n] = { position: pa.clone().lerp(pb, k), quaternion: qa.clone().slerp(qb, k) };
	}
	return out;
}
