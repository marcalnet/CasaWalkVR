// The hand-held tools' models (SPEC.md phase 17, milestone C1): the street
// camera, the meter and the marker, after the designer's drafts (22 Nov
// 2026, simplified after the user's review): plain three.js primitives at
// real size, one Lambert material per colour (merged per material: one draw
// call each), in the theme's colours; the only texture is the camera's
// "Coming soon" tag (assets/ui/tag-coming-soon.png, its words). Each builder
// returns a group with named points (empties: grip, lens, tip...) and
// userData.fanScale (its size in the fan). Original shapes: no maker's name,
// logo or replica.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLOURS, KEY, HAND, BADGE } from './theme.js';

export const TOOL_COLOURS = {
	graphite: COLOURS.text, // bodies
	soft: COLOURS.soft, // glass, windows, screens when off
	metal: KEY.nub, // the light metal parts
	paper: HAND.fill, // the white parts
	accent: BADGE.orb.fill, // the thing to press
};

// The marker's four inks (content colours, not interface colours).
export const MARKER_INKS = {
	black: '#1d2329',
	blue: '#2f5fd0',
	green: '#2f9e6a',
	red: '#d6423a',
};

/** A Lambert material; `map` optional. One per look, shared by every part that wears it. */
export function lambert(colour, extra = {}) {
	return new THREE.MeshLambertMaterial({ color: colour, ...extra });
}

/**
 * Collects geometries per material, then merges each set into one mesh: one draw call per material.
 * parts.add(material, geometry, matrix?) places a primitive; parts.build(name) returns the group.
 */
export function partList() {
	const byMat = new Map();
	return {
		add(material, geometry, matrix) {
			let g = geometry.index ? geometry.toNonIndexed() : geometry;
			if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
			for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
			if (matrix) g.applyMatrix4(matrix);
			if (!byMat.has(material)) byMat.set(material, []);
			byMat.get(material).push(g);
			return g;
		},
		/**
		 * The parts as meshes. The plain colours merge into ONE mesh with the colours
		 * per vertex, on a material all the tools share (the tester's finding: the
		 * fan cost 14 draw calls); a material with a texture, or one that must change
		 * on its own (keep: the marker's ink), stays a mesh of its own.
		 */
		build(name, { keep = [] } = {}) {
			const group = new THREE.Group();
			group.name = name;
			const plain = [];
			for (const [mat, geos] of byMat) {
				if (mat.map || mat.transparent || keep.includes(mat.name)) {
					const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
					mesh.name = `${name}:${mat.name || mat.color.getHexString()}`;
					group.add(mesh);
					continue;
				}
				for (const g of geos) {
					const n = g.attributes.position.count, c = new Float32Array(n * 3);
					for (let i = 0; i < n; i++) { c[i * 3] = mat.color.r; c[i * 3 + 1] = mat.color.g; c[i * 3 + 2] = mat.color.b; }
					g.setAttribute('color', new THREE.BufferAttribute(c, 3));
					plain.push(g);
				}
			}
			if (plain.length) {
				const mesh = new THREE.Mesh(mergeGeometries(plain, false), sharedMaterial());
				mesh.name = `${name}:body`;
				group.add(mesh);
			}
			return group;
		},
	};
}

let shared = null;
/** The one material of the tools' plain parts (their colours are per vertex). */
function sharedMaterial() {
	return (shared ??= new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, name: 'tools' })); // (double-sided: the meter's blade)
}

/** A transform from position, Euler rotation (radians) and scale. */
export function at(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
	const m = new THREE.Matrix4();
	m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
	return m;
}

/** A rounded rectangle shape centred on 0, with one radius per corner [bl, br, tr, tl]. */
export function roundedRect(w, h, r) {
	const [bl, br, tr, tl] = Array.isArray(r) ? r : [r, r, r, r];
	const x = -w / 2, y = -h / 2;
	const s = new THREE.Shape();
	s.moveTo(x + bl, y);
	s.lineTo(x + w - br, y);
	if (br) s.quadraticCurveTo(x + w, y, x + w, y + br);
	s.lineTo(x + w, y + h - tr);
	if (tr) s.quadraticCurveTo(x + w, y + h, x + w - tr, y + h);
	s.lineTo(x + tl, y + h);
	if (tl) s.quadraticCurveTo(x, y + h, x, y + h - tl);
	s.lineTo(x, y + bl);
	if (bl) s.quadraticCurveTo(x, y, x + bl, y);
	return s;
}

/** Extrudes a shape by `depth` along +Z, centred on z = 0, with a small soft bevel. */
export function slab(shape, depth, bevel = 0.002, curveSegments = 4) {
	const g = new THREE.ExtrudeGeometry(shape, {
		depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
		bevelSegments: 1, curveSegments,
	});
	g.translate(0, 0, -(depth - 2 * bevel) / 2);
	return g;
}

/** A rounded box: a rounded rectangle extruded, its bevel kept inside the nominal size (w × h × depth). */
export function rslab(w, h, r, depth, bevel = 0.002, curveSegments = 4) {
	const rr = (Array.isArray(r) ? r : [r, r, r, r]).map((x) => Math.max(0, x - bevel));
	return slab(roundedRect(w - 2 * bevel, h - 2 * bevel, rr), depth, bevel, curveSegments);
}

/** A named empty: the points the builder attaches things to (grip, tip, lens…). */
export function point(group, name, x, y, z, lookAt) {
	const o = new THREE.Object3D();
	o.name = name;
	o.position.set(x, y, z);
	if (lookAt) o.lookAt(new THREE.Vector3(...lookAt).add(o.position)); // +Z of the empty faces lookAt
	group.add(o);
	return o;
}


/** Loads a texture of assets/ui/ (sRGB). Null in Node. */
export function tex(file) {
	if (typeof document === 'undefined') return null;
	const t = new THREE.TextureLoader().load(`assets/ui/${file}`);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 4;
	return t;
}

const C = TOOL_COLOURS;

// ---------------------------------------------------------------------------
// The street camera (milestone D; in the fan from C, inactive, with its tag).
// Axes: X to the right as held to the eye, Y up, the lens looks along -Z.
// Points: grip, lens, viewfinder, shutter, screen, strap.
// ---------------------------------------------------------------------------

export const CAMERA_SIZE = { w: 0.120, h: 0.066, d: 0.032 };
export const CAMERA_FAN_SCALE = 0.09 / CAMERA_SIZE.w; // 9 cm across in the fan

/**
 * @param {object} [o]
 * @param {boolean} [o.inactive] the "Coming soon" look: dimmed, grey shutter, the tag
 */
export function buildCamera({ inactive = false } = {}) {
	const dim = (hex) => inactive ? '#' + new THREE.Color(hex).lerp(new THREE.Color('#9aa3ac'), 0.45).getHexString() : hex;
	const M = {
		body: lambert(dim(C.graphite), { name: 'body' }),
		metal: lambert(dim(C.metal), { name: 'metal' }),
		glass: lambert(dim(C.soft), { name: 'glass' }),
		accent: lambert(inactive ? dim(C.soft) : C.accent, { name: 'accent' }),
	};

	const P = partList();
	const { w, h, d } = CAMERA_SIZE;
	const yTop = h / 2, ySplit = 0.017; // graphite below, metal top plate above
	const up = new THREE.Matrix4().makeRotationX(Math.PI / 2); // plan shape Y -> world Z, extrusion -> world -Y

	// Body: a stadium in plan (fully round ends), extruded upwards, in two colours.
	const lowH = ySplit + h / 2, topH = yTop - ySplit;
	P.add(M.body, rslab(w, d, d / 2 - 0.0005, lowH, 0.002, 6), at(0, -h / 2 + lowH / 2).multiply(up));
	P.add(M.metal, rslab(w - 0.001, d - 0.001, d / 2 - 0.001, topH, 0.002, 6), at(0, ySplit + topH / 2).multiply(up));

	// Lens: metal mount ring, graphite barrel, glass front.
	const lx = 0.004, ly = -0.006, zFront = -d / 2;
	const lathe = (pts, mat) => P.add(mat, new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 16), at(lx, ly, zFront, -Math.PI / 2));
	lathe([[0.0235, 0.000], [0.0235, 0.005], [0.0212, 0.005]], M.metal);
	lathe([[0.0212, 0.005], [0.0212, 0.032], [0.0180, 0.034]], M.body);
	P.add(M.glass, new THREE.CircleGeometry(0.0180, 16), at(lx, ly, zFront - 0.034, 0, Math.PI));

	// Viewfinder window (front, top plate) and the shutter button on top.
	P.add(M.glass, rslab(0.016, 0.009, 0.002, 0.0012, 0, 3), at(-0.040, ySplit + topH / 2, -d / 2 - 0.0002));
	P.add(M.accent, new THREE.CylinderGeometry(0.0055, 0.0055, 0.005, 14), at(0.043, yTop + 0.0025));

	// Back: the screen and the eyepiece.
	P.add(M.glass, rslab(0.050, 0.034, 0.003, 0.0012, 0, 3), at(-0.012, -0.008, d / 2 + 0.0004));
	P.add(M.body, rslab(0.0125, 0.0095, 0.0025, 0.003, 0.0008, 3), at(-0.040, ySplit + topH / 2, d / 2 + 0.0012));

	const g = P.build(inactive ? 'camera-inactive' : 'camera');

	// The "Coming soon" tag: a paper tag on a string from the left end. Its words are the one texture
	// (assets/ui/tag-coming-soon.png, from C0); without it, a plain paper tag.
	if (inactive) {
		const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.039, 4), lambert(C.metal));
		string.position.set(-w / 2 - 0.006, -0.010, -0.004);
		string.rotation.set(0.55, 0, 0.45);
		const tagMat = lambert('#ffffff', { map: tex('tag-coming-soon.png'), transparent: true, alphaTest: 0.5, name: 'tag' });
		if (!tagMat.map) tagMat.color.set(C.paper);
		const tag = new THREE.Group();
		const face = new THREE.PlaneGeometry(0.056, 0.028);
		const a = new THREE.Mesh(face, tagMat), b = new THREE.Mesh(face, tagMat);
		b.rotation.y = Math.PI; // two planes back to back: the words read from both sides
		tag.add(a, b);
		tag.position.set(-w / 2 + 0.006, -0.040, -d / 2 - 0.006);
		tag.rotation.set(0.1, 0, -0.08);
		tag.name = 'tag';
		g.add(string, tag);
	}

	point(g, 'grip', 0.044, -0.008, 0);
	point(g, 'lens', lx, ly, zFront - 0.035, [0, 0, -1]);
	// The control part (its dial: the lens) and its quiet ring (js/tool-dial.js): on the top of the body at its back edge, on the
	// grip's side, where a real camera's dial sits, a flat ring facing up, seen from above while held. (On the lens it was
	// hidden by the body in the hold: the Tester's xr-39; the Designer, next-build asks 3.6.)
	point(g, 'control', 0.022, yTop, d / 2 - 0.011);
	g.userData.cue = { shape: 'ring', at: [0.022, yTop + 0.0005, d / 2 - 0.011], radius: 0.011, up: true };
	point(g, 'viewfinder', -0.040, ySplit + topH / 2, d / 2 + 0.003, [0, 0, 1]);
	point(g, 'shutter', 0.043, yTop + 0.005, 0);
	point(g, 'screen', -0.012, -0.008, d / 2 + 0.001, [0, 0, 1]);
	point(g, 'strap', -w / 2, 0.010, 0);
	g.userData.fanScale = CAMERA_FAN_SCALE;
	return g;
}

// ---------------------------------------------------------------------------
// The meter (milestone E): a roll tape that measures by laser.
// Axes: X across the case, Y up, the blade and the laser along -Z.
// Points: grip, tip (laser window), hook, screen, key.
// ---------------------------------------------------------------------------

export const METER_SIZE = { w: 0.036, h: 0.066, d: 0.068 };
export const METER_FAN_SCALE = 0.09 / 0.098; // 9 cm with the blade showing (case 6.8 + blade 3)

/** @param {{ blade?: number }} [o] blade: how far the blade shows, in metres (default 3 cm) */
export function buildMeter({ blade = 0.03 } = {}) {
	const M = {
		case: lambert(C.graphite, { name: 'case' }),
		metal: lambert(C.metal, { name: 'metal' }),
		glass: lambert(C.soft, { name: 'glass' }),
		paper: lambert(C.paper, { side: THREE.DoubleSide, name: 'paper' }),
		accent: lambert(C.accent, { name: 'accent' }),
	};

	const P = partList();
	const { w, h, d } = METER_SIZE;
	// Side profile in the shape's XY (x = forward), extruded across; corners [back-bottom, front-bottom, front-top, back-top].
	const side = new THREE.Matrix4().makeRotationY(Math.PI / 2); // shape x -> world -Z, extrusion -> world X
	P.add(M.case, rslab(d, h, [0.012, 0.004, 0.014, 0.031], w, 0.003, 8), side);

	// Plain light metal discs on both sides.
	const cx = -0.004, cy = 0.003;
	for (const s of [-1, 1]) P.add(M.metal, new THREE.CylinderGeometry(0.025, 0.025, 0.002, 24), at(s * (w / 2 + 0.0005), cy, -cx, 0, 0, Math.PI / 2));

	// Front face: the orange key, the laser window under it, the blade's mouth at the bottom.
	const zf = -d / 2;
	P.add(M.accent, rslab(0.016, 0.011, 0.0025, 0.005, 0.0012, 3), at(0, 0.008, zf - 0.0015));
	P.add(M.glass, new THREE.CylinderGeometry(0.005, 0.005, 0.002, 14), at(0, -0.012, zf - 0.0005, Math.PI / 2));

	// Screen on the flat top, reading towards the back (the user).
	P.add(M.glass, rslab(0.024, 0.016, 0.002, 0.0012, 0, 3), at(0, h / 2 + 0.0004, -0.007, -Math.PI / 2));

	// Blade: a slightly curved paper-white strip out of the mouth, then the metal hook bent down at its end.
	const bw = 0.025, by = -h / 2 + 0.004, z0 = zf - 0.001, z1 = z0 - blade;
	const strip = new THREE.PlaneGeometry(bw, blade, 4, 1);
	const pos = strip.attributes.position;
	for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.0016 * (2 * pos.getX(i) / bw) ** 2); // concave, as a real tape
	strip.computeVertexNormals();
	P.add(M.paper, strip, at(0, by, (z0 + z1) / 2, -Math.PI / 2));
	P.add(M.metal, new THREE.BoxGeometry(bw + 0.002, 0.009, 0.0015), at(0, by - 0.0035, z1));

	const g = P.build('meter');
	point(g, 'grip', 0, 0, 0.004);
	point(g, 'tip', 0, -0.012, zf - 0.002, [0, 0, -1]);
	point(g, 'hook', 0, by - 0.008, z1, [0, 0, -1]);
	point(g, 'screen', 0, h / 2 + 0.002, -0.007, [0, 1, 0]);
	point(g, 'key', 0, 0.008, zf - 0.004, [0, 0, -1]);
	g.userData.fanScale = METER_FAN_SCALE;
	return g;
}

// ---------------------------------------------------------------------------
// The marker (milestone F): a thick felt-tip; its ink recolours one material.
// Axes: the nib points along -Z. Points: grip, tip, cap.
// ---------------------------------------------------------------------------

export const MARKER_LENGTH = 0.145;
export const MARKER_FAN_SCALE = 0.11 / MARKER_LENGTH; // a little longer than the others in the fan: it is thin

/** @param {{ ink?: keyof MARKER_INKS | string }} [o] */
export function buildMarker({ ink = 'blue' } = {}) {
	const M = {
		barrel: lambert(C.paper, { name: 'barrel' }),
		ink: lambert(MARKER_INKS[ink] || ink, { name: 'ink' }),
	};
	const P = partList();
	const R = 0.0105; // barrel radius: thick, about 2.1 cm across
	// One lathe profile per colour; distance d along the axis sits at world z = 0.051 - d (nib at -Z).
	const lathe = (pts, mat) => P.add(mat, new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 18), at(0, 0, 0.051, -Math.PI / 2));

	// Barrel, from its back end (z 0.051) to the collar (z -0.040), softly rounded at both ends.
	lathe([[0, 0], [R - 0.0015, 0], [R, 0.0015], [R, 0.0895], [R - 0.0008, 0.091]], M.barrel);
	// Collar tapering to the bullet nib (z -0.040 to -0.0695).
	lathe([[R - 0.0008, 0.091], [0.0085, 0.103], [0.0048, 0.110], [0.0030, 0.111], [0.0026, 0.117], [0.0016, 0.1195], [0, 0.1205]], M.ink);
	// Posted cap on the back: plain, domed (z 0.051 to 0.0825).
	const cap = (pts) => P.add(M.ink, new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 18), at(0, 0, 0.051, Math.PI / 2));
	cap([[0.0119, 0.0], [0.0122, 0.001], [0.0122, 0.026], [0.0105, 0.0295], [0.0060, 0.0313], [0, 0.0318]]);

	const g = P.build('marker', { keep: ['ink'] });
	point(g, 'grip', 0, 0, (-0.0695 + 0.0823) / 2); // (held by its middle, between the nib and the cap's end: build 215's B2; before, 2.5 cm towards the nib)
	point(g, 'tip', 0, 0, -0.0695, [0, 0, -1]);
	point(g, 'cap', 0, 0, 0.067); // (the posted cap's middle: the marker's control part, its colour dial)
	point(g, 'dial', 0, 0, 0.067 - 0.07); // (its dial opens round here, 7 cm from the cap towards the nib: the cap is by the holding wrist)
	// Its quiet ring: round the cap's domed end, facing along the axis, 0.5 mm proud of the surface (the UX review's S5).
	g.userData.cue = { shape: 'ring', at: [0, 0, 0.0823 + 0.0005], radius: 0.0085 };
	g.userData.fanScale = MARKER_FAN_SCALE;
	g.userData.setInk = (c) => M.ink.color.set(MARKER_INKS[c] || c);
	return g;
}
