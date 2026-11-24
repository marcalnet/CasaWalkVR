// File loading: .sh3d, OBJ (plain, multiple files or zipped), GLB/glTF, DAE, 3DS.
//
// Files are kept in memory as a map of path -> bytes ("entries"). Loaders ask
// for related files (MTL, textures, .bin) through a LoadingManager URL
// modifier that serves those bytes as blob URLs. Blob URLs are only ever made
// from our own in-memory bytes, never from a picked File (Quest Browser bug,
// see SPEC.md).
//
// Safety: a model file is untrusted input. Nothing in it can make the app
// contact another server (links inside models are blocked, see EntryStore),
// and archives that would unpack to an absurd size are refused.

import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { defaultMtlFor, usedMaterialNames, definedMaterialNames, isWindowPaneName, WINDOW_PANE_OPACITY } from './obj-defaults.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { parseHome, buildHome } from './sh3d.js';

export class UserError extends Error {}

// ---------------------------------------------------------------------------
// Bytes helpers
// ---------------------------------------------------------------------------

/** Detects a file format from its first bytes. */
export function sniff(bytes) {
	if (!bytes || bytes.length < 4) return 'unknown';
	const b = bytes;
	if (b[0] === 0x50 && b[1] === 0x4b) return 'zip'; // "PK"
	if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) return 'glb'; // "glTF"
	if (b[0] === 0x4d && b[1] === 0x4d) return '3ds'; // 0x4D4D main chunk
	const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).trimStart();
	if (head.startsWith('<?xml') || head.startsWith('<COLLADA')) {
		return /COLLADA/i.test(new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4096)))) ? 'dae' : 'xml';
	}
	if (head.startsWith('{')) return 'gltf';
	return 'obj';
}

function imageMime(bytes) {
	if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
	if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
	if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
	if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
	return 'application/octet-stream';
}

// A valid 1x1 opaque white PNG (stands in for missing or blocked images).
export const WHITE_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';

// Limits for ZIP archives (.sh3d, .zip and zipped models inside them), counted
// over one opened file including nested archives. A "zip bomb" is a tiny file
// that unpacks to gigabytes and crashes the browser tab.
export const ZIP_LIMITS = { bytes: 1024 * 1048576, entries: 50000 };

const normPath = (p) => {
	const out = [];
	for (const part of p.replace(/\\/g, '/').split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') out.pop(); else out.push(part);
	}
	return out.join('/');
};
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const extOf = (p) => (p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '');

// ---------------------------------------------------------------------------
// In-memory entry store
// ---------------------------------------------------------------------------

/** A set of in-memory files addressable by path, served to loaders as blob URLs. */
export class EntryStore {
	/**
	 * @param entries Map<path, Uint8Array>
	 * @param budget  { bytes, entries } still allowed for nested archives (shared with them)
	 */
	constructor(entries = new Map(), budget = { ...ZIP_LIMITS }) {
		this.entries = entries;
		this.budget = budget;
		this.urls = new Map();
		this.children = []; // stores of zipped models inside this one
		this.blocked = 0; // links to other servers found inside models (never fetched)
		this.notes = new Set(); // things the status line should mention (e.g. textures that can't be shown)
		this.busy = false;
		this.waiters = [];
		this.manager = new THREE.LoadingManager();
		this.manager.onStart = () => { this.busy = true; };
		this.manager.onLoad = () => { this.busy = false; for (const f of this.waiters.splice(0)) f(); };
		// Loaders request "mem:<path>"; we answer with a blob URL for those bytes.
		// Embedded data (data: URIs, and blob: URLs the glTF loader makes from the
		// file's own bytes) passes through. Anything else is a link to another
		// server written inside the model: it is never fetched, so opening a
		// model cannot be used to track who opens it or to reach other sites.
		this.manager.setURLModifier((url) => {
			if (url.startsWith('mem:')) {
				const path = this.find(url.slice(4));
				// A missing texture becomes a 1x1 white pixel rather than a failed request.
				return path ? this.url(path) : WHITE_PIXEL;
			}
			if (/^(data|blob):/i.test(url)) return url;
			this.blocked++;
			return WHITE_PIXEL;
		});
	}

	/** Unpacks a ZIP, refusing archives over the size and entry limits before unpacking anything. */
	static fromZip(bytes, budget = { ...ZIP_LIMITS }) {
		let files;
		let tooBig = false;
		try {
			// The filter sees each entry's declared size first; fflate never writes
			// past that size, so the declared total is a true upper bound.
			files = unzipSync(bytes, { filter: (f) => {
				if (tooBig || f.name.endsWith('/')) return false;
				budget.entries -= 1;
				budget.bytes -= f.originalSize;
				if (budget.entries < 0 || budget.bytes < 0) tooBig = true;
				return !tooBig;
			} });
		} catch (e) { throw new UserError('This file is not a valid ZIP archive.'); }
		if (tooBig) throw new UserError(`This file is too large to open: it unpacks to more than ${Math.round(ZIP_LIMITS.bytes / 1048576)} MB or ${ZIP_LIMITS.entries.toLocaleString('en-GB')} files.`);
		return new EntryStore(new Map(Object.entries(files)), budget);
	}

	/** Opens a ZIP stored inside this one (a zipped model); it is disposed with this store. */
	child(bytes) {
		const c = EntryStore.fromZip(bytes, this.budget);
		this.children.push(c);
		return c;
	}

	/** Resolves once every texture requested so far (here and in nested archives) has loaded or failed. */
	whenIdle() {
		const mine = this.busy ? new Promise((r) => this.waiters.push(r)) : Promise.resolve();
		return Promise.all([mine, ...this.children.map((c) => c.whenIdle())]);
	}

	/** Total links to other servers that were blocked, including nested archives. */
	blockedLinks() { return this.children.reduce((n, c) => n + c.blockedLinks(), this.blocked); }

	/** Notes for the status line, including nested archives'. */
	allNotes() { return [...new Set([...this.notes, ...this.children.flatMap((c) => c.allNotes())])]; }

	get(path) { const p = this.find(path); return p ? this.entries.get(p) : null; }

	/**
	 * Finds an entry: exact, URL-decoded (Sweet Home 3D encodes spaces as %20
	 * in model paths), case-insensitive, by file name only, and finally by file
	 * name ignoring the extension (an MTL may say .jpg for a .png).
	 */
	find(path) {
		if (!path) return null;
		const candidates = [normPath(path)];
		try { const d = normPath(decodeURIComponent(path)); if (d !== candidates[0]) candidates.push(d); } catch { /* not encoded */ }
		for (const p of candidates) if (this.entries.has(p)) return p;
		const keys = [...this.entries.keys()];
		for (const p of candidates) {
			const lower = p.toLowerCase();
			const k = keys.find((k) => k.toLowerCase() === lower);
			if (k) return k;
		}
		for (const p of candidates) {
			const base = baseName(p.toLowerCase());
			const k = keys.find((k) => baseName(k.toLowerCase()) === base);
			if (k) return k;
		}
		for (const p of candidates) {
			const stem = (s) => baseName(s.toLowerCase()).replace(/\.[^.]*$/, '');
			const dir = dirOf(p.toLowerCase());
			const k = keys.find((k) => dirOf(k.toLowerCase()) === dir && stem(k) === stem(p));
			if (k) return k;
		}
		return null;
	}

	url(path) {
		if (!this.urls.has(path)) {
			const bytes = this.entries.get(path);
			this.urls.set(path, URL.createObjectURL(new Blob([bytes], { type: imageMime(bytes) })));
		}
		return this.urls.get(path);
	}

	/**
	 * Frees the unpacked files and their blob URLs. Call once the model is
	 * built and its textures have loaded (whenIdle): the scene keeps its own
	 * geometry and decoded images, so the raw files are only wasted memory.
	 */
	dispose() {
		for (const u of this.urls.values()) URL.revokeObjectURL(u);
		this.urls.clear();
		this.entries.clear();
		for (const c of this.children.splice(0)) c.dispose();
	}
}

// ---------------------------------------------------------------------------
// Materials: Lambert everywhere, Phong only where the model asks for shininess
// ---------------------------------------------------------------------------

function simplifyMaterial(src) {
	if (src.userData?.simplified) return src;
	const opacity = src.opacity ?? 1;
	const params = {
		name: src.name, color: src.color ? src.color.clone() : new THREE.Color(0xcccccc),
		map: src.map || null, opacity, transparent: src.transparent || opacity < 1,
		alphaTest: src.alphaTest || 0, side: src.side ?? THREE.FrontSide,
		vertexColors: !!src.vertexColors,
	};
	if (params.map) params.map.colorSpace = THREE.SRGBColorSpace;
	const shiny = src.isMeshPhongMaterial && src.shininess > 1 && src.specular && (src.specular.r + src.specular.g + src.specular.b) > 0.15;
	const m = shiny ? new THREE.MeshPhongMaterial({ ...params, shininess: src.shininess, specular: src.specular.clone() }) : new THREE.MeshLambertMaterial(params);
	if (m.transparent) m.depthWrite = false;
	m.userData.simplified = true;
	return m;
}

function simplifyMaterials(obj) {
	const seen = new Map();
	const conv = (m) => { if (!seen.has(m)) seen.set(m, simplifyMaterial(m)); return seen.get(m); };
	obj.traverse((o) => {
		if (!o.isMesh) return;
		o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material || new THREE.MeshLambertMaterial());
		o.castShadow = o.receiveShadow = false;
	});
	return seeThroughPanes(obj);
}

/**
 * Sweet Home 3D's window panes (js/obj-defaults.js): a part named
 * "sweethome3d_window_pane…" (its own name or a group's above it, whatever
 * the format) whose material is opaque is shown at half opacity. A material
 * the pane shares with an opaque part (a frame) is copied for the pane only,
 * one copy per material, so panes still merge into few draw calls. A
 * material that is already transparent keeps its own opacity.
 */
function seeThroughPanes(obj) {
	const copies = new Map();
	const glass = (m) => {
		if (m.transparent || m.opacity < 1) return m;
		if (!copies.has(m)) {
			const c = m.clone();
			c.opacity = WINDOW_PANE_OPACITY;
			c.transparent = true;
			c.depthWrite = false; // as simplifyMaterial does for any transparent material
			copies.set(m, c);
		}
		return copies.get(m);
	};
	obj.traverse((o) => {
		if (!o.isMesh) return;
		let pane = false;
		for (let n = o; n && !pane; n = n === obj ? null : n.parent) pane = isWindowPaneName(n.name);
		if (pane) o.material = Array.isArray(o.material) ? o.material.map(glass) : glass(o.material);
	});
	return obj;
}

// ---------------------------------------------------------------------------
// Compressed glTF: Draco and meshopt geometry; KTX2 textures
// ---------------------------------------------------------------------------
//
// Many exports (SketchUp, Rhino, Blender, gltfpack, glTF-Transform) compress
// their GLB. The decoders are vendored (scripts/vendor.js) and load only when
// a file declares that it needs them. They run WebAssembly, and Draco decodes
// in workers that three.js builds from the vendored files: that is why the
// page's security policy allows 'wasm-unsafe-eval' (WebAssembly only, never
// JavaScript eval) and blob: workers.
//
// KTX2 (Basis Universal) textures can't be decoded under that policy: the
// transcoder three.js ships builds functions from strings at run time. Such a
// file still opens: with its ordinary fallback images when it has them,
// otherwise with plain surfaces in the model's own colours, and a note.

const LIBS = new URL('../vendor/three/addons/libs/', import.meta.url).href;

/** glTF extensions that need a decoder, with the name used in messages. */
export const GLTF_COMPRESSION = {
	KHR_draco_mesh_compression: 'Draco',
	EXT_meshopt_compression: 'meshopt',
	KHR_meshopt_compression: 'meshopt',
	KHR_texture_basisu: 'KTX2',
};

/** The extensions a .glb or .gltf file declares: { used, required }. */
export function gltfExtensions(bytes) {
	let json;
	try {
		if (sniff(bytes) === 'glb') {
			// 12-byte header, then the first chunk: length, type "JSON", data.
			const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			if (dv.getUint32(16, true) !== 0x4e4f534a) return { used: [], required: [] };
			json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
		} else {
			json = JSON.parse(new TextDecoder().decode(bytes));
		}
	} catch { return { used: [], required: [] }; }
	const list = (v) => (Array.isArray(v) ? [...new Set(v.filter((e) => typeof e === 'string'))] : []);
	const required = list(json?.extensionsRequired);
	return { used: [...new Set([...list(json?.extensionsUsed), ...required])], required };
}

// One shared instance of each decoder, created on first use. A failed start
// is forgotten, so the next file tries again.
const decoders = new Map();
function decoder(name, make) {
	if (!decoders.has(name)) decoders.set(name, make().catch((e) => { decoders.delete(name); throw e; }));
	return decoders.get(name);
}

const DECODERS = {
	// The Draco loader keeps its own loading manager: it fetches our vendored
	// decoder files, which the model's store would (rightly) refuse.
	draco: () => import('three/addons/loaders/DRACOLoader.js').then(({ DRACOLoader }) => {
		const d = new DRACOLoader();
		d.setDecoderPath(`${LIBS}draco/gltf/`); // WebAssembly build (the default where WebAssembly exists)
		d.setWorkerLimit(2); // each worker holds its own decoder: keep memory low on Quest 2
		return d;
	}),
	meshopt: () => import('three/addons/libs/meshopt_decoder.module.js').then(async ({ MeshoptDecoder }) => {
		await MeshoptDecoder.ready; // compiles its WebAssembly on the page
		return MeshoptDecoder;
	}),
};

/**
 * Stands in for a KTX2 texture loader when a file has no fallback images:
 * every KTX2 texture becomes one white pixel, so surfaces show the model's
 * own colours instead of the whole file failing.
 */
const KTX2_STAND_IN = {
	load(url, onLoad) {
		const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
		t.needsUpdate = true;
		onLoad(t);
	},
};

/** Gives the glTF loader the decoders this file needs; returns notes for the status line. */
async function useDecoders(loader, exts) {
	const notes = [];
	if (exts.used.includes('KHR_draco_mesh_compression')) loader.setDRACOLoader(await decoder('draco', DECODERS.draco));
	if (exts.used.includes('EXT_meshopt_compression') || exts.used.includes('KHR_meshopt_compression')) loader.setMeshoptDecoder(await decoder('meshopt', DECODERS.meshopt));
	if (exts.used.includes('KHR_texture_basisu')) {
		// Without a KTX2 loader, three.js uses each texture's fallback image.
		// A file that requires KTX2 has none: plain surfaces, and say so.
		if (exts.required.includes('KHR_texture_basisu')) {
			loader.setKTX2Loader(KTX2_STAND_IN);
			notes.push("Its KTX2 textures can't be shown yet, so its surfaces are plain.");
		}
	}
	return notes;
}

/** A glTF that fails to load: say which compression it uses, as that is the usual cause. */
function explainGltfError(e, exts) {
	const kinds = [...new Set(exts.used.map((x) => GLTF_COMPRESSION[x]).filter(Boolean))];
	if (kinds.length && !(e instanceof UserError)) return new Error(`${e?.message || e} (the file uses ${kinds.join(' and ')} compression)`);
	return e;
}

/** For the browser tests: starts each decoder and reports whether it really runs here. */
export async function checkDecoders() {
	const within = (p, ms = 15000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('no answer (blocked?)')), ms))]);
	const out = {};
	try { out.meshopt = typeof (await within(decoder('meshopt', DECODERS.meshopt))).decodeGltfBuffer === 'function' || 'no decoder'; } catch (e) { out.meshopt = e.message; }
	// Draco compiles its WebAssembly inside a worker. Bad input must come back
	// as a decoding error: no answer at all means the worker or its
	// WebAssembly was blocked.
	try {
		const d = await within(decoder('draco', DECODERS.draco));
		await within(new Promise((ok, no) => d.parse(new Uint8Array(64).fill(7).buffer, ok, no)));
		out.draco = 'decoded garbage?';
	} catch (e) { out.draco = /blocked|Refused|CompileError/i.test(e.message) ? e.message : true; }
	return out;
}

// ---------------------------------------------------------------------------
// Model loading from entries
// ---------------------------------------------------------------------------

const MODEL_EXTS = ['obj', 'glb', 'gltf', 'dae', '3ds'];

/** Loads a model from an entry path; the format is detected from its bytes. */
export async function loadModelEntry(store, path) {
	const bytes = store.get(path);
	if (!bytes) throw new Error(`Missing entry ${path}`);
	const kind = sniff(bytes);
	if (kind === 'zip') {
		// Nested zip: find the model inside it. Its blob URLs stay alive for
		// the textures until the parent store is disposed.
		const inner = store.child(bytes);
		const main = findMainModel([...inner.entries.keys()], inner);
		if (!main) throw new Error(`No model inside ${path}`);
		return loadModelEntry(inner, main);
	}
	const folder = dirOf(store.find(path));
	const base = `mem:${folder}`;
	switch (kind) {
		case 'glb':
		case 'gltf': {
			const loader = new GLTFLoader(store.manager);
			const exts = gltfExtensions(bytes);
			for (const n of await useDecoders(loader, exts)) store.notes.add(n);
			const data = kind === 'glb' ? bytes.slice().buffer : new TextDecoder().decode(bytes);
			let gltf;
			try { gltf = await loader.parseAsync(data, base); } catch (e) { throw explainGltfError(e, exts); }
			return simplifyMaterials(gltf.scene);
		}
		case 'dae': {
			const loader = new ColladaLoader(store.manager);
			const collada = loader.parse(new TextDecoder().decode(bytes), base);
			return simplifyMaterials(collada.scene);
		}
		case '3ds': {
			const loader = new TDSLoader(store.manager);
			loader.setResourcePath(base);
			return simplifyMaterials(loader.parse(bytes.slice().buffer, base));
		}
		default:
			return loadObj(store, new TextDecoder().decode(bytes), folder);
	}
}

/**
 * Prepares OBJ text for three.js's OBJLoader:
 *
 * 1. Removes line ("l") and point ("p") records. A single stray "l" record
 *    makes OBJLoader turn a whole object into LineSegments; Sweet Home 3D
 *    ignores them, and we never draw lines anyway.
 * 2. Triangulates faces with 4+ corners properly. OBJLoader splits polygons
 *    into a fan from the first corner, which only works for convex shapes:
 *    on a U-shaped face (e.g. Sweet Home 3D's door frame) the fan fills in
 *    the doorway. Concave quads and all larger polygons go through earcut.
 */
export function prepareObjText(text) {
	const verts = [];
	let vtCount = 0, vnCount = 0;
	const out = [];
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
	for (const line of text.split(/\r?\n/)) {
		const t = line.trimStart();
		if (t.startsWith('v ')) {
			const p = t.split(/\s+/);
			verts.push(new THREE.Vector3(+p[1], +p[2], +p[3]));
		} else if (t.startsWith('vt ')) {
			vtCount++;
		} else if (t.startsWith('vn ')) {
			vnCount++;
		} else if (/^[lp]\s/.test(t)) {
			continue;
		} else if (t.startsWith('f ')) {
			let toks = t.split(/\s+/).slice(1).filter(Boolean);
			if (t.includes('/')) {
				const clean = cleanFaceRefs(toks, vtCount, vnCount);
				if (clean !== toks) { toks = clean; if (toks.length < 4) { out.push(`f ${toks.join(' ')}`); continue; } }
			}
			if (toks.length >= 4) {
				const tris = triangulateFace(toks, verts, a, b, c);
				if (tris) { for (const tri of tris) out.push(`f ${tri.join(' ')}`); continue; }
			}
		}
		out.push(line);
	}
	return out.join('\n');
}

/**
 * Face corners are "v", "v/vt", "v//vn" or "v/vt/vn". OBJLoader only checks
 * the first corner of each triangle for vt/vn, so a face that mixes corners
 * with and without them, or points at normals that don't exist, ends up with
 * NaN normals (black) once triangles start at a different corner. Keep a
 * texture/normal reference only if every corner has a valid one.
 * Returns the same array when nothing needs changing.
 */
function cleanFaceRefs(toks, vtCount, vnCount) {
	const parts = toks.map((tok) => tok.split('/'));
	const valid = (s, count) => {
		if (s === undefined || s === '') return false;
		const i = parseInt(s, 10);
		return Number.isFinite(i) && i !== 0 && (i > 0 ? i <= count : count + i >= 0);
	};
	const keepVt = parts.every((p) => valid(p[1], vtCount));
	const keepVn = parts.every((p) => valid(p[2], vnCount));
	const hasVt = parts.some((p) => p[1]), hasVn = parts.some((p) => p[2]);
	if ((keepVt || !hasVt) && (keepVn || !hasVn)) return toks;
	return parts.map((p) => p[0] + (keepVt ? `/${p[1]}` : keepVn ? '/' : '') + (keepVn ? `/${p[2]}` : ''));
}

/** Returns triangles (arrays of 3 face tokens) for an OBJ polygon, or null to keep it as is. */
function triangulateFace(toks, verts, a, b, c) {
	const pts = toks.map((tok) => {
		const i = parseInt(tok, 10);
		return verts[i < 0 ? verts.length + i : i - 1];
	});
	if (pts.some((p) => !p)) return null;
	// Polygon normal (Newell's method)
	const n = new THREE.Vector3();
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i], q = pts[(i + 1) % pts.length];
		n.x += (p.y - q.y) * (p.z + q.z);
		n.y += (p.z - q.z) * (p.x + q.x);
		n.z += (p.x - q.x) * (p.y + q.y);
	}
	if (n.lengthSq() === 0) return null;
	const faces = (idx) => idx.map((tri) => {
		// Keep each triangle facing the same way as the polygon.
		const [i, j, k] = tri;
		a.subVectors(pts[j], pts[i]); b.subVectors(pts[k], pts[i]);
		return c.crossVectors(a, b).dot(n) < 0 ? [toks[i], toks[k], toks[j]] : [toks[i], toks[j], toks[k]];
	});
	if (pts.length === 4) {
		// Convex quad: the usual split works; otherwise split along the other diagonal.
		const ok = (i, j, k) => { a.subVectors(pts[j], pts[i]); b.subVectors(pts[k], pts[i]); return c.crossVectors(a, b).dot(n) > 0; };
		if (ok(0, 1, 2) && ok(0, 2, 3)) return null;
		return faces([[1, 2, 3], [1, 3, 0]]);
	}
	// Project on the plane most facing the normal, then earcut.
	const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
	const flat = pts.map((p) => (az >= ax && az >= ay ? new THREE.Vector2(p.x, p.y) : ax >= ay ? new THREE.Vector2(p.y, p.z) : new THREE.Vector2(p.z, p.x)));
	let idx;
	try { idx = THREE.ShapeUtils.triangulateShape(flat, []); } catch { return null; }
	if (!idx || idx.length < pts.length - 2) return null;
	return faces(idx);
}

async function loadObj(store, text, folder) {
	text = prepareObjText(text);
	const objLoader = new OBJLoader(store.manager);
	// The model's own .mtl (OBJLoader supports a single material library),
	// then Sweet Home 3D's built-in materials for the names it doesn't define
	// (js/obj-defaults.js): a name the .mtl defines always wins.
	let mtlText = '';
	for (const name of [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1])) {
		const mtlBytes = store.get(folder + name);
		if (!mtlBytes) continue;
		mtlText = new TextDecoder().decode(mtlBytes);
		break;
	}
	mtlText += '\n' + defaultMtlFor(usedMaterialNames(text), definedMaterialNames(mtlText));
	if (mtlText.trim()) {
		const creator = new MTLLoader(store.manager).parse(mtlText, `mem:${folder}`);
		creator.preload();
		objLoader.setMaterials(creator);
	}
	return simplifyMaterials(objLoader.parse(text));
}

function findMainModel(paths, store) {
	const byExt = (ext) => paths.find((p) => extOf(p) === ext && !p.startsWith('__MACOSX/'));
	for (const ext of MODEL_EXTS) { const p = byExt(ext); if (p) return p; }
	// Sweet Home 3D entries may have no extension: sniff them.
	for (const p of paths) { const k = sniff(store.entries.get(p)); if (['glb', 'dae', '3ds'].includes(k)) return p; }
	return null;
}

// ---------------------------------------------------------------------------
// Public entry point: open what the user picked or downloaded
// ---------------------------------------------------------------------------

export const UNIT_SCALE = { cm: 0.01, m: 1, mm: 0.001, in: 0.0254 };

/**
 * Opens one or more files.
 * @param files  [{ name, bytes: Uint8Array }]
 * @param opts   { units: 'auto'|'cm'|'m'|'mm'|'in', onProgress(text),
 *                 makeTexture(ref) (a Sweet Home 3D texture image; default: decoded
 *                 by the browser. Node, which decodes no images, passes a stand-in) }
 * @returns { kind: 'sh3d'|'model', root, bounds, observer, stats, store }
 */
export async function openFiles(files, opts = {}) {
	if (!files.length) throw new UserError('No file selected.');
	const progress = opts.onProgress || (() => {});

	let store;
	try {
		let mainPath = null;
		if (files.length === 1 && sniff(files[0].bytes) === 'zip') {
			progress('Unzipping…');
			store = EntryStore.fromZip(files[0].bytes);
			if (store.entries.has('Home.xml')) return await openSh3d(store, progress, opts.makeTexture);
			if (store.entries.has('Home')) throw new UserError('Re-save this file in Sweet Home 3D 5.3 or later.');
			mainPath = findMainModel([...store.entries.keys()], store);
			if (!mainPath) throw new UserError('No 3D model (.sh3d, .obj, .glb, .dae, .3ds) found inside this ZIP.');
		} else {
			// Picked files are copied into a new Map, so disposing the store
			// never touches the caller's list (it is saved under Recent).
			store = new EntryStore(new Map(files.map((f) => [f.name, f.bytes])));
			const names = files.map((f) => f.name);
			mainPath = names.find((n) => MODEL_EXTS.includes(extOf(n))) || names.find((n) => ['glb', 'dae', '3ds'].includes(sniff(store.entries.get(n)))) || names[0];
		}

		progress('Loading model…');
		const fmt = sniff(store.get(mainPath));
		const object = await loadModelEntry(store, mainPath);
		const isMetric = fmt === 'glb' || fmt === 'gltf' || fmt === 'dae'; // glTF is metres; COLLADA declares its own unit
		return placeModel(object, store, { units: isMetric ? 'm' : opts.units || 'auto', name: baseName(mainPath) });
	} catch (e) {
		store?.dispose(); // a failed load must not leave its files in memory
		throw e;
	}
}

/** Lets the page repaint (progress text) if the last pause was a while ago. */
let lastPause = 0;
async function breathe() {
	const now = Date.now();
	if (now - lastPause < 50) return;
	await new Promise((r) => setTimeout(r, 0));
	lastPause = Date.now();
}

async function openSh3d(store, progress, makeTexture = null) {
	progress('Reading Home.xml…');
	const home = parseHome(new TextDecoder().decode(store.entries.get('Home.xml')));
	const texLoader = new THREE.TextureLoader(store.manager);
	makeTexture ??= (ref) => texLoader.load(`mem:${ref}`);
	const built = await buildHome(home, {
		// Pause between models so the "Loading furniture" count is actually
		// painted instead of the page freezing until the end.
		loadModel: async (ref) => { await breathe(); return loadModelEntry(store, ref); },
		loadTexture: (ref) => (store.find(ref) ? makeTexture(ref) : null),
		onProgress: (done, total) => progress(`Loading furniture ${done}/${total}…`),
	});
	return { kind: 'sh3d', ...built, home, store };
}

/** Wraps a generic model: unit conversion, centred on the origin, resting on y = 0. */
function placeModel(object, store, { units, name }) {
	const box = new THREE.Box3().setFromObject(object);
	const size = box.getSize(new THREE.Vector3());
	let unit = units;
	if (unit === 'auto') unit = Math.max(size.x, size.y, size.z) > 100 ? 'cm' : 'm';
	const s = UNIT_SCALE[unit] ?? 1;
	const root = new THREE.Group();
	root.name = name;
	const center = box.getCenter(new THREE.Vector3());
	object.position.set(-center.x, -box.min.y, -center.z);
	const scaled = new THREE.Group();
	scaled.scale.setScalar(s);
	scaled.add(object);
	root.add(scaled);

	const bounds = new THREE.Box3().setFromObject(root);
	const bsize = bounds.getSize(new THREE.Vector3());
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(bsize.x + 6, bsize.z + 6).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xa8a8a8 }));
	ground.position.y = -0.005;
	ground.name = 'ground';
	root.add(ground);
	root.updateMatrixWorld(true);
	return { kind: 'model', root, bounds, observer: null, unit, stats: {}, store };
}
