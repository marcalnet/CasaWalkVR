// The real controller in each hand (next-build asks §6): the WebXR Input
// Profiles' model for the device (vendor/controllers/: Quest 2, Quest 3/3S,
// Quest Pro), its trigger, grip, stick and buttons moving with the real ones.
//
// Made cheap for the Quest 2 (CLAUDE.md): one draw call per controller. The
// model's parts (the body, the trigger, the stick...) are merged into one
// skinned mesh whose bones are the parts' places, so the buttons still move
// as the profile says (motion-controllers' visual responses move the nodes;
// each part's vertices follow its node). Lambert, keeping the texture, with
// an emissive floor so it stays readable at Night. On the interface layer
// (the grip it hangs on is hidden from photos: XRExperience.hideFromPhotos).
//
// The look (setLook): faded to 35% while it holds a tool (the tool reads as the
// thing in your hand), the tool's buttons lit with a faint orange glow;
// gone (in 0.2 s) when it is put down and a bare
// hand takes over. A device with none of the three profiles keeps the plain
// bars (js/xr-input.js): only those three are vendored.
//
// The touch point (measureTip): where the laser's line (the target ray, from
// WebXR) leaves the front of the model, measured once per profile and hand,
// so touching a key with the controller's nose presses exactly there.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fetchProfile, MotionController, Constants } from 'three/addons/libs/motion-controllers.module.js';
import { CONTROLLER } from './theme.js';

export const CONTROLLERS_PATH = 'vendor/controllers';
export const LOOK = {
	FADED: 0.35, // opacity while it holds a tool
	EMISSIVE: 0.3, // the texture's own glow: readable at Night
	TINT: 0.22, // the tool's buttons: this much of the theme's orange (CONTROLLER.glow), as glow
	FADE: 0.2, // seconds for a full change of opacity (put down, picked up, a tool taken)
};
// The gamepad's buttons (xr-input's names) by their xr-standard index: which part of the model is which button.
const BUTTON_INDEX = { trigger: 0, grip: 1, stickPress: 3, a: 4, b: 5 };
const TIP_CAST = 0.25; // metres ahead of the ray's origin the nose is looked for, back along the line
const TIP_FAR = 0.15; // a nose further than this from the ray's origin is not believed (the default stays)

const built = new Map(); // `${profileId}/${handedness}` -> { root, mesh, probe, parts }, built once
const tips = new Map(); // the same key -> the measured touch point (grip space), or null if none was found
let loader = null;

/**
 * Loads the model for an XRInputSource. Resolves to a ControllerModel, or null
 * when the device has no vendored profile or the model can't load (the bars stay).
 */
export async function loadControllerModel(source) {
	let profile, assetPath;
	try {
		({ profile, assetPath } = await fetchProfile(source, CONTROLLERS_PATH));
	} catch { return null; } // (not one of the three: the bars stay)
	const key = `${profile.profileId}/${source.handedness}`;
	let b = built.get(key);
	if (!b) {
		try {
			loader ??= new GLTFLoader();
			const gltf = await loader.loadAsync(assetPath);
			b = buildControllerModel(gltf.scene);
		} catch (e) {
			console.warn('Controller model did not load', e);
			return null;
		}
		built.set(key, b);
	}
	return new ControllerModel(key, b, new MotionController(source, profile, assetPath));
}

/**
 * Turns a profile's glTF scene into one skinned mesh (pure three.js, Node-tested).
 * Every mesh becomes a bone in its place (an Object3D with its name), so the
 * profile's nodes still move the parts; the meshes' geometries, in the model's
 * space, are merged with each vertex bound to its part. Returns
 * { root, mesh, probe (the same geometry, still, for measuring), parts: [{ bone, start, count }] }.
 */
export function buildControllerModel(scene) {
	const root = scene;
	root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1);
	root.updateMatrixWorld(true);
	const meshes = [];
	root.traverse((o) => { if (o.isMesh) meshes.push(o); });
	let map = null;
	const geos = [], parts = [], bones = [];
	let start = 0;
	for (const m of meshes) {
		map ??= m.material?.map ?? null;
		const src = m.geometry;
		const g = new THREE.BufferGeometry();
		g.setIndex(src.index ? src.index.clone() : null);
		g.setAttribute('position', src.attributes.position.clone());
		if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone()); else g.computeVertexNormals();
		const n = g.attributes.position.count;
		g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
		g.applyMatrix4(m.matrixWorld);
		const i = bones.length;
		g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).fill(0).map((_, k) => (k % 4 === 0 ? i : 0)), 4));
		g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), 4));
		g.setAttribute('tint', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
		geos.push(g);
		// The mesh's place becomes a bone: same name, same transform, same children.
		const bone = new THREE.Object3D();
		bone.name = m.name;
		bone.position.copy(m.position); bone.quaternion.copy(m.quaternion); bone.scale.copy(m.scale);
		m.parent.add(bone);
		for (const c of [...m.children]) bone.add(c);
		m.removeFromParent();
		bones.push(bone);
		parts.push({ bone, start, count: n });
		start += n;
	}
	for (const m of meshes) m.geometry.dispose();
	const geometry = mergeGeometries(geos);
	for (const g of geos) g.dispose();
	const material = controllerMaterial(map);
	const mesh = new THREE.SkinnedMesh(geometry, material);
	mesh.name = 'controller-model';
	mesh.frustumCulled = false; // (small, always near the eyes; its bounds move with the buttons)
	root.add(mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton(bones)); // (the root at rest, at the origin: each part's rest place is its bone's inverse)
	const probe = new THREE.Mesh(geometry); // (the still model, for the touch point's one measurement; never drawn)
	return { root, mesh, probe, parts };
}

/** Lambert with the texture, an emissive floor, and a per-vertex glow (the tool's buttons). */
function controllerMaterial(map) {
	const material = new THREE.MeshLambertMaterial({
		map, emissiveMap: map,
		color: map ? 0xffffff : 0x2b3036,
		emissive: new THREE.Color().setScalar(LOOK.EMISSIVE),
	});
	material.name = 'controller';
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nattribute vec3 tint;\nvarying vec3 vTint;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = tint;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
			.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTint;');
	};
	material.customProgramCacheKey = () => 'casawalk-controller';
	return material;
}

export class ControllerModel {
	constructor(key, b, motion) {
		this.key = key;
		this.root = b.root;
		this.mesh = b.mesh;
		this.probe = b.probe;
		this.parts = b.parts;
		this.motion = motion;
		this.opacity = 1;
		this.target = 1;
		this.tinted = '';
		findNodes(motion, this.root);
		// Which button each part is (its node lies under that component's moving node).
		this.partButton = this.parts.map((p) => buttonOf(motion, p.bone));
		this.setTint([]);
		this.apply();
	}

	/** The measured touch point in grip space, null if none was found, undefined until measured. */
	get tip() { return tips.get(this.key); }

	/**
	 * The look this frame: opacity (1, LOOK.FADED or 0) and the buttons to glow
	 * (xr-input names: 'trigger', 'stickPress', 'a', 'b').
	 */
	setLook(opacity, buttons) {
		this.target = opacity;
		this.setTint(buttons);
	}

	setTint(buttons) {
		if (buttons === this.tintedFor) return; // (the same array each frame while a tool is held: nothing to do)
		this.tintedFor = buttons;
		const id = buttons.join(',');
		if (id === this.tinted) return;
		this.tinted = id;
		const lit = new Set(buttons.map((k) => BUTTON_INDEX[k]));
		const glow = new THREE.Color(CONTROLLER.glow).multiplyScalar(LOOK.TINT);
		const tint = this.mesh.geometry.attributes.tint;
		this.parts.forEach((p, i) => {
			const on = lit.has(this.partButton[i]);
			for (let v = p.start; v < p.start + p.count; v++) tint.setXYZ(v, on ? glow.r : 0, on ? glow.g : 0, on ? glow.b : 0);
		});
		tint.needsUpdate = true;
	}

	/** Once a frame: the buttons move as pressed; the opacity eases to its target. */
	update(dt) {
		this.motion.updateFromGamepad();
		for (const component of Object.values(this.motion.components)) {
			for (const r of Object.values(component.visualResponses)) {
				const { valueNode, minNode, maxNode, value, valueNodeProperty } = r;
				if (!valueNode) continue;
				if (valueNodeProperty === Constants.VisualResponseProperty.VISIBILITY) valueNode.visible = value;
				else if (valueNodeProperty === Constants.VisualResponseProperty.TRANSFORM && minNode && maxNode) {
					valueNode.quaternion.slerpQuaternions(minNode.quaternion, maxNode.quaternion, value);
					valueNode.position.lerpVectors(minNode.position, maxNode.position, value);
				}
			}
		}
		const step = dt / LOOK.FADE;
		this.opacity = this.opacity < this.target ? Math.min(this.target, this.opacity + step) : Math.max(this.target, this.opacity - step);
		this.apply();
	}

	apply() {
		const m = this.mesh.material, see = this.opacity < 0.999;
		if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; }
		m.opacity = this.opacity;
		this.mesh.visible = this.opacity > 0.001;
	}

	/**
	 * Measures the touch point once per profile and hand: where the target
	 * ray's line leaves the front of the model. rayInGrip: the target-ray
	 * space's matrix in grip space (both from WebXR).
	 */
	measureTip(rayInGrip) {
		if (tips.has(this.key)) return;
		const origin = new THREE.Vector3().setFromMatrixPosition(rayInGrip);
		const dir = new THREE.Vector3(0, 0, -1).transformDirection(rayInGrip);
		tips.set(this.key, frontAlong(this.probe, origin, dir));
	}
}

/**
 * The frontmost point of a mesh along a line (origin, unit dir): cast back
 * from TIP_CAST ahead; null if the line misses it or the hit is implausibly far.
 */
export function frontAlong(mesh, origin, dir) {
	const ray = new THREE.Raycaster(origin.clone().addScaledVector(dir, TIP_CAST), dir.clone().negate(), 0, TIP_CAST * 2);
	mesh.material ??= new THREE.MeshBasicMaterial();
	mesh.material.side = THREE.DoubleSide;
	const hit = ray.intersectObject(mesh, false)[0];
	if (!hit || hit.point.distanceTo(origin) > TIP_FAR) return null;
	return hit.point;
}

/** The nodes each visual response moves (as three.js's XRControllerModelFactory finds them). */
function findNodes(motion, root) {
	for (const component of Object.values(motion.components)) {
		for (const r of Object.values(component.visualResponses)) {
			r.valueNode = root.getObjectByName(r.valueNodeName) ?? null;
			if (r.valueNodeProperty === Constants.VisualResponseProperty.TRANSFORM) {
				r.minNode = root.getObjectByName(r.minNodeName) ?? null;
				r.maxNode = root.getObjectByName(r.maxNodeName) ?? null;
			}
		}
	}
}

/** The gamepad button index of the component whose moving node carries this part, or -1 (the body). */
function buttonOf(motion, bone) {
	for (const component of Object.values(motion.components)) {
		const index = component.gamepadIndices?.button;
		if (index == null) continue;
		for (const r of Object.values(component.visualResponses)) {
			for (let o = bone; o; o = o.parent) if (o === r.valueNode) return index;
		}
	}
	return -1;
}
