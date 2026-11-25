// The one base for everything drawn on a canvas in the headset (code audit,
// A5): the boards, cards, labels, keys, the guide, the lessons' card, the
// meter's labels and screen, the camera's hint and lens label. Each keeps its
// own drawing; this makes the canvas and its texture the same way for all of
// them. In Node (the tests), where there is no canvas, both are null and the
// cards simply draw nothing.

import * as THREE from 'three';

/**
 * A canvas of w x h pixels and its texture (sRGB, so colours are as drawn;
 * anisotropy 4 keeps text sharp when seen at an angle, 1 to leave it off).
 * Returns { canvas, texture }, both null without a document.
 */
export function canvasTexture(w, h, { anisotropy = 4 } = {}) {
	const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	if (!canvas) return { canvas: null, texture: null };
	canvas.width = w; canvas.height = h;
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	if (anisotropy > 1) texture.anisotropy = anisotropy;
	return { canvas, texture };
}
