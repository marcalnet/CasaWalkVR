// Scenery for the headset (SPEC.md, "Experience and controls"): the gallery
// room and its sky, the museum plinth, the walk-mode sky and the "stand here"
// markers. Builders only: they make three.js objects and
// keep no state; js/xr.js and the modes own what they build.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One plinth for both inputs (the user's decision, 26 Nov 2026; until then 0.60 m with a controller):
// the model at the arm's working height (build 111's design), stomach height so there is no bending
// (the user's decision after build 120): the top 0.65 m below the eyes, measured from the eyes because
// the scale model's view lifts them to a 2 m person's (1.89 m on the stage), so it suits any real
// height, seated too (build 120's design, corrections to item 5).
export const PLINTH_HEIGHT = 1.24;
// The model rests a few millimetres above the plinth, never exactly on it:
// two surfaces at the same height fight for the same pixels ("z-fighting"),
// which showed as flickering polygon-shaped patches all over the floors.
const SLAB = 0.03, GAP = 0.05, INSET = 0.025; // the plinth's top slab, its dark base gap, the base's inset
export const PLINTH_MARGIN = 0.3; // table left around the model (at most 1.4 m across): the bare-hands plinth's (build 120's design, item 8), for both inputs
// From where you stand to the plinth's front edge (60 cm at the user's request:
// you can't walk around in the gallery, and 30 cm put the model too close).
const PLINTH_FRONT_GAP = 0.6;
export const EYE_BELOW_TOP = 0.11; // eyes are about this far below the top of the head

/**
 * Outside the gallery: a soft gradient sky and a pale ground, seen through
 * the windows and the skylight. Added to the scene, hidden.
 */
export function buildShowroom(scene) {
	const room = new THREE.Group();
	room.name = 'showroom';
	const sky = new THREE.Mesh(gradientSphere(40, 0xb7cde0, 0xf5f7f9), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false }));
	const ground = new THREE.Mesh(new THREE.CircleGeometry(39, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xdfe3dc }));
	ground.position.y = -0.02;
	room.add(sky, ground);
	room.visible = false;
	scene.add(room);
	return { showroom: room, showroomSky: sky };
}

/**
 * The stage, what Recentre moves (positioned relative to the user): the
 * gallery room and the museum plinth, which stays still while the model
 * turns on it. The plinth is sized to the model by fitPlinth(). Added to the
 * scene, hidden.
 */
export function buildStage(scene) {
	const stage = new THREE.Group();
	stage.name = 'stage';
	const gallery = buildGallery();
	const pedestal = new THREE.Group();
	pedestal.name = 'plinth';
	const plinthMaterials = {
		// (Drawn a touch further back in depth as well, so the model's floor always wins.)
		top: new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
		body: new THREE.MeshLambertMaterial({ color: 0xf2f1ee }),
		base: new THREE.MeshLambertMaterial({ color: 0x33383d }),
	};
	stage.add(gallery, pedestal);
	stage.visible = false;
	scene.add(stage);
	return { stage, gallery, pedestal, plinthMaterials };
}

/**
 * A rectangular exhibition plinth for a model footprint of w x d metres:
 * a thin white top slab, an off-white body, and a dark recessed base
 * (shadow gap) so it seems to float just above the floor. The gallery
 * room is centred on it. Returns { W, D } (the plinth's size) and
 * `distance`, from the user to the plinth's centre.
 */
export function fitPlinth({ pedestal, gallery, plinthMaterials: M }, w, d, H = PLINTH_HEIGHT) {
	const W = w + 2 * PLINTH_MARGIN, D = d + 2 * PLINTH_MARGIN;
	const distance = D / 2 + PLINTH_FRONT_GAP;
	pedestal.position.set(0, 0, -distance);
	gallery.position.set(0, 0, -distance);
	const p = pedestal;
	for (const m of p.children) m.geometry.dispose();
	p.clear();
	const box = (bw, bh, bd, y, mat) => {
		const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
		m.position.y = y;
		m.castShadow = m.receiveShadow = true; // the model's shadow falls on the table
		p.add(m);
		return m;
	};
	// (The body is a unit-high box scaled to the height.)
	box(W, SLAB, D, H - SLAB / 2, M.top);
	const body = box(W - 0.01, 1, D - 0.01, GAP + (H - SLAB - GAP) / 2, M.body);
	body.scale.y = H - SLAB - GAP;
	box(W - 2 * INSET, GAP, D - 2 * INSET, GAP / 2, M.base);
	return { W, D, distance };
}

/**
 * Puts the scale plate on the plinth top, near its front edge on the right,
 * tilted up towards you like a museum caption (the plinth is W x D).
 */
export function placePlate(plate, pedestal, W, D, H = PLINTH_HEIGHT) {
	const ph = plate.geometry.parameters?.height ?? 0.05;
	const tilt = THREE.MathUtils.degToRad(35); // up from lying flat
	plate.rotation.set(-(Math.PI / 2 - tilt), 0, 0);
	plate.position.set(W / 2 - 0.15, H + Math.sin(tilt) * ph / 2 + 0.002, D / 2 - 0.065);
	plate.userData.tiltHalf = Math.sin(tilt) * ph / 2 + 0.002; // (its height above the top)
	pedestal.add(plate);
}

/** Sky for walk mode in the VR view: follows the head (a child of the camera), coloured by recolourSphere(). */
export function buildWalkSky(camera) {
	const sky = new THREE.Mesh(gradientSphere(200, 0xcce4fc, 0xffffff), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
	sky.renderOrder = -1;
	sky.visible = false;
	sky.name = 'walk-sky';
	camera.add(sky);
	return sky;
}

/**
 * Person-height "stand here" markers, in real metres, one per controller;
 * they live in model space so they scale with the dollhouse.
 */
export function buildMarkers() {
	const m = new THREE.Group();
	const mat = new THREE.MeshLambertMaterial({ color: 0xd9822b, transparent: true, opacity: 0.9, depthTest: true });
	const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.3, 20), mat);
	body.position.y = 0.65;
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 12), mat);
	head.position.y = 1.55;
	// The ring, with a small arrow in front: the way you will face (the
	// marker turns with it). One geometry, so one draw call.
	const arrow = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.14, 0.42), new THREE.Vector2(0.14, 0.42), new THREE.Vector2(0, 0.62)]));
	const ringGeo = mergeGeometries([new THREE.RingGeometry(0.3, 0.4, 32), arrow]).rotateX(-Math.PI / 2);
	arrow.dispose();
	const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xd9822b, side: THREE.DoubleSide }));
	ring.position.y = 0.02;
	m.add(body, head, ring);
	m.visible = false;
	m.name = 'marker';
	return [m, m.clone()];
}


/** Inside-out sphere with a vertical colour gradient (horizon -> top). */
function gradientSphere(r, top, horizon) {
	const g = new THREE.SphereGeometry(r, 32, 16);
	recolourSphere(g, r, top, horizon);
	return g;
}

/** Recolours a gradient sphere of radius r (the skies follow the time of day). */
export function recolourSphere(g, r, top, horizon) {
	const t0 = new THREE.Color(top), h0 = new THREE.Color(horizon);
	const pos = g.attributes.position;
	const colors = new Float32Array(pos.count * 3);
	const c = new THREE.Color();
	for (let i = 0; i < pos.count; i++) {
		const t = Math.max(0, pos.getY(i) / r);
		c.copy(h0).lerp(t0, Math.pow(t, 0.7)).toArray(colors, i * 3);
	}
	g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Gallery room around the plinth (VR dollhouse): dark oak floor with a pale
 * rug, warm white walls with a dark skirting, a charcoal feature wall, tall
 * windows on both sides, a skylight, and four large abstract canvases.
 * Untextured parts are merged by material to keep draw calls low.
 */
function buildGallery() {
	const g = new THREE.Group();
	g.name = 'gallery';
	const W = 12, D = 12, H = 4.2, T = 0.25; // inner size, wall thickness
	const mats = {
		wall: new THREE.MeshLambertMaterial({ color: 0xefece6 }),
		feature: new THREE.MeshLambertMaterial({ color: 0x3a3f45 }),
		dark: new THREE.MeshLambertMaterial({ color: 0x2b2f33 }),
		ceiling: new THREE.MeshLambertMaterial({ color: 0xf7f6f3 }),
		rug: new THREE.MeshLambertMaterial({ color: 0xb9b2a6 }), // mid tone, so the white plinth stands out
	};
	const parts = new Map(); // material -> geometries
	const box = (mat, w, h, d, x, y, z) => {
		const geo = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
		if (!parts.has(mat)) parts.set(mat, []);
		parts.get(mat).push(geo);
	};

	// Floor: dark oak planks; a pale rug under the plinth.
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: plankTexture() }));
	floor.receiveShadow = true;
	g.add(floor);
	box(mats.rug, 5, 0.01, 4.2, 0, 0.005, 0.2);

	// Front (far) wall: charcoal feature wall. Back wall: warm white.
	box(mats.feature, W + 2 * T, H, T, 0, H / 2, -D / 2 - T / 2);
	box(mats.wall, W + 2 * T, H, T, 0, H / 2, D / 2 + T / 2);
	box(mats.dark, W, 0.12, 0.02, 0, 0.06, D / 2 - 0.01); // skirting

	// Side walls with two tall windows each (2.6 m wide, 3 m high, sill 0.5 m).
	const WIN_W = 2.6, WIN_H = 3, SILL = 0.5, centres = [-2.4, 2.4];
	for (const side of [-1, 1]) {
		const x = side * (W / 2 + T / 2);
		const spans = [[-D / 2, centres[0] - WIN_W / 2], [centres[0] + WIN_W / 2, centres[1] - WIN_W / 2], [centres[1] + WIN_W / 2, D / 2]];
		for (const [z0, z1] of spans) box(mats.wall, T, H, z1 - z0, x, H / 2, (z0 + z1) / 2);
		for (const zc of centres) {
			box(mats.wall, T, SILL, WIN_W, x, SILL / 2, zc); // below
			box(mats.wall, T, H - SILL - WIN_H, WIN_W, x, SILL + WIN_H + (H - SILL - WIN_H) / 2, zc); // above
			// Slim dark frame, a mullion and a transom
			const fx = side * (W / 2 + 0.02), F = 0.06;
			box(mats.dark, 0.08, F, WIN_W, fx, SILL + F / 2, zc);
			box(mats.dark, 0.08, F, WIN_W, fx, SILL + WIN_H - F / 2, zc);
			box(mats.dark, 0.08, WIN_H, F, fx, SILL + WIN_H / 2, zc - WIN_W / 2 + F / 2);
			box(mats.dark, 0.08, WIN_H, F, fx, SILL + WIN_H / 2, zc + WIN_W / 2 - F / 2);
			box(mats.dark, 0.06, WIN_H, 0.04, fx, SILL + WIN_H / 2, zc);
			box(mats.dark, 0.06, 0.04, WIN_W, fx, SILL + 2.2, zc);
		}
		for (const [z0, z1] of spans) box(mats.dark, 0.02, 0.12, z1 - z0, side * (W / 2 - 0.01), 0.06, (z0 + z1) / 2); // skirting
	}

	// Ceiling with a 5 x 5 m skylight in the middle.
	const S = 5, CT = 0.15;
	box(mats.ceiling, W, CT, (D - S) / 2, 0, H + CT / 2, -(S + (D - S) / 2) / 2);
	box(mats.ceiling, W, CT, (D - S) / 2, 0, H + CT / 2, (S + (D - S) / 2) / 2);
	box(mats.ceiling, (W - S) / 2, CT, S, -(S + (W - S) / 2) / 2, H + CT / 2, 0);
	box(mats.ceiling, (W - S) / 2, CT, S, (S + (W - S) / 2) / 2, H + CT / 2, 0);

	for (const [mat, geoms] of parts) {
		const m = new THREE.Mesh(mergeGeometries(geoms), mat);
		m.receiveShadow = true;
		g.add(m);
		for (const geo of geoms) geo.dispose();
	}

	// Canvases: big one on the feature wall, one behind you, one on each side.
	const canvas = (w, h, seed, x, y, z, ry) => {
		const c = new THREE.Group();
		const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), mats.dark);
		const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: artTexture(seed, w / h) }));
		art.position.z = 0.031; // clear of the frame's front face (0.025), or the two flicker from afar
		c.add(frame, art);
		c.position.set(x, y, z);
		c.rotation.y = ry;
		g.add(c);
	};
	canvas(3.6, 2.2, 1, 0, 2.3, -D / 2 + 0.03, 0);
	canvas(3.0, 1.9, 2, 0, 2.1, D / 2 - 0.03, Math.PI);
	canvas(1.3, 1.9, 3, -W / 2 + 0.03, 2.0, 0, Math.PI / 2);
	canvas(1.3, 1.9, 4, W / 2 - 0.03, 2.0, 0, -Math.PI / 2);
	return g;
}

/** Dark oak planks, drawn once on a canvas (2 m tile, 25 cm planks). */
function plankTexture() {
	if (typeof document === 'undefined') return null;
	const c = document.createElement('canvas');
	c.width = c.height = 1024;
	const ctx = c.getContext('2d');
	const rnd = seeded(7);
	const PW = 128;
	for (let col = 0; col < 8; col++) {
		let y = -rnd() * 600;
		while (y < 1024) {
			const len = 400 + rnd() * 500;
			const l = 34 + rnd() * 10, s = 22 + rnd() * 8;
			ctx.fillStyle = `hsl(28, ${s}%, ${l}%)`;
			ctx.fillRect(col * PW, y, PW, len);
			// Grain
			ctx.strokeStyle = 'rgba(30, 18, 8, 0.12)';
			ctx.lineWidth = 2;
			for (let k = 0; k < 6; k++) {
				const gx = col * PW + 10 + rnd() * (PW - 20);
				ctx.beginPath(); ctx.moveTo(gx, y); ctx.bezierCurveTo(gx + 6, y + len / 3, gx - 6, y + 2 * len / 3, gx, y + len); ctx.stroke();
			}
			ctx.fillStyle = 'rgba(20, 12, 6, 0.6)';
			ctx.fillRect(col * PW, y, PW, 3); // plank end
			y += len;
		}
		ctx.fillStyle = 'rgba(20, 12, 6, 0.6)';
		ctx.fillRect(col * PW, 0, 3, 1024); // seam
	}
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(6, 6);
	tex.anisotropy = 4;
	return tex;
}

/** Original abstract painting: soft colour fields, a disc, or bands. */
function artTexture(seed, aspect) {
	if (typeof document === 'undefined') return null;
	const c = document.createElement('canvas');
	c.width = 1024;
	c.height = Math.round(1024 / aspect);
	const ctx = c.getContext('2d');
	const { width: w, height: h } = c;
	const rnd = seeded(seed * 97);
	const palettes = [
		['#efe6d8', '#c65d3b', '#e9b44c', '#1f4e5f'],
		['#e9e4da', '#2e5e4e', '#d9c8a9', '#a33b2a'],
		['#f1ece4', '#3d5a80', '#98c1d9', '#ee6c4d'],
		['#ece6dc', '#6b4e71', '#f2d0a4', '#3a7d44'],
	];
	const [bg, a, b, d] = palettes[seed % palettes.length];
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);
	const soft = (x, y, rw, rh, col) => { ctx.filter = 'blur(6px)'; ctx.fillStyle = col; ctx.fillRect(x, y, rw, rh); ctx.filter = 'none'; };
	const style = seed % 3;
	if (style === 0) { // stacked colour fields
		soft(w * 0.08, h * 0.08, w * 0.84, h * 0.45, a);
		soft(w * 0.08, h * 0.58, w * 0.84, h * 0.22, b);
		soft(w * 0.08, h * 0.84, w * 0.84, h * 0.08, d);
	} else if (style === 1) { // disc over a horizon band
		soft(0, h * (0.55 + rnd() * 0.1), w, h, d);
		ctx.fillStyle = a;
		ctx.beginPath(); ctx.arc(w * (0.35 + rnd() * 0.3), h * 0.42, Math.min(w, h) * 0.24, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = b; ctx.lineWidth = 14;
		ctx.beginPath(); ctx.arc(w * 0.5, h * 1.2, w * 0.7, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
	} else { // diagonal bands
		ctx.save();
		ctx.translate(w / 2, h / 2); ctx.rotate(-0.5);
		const cols = [a, b, d, b, a];
		for (let i = 0; i < 5; i++) { ctx.fillStyle = cols[i]; ctx.fillRect(-w, -h * 0.6 + i * h * 0.26, w * 2, h * 0.16); }
		ctx.restore();
	}
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

/** Small seeded random generator, so the room looks the same every time. */
function seeded(s) {
	let x = s >>> 0 || 1;
	return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
