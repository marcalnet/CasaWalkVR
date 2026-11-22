// Photo button in the headset menu (SPEC.md, "Experience and controls").
//
// The Quest's own screenshot (hold the Meta button and pull a trigger) also
// sends that trigger pull to the page, which then jumps you (teleport, or
// "step inside" in the dollhouse); a web page cannot see the Meta button, so
// it cannot tell the two apart. Instead the menu has a Photo button: it
// renders the view once more, from your head, without the menu, lasers and
// orbs, into an image off screen, and saves it as a JPEG download (on the
// Quest: the Files app, Downloads; a web page cannot write into the
// headset's own screenshot gallery).
//
// Colour: three.js keeps off-screen images in linear colour, so the scene is
// drawn into a half-float image first, then a second pass converts it to
// sRGB bytes (what the headset shows), which are read back.

import * as THREE from 'three';

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAGMENT = `
uniform sampler2D map;
varying vec2 vUv;
vec3 toSRGB(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() { gl_FragColor = vec4(toSRGB(texture2D(map, vUv).rgb), 1.0); }`;

/**
 * Renders `scene` from `eye` (a world matrix: position and direction; its
 * roll is removed so the horizon is level) and returns a JPEG Blob.
 * Call between frames; the renderer's XR state and render target are restored.
 */
export async function takePhoto(renderer, scene, eye, { width = 1920, height = 1080, fov = 60, near = 0.05, far = 300, quality = 0.92 } = {}) {
	// The camera: the eye's position, yaw and pitch.
	const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
	eye.decompose(pos, quat, scale);
	const e = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
	e.z = 0;
	const camera = new THREE.PerspectiveCamera(fov, width / height, near, far);
	camera.position.copy(pos);
	camera.quaternion.setFromEuler(e);
	camera.updateMatrixWorld(true);

	const ext = renderer.extensions;
	const halfFloat = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
	const linear = new THREE.WebGLRenderTarget(width, height, { type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 4 });
	const encoded = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType });
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
		uniforms: { map: { value: linear.texture } }, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false,
	}));
	quad.frustumCulled = false;
	const quadScene = new THREE.Scene();
	quadScene.add(quad);

	const xrEnabled = renderer.xr.enabled, previous = renderer.getRenderTarget();
	const pixels = new Uint8Array(width * height * 4);
	try {
		// While presenting, three.js draws with the headset's camera; switched
		// off for these two draws, it uses ours.
		renderer.xr.enabled = false;
		renderer.setRenderTarget(linear);
		renderer.clear();
		renderer.render(scene, camera);
		renderer.setRenderTarget(encoded);
		renderer.render(quadScene, camera);
	} finally {
		renderer.setRenderTarget(previous);
		renderer.xr.enabled = xrEnabled;
	}
	try {
		await renderer.readRenderTargetPixelsAsync(encoded, 0, 0, width, height, pixels);
	} finally {
		linear.dispose();
		encoded.dispose();
		quad.geometry.dispose();
		quad.material.dispose();
	}

	// WebGL rows run bottom-up: flip them into a 2D canvas, then JPEG.
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	const image = ctx.createImageData(width, height);
	const row = width * 4;
	for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
	ctx.putImageData(image, 0, 0);
	return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be encoded'))), 'image/jpeg', quality));
}

/**
 * Hides `objects` (any iterable of Object3Ds) while `draw()` runs, then puts
 * each one back as it was; returns what draw() returned. The Photo button
 * draws the view without the menu, lasers, controllers, orbs and other
 * interface (js/xr.js keeps the list: XRExperience.hideFromPhotos()).
 */
export function withHidden(objects, draw) {
	const was = [];
	for (const o of objects) { was.push(o.visible); o.visible = false; }
	try {
		return draw();
	} finally {
		let i = 0;
		for (const o of objects) o.visible = was[i++];
	}
}

/** A file name like "CasaWalk 2026-11-21 10.42.07.jpg". */
export function photoName(date = new Date()) {
	const p = (n) => String(n).padStart(2, '0');
	return `CasaWalk ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}.jpg`;
}

/** Saves a Blob as a download (on the Quest: Files app, Downloads). */
export function saveFile(blob, name) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.hidden = true;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
