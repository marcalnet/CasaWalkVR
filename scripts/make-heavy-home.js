// Generates examples/heavy-home.sh3d: a deliberately heavy home for
// measuring (code audit, stage A3). It is not offered on the page: open it
// with ?model=examples/heavy-home.sh3d. What it stresses:
//   - three storeys of 6 x 4 rooms (72 rooms);
//   - in every room a detailed sculpture, two dense plants, a shelf of books
//     in several colours, a table, chairs and armchairs;
//   - furniture painted in many different colours (each a material of its own,
//     so a draw call of its own after merging, per storey), whole pieces and
//     single materials of a piece (as Sweet Home 3D's "Modify furniture" does);
//   - textures, as homes made in Sweet Home 3D have them: parquet, stone slab
//     and tiled floors, wallpaper on the top storey's walls, upholstered
//     armchairs, a marble pedestal; six images, two of them 2048 px (the
//     app's largest), drawn here as PNGs;
//   - about a million triangles in all (just under the budget: only its draw calls are over).
// It stays small on disk because every room reuses the same few models (a
// Sweet Home 3D file can point many pieces at one model).
//
// Everything in it is original and written here. Run: npm run heavy-home
// (the output is committed; it is byte-for-byte reproducible).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';

const out = path.resolve(import.meta.dirname, '../examples/heavy-home.sh3d');
const PI = Math.PI;
const f3 = (n) => +n.toFixed(3);

// ---------------------------------------------------------------------------
// Models (centimetres; x = width, y = up, z = depth). Each is a list of parts
// ({ verts, faces, mat }); toObj() writes them as one OBJ with its MTL.
// ---------------------------------------------------------------------------

const MATERIALS = {
	stone: [0.78, 0.76, 0.72], pedestal: [0.3, 0.3, 0.32], leaf: [0.3, 0.5, 0.28], leafLight: [0.45, 0.62, 0.35], pot: [0.7, 0.42, 0.3],
	shelf: [0.55, 0.4, 0.26], bookRed: [0.62, 0.2, 0.18], bookBlue: [0.2, 0.32, 0.55], bookGreen: [0.24, 0.45, 0.3],
	bookOchre: [0.78, 0.6, 0.25], bookGrey: [0.5, 0.5, 0.52], bookCream: [0.9, 0.86, 0.75],
	wood: [0.66, 0.5, 0.33], fabric: [0.5, 0.52, 0.58], white: [0.95, 0.95, 0.93], glass: [0.75, 0.88, 0.95, 0.35],
};

/** A box part: 8 corners, 6 quads. */
function box(x0, y0, z0, x1, y1, z1, mat) {
	const verts = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
	const faces = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
	return { verts, faces, mat };
}

/** A sphere part (lat x lon segments), centred at c, radius r. */
function sphere([cx, cy, cz], r, lat, lon, mat) {
	const verts = [], faces = [];
	for (let i = 0; i <= lat; i++) {
		const t = (i / lat) * PI;
		for (let j = 0; j < lon; j++) {
			const p = (j / lon) * 2 * PI;
			// (A gentle ripple, so it reads as a sculpture rather than a ball.)
			const rr = r * (1 + 0.08 * Math.sin(5 * p) * Math.sin(3 * t));
			verts.push([f3(cx + rr * Math.sin(t) * Math.cos(p)), f3(cy + rr * Math.cos(t)), f3(cz + rr * Math.sin(t) * Math.sin(p))]);
		}
	}
	for (let i = 0; i < lat; i++) {
		for (let j = 0; j < lon; j++) {
			const a = i * lon + j, b = i * lon + (j + 1) % lon, c = (i + 1) * lon + (j + 1) % lon, d = (i + 1) * lon + j;
			faces.push([a, d, c, b]);
		}
	}
	return { verts, faces, mat };
}

function toObj(name, parts) {
	const lines = [`# ${name}: generated for CasaWalk (heavy test home)`, `mtllib ${name}.mtl`];
	const used = new Set();
	let n = 1, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
	for (const { verts, faces, mat } of parts) {
		used.add(mat);
		for (const v of verts) {
			lines.push(`v ${v[0]} ${v[1]} ${v[2]}`);
			for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
		}
		lines.push(`usemtl ${mat}`);
		for (const f of faces) lines.push(`f ${f.map((i) => i + n).join(' ')}`);
		n += verts.length;
	}
	const mtl = [...used].map((m) => { const [r, g, b, d] = MATERIALS[m]; return `newmtl ${m}\nKd ${r} ${g} ${b}\n${d !== undefined ? `d ${d}\n` : ''}`; }).join('\n');
	return { obj: `${lines.join('\n')}\n`, mtl, size: [0, 1, 2].map((k) => f3(hi[k] - lo[k])) };
}

// A little seeded random, so the plants' leaves are the same every run.
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const legs = (w, d, h, t, mat) => [box(0, 0, 0, t, h, t, mat), box(w - t, 0, 0, w, h, t, mat), box(0, 0, d - t, t, h, d, mat), box(w - t, 0, d - t, w, h, d, mat)];

const MODELS = {
	// About 7,000 triangles: the detail a catalogue sculpture or a scanned object brings.
	sculpture: () => [box(0, 0, 0, 40, 90, 40, 'pedestal'), sphere([20, 115, 20], 25, 44, 76, 'stone')],
	// About 2,400 triangles: many small leaves, in two greens, on a pot.
	plant: () => {
		seed = 7;
		const parts = [box(15, 0, 15, 45, 35, 45, 'pot')];
		for (let i = 0; i < 200; i++) {
			const a = rnd() * 2 * PI, r = 4 + rnd() * 22, y = 35 + rnd() * 80, s = 3 + rnd() * 4;
			const x = 30 + r * Math.cos(a), z = 30 + r * Math.sin(a);
			parts.push(box(f3(x - s), f3(y), f3(z - s / 3), f3(x + s), f3(y + s / 2), f3(z + s / 3), i % 3 ? 'leaf' : 'leafLight'));
		}
		return parts;
	},
	// A shelf with 90 books in six colours: one model, seven materials.
	bookshelf: () => {
		const parts = [box(0, 0, 0, 4, 200, 32, 'shelf'), box(116, 0, 0, 120, 200, 32, 'shelf'), box(4, 0, 0, 116, 200, 2, 'shelf'),
			...[0, 48, 96, 144, 196].map((y) => box(4, y, 2, 116, y + 4, 32, 'shelf'))];
		const books = ['bookRed', 'bookBlue', 'bookGreen', 'bookOchre', 'bookGrey', 'bookCream'];
		for (let row = 0; row < 4; row++) {
			let x = 6;
			for (let k = 0; k < 22 && x < 112; k++) {
				const w = 2 + ((k * 7 + row * 3) % 4), h = 28 + ((k * 5 + row) % 14);
				parts.push(box(x, row * 48 + 4, 6, Math.min(114, x + w), row * 48 + 4 + h, 28, books[(k + row) % books.length]));
				x += w + 0.4;
			}
		}
		return parts;
	},
	table: () => [box(0, 72, 0, 140, 76, 80, 'wood'), ...legs(140, 80, 72, 6, 'wood')],
	chair: () => [box(0, 43, 0, 42, 47, 42, 'wood'), box(0, 47, 0, 42, 90, 4, 'wood'), ...legs(42, 42, 43, 4, 'wood')],
	armchair: () => [box(0, 12, 0, 80, 42, 80, 'fabric'), box(0, 42, 0, 80, 80, 18, 'fabric'), box(0, 42, 18, 14, 62, 80, 'fabric'), box(66, 42, 18, 80, 62, 80, 'fabric'), ...legs(80, 80, 12, 6, 'wood')],
	door: () => [box(0, 0, 0, 5, 205, 15, 'white'), box(85, 0, 0, 90, 205, 15, 'white'), box(5, 200, 0, 85, 205, 15, 'white'), box(5, 0, 6, 85, 200, 9, 'wood')],
	window: () => [box(0, 0, 0, 120, 6, 15, 'white'), box(0, 114, 0, 120, 120, 15, 'white'), box(0, 6, 0, 6, 114, 15, 'white'), box(114, 6, 0, 120, 114, 15, 'white'), box(6, 6, 7, 114, 114, 8, 'glass')],
};

// ---------------------------------------------------------------------------
// Textures: plain patterns drawn pixel by pixel into PNGs (no image library).
// (The file's entries: the textures first, then the models as they are used.)
const entries = {};
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}='${String(v).replace(/&/g, '&amp;').replace(/'/g, '&apos;')}'`).join('');
// ---------------------------------------------------------------------------

/** A PNG (8-bit RGB) of w x h pixels; pixel(x, y) returns [r, g, b]. Rows use the Up filter, so repeats compress to almost nothing. */
function png(w, h, pixel) {
	const stride = w * 3 + 1, raw = Buffer.alloc(stride * h);
	let prev = Buffer.alloc(w * 3), row = Buffer.alloc(w * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); row[3 * x] = r; row[3 * x + 1] = g; row[3 * x + 2] = b; }
		raw[y * stride] = 2; // (Up: each byte minus the one above it)
		for (let i = 0; i < w * 3; i++) raw[y * stride + 1 + i] = (row[i] - prev[i]) & 255;
		[prev, row] = [row, prev];
	}
	const chunk = (type, data) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const shade = ([r, g, b], k) => [clamp8(r * k), clamp8(g * k), clamp8(b * k)];
const TEXTURES = {
	// Oak parquet: planks 128 px wide, 640 long, staggered, each its own tone, with dark joints.
	'parquet.png': [2048, (x, y) => {
		const col = x >> 7, off = (col * 237) % 640, plank = Math.floor((y + off) / 640);
		const edge = (x & 127) < 2 || (y + off) % 640 < 2;
		const k = 0.85 + 0.15 * (((col * 31 + plank * 17) % 7) / 6) + 0.03 * Math.sin(x * 0.3);
		return edge ? [92, 64, 40] : shade([196, 150, 102], k);
	}],
	// Stone slabs: 512 px squares in three greys, with mortar.
	'slabs.png': [2048, (x, y) => {
		const i = x >> 9, j = y >> 9, edge = (x & 511) < 4 || (y & 511) < 4;
		return edge ? [120, 118, 112] : shade([188, 184, 174], 0.88 + 0.06 * ((i * 3 + j * 5) % 3) + 0.02 * Math.sin(y * 0.05));
	}],
	// Ceramic tiles: 128 px, two tones in a check, white grout.
	'tiles.png': [1024, (x, y) => ((x & 127) < 3 || (y & 127) < 3 ? [235, 235, 230] : (((x >> 7) + (y >> 7)) & 1 ? [92, 128, 140] : [210, 220, 222]))],
	// Upholstery: an 8 px weave.
	'fabric.png': [1024, (x, y) => (((x >> 3) + (y >> 3)) & 1 ? shade([120, 72, 64], 0.9 + 0.1 * ((x & 7) / 7)) : shade([140, 88, 78], 0.9 + 0.1 * ((y & 7) / 7)))],
	// Marble: soft veins.
	'marble.png': [1024, (x, y) => { const v = Math.sin((x + 2 * y) * 0.02 + 3 * Math.sin(y * 0.01)); return shade([236, 232, 226], 0.86 + 0.14 * Math.abs(v)); }],
	// Wallpaper: a pale stripe.
	'wallpaper.png': [512, (x) => ((x >> 5) & 1 ? [232, 226, 210] : [244, 240, 230])],
};
for (const [name, [size, fn]] of Object.entries(TEXTURES)) entries[`textures/${name}`] = png(size, size, fn);

/** A texture child element (tile size in cm, as Sweet Home 3D writes it). */
const tex = (attribute, image, size) => `<texture${attrs({ attribute, name: image.replace('.png', ''), image: `textures/${image}`, width: size, height: size })}/>`;

// ---------------------------------------------------------------------------
// The home
// ---------------------------------------------------------------------------

const modelIndex = new Map();
function modelRef(name) {
	if (!modelIndex.has(name)) {
		const i = modelIndex.size;
		const { obj, mtl, size } = toObj(name, MODELS[name]());
		entries[`${i}/${name}.obj`] = strToU8(obj);
		entries[`${i}/${name}.mtl`] = strToU8(mtl);
		modelIndex.set(name, { ref: `${i}/${name}.obj`, size, triangles: obj.split('\nf ').length - 1 });
	}
	return modelIndex.get(name);
}

const xml = [];
let nextId = 0;

/**
 * A piece: furniture or an opening. color (hex AARRGGBB) paints the whole
 * piece; texture (an image name) covers the whole piece; materials ([{ name,
 * color } or { name, texture }]) change single materials of its model.
 */
function piece(kind, label, model, level, x, y, { angle = 0, elevation = 0, color, texture, materials } = {}) {
	const { ref, size: [w, h, d] } = modelRef(model);
	const a = attrs({ id: `${kind}-${nextId++}`, level, name: label, model: ref, x: f3(x), y: f3(y), elevation: elevation || undefined, angle: angle || undefined, width: w, depth: d, height: h, color });
	const kids = [
		...(texture ? [tex('texture', texture, 40)] : []),
		...(materials ?? []).map((m) => (m.texture ? `<material${attrs({ name: m.name, key: m.name })}>${tex('texture', m.texture, 50)}</material>` : `<material${attrs({ name: m.name, key: m.name, color: m.color })}/>`)),
	];
	xml.push(kids.length ? `<${kind}${a}>${kids.join('')}</${kind}>` : `<${kind}${a}/>`);
}

// 36 paint colours for the furniture: a different set in each room, so the
// merge meets many materials (as a real home furnished from a catalogue does).
const PAINT = Array.from({ length: 36 }, (_, i) => {
	const h = (i * 47) % 360, s = 0.35 + (i % 3) * 0.15, l = 0.35 + (i % 4) * 0.1;
	const k = (n) => { const a = s * Math.min(l, 1 - l), t = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1)))); };
	return `FF${[k(0), k(8), k(4)].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
});

const COLS = 6, ROWS = 4, RW = 500, RD = 400, STOREYS = 3, H = 250, SLAB = 12, T = 15;
const W = COLS * RW, D = ROWS * RD;
const levels = Array.from({ length: STOREYS }, (_, s) => ({ id: `level-${s}`, name: s ? `Floor ${s}` : 'Ground floor', elevation: s * (H + SLAB) }));

for (const [s, L] of levels.entries()) {
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const x0 = c * RW, y0 = r * RD, n = (s * ROWS + r) * COLS + c;
			const paint = (k) => PAINT[(n * 5 + k) % PAINT.length];
			piece('pieceOfFurniture', 'Sculpture', 'sculpture', L.id, x0 + 70, y0 + 70, { materials: [{ name: 'pedestal', texture: 'marble.png' }] });
			piece('pieceOfFurniture', 'Plant', 'plant', L.id, x0 + RW - 60, y0 + 60);
			piece('pieceOfFurniture', 'Plant', 'plant', L.id, x0 + 60, y0 + RD - 60, { angle: 1 });
			piece('pieceOfFurniture', 'Bookshelf', 'bookshelf', L.id, x0 + RW / 2, y0 + 30);
			piece('pieceOfFurniture', 'Table', 'table', L.id, x0 + RW / 2, y0 + RD / 2 + 20, { color: paint(0) });
			for (const [dx, dy, a] of [[-40, -55, 0], [40, -55, 0], [-40, 95, PI], [40, 95, PI]]) piece('pieceOfFurniture', 'Chair', 'chair', L.id, x0 + RW / 2 + dx, y0 + RD / 2 + dy, { angle: a, color: paint(1) });
			// Armchairs: upholstered (a texture over the whole piece) in every other room; elsewhere their
			// fabric recoloured and their legs kept (one material of the model changed).
			const chair = n % 2 ? { texture: 'fabric.png' } : { materials: [{ name: 'fabric', color: paint(2) }] };
			piece('pieceOfFurniture', 'Armchair', 'armchair', L.id, x0 + RW - 70, y0 + RD - 80, { angle: PI, ...chair });
			piece('pieceOfFurniture', 'Armchair', 'armchair', L.id, x0 + RW - 170, y0 + RD - 80, { angle: PI, materials: [{ name: 'fabric', color: paint(3) }] });
			// Doors: east wall (to the next room) and south wall (to the room below), where there is one.
			if (c < COLS - 1) piece('doorOrWindow', 'Door', 'door', L.id, x0 + RW, y0 + RD / 2, { angle: PI / 2 });
			if (r < ROWS - 1) piece('doorOrWindow', 'Door', 'door', L.id, x0 + RW / 2 + 120, y0 + RD);
			// Windows on the outside walls.
			if (r === 0) piece('doorOrWindow', 'Window', 'window', L.id, x0 + RW / 2 + 140, 0, { elevation: 90 });
			if (r === ROWS - 1) piece('doorOrWindow', 'Window', 'window', L.id, x0 + RW / 2, D, { elevation: 90 });
			if (c === 0) piece('doorOrWindow', 'Window', 'window', L.id, 0, y0 + RD / 2, { angle: PI / 2, elevation: 90 });
			if (c === COLS - 1) piece('doorOrWindow', 'Window', 'window', L.id, W, y0 + RD / 2 + 100, { angle: PI / 2, elevation: 90 });
		}
	}
}

// Walls: one segment per room edge (so each door cuts its own wall), every storey.
// The top storey's walls are papered on both sides.
const WALL = 'FFF2EEE6';
const wall = (L, xStart, yStart, xEnd, yEnd) => {
	const a = attrs({ id: `wall-${nextId++}`, level: L.id, xStart, yStart, xEnd, yEnd, height: H, thickness: T, leftSideColor: WALL, rightSideColor: WALL });
	xml.push(L === levels.at(-1) ? `<wall${a}>${tex('leftSideTexture', 'wallpaper.png', 60)}${tex('rightSideTexture', 'wallpaper.png', 60)}</wall>` : `<wall${a}/>`);
};
for (const L of levels) {
	for (let r = 0; r <= ROWS; r++) for (let c = 0; c < COLS; c++) wall(L, c * RW, r * RD, (c + 1) * RW, r * RD);
	for (let c = 0; c <= COLS; c++) for (let r = 0; r < ROWS; r++) wall(L, c * RW, r * RD, c * RW, (r + 1) * RD);
}

// Rooms: a parquet, stone or tiled floor, or (one room in four) a plain floor in its own colour.
for (const [s, L] of levels.entries()) {
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const x0 = c * RW, y0 = r * RD, n = (s * ROWS + r) * COLS + c;
			const floor = PAINT[(n * 11 + 3) % PAINT.length];
			const floorTex = [['parquet.png', 200], ['slabs.png', 240], ['tiles.png', 120], null][n % 4];
			xml.push(`<room${attrs({ id: `room-${nextId++}`, level: L.id, name: `Room ${String.fromCharCode(65 + r)}${c + 1}${s ? ` (${L.name})` : ''}`, floorColor: floorTex ? undefined : floor, ceilingColor: 'FFFFFFFF' })}>`,
				...[[x0, y0], [x0 + RW, y0], [x0 + RW, y0 + RD], [x0, y0 + RD]].map(([x, y]) => `  <point x='${x}' y='${y}'/>`),
				...(floorTex ? [`  ${tex('floorTexture', ...floorTex)}`] : []), '</room>');
		}
	}
}

const home = [
	"<?xml version='1.0'?>",
	"<home version='7200' name='Heavy test home' camera='observerCamera' selectedLevel='level-0' wallHeight='250'>",
	"  <environment groundColor='FF8FA37E' skyColor='FFCCE4FC' lightColor='FFD0D0D0' ceillingLightColor='FFD0D0D0'/>",
	"  <compass x='-150' y='60' diameter='100' northDirection='0.0' longitude='0.0407' latitude='0.8529' timeZone='Europe/Paris'/>",
	`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='250' y='200' z='170' yaw='${PI}' pitch='0.0' fieldOfView='1.0995574'/>`,
	...levels.map((L) => `  <level id='${L.id}' name='${L.name}' elevation='${L.elevation}' floorThickness='${SLAB}' height='${H}' elevationIndex='0'/>`),
	...xml.map((l) => `  ${l}`),
	'</home>',
	'',
].join('\n');

const files = { 'Home.xml': strToU8(home), ...Object.fromEntries(Object.entries(entries).sort(([a], [c]) => (a < c ? -1 : 1))) };
const zip = zipSync(files, { level: 9, mtime: new Date('2026-01-01T12:00:00Z') });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip);
const perRoom = ['sculpture', 'plant', 'plant', 'bookshelf', 'table', 'chair', 'chair', 'chair', 'chair', 'armchair', 'armchair'].reduce((t, m) => t + 2 * modelIndex.get(m).triangles, 0); // (quads: two triangles each)
const gpuMB = Object.values(TEXTURES).reduce((t, [px]) => t + (px * px * 4 * 4) / 3, 0) / 1048576; // (RGBA, with its smaller copies, the mipmaps: 4/3)
console.log(`${path.relative(process.cwd(), out)}: ${(zip.length / 1024).toFixed(1)} kB, ${modelIndex.size} models, ${COLS * ROWS * STOREYS} rooms, about ${Math.round(perRoom * COLS * ROWS * STOREYS / 1000)}k furniture triangles, ${Object.keys(TEXTURES).length} textures (about ${Math.round(gpuMB)} MB in the headset's graphics memory)`);
