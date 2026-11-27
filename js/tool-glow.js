// The glow of a tool ready to use (build-215 asks C10 §5; the user: "a
// glowing effect when the tool is ready to use, like in a video game"): a rim
// round the held tool's silhouette while it is in use mode, coming on with
// the tool itself switching on (the camera's screen, the meter's beam, the
// marker's aim dot).
//
//   How       one shell per tool, built from its body meshes (never its
//             screens, which are meshes of their own), pushed out along
//             smoothed normals by WIDTH, drawn back faces only, additive, no
//             depth write, depth test on (the hand and the model still hide
//             it); intensity a fresnel term (1 - |n.v|)^2.5, so it lights the
//             silhouette and fades to nothing on faces turned to you. No
//             post-process. One draw call per held tool.
//   Colour    the theme's accent (BADGE.orb.fill): the colour of "this acts".
//   Strength  35% at rest in use mode, breathing ±7% over 3 s; entering use
//             mode it swells to 100% in 0.15 s, then settles to 35% in 0.6 s
//             (ease-out); back in the dock it fades to 0 in 0.3 s; it fades
//             with the tool when tracking is lost.
//   Never in photos, nor in the camera's viewfinder (the interface layer).
// Pure enough: glowAt() (the strength over time) runs in Node tests.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BADGE } from './theme.js';

export const GLOW = {
	WIDTH: { camera: 0.003, meter: 0.003, marker: 0.002 }, // the rim's width out from the surface (m)
	REST: 0.35, BREATHE: 0.07, PERIOD: 3, // at rest: 35%, ±7% over 3 s
	SWELL: 0.15, SETTLE: 0.6, FADE: 0.3, // seconds: up to 100%, back to rest, out in the dock
	POWER: 2.5, // the fresnel's exponent
};

/**
 * The glow's strength (0..1), s seconds into use mode (s < 0: not in use; out
 * the seconds since it left use mode, from the strength it had then, from).
 */
export function glowAt(s, { out = null, from = GLOW.REST } = {}) {
	if (out !== null) return Math.max(0, from * (1 - out / GLOW.FADE));
	if (s < 0) return 0;
	if (s < GLOW.SWELL) return s / GLOW.SWELL;
	const t = s - GLOW.SWELL;
	if (t < GLOW.SETTLE) { const k = 1 - (1 - t / GLOW.SETTLE) ** 3; return 1 + (GLOW.REST - 1) * k; } // (ease-out)
	return GLOW.REST + GLOW.BREATHE * Math.sin(((t - GLOW.SETTLE) / GLOW.PERIOD) * Math.PI * 2);
}

const VERTEX = `
varying vec3 vN;
varying vec3 vV;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vN = normalize(normalMatrix * normal);
	vV = normalize(-mv.xyz);
	gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = `
uniform vec3 colour;
uniform float strength;
uniform float power;
varying vec3 vN;
varying vec3 vV;
void main() {
	float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power);
	gl_FragColor = vec4(colour * f * strength, 1.0);
}`;

/** The shell of a tool's body (its meshes named "<tool>:..."), pushed out by width (m, in the tool's own space). */
export function shellOf(object, width) {
	object.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(object.matrixWorld).invert(), parts = [];
	object.traverse((m) => {
		if (!m.isMesh || !m.name.startsWith(`${object.name}:`)) return; // (the body: the screens, the viewfinder, cues and prints are meshes of their own)
		const g = new THREE.BufferGeometry().setAttribute('position', m.geometry.attributes.position.clone());
		if (m.geometry.index) g.setIndex(m.geometry.index.clone());
		parts.push(g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
	});
	if (!parts.length) return null;
	const geo = mergeVertices(mergeGeometries(parts, false), 1e-5); // (shared vertices: smooth normals, so the shell closes at the edges)
	geo.computeVertexNormals();
	const pos = geo.attributes.position, nor = geo.attributes.normal;
	for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nor.getX(i) * width, pos.getY(i) + nor.getY(i) * width, pos.getZ(i) + nor.getZ(i) * width);
	const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
		uniforms: { colour: { value: new THREE.Color(BADGE.orb.fill) }, strength: { value: 0 }, power: { value: GLOW.POWER } },
		vertexShader: VERTEX, fragmentShader: FRAGMENT,
		side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true,
	}));
	mesh.name = 'tool-glow';
	mesh.raycast = () => {};
	mesh.visible = false;
	return mesh;
}

export class ToolGlow {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.glows = new Map(); // tool -> { mesh, s (seconds in use, or -1), out (seconds since it left use, or null), from }
	}

	glowOf(tool) {
		let g = this.glows.get(tool);
		if (g) return g;
		const mesh = shellOf(tool.object, GLOW.WIDTH[tool.name] ?? 0.003);
		if (mesh) { tool.object.add(mesh); this.xr.hideFromPhotos(mesh); }
		g = { mesh, s: -1, out: null, from: 0 };
		this.glows.set(tool, g);
		return g;
	}

	/** Once a frame (after the tools): each tool's glow from its mode. */
	update(dt) {
		const held = this.xr.tools?.held;
		for (const tool of this.xr.tools?.tools ?? []) {
			const g = this.glowOf(tool), use = held?.tool === tool && held.mode === 'use';
			if (use) { if (g.s < 0) { g.s = 0; g.out = null; } else g.s += dt; }
			else if (g.s >= 0) { g.from = glowAt(g.s); g.s = -1; g.out = 0; }
			else if (g.out !== null) g.out += dt;
			const k = g.out !== null ? glowAt(-1, { out: g.out, from: g.from }) : glowAt(g.s);
			if (g.out !== null && k <= 0) g.out = null;
			if (!g.mesh) continue;
			g.mesh.material.uniforms.strength.value = k;
			g.mesh.visible = k > 0.002 && tool.object.visible;
		}
	}

	/** The session ends: every glow out at once. */
	end() { for (const g of this.glows.values()) { g.s = -1; g.out = null; if (g.mesh) g.mesh.visible = false; } }
}
