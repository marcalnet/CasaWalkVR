// Sweet Home 3D (.sh3d) parser and scene builder.
//
// A .sh3d file is a ZIP archive; since Sweet Home 3D 5.3 it contains Home.xml,
// which is the only entry we read (see SPEC.md, "SH3D format").
//
// This module never touches the DOM, so it runs in Node tests as well as the
// browser. Loading model files and texture images is delegated to callbacks
// (see buildHome), which formats.js implements for the browser.
//
// Units: everything here is in centimetres and radians, like Sweet Home 3D.
// Plan coordinates (x right, y down) map to 3D as (x, elevation, planY);
// buildHome() returns a root group scaled by 0.01 so the scene is in metres.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal XML reader
// ---------------------------------------------------------------------------
// Home.xml only uses elements with attributes, so a small tokenizer is enough
// and behaves identically in Node and the browser (Node has no DOMParser).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
	if (s.indexOf('&') < 0) return s;
	return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			// An impossible character code stays as written instead of throwing.
			return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e] ?? m;
	});
}

/** Parses XML text into { name, attrs, children } nodes; returns the root element. */
export function parseXml(text) {
	const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
	const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	const root = { name: '#document', attrs: {}, children: [] };
	const stack = [root];
	let m;
	while ((m = tagRe.exec(text))) {
		if (m[1]) { // closing tag
			if (stack.length > 1) stack.pop();
		} else if (m[2]) { // opening or self-closing tag
			const attrs = {};
			let a;
			attrRe.lastIndex = 0;
			while ((a = attrRe.exec(m[3]))) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
			const node = { name: m[2], attrs, children: [] };
			stack[stack.length - 1].children.push(node);
			if (!m[4]) stack.push(node);
		}
	}
	return root.children[0] ?? null;
}

// ---------------------------------------------------------------------------
// Home.xml -> plain data
// ---------------------------------------------------------------------------

// A number attribute, or the default when it is missing or not a finite
// number (a damaged file must not put NaN or Infinity into the geometry).
const num = (a, k, d = 0) => {
	const v = a[k] !== undefined && a[k] !== '' ? parseFloat(a[k]) : d;
	return Number.isFinite(v) ? v : d;
};
const bool = (a, k, d) => (a[k] === undefined ? d : a[k] === 'true');
/** ARGB hex string ("FF808080") to 0xRRGGBB, or null. The alpha byte is ignored. */
const color = (a, k) => (a[k] ? parseInt(a[k], 16) & 0xffffff : null);

function readTexture(node) {
	if (!node) return null;
	const a = node.attrs;
	return { image: a.image, width: num(a, 'width', 100), height: num(a, 'height', 100), angle: num(a, 'angle', 0), name: a.name || '' };
}

const childTexture = (node, attribute) => readTexture(node.children.find((c) => c.name === 'texture' && (c.attrs.attribute || 'texture') === attribute));

/**
 * Parses Home.xml text into plain data. Hidden items and items on hidden
 * (non-viewable) levels are already filtered out.
 */
export function parseHome(xmlText) {
	const root = parseXml(xmlText);
	if (!root || root.name !== 'home') throw new Error('Home.xml has no <home> element');
	const H = root.attrs;
	const home = {
		name: H.name || '',
		version: num(H, 'version', 0),
		wallHeight: num(H, 'wallHeight', 250),
		groundColor: 0xa8a8a8,
		skyColor: 0xcce4fc,
		// Compass: plan north (radians, clockwise from plan "up") and latitude
		// (radians), for the sun position. Values are radians in Home.xml.
		compass: { northDirection: 0, latitude: Math.PI / 4 },
		observer: null,
		levels: new Map(),
		pieces: [],
		walls: [],
		rooms: [],
	};

	for (const n of root.children) {
		if (n.name === 'level') {
			const a = n.attrs;
			home.levels.set(a.id, {
				id: a.id, name: a.name || '',
				elevation: num(a, 'elevation', 0),
				floorThickness: num(a, 'floorThickness', 12),
				height: num(a, 'height', home.wallHeight),
				elevationIndex: num(a, 'elevationIndex', 0),
				viewable: bool(a, 'viewable', true) && bool(a, 'visible', true),
			});
		}
	}
	// The lowest level's walls start at its elevation; other levels' walls
	// reach down through the floor thickness.
	let lowest = null;
	for (const l of home.levels.values()) {
		if (!lowest || l.elevation < lowest.elevation || (l.elevation === lowest.elevation && l.elevationIndex < lowest.elevationIndex)) lowest = l;
	}
	home.lowestLevelId = lowest ? lowest.id : null;
	// Storeys: the distinct elevations of the viewable levels, lowest first.
	// (Sweet Home 3D allows several levels at one elevation; they are one storey.)
	home.storeys = [...new Set([...home.levels.values()].filter((l) => l.viewable).map((l) => l.elevation))].sort((a, b) => a - b);
	// Their names, for the headset's level picker: the names of the viewable
	// levels at each elevation ("" when unnamed). Shown as plain canvas text.
	home.storeyNames = home.storeys.map((e) => [...home.levels.values()]
		.filter((l) => l.viewable && l.elevation === e && l.name)
		.sort((a, b) => a.elevationIndex - b.elevationIndex)
		.map((l) => l.name.slice(0, 40)).join(' / '));

	const levelOf = (id) => (id ? home.levels.get(id) || null : null);
	const levelHidden = (id) => { const l = levelOf(id); return l ? !l.viewable : false; };

	const readPiece = (n, inheritedLevel) => {
		const a = n.attrs;
		const levelId = a.level || inheritedLevel || null;
		let rot = null;
		if (a.modelRotation) {
			rot = a.modelRotation.trim().split(/[\s,]+/).map(Number);
			if (rot.length !== 9 || rot.some((v) => !Number.isFinite(v))) rot = null;
		}
		const materials = n.children.filter((c) => c.name === 'material').map((c) => ({
			name: c.attrs.name || '', key: c.attrs.key || c.attrs.name || '',
			color: color(c.attrs, 'color'),
			shininess: c.attrs.shininess !== undefined ? num(c.attrs, 'shininess') : null,
			texture: childTexture(c, 'texture'),
		}));
		let flags = num(a, 'modelFlags', 0) | 0;
		if (bool(a, 'backFaceShown', false)) flags |= 1;
		return {
			kind: n.name === 'doorOrWindow' ? 'door' : n.name === 'light' ? 'light' : 'piece',
			id: a.id || '', name: a.name || '', model: a.model || null, levelId,
			x: num(a, 'x'), y: num(a, 'y'), elevation: num(a, 'elevation'), angle: num(a, 'angle'),
			width: num(a, 'width', 1), depth: num(a, 'depth', 1), height: num(a, 'height', 1),
			pitch: num(a, 'pitch'), roll: num(a, 'roll'),
			mirrored: bool(a, 'modelMirrored', false),
			modelRotation: rot,
			centeredAtOrigin: bool(a, 'modelCenteredAtOrigin', true),
			modelFlags: flags,
			color: color(a, 'color'),
			shininess: a.shininess !== undefined ? num(a, 'shininess') : null,
			texture: childTexture(n, 'texture'),
			materials,
			// Door/window wall cut-out, as fractions of the piece size
			wallLeft: num(a, 'wallLeft', 0), wallWidth: num(a, 'wallWidth', 1),
			wallTop: num(a, 'wallTop', 0), wallHeight: num(a, 'wallHeight', 1),
			// Lights: where the bulbs are, as fractions of the piece size
			// (diameter is a fraction of the width, or null for the default).
			lightSources: n.name === 'light' ? n.children.filter((c) => c.name === 'lightSource').map((c) => ({
				x: num(c.attrs, 'x', 0.5), y: num(c.attrs, 'y', 0.5), z: num(c.attrs, 'z', 0.5),
				diameter: c.attrs.diameter !== undefined ? num(c.attrs, 'diameter', 0) || null : null,
			})) : [],
		};
	};

	// Furniture groups: recurse; children hold absolute coordinates.
	const collect = (nodes, inheritedLevel) => {
		for (const n of nodes) {
			if (n.name === 'pieceOfFurniture' || n.name === 'doorOrWindow' || n.name === 'light') {
				const p = readPiece(n, inheritedLevel);
				if (bool(n.attrs, 'visible', true) && !levelHidden(p.levelId)) home.pieces.push(p);
			} else if (n.name === 'furnitureGroup') {
				if (!bool(n.attrs, 'visible', true)) continue;
				const lvl = n.attrs.level || inheritedLevel || null;
				if (levelHidden(lvl)) continue;
				collect(n.children, lvl);
			}
		}
	};

	for (const n of root.children) {
		const a = n.attrs;
		switch (n.name) {
			case 'environment':
				if (a.groundColor) home.groundColor = color(a, 'groundColor');
				if (a.skyColor) home.skyColor = color(a, 'skyColor');
				for (const c of n.children) {
					if (c.name === 'observerCamera' && c.attrs.attribute === 'observerCamera') home.observer = readCamera(c.attrs);
				}
				break;
			case 'compass':
				home.compass = { northDirection: num(a, 'northDirection', 0), latitude: num(a, 'latitude', Math.PI / 4) };
				break;
			case 'observerCamera':
				if (a.attribute === 'observerCamera') home.observer = readCamera(a);
				break;
			case 'wall':
				if (levelHidden(a.level)) break;
				home.walls.push({
					id: a.id || '', levelId: a.level || null,
					xStart: num(a, 'xStart'), yStart: num(a, 'yStart'), xEnd: num(a, 'xEnd'), yEnd: num(a, 'yEnd'),
					height: a.height !== undefined ? num(a, 'height') : null,
					heightAtEnd: a.heightAtEnd !== undefined ? num(a, 'heightAtEnd') : null,
					thickness: num(a, 'thickness', 10),
					arcExtent: num(a, 'arcExtent', 0),
					wallAtStart: a.wallAtStart || null, wallAtEnd: a.wallAtEnd || null,
					leftColor: color(a, 'leftSideColor'), rightColor: color(a, 'rightSideColor'), topColor: color(a, 'topColor'),
					leftTexture: childTexture(n, 'leftSideTexture'), rightTexture: childTexture(n, 'rightSideTexture'),
				});
				break;
			case 'room':
				if (levelHidden(a.level)) break;
				home.rooms.push({
					id: a.id || '', name: a.name || '', levelId: a.level || null,
					points: n.children.filter((c) => c.name === 'point').map((c) => [num(c.attrs, 'x'), num(c.attrs, 'y')]),
					floorVisible: bool(a, 'floorVisible', true), ceilingVisible: bool(a, 'ceilingVisible', true),
					floorColor: color(a, 'floorColor'), ceilingColor: color(a, 'ceilingColor'),
					floorTexture: childTexture(n, 'floorTexture'), ceilingTexture: childTexture(n, 'ceilingTexture'),
				});
				break;
		}
	}
	collect(root.children, null);
	return home;
}

function readCamera(a) {
	return { x: num(a, 'x'), y: num(a, 'y'), z: num(a, 'z', 170), yaw: num(a, 'yaw'), pitch: num(a, 'pitch') };
}

// ---------------------------------------------------------------------------
// Geometry buckets: one mesh per material for walls, floors and ceilings
// ---------------------------------------------------------------------------

class Buckets {
	constructor() { this.map = new Map(); }

	/** One bucket per storey and material key, so storeys can be shown and hidden. */
	get(key, makeMaterial, storey = 0) {
		const k = `${storey}|${key}`;
		let b = this.map.get(k);
		if (!b) { b = { material: makeMaterial(), storey, pos: [], nrm: [], uv: [] }; this.map.set(k, b); }
		return b;
	}

	/** Adds a triangle; vertices are flipped if needed so its normal points along `hint`. */
	tri(b, p0, p1, p2, uv0, uv1, uv2, hint) {
		const e1 = new THREE.Vector3().subVectors(p1, p0);
		const e2 = new THREE.Vector3().subVectors(p2, p0);
		const n = e1.cross(e2);
		if (n.lengthSq() < 1e-12) return;
		n.normalize();
		if (hint && n.dot(hint) < 0) { [p1, p2] = [p2, p1]; [uv1, uv2] = [uv2, uv1]; n.negate(); }
		for (const [p, uv] of [[p0, uv0], [p1, uv1], [p2, uv2]]) {
			b.pos.push(p.x, p.y, p.z); b.nrm.push(n.x, n.y, n.z); b.uv.push(uv[0], uv[1]);
		}
	}

	quad(b, p, uv, hint) {
		this.tri(b, p[0], p[1], p[2], uv[0], uv[1], uv[2], hint);
		this.tri(b, p[0], p[2], p[3], uv[0], uv[2], uv[3], hint);
	}

	toMeshes(name) {
		const g = new THREE.Group();
		g.name = name;
		for (const [key, b] of this.map) {
			if (!b.pos.length) continue;
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
			geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
			geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
			const mesh = new THREE.Mesh(geo, b.material);
			mesh.name = `${name}:${key}`;
			mesh.userData.storey = b.storey;
			g.add(mesh);
		}
		return g;
	}
}

// ---------------------------------------------------------------------------
// Scene building
// ---------------------------------------------------------------------------

const DEFAULT_WALL_COLOR = 0xffffff;
const DEFAULT_FLOOR_COLOR = 0xe8e2d6;
const DEFAULT_CEILING_COLOR = 0xffffff;
const MIN_SIZE = 0.001; // Sweet Home 3D's ModelManager minimum size (avoids /0 on flat models)
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

function surfaceMaterial(colorHex, map) {
	const m = new THREE.MeshLambertMaterial({ color: map ? 0xffffff : colorHex, map: map || null });
	m.userData.sh3d = true;
	return m;
}

/**
 * Builds the three.js scene for a parsed home.
 *
 * @param home   result of parseHome()
 * @param opts.loadModel(ref)    -> Promise<THREE.Object3D|null> raw model for a ZIP entry name
 * @param opts.loadTexture(ref)  -> THREE.Texture|null for a ZIP entry name (may load asynchronously)
 * @param opts.onProgress(done, total)
 * @returns { root, stats, observer, bounds, lamps, storeys, storeyNames, plan }  root is scaled to metres.
 */
export async function buildHome(home, opts = {}) {
	const loadModel = opts.loadModel || (async () => null);
	const loadTexture = opts.loadTexture || (() => null);

	// Texture cache keyed by image entry; UVs are pre-divided by the tile size,
	// so one texture object can be shared by every surface using that image.
	const texCache = new Map();
	const getTexture = (t) => {
		if (!t || !t.image) return null;
		if (!texCache.has(t.image)) {
			const tex = loadTexture(t.image);
			if (tex) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; }
			texCache.set(t.image, tex || null);
		}
		return texCache.get(t.image);
	};

	const root = new THREE.Group();
	root.name = 'sh3d-home';
	const levelElevation = (id) => home.levels.get(id)?.elevation ?? 0;
	// Which storey (0 = lowest) an item on a level belongs to.
	const storeys = home.storeys?.length ? home.storeys : [0];
	const storeyOf = (id) => Math.max(0, storeys.indexOf(levelElevation(id)));

	// Furniture first: door/window placement feeds the wall openings.
	const furniture = new THREE.Group();
	furniture.name = 'furniture';
	const placed = [];
	const modelCache = new Map();
	const normCache = new Map();
	let done = 0;
	for (const piece of home.pieces) {
		const obj = await buildPiece(piece, { home, loadModel, getTexture, modelCache, normCache, levelElevation });
		obj.object.userData.storey = storeyOf(piece.levelId);
		furniture.add(obj.object);
		placed.push({ piece, effHeight: obj.effHeight });
		opts.onProgress?.(++done, home.pieces.length);
	}

	const doors = placed.filter((p) => p.piece.kind === 'door');
	const wallsGroup = buildWalls(home, doors, getTexture, levelElevation, storeyOf);
	const { floors, ceilings } = buildRooms(home, getTexture, levelElevation, storeyOf);

	// Bulbs of the light pieces, in metres: drawn as glowing lamps at night.
	// Position as in Sweet Home 3D's PhotoRenderer: fractions of the piece's
	// width, depth and height, turned by the piece's angle.
	const lamps = [];
	for (const { piece: p } of placed) {
		for (const s of p.lightSources || []) {
			let xl = -p.width / 2 + s.x * p.width;
			const yl = p.depth / 2 - s.y * p.depth;
			if (p.mirrored) xl = -xl;
			const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
			lamps.push({
				position: new THREE.Vector3(p.x + xl * cos - yl * sin, levelElevation(p.levelId) + p.elevation + s.z * p.height, p.y + xl * sin + yl * cos).multiplyScalar(0.01),
				radius: (s.diameter ? s.diameter * p.width / 2 : 3.25) * 0.01,
				storey: storeyOf(p.levelId),
			});
		}
	}

	root.add(wallsGroup.group, floors, ceilings, furniture);

	// Ground: 3 m larger than the model on every side, just below zero.
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const bounds = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 250, 100)) : box.clone();
	const pad = 300;
	const gw = bounds.max.x - bounds.min.x + 2 * pad;
	const gd = bounds.max.z - bounds.min.z + 2 * pad;
	const groundGeo = new THREE.PlaneGeometry(gw, gd).rotateX(-Math.PI / 2);
	const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ color: home.groundColor }));
	ground.position.set((bounds.min.x + bounds.max.x) / 2, -0.5, (bounds.min.z + bounds.max.z) / 2);
	ground.name = 'ground';
	root.add(ground);

	root.scale.setScalar(0.01);
	root.updateMatrixWorld(true);

	return {
		root,
		bounds: bounds.clone().applyMatrix4(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01)),
		observer: home.observer,
		lamps,
		storeys: storeys.length,
		storeyNames: home.storeyNames ?? [],
		// Plan outlines in metres (x, z), for choosing where stepping inside
		// lands (js/rooms.js): each room with its name and floor height, each
		// doorway, and each wall as a line with its thickness.
		plan: {
			rooms: home.rooms.filter((r) => r.points.length >= 3).map((r) => ({
				name: r.name, storey: storeyOf(r.levelId), floorY: levelElevation(r.levelId) / 100,
				points: r.points.map(([x, y]) => [x / 100, y / 100]),
			})),
			// Doorways (doors standing on their floor, at least 1.5 m tall; not
			// windows): where the teleport's hotspots go (js/hotspots.js).
			doors: doors.map((d) => d.piece).filter((d) => d.elevation < 10 && d.height >= 150).map((d) => ({
				x: d.x / 100, z: d.y / 100, angle: d.angle, width: d.width / 100, depth: d.depth / 100,
				storey: storeyOf(d.levelId), floorY: levelElevation(d.levelId) / 100,
			})),
			walls: home.walls.map((w) => ({
				a: [w.xStart / 100, w.yStart / 100], b: [w.xEnd / 100, w.yEnd / 100], thickness: w.thickness / 100,
				storey: storeyOf(w.levelId), floorY: levelElevation(w.levelId) / 100,
			})),
		},
		stats: {
			walls: home.walls.length,
			rooms: home.rooms.length,
			pieces: home.pieces.length,
			doorsAndWindows: doors.length,
			openings: wallsGroup.openings,
			levels: home.levels.size,
			lamps: lamps.length,
			missingModels: [...modelCache.values()].filter((v) => v === null).length,
		},
	};
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** Bounding box of every vertex of `obj` (and its descendants) transformed by `m`. */
function boundsUnder(obj, m) {
	const box = new THREE.Box3();
	const v = new THREE.Vector3();
	const full = new THREE.Matrix4();
	obj.updateMatrixWorld(true);
	obj.traverse((o) => {
		const pos = o.geometry?.attributes?.position;
		if (!o.isMesh || !pos) return;
		full.multiplyMatrices(m, o.matrixWorld);
		for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(full));
	});
	return box;
}

const centerTranslation = (box) => {
	const c = box.getCenter(new THREE.Vector3());
	return new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
};

/**
 * Sweet Home 3D's ModelManager.getNormalizedTransform: centre the model,
 * apply modelRotation (row-major 3x3), re-centre, then scale to 1x1x1.
 */
function normalizedTransform(model, rotation, centeredAtOrigin) {
	let box = boundsUnder(model, new THREE.Matrix4());
	if (box.isEmpty()) return null;
	let m = centerTranslation(box);
	if (rotation && !isIdentity3(rotation)) {
		const r = rotation;
		const rot = new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
		m = rot.multiply(m);
		box = boundsUnder(model, m);
		if (centeredAtOrigin) m = centerTranslation(box).multiply(m);
	}
	const s = box.getSize(new THREE.Vector3());
	const scale = new THREE.Matrix4().makeScale(1 / Math.max(MIN_SIZE, s.x), 1 / Math.max(MIN_SIZE, s.y), 1 / Math.max(MIN_SIZE, s.z));
	return scale.multiply(m);
}

function isIdentity3(r) {
	const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	return r.every((v, i) => Math.abs(v - id[i]) < 1e-6);
}

let unitBoxGeometry = null;
function unitBox() {
	unitBoxGeometry ||= new THREE.BoxGeometry(1, 1, 1);
	const mesh = new THREE.Mesh(unitBoxGeometry, new THREE.MeshLambertMaterial({ color: 0xc0c0c0 }));
	mesh.name = 'missing-model';
	return mesh;
}

/**
 * The piece transform from ModelManager.getPieceOfFurnitureNormalizedModelTransformation,
 * applied on top of the normalised (1x1x1, centred) model.
 * Returns { matrix, effHeight }.
 */
export function pieceTransform(piece, normalizedModel, levelElev) {
	const scale = new THREE.Matrix4().makeScale(piece.width * (piece.mirrored ? -1 : 1), piece.height, piece.depth);
	let h = scale;
	let effHeight = piece.height;
	if (piece.pitch !== 0 || piece.roll !== 0) {
		// rotZ(-roll) . rotX(-pitch) . scale, then re-centre on the rotated bounds
		const j = new THREE.Matrix4().makeRotationZ(-piece.roll)
			.multiply(new THREE.Matrix4().makeRotationX(-piece.pitch))
			.multiply(scale);
		const box = normalizedModel ? boundsUnder(normalizedModel, j) : new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(j);
		h = centerTranslation(box).multiply(j);
		effHeight = Math.max(MIN_SIZE, box.max.y - box.min.y);
	}
	const m = new THREE.Matrix4().makeTranslation(piece.x, piece.elevation + effHeight / 2 + levelElev, piece.y)
		.multiply(new THREE.Matrix4().makeRotationY(-piece.angle))
		.multiply(h);
	return { matrix: m, effHeight };
}

async function buildPiece(piece, ctx) {
	// Load (or reuse) the raw model for this ZIP entry.
	let raw = null;
	if (piece.model) {
		if (!ctx.modelCache.has(piece.model)) {
			let loaded = null;
			try { loaded = await ctx.loadModel(piece.model); } catch (e) { console.warn('Model failed', piece.model, e); }
			ctx.modelCache.set(piece.model, loaded);
		}
		raw = ctx.modelCache.get(piece.model);
	}
	const model = raw ? raw.clone(true) : unitBox();

	// Normalise to a centred 1x1x1 box (cached per model + rotation).
	const normKey = `${raw ? piece.model : '#box'}|${piece.modelRotation ? piece.modelRotation.join(',') : ''}|${piece.centeredAtOrigin}`;
	if (!ctx.normCache.has(normKey)) ctx.normCache.set(normKey, normalizedTransform(model, piece.modelRotation, piece.centeredAtOrigin));
	const norm = ctx.normCache.get(normKey);
	if (!norm) {
		// No faces at all (e.g. Sweet Home 3D's wireframe light-source sphere,
		// which it only shows while selected): nothing to draw.
		const empty = new THREE.Group();
		empty.name = piece.name;
		return { object: empty, effHeight: piece.height };
	}

	const normalized = new THREE.Group();
	normalized.matrixAutoUpdate = false;
	normalized.matrix.copy(norm);
	normalized.add(model);

	const { matrix, effHeight } = pieceTransform(piece, (piece.pitch || piece.roll) ? normalized : null, ctx.levelElevation(piece.levelId));
	const wrapper = new THREE.Group();
	wrapper.name = piece.name;
	wrapper.matrixAutoUpdate = false;
	wrapper.matrix.copy(matrix);
	wrapper.add(normalized);
	wrapper.userData.piece = { name: piece.name, kind: piece.kind };

	applyPieceMaterials(model, piece, ctx.getTexture, !!raw);
	return { object: wrapper, effHeight };
}

/** Piece colour / texture / per-material overrides and back-face flag. */
function applyPieceMaterials(model, piece, getTexture, isRealModel) {
	const side = piece.modelFlags & 1 ? THREE.DoubleSide : THREE.FrontSide;
	const pieceTex = piece.color === null ? getTexture(piece.texture) : null;
	const byName = new Map(piece.materials.map((m) => [m.name, m]));
	const cloned = new Map();

	const adapt = (mat) => {
		if (cloned.has(mat)) return cloned.get(mat);
		const override = byName.get(mat.name);
		const needsClone = piece.color !== null || pieceTex || override || mat.side !== side || (piece.shininess !== null && isRealModel);
		let m = mat;
		if (needsClone) {
			m = mat.clone();
			m.side = side;
			if (piece.color !== null) {
				m.color.setHex(piece.color);
				m.map = null;
			} else if (pieceTex) {
				m.color.setHex(0xffffff);
				m.map = pieceTex;
			} else if (override) {
				if (override.color !== null) { m.color.setHex(override.color); m.map = null; }
				const t = getTexture(override.texture);
				if (t) { m.color.setHex(0xffffff); m.map = t; }
			}
			m.needsUpdate = true;
		}
		cloned.set(mat, m);
		return m;
	};

	model.traverse((o) => {
		if (!o.isMesh) return;
		o.material = Array.isArray(o.material) ? o.material.map(adapt) : adapt(o.material);
	});
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Subtracts intervals `cuts` from [lo, hi]; returns sorted solid intervals. */
function subtractIntervals(lo, hi, cuts) {
	let solid = [[lo, hi]];
	for (const [c0, c1] of cuts) {
		const next = [];
		for (const [a, b] of solid) {
			if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
			if (c0 > a) next.push([a, c0]);
			if (c1 < b) next.push([c1, b]);
		}
		solid = next;
	}
	return solid.filter(([a, b]) => b - a > 0.01);
}

/** Centre of a round wall's arc (Sweet Home 3D's Wall.getArcCircleCenter). */
export function arcCircleCenter(w) {
	const chord = Math.hypot(w.xEnd - w.xStart, w.yEnd - w.yStart);
	const theta = Math.abs(w.arcExtent) > Math.PI ? -(Math.PI + w.arcExtent) / 2 : (Math.PI - w.arcExtent) / 2;
	const d = -Math.tan(theta) * chord / 2;
	const phi = Math.atan2(w.xStart - w.xEnd, w.yEnd - w.yStart);
	return [(w.xStart + w.xEnd) / 2 + d * Math.cos(phi), (w.yStart + w.yEnd) / 2 + d * Math.sin(phi)];
}

/**
 * Splits a wall into straight segments (1 for straight walls, ~12 for round
 * ones). Each segment: { sx, sy, ex, ey, len, uOffset, extStart, extEnd }.
 */
function wallSegments(w) {
	const t = w.thickness;
	const joinExt = t / 2 - 0.1; // extend by thickness/2 - 1 mm at joined ends
	const extS = w.wallAtStart ? joinExt : 0;
	const extE = w.wallAtEnd ? joinExt : 0;
	if (!w.arcExtent || Math.abs(w.arcExtent) < 1e-4) {
		return [{ sx: w.xStart, sy: w.yStart, ex: w.xEnd, ey: w.yEnd, len: Math.hypot(w.xEnd - w.xStart, w.yEnd - w.yStart), uOffset: 0, extStart: extS, extEnd: extE }];
	}
	const [cx, cy] = arcCircleCenter(w);
	const r = Math.hypot(w.xStart - cx, w.yStart - cy);
	const a0 = Math.atan2(w.yStart - cy, w.xStart - cx);
	const n = Math.max(3, Math.round(12 * Math.min(1, Math.abs(w.arcExtent) / Math.PI) + 0.5));
	const step = w.arcExtent / n;
	// Overlap neighbouring segments so the outside of the bend has no gaps.
	const bendExt = (t / 2) * Math.tan(Math.abs(step) / 2);
	const segs = [];
	let u = 0;
	for (let i = 0; i < n; i++) {
		const sx = cx + r * Math.cos(a0 + step * i), sy = cy + r * Math.sin(a0 + step * i);
		const ex = cx + r * Math.cos(a0 + step * (i + 1)), ey = cy + r * Math.sin(a0 + step * (i + 1));
		const len = Math.hypot(ex - sx, ey - sy);
		segs.push({ sx, sy, ex, ey, len, uOffset: u, extStart: i === 0 ? extS : bendExt, extEnd: i === n - 1 ? extE : bendExt });
		u += len;
	}
	return segs;
}

function buildWalls(home, doors, getTexture, levelElevation, storeyOf = () => 0) {
	const buckets = new Buckets();
	let openingCount = 0;

	for (const w of home.walls) {
		const level = w.levelId ? home.levels.get(w.levelId) : null;
		const lvlElev = level ? level.elevation : 0;
		const bottom = level && w.levelId !== home.lowestLevelId ? lvlElev - level.floorThickness : lvlElev;
		const h0 = w.height ?? home.wallHeight;
		const h1 = w.heightAtEnd ?? h0;
		const segs = wallSegments(w);
		const totalLen = segs.reduce((s, g) => s + g.len, 0) || 1;
		const storey = storeyOf(w.levelId);
		const topAt = (uGlobal) => lvlElev + h0 + (h1 - h0) * Math.min(1, Math.max(0, uGlobal / totalLen));

		// Materials per side
		const sideMat = (col, tex) => {
			const map = getTexture(tex);
			if (map) {
				const key = `tex:${tex.image}`;
				return { bucket: buckets.get(key, () => surfaceMaterial(0xffffff, map), storey), tw: tex.width || 100, th: tex.height || 100 };
			}
			const c = col ?? DEFAULT_WALL_COLOR;
			return { bucket: buckets.get(`col:${c}`, () => surfaceMaterial(c), storey), tw: 100, th: 100 };
		};
		const sides = [
			{ s: +1, mat: sideMat(w.leftColor, w.leftTexture) },
			{ s: -1, mat: sideMat(w.rightColor, w.rightTexture) },
		];
		const topBucket = w.topColor !== null ? buckets.get(`col:${w.topColor}`, () => surfaceMaterial(w.topColor), storey) : null;

		for (const seg of segs) {
			if (seg.len < 0.01) continue;
			const dx = (seg.ex - seg.sx) / seg.len, dy = (seg.ey - seg.sy) / seg.len;
			const nx = dy, ny = -dx; // left side direction: (sin a, -cos a)
			const half = w.thickness / 2;
			const uA = -seg.extStart, uB = seg.len + seg.extEnd;

			// Door/window openings projected on this segment's axis
			const openings = [];
			// (A door on another level only cuts this wall if their heights
			// overlap, which the vertical clipping below takes care of.)
			for (const { piece: p, effHeight } of doors) {
				const pa = Math.atan2(dy, dx);
				if (Math.abs(Math.sin(p.angle - pa)) > 0.15) continue; // not parallel to the wall
				const rx = p.x - seg.sx, ry = p.y - seg.sy;
				const dist = Math.abs(rx * nx + ry * ny);
				// Must really overlap the wall (by > 5 mm): a piece placed flush
				// against a wall, like a fireplace opening, must not cut it.
				if (dist > half + p.depth / 2 - 0.5) continue;
				// Horizontal extent of the cut-out across the piece width
				let xl = -p.width / 2 + p.wallLeft * p.width;
				let xr = -p.width / 2 + (p.wallLeft + p.wallWidth) * p.width;
				if (p.mirrored) [xl, xr] = [-xr, -xl];
				const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
				const proj = (x) => (p.x + ca * x - seg.sx) * dx + (p.y + sa * x - seg.sy) * dy;
				let u0 = proj(xl), u1 = proj(xr);
				if (u0 > u1) [u0, u1] = [u1, u0];
				if (u1 <= uA || u0 >= uB) continue;
				const top = levelElevation(p.levelId) + p.elevation + effHeight;
				const z1 = top - p.wallTop * p.height;
				const z0 = z1 - p.wallHeight * p.height;
				if (z1 <= bottom || z0 >= Math.max(topAt(0), topAt(totalLen))) continue;
				openings.push({ u0: Math.max(u0, uA), u1: Math.min(u1, uB), z0, z1 });
			}
			openingCount += openings.length;

			// Sweep along u: cells between every opening edge.
			const cuts = new Set([uA, uB]);
			for (const o of openings) { cuts.add(o.u0); cuts.add(o.u1); }
			const us = [...cuts].sort((a, b) => a - b);
			const cells = [];
			for (let i = 0; i < us.length - 1; i++) {
				const ua = us[i], ub = us[i + 1];
				if (ub - ua < 0.01) continue;
				const mid = (ua + ub) / 2;
				const tA = topAt(seg.uOffset + ua), tB = topAt(seg.uOffset + ub);
				const cutsZ = openings.filter((o) => o.u0 <= mid && o.u1 >= mid).map((o) => [o.z0, o.z1]);
				const solid = subtractIntervals(bottom, Math.max(tA, tB), cutsZ);
				// Mark the top interval so its upper edge follows a sloping top.
				cells.push({ ua, ub, tA, tB, solid: solid.map(([z0, z1]) => ({ z0, z1, isTop: z1 >= Math.max(tA, tB) - 1e-6 })) });
			}

			const P = (u, s, z) => new THREE.Vector3(seg.sx + dx * u + nx * s, z, seg.sy + dy * u + ny * s);
			const upper = (iv, cell, u) => (iv.isTop ? (u === cell.ua ? cell.tA : cell.tB) : iv.z1);

			for (const { s, mat } of sides) {
				const out = new THREE.Vector3(nx * s, 0, ny * s);
				const uvU = (u) => (s > 0 ? -(seg.uOffset + u) : seg.uOffset + u) / mat.tw; // run left-to-right as seen from that side
				const uvZ = (z) => (z - lvlElev) / mat.th;
				for (let ci = 0; ci < cells.length; ci++) {
					const cell = cells[ci];
					for (const iv of cell.solid) {
						const zA = upper(iv, cell, cell.ua), zB = upper(iv, cell, cell.ub);
						// Outer face of this side
						buckets.quad(mat.bucket,
							[P(cell.ua, s * half, iv.z0), P(cell.ub, s * half, iv.z0), P(cell.ub, s * half, zB), P(cell.ua, s * half, zA)],
							[[uvU(cell.ua), uvZ(iv.z0)], [uvU(cell.ub), uvZ(iv.z0)], [uvU(cell.ub), uvZ(zB)], [uvU(cell.ua), uvZ(zA)]], out);
						// Upper face (wall top, or window sill), half thickness on this side
						const topB = iv.isTop && topBucket ? topBucket : mat.bucket;
						buckets.quad(topB,
							[P(cell.ua, 0, zA), P(cell.ub, 0, zB), P(cell.ub, s * half, zB), P(cell.ua, s * half, zA)],
							[[uvU(cell.ua), 0], [uvU(cell.ub), 0], [uvU(cell.ub), half / mat.th], [uvU(cell.ua), half / mat.th]], UP);
						// Lower face under a lintel (not at the wall bottom)
						if (iv.z0 > bottom + 0.01) {
							buckets.quad(mat.bucket,
								[P(cell.ua, 0, iv.z0), P(cell.ub, 0, iv.z0), P(cell.ub, s * half, iv.z0), P(cell.ua, s * half, iv.z0)],
								[[uvU(cell.ua), 0], [uvU(cell.ub), 0], [uvU(cell.ub), half / mat.th], [uvU(cell.ua), half / mat.th]], DOWN);
						}
					}
					// End caps / reveals: parts of this cell not covered by the neighbour.
					for (const [u, nb, dir] of [[cell.ua, cells[ci - 1], -1], [cell.ub, cells[ci + 1], +1]]) {
						const nbSolid = nb && Math.abs((dir < 0 ? nb.ub : nb.ua) - u) < 1e-6 ? nb.solid.map((iv) => [iv.z0, iv.isTop ? Infinity : iv.z1]) : [];
						for (const iv of cell.solid) {
							const zTop = upper(iv, cell, u);
							for (const [z0, z1] of subtractIntervals(iv.z0, zTop, nbSolid)) {
								buckets.quad(mat.bucket,
									[P(u, 0, z0), P(u, s * half, z0), P(u, s * half, z1), P(u, 0, z1)],
									[[0, uvZ(z0)], [half / mat.tw, uvZ(z0)], [half / mat.tw, uvZ(z1)], [0, uvZ(z1)]],
									new THREE.Vector3(dx * dir, 0, dy * dir));
							}
						}
					}
				}
			}
		}
	}
	return { group: buckets.toMeshes('walls'), openings: openingCount };
}

// ---------------------------------------------------------------------------
// Rooms: floors (facing up) and ceilings (facing down)
// ---------------------------------------------------------------------------

function buildRooms(home, getTexture, levelElevation, storeyOf = () => 0) {
	const floorB = new Buckets();
	const ceilB = new Buckets();
	for (const room of home.rooms) {
		if (room.points.length < 3) continue;
		const level = room.levelId ? home.levels.get(room.levelId) : null;
		const floorY = level ? level.elevation : 0;
		const ceilY = level ? level.elevation + level.height : home.wallHeight;
		const contour = room.points.map(([x, y]) => new THREE.Vector2(x, y));
		// Drop consecutive duplicate points, which break triangulation.
		const pts = contour.filter((p, i) => p.distanceTo(contour[(i + 1) % contour.length]) > 1e-3);
		if (pts.length < 3) continue;
		let tris;
		try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { continue; }

		const add = (buckets, y, col, defCol, tex, hint, prefix) => {
			const map = getTexture(tex);
			const tw = map ? tex.width || 100 : 100, th = map ? tex.height || 100 : 100;
			const storey = storeyOf(room.levelId);
			const b = map
				? buckets.get(`tex:${tex.image}`, () => surfaceMaterial(0xffffff, map), storey)
				: buckets.get(`${prefix}:${col ?? defCol}`, () => surfaceMaterial(col ?? defCol), storey);
			for (const [i, j, k] of tris) {
				const v = [pts[i], pts[j], pts[k]];
				buckets.tri(b, ...v.map((p) => new THREE.Vector3(p.x, y, p.y)), ...v.map((p) => [p.x / tw, -p.y / th]), hint);
			}
		};
		if (room.floorVisible) add(floorB, floorY, room.floorColor, DEFAULT_FLOOR_COLOR, room.floorTexture, UP, 'floor');
		if (room.ceilingVisible) add(ceilB, ceilY, room.ceilingColor, DEFAULT_CEILING_COLOR, room.ceilingTexture, DOWN, 'ceiling');
	}
	return { floors: floorB.toMeshes('floors'), ceilings: ceilB.toMeshes('ceilings') };
}
