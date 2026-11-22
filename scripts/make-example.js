// Generates examples/example-home.sh3d: a small two-storey house made for
// this viewer (the "Try the example home" button, and a fixture for tests).
//
// Everything in it is original and written here: the plan in Home.xml and
// the furniture, which is built from plain boxes. It exists because the
// official Sweet Home 3D example homes state no licence that would let this
// project redistribute them.
//
// Run: npm run example   (the output is committed; it is byte-for-byte
// reproducible, so re-running without changes leaves git clean)

import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const out = path.resolve(import.meta.dirname, '../examples/example-home.sh3d');
const PI = Math.PI;

// ---------------------------------------------------------------------------
// Box models -> OBJ + MTL. Model axes: x = width, y = up, z = depth (the
// front of a piece faces +z). Units are centimetres.
// ---------------------------------------------------------------------------

const MATERIALS = {
	wood: [0.72, 0.53, 0.34], darkwood: [0.42, 0.29, 0.18], white: [0.95, 0.95, 0.93], dark: [0.17, 0.18, 0.2],
	fabric: [0.42, 0.52, 0.62], cushion: [0.55, 0.64, 0.72], rug: [0.76, 0.42, 0.33], metal: [0.72, 0.74, 0.76],
	shade: [0.99, 0.94, 0.8], green: [0.33, 0.52, 0.33], pot: [0.72, 0.42, 0.3], linen: [0.93, 0.9, 0.84],
	glass: [0.75, 0.88, 0.95, 0.35], // 4th value: opacity
};

/** b(x0, y0, z0, x1, y1, z1, material) */
const b = (x0, y0, z0, x1, y1, z1, mat) => ({ min: [x0, y0, z0], max: [x1, y1, z1], mat });

function toObj(name, boxes) {
	const lines = [`# ${name}: generated for CasaWalk`, `mtllib ${name}.mtl`];
	const used = new Set();
	let n = 0;
	for (const { min: [x0, y0, z0], max: [x1, y1, z1], mat } of boxes) {
		used.add(mat);
		for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) lines.push(`v ${x} ${y} ${z}`);
		lines.push(`usemtl ${mat}`);
		// Outward-facing quads: front, back, right, left, top, bottom.
		for (const f of [[5, 6, 7, 8], [2, 1, 4, 3], [6, 2, 3, 7], [1, 5, 8, 4], [8, 7, 3, 4], [1, 2, 6, 5]]) lines.push(`f ${f.map((i) => i + n).join(' ')}`);
		n += 8;
	}
	const mtl = [...used].map((m) => {
		const [r, g, bl, d] = MATERIALS[m];
		return `newmtl ${m}\nKd ${r} ${g} ${bl}\n${d !== undefined ? `d ${d}\n` : ''}`;
	}).join('\n');
	const all = boxes.flatMap((bx) => [bx.min, bx.max]);
	const size = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])) - Math.min(...all.map((p) => p[i])));
	return { obj: `${lines.join('\n')}\n`, mtl, size };
}

const legs = (w, d, h, t, mat) => [b(0, 0, 0, t, h, t, mat), b(w - t, 0, 0, w, h, t, mat), b(0, 0, d - t, t, h, d, mat), b(w - t, 0, d - t, w, h, d, mat)];

const MODELS = {
	door: [b(0, 0, 0, 5, 205, 20, 'white'), b(85, 0, 0, 90, 205, 20, 'white'), b(5, 200, 0, 85, 205, 20, 'white'), b(5, 0, 8, 85, 200, 12, 'wood'), b(74, 98, 6, 80, 102, 14, 'metal')],
	window: [b(0, 0, 0, 120, 6, 20, 'white'), b(0, 114, 0, 120, 120, 20, 'white'), b(0, 6, 0, 6, 114, 20, 'white'), b(114, 6, 0, 120, 114, 20, 'white'), b(58, 6, 7, 62, 114, 13, 'white'), b(6, 6, 9, 114, 114, 11, 'glass')],
	sofa: [b(0, 12, 0, 200, 42, 90, 'fabric'), b(0, 42, 0, 200, 82, 22, 'fabric'), b(0, 42, 22, 18, 62, 90, 'fabric'), b(182, 42, 22, 200, 62, 90, 'fabric'),
		b(22, 42, 26, 98, 54, 86, 'cushion'), b(102, 42, 26, 178, 54, 86, 'cushion'), ...legs(200, 90, 12, 8, 'darkwood')],
	coffeeTable: [b(0, 36, 0, 110, 41, 60, 'wood'), ...legs(110, 60, 36, 5, 'darkwood')],
	tvUnit: [b(0, 0, 0, 160, 45, 45, 'dark'), b(60, 45, 16, 100, 52, 28, 'dark'), b(25, 52, 19, 135, 117, 24, 'dark')],
	rug: [b(0, 0, 0, 170, 1, 240, 'rug')],
	diningTable: [b(0, 71, 0, 160, 76, 90, 'wood'), ...legs(160, 90, 71, 6, 'wood')],
	chair: [b(0, 43, 0, 42, 47, 42, 'wood'), b(0, 47, 0, 42, 90, 4, 'wood'), ...legs(42, 42, 43, 4, 'wood')],
	floorLamp: [b(0, 0, 0, 30, 2, 30, 'metal'), b(13.5, 2, 13.5, 16.5, 150, 16.5, 'metal'), b(0, 150, 0, 30, 176, 30, 'shade')],
	counter: [b(0, 0, 0, 300, 86, 60, 'white'), b(0, 86, 0, 300, 90, 62, 'dark'), b(120, 90, 15, 180, 91, 50, 'metal')],
	fridge: [b(0, 0, 0, 60, 180, 62, 'metal'), b(4, 60, 62, 7, 150, 65, 'dark')],
	stairs: Array.from({ length: 15 }, (_, i) => b(0, 0, i * 18, 90, +(((i + 1) * 262) / 15).toFixed(3), (i + 1) * 18, i % 2 ? 'wood' : 'darkwood')),
	ceilingLamp: [b(19, 20, 19, 21, 45, 21, 'dark'), b(0, 0, 0, 40, 20, 40, 'shade')],
	bed: [b(0, 0, 0, 160, 30, 200, 'wood'), b(5, 30, 8, 155, 50, 198, 'linen'), b(0, 0, 0, 160, 95, 6, 'wood'), b(12, 50, 12, 72, 60, 52, 'white'), b(88, 50, 12, 148, 60, 52, 'white'), b(5, 50, 90, 155, 54, 198, 'fabric')],
	bedsideTable: [b(0, 0, 0, 45, 50, 40, 'wood'), b(4, 28, 40, 41, 46, 41, 'darkwood')],
	tableLamp: [b(5, 0, 5, 17, 3, 17, 'metal'), b(9.5, 3, 9.5, 12.5, 26, 12.5, 'metal'), b(0, 26, 0, 22, 44, 22, 'shade')],
	wardrobe: [b(0, 0, 0, 180, 210, 60, 'white'), b(89, 5, 60, 91, 205, 61, 'dark'), b(80, 95, 60, 83, 115, 63, 'metal'), b(97, 95, 60, 100, 115, 63, 'metal')],
	desk: [b(0, 72, 0, 140, 76, 70, 'wood'), ...legs(140, 70, 72, 5, 'dark')],
	bookshelf: [b(0, 0, 0, 4, 190, 30, 'wood'), b(86, 0, 0, 90, 190, 30, 'wood'), b(4, 0, 0, 86, 190, 2, 'darkwood'),
		...[0, 46, 92, 138, 186].map((y) => b(4, y, 2, 86, y + 4, 30, 'wood')),
		b(8, 4, 8, 50, 30, 26, 'fabric'), b(30, 50, 8, 82, 78, 26, 'rug'), b(8, 96, 8, 60, 124, 26, 'green'), b(40, 142, 8, 82, 170, 26, 'dark')],
	railingLong: [b(0, 88, 0, 5, 95, 250, 'wood'), ...Array.from({ length: 6 }, (_, i) => b(1, 0, i * 49, 4, 88, i * 49 + 5, 'white'))],
	railingShort: [b(0, 88, 0, 100, 95, 5, 'wood'), ...Array.from({ length: 3 }, (_, i) => b(i * 47.5, 0, 1, i * 47.5 + 5, 88, 4, 'white'))],
	plant: [b(10, 0, 10, 40, 30, 40, 'pot'), b(0, 30, 0, 50, 95, 50, 'green')],
};

// ---------------------------------------------------------------------------
// The home. Plan units are centimetres: x to the right, y down the page.
// Angles: 0 = front faces down the page (south), PI/2 = west, -PI/2 = east.
// ---------------------------------------------------------------------------

const entries = {};
const modelIndex = new Map();
function modelRef(name) {
	if (!modelIndex.has(name)) {
		const i = modelIndex.size;
		const { obj, mtl, size } = toObj(name, MODELS[name]);
		entries[`${i}/${name}.obj`] = strToU8(obj);
		entries[`${i}/${name}.mtl`] = strToU8(mtl);
		modelIndex.set(name, { ref: `${i}/${name}.obj`, size });
	}
	return modelIndex.get(name);
}

const xml = [];
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}='${String(v).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;')}'`).join('');
let nextId = 0;

/** Furniture, doors/windows (kind 'doorOrWindow') and lights (kind 'light', with bulbs). */
function piece(kind, label, model, level, x, y, { angle = 0, elevation = 0, bulbs = null } = {}) {
	const { ref, size: [w, h, d] } = modelRef(model);
	const a = attrs({ id: `${kind}-${nextId++}`, level, name: label, model: ref, x, y, elevation: elevation || undefined, angle: angle || undefined, width: w, depth: d, height: h, power: bulbs ? 0.5 : undefined });
	if (!bulbs) { xml.push(`<${kind}${a}/>`); return; }
	xml.push(`<${kind}${a}>`, ...bulbs.map((s) => `  <lightSource${attrs({ x: 0.5, y: 0.5, z: s.z, color: '00FFE2B0', diameter: s.diameter })}/>`), `</${kind}>`);
}
const furniture = (...a) => piece('pieceOfFurniture', ...a);
const opening = (...a) => piece('doorOrWindow', ...a);
const light = (...a) => piece('light', ...a);

const G = 'level-ground', F = 'level-first';
const W = 800, D = 700, UP = 262; // footprint; elevation of the first floor (250 + 12 floor)

// Furniture is listed first (Sweet Home 3D's order), then walls and rooms.
// --- Ground floor: living room (west), kitchen (north-east), hall with stairs (south-east)
furniture('Rug', 'rug', G, 200, 420);
furniture('TV unit', 'tvUnit', G, 33, 420, { angle: -PI / 2 });
furniture('Sofa', 'sofa', G, 330, 420, { angle: PI / 2 });
furniture('Coffee table', 'coffeeTable', G, 190, 420, { angle: PI / 2 });
light('Floor lamp', 'floorLamp', G, 440, 290, { bulbs: [{ z: 0.93, diameter: 0.5 }] });
furniture('Dining table', 'diningTable', G, 240, 160);
furniture('Chair', 'chair', G, 190, 92);
furniture('Chair', 'chair', G, 290, 92);
furniture('Chair', 'chair', G, 190, 228, { angle: PI });
furniture('Chair', 'chair', G, 290, 228, { angle: PI });
furniture('Plant', 'plant', G, 45, 655);
furniture('Kitchen counter', 'counter', G, 640, 41);
furniture('Fridge', 'fridge', G, 757, 250, { angle: PI / 2 });
furniture('Stairs', 'stairs', G, 745, 535);
light('Hall lamp', 'ceilingLamp', G, 590, 500, { elevation: 205, bulbs: [{ z: 0.22, diameter: 0.6 }] });
opening('Front door', 'door', G, 590, D);
opening('Door', 'door', G, 480, 200, { angle: PI / 2 });
opening('Door', 'door', G, 480, 560, { angle: PI / 2 });
opening('Window', 'window', G, 240, 0, { elevation: 90 });
opening('Window', 'window', G, 240, D, { elevation: 90 });
opening('Window', 'window', G, 0, 150, { angle: PI / 2, elevation: 90 });
opening('Window', 'window', G, 640, 0, { elevation: 100 });
opening('Window', 'window', G, W, 150, { angle: PI / 2, elevation: 90 });

// --- First floor: bedroom (west), study and landing (east)
furniture('Bed', 'bed', F, 240, 115);
furniture('Bedside table', 'bedsideTable', F, 130, 32);
furniture('Bedside table', 'bedsideTable', F, 350, 32);
light('Bedside lamp', 'tableLamp', F, 130, 32, { elevation: 50, bulbs: [{ z: 0.8, diameter: 0.6 }] });
light('Bedside lamp', 'tableLamp', F, 350, 32, { elevation: 50, bulbs: [{ z: 0.8, diameter: 0.6 }] });
furniture('Wardrobe', 'wardrobe', F, 42, 480, { angle: -PI / 2 });
furniture('Desk', 'desk', F, 640, 47);
furniture('Chair', 'chair', F, 640, 112, { angle: PI });
furniture('Bookshelf', 'bookshelf', F, 773, 250, { angle: PI / 2 });
furniture('Plant', 'plant', F, 520, 45);
furniture('Railing', 'railingLong', F, 700, 525);
furniture('Railing', 'railingShort', F, 750, 400);
light('Landing lamp', 'ceilingLamp', F, 590, 350, { elevation: 205, bulbs: [{ z: 0.22, diameter: 0.6 }] });
opening('Door', 'door', F, 480, 560, { angle: PI / 2 });
opening('Window', 'window', F, 240, D, { elevation: 90 });
opening('Window', 'window', F, 0, 300, { angle: PI / 2, elevation: 90 });
opening('Window', 'window', F, 640, 0, { elevation: 100 });
opening('Window', 'window', F, W, 150, { angle: PI / 2, elevation: 90 });
opening('Window', 'window', F, 590, D, { elevation: 90 });

// --- Walls: the same outer shell on both storeys, joined at the corners
const WALL = 'FFF4F1EA';
for (const [lvl, tag] of [[G, 'g'], [F, 'f']]) {
	const corners = [[0, 0], [W, 0], [W, D], [0, D]];
	corners.forEach(([x, y], i) => {
		const [x2, y2] = corners[(i + 1) % 4];
		xml.push(`<wall${attrs({ id: `wall-${tag}${i}`, level: lvl, wallAtStart: `wall-${tag}${(i + 3) % 4}`, wallAtEnd: `wall-${tag}${(i + 1) % 4}`, xStart: x, yStart: y, xEnd: x2, yEnd: y2, height: 250, thickness: 20, leftSideColor: WALL, rightSideColor: WALL })}/>`);
	});
	xml.push(`<wall${attrs({ id: `wall-${tag}-mid`, level: lvl, xStart: 480, yStart: 0, xEnd: 480, yEnd: D, height: 250, thickness: 20, leftSideColor: WALL, rightSideColor: WALL })}/>`);
}
xml.push(`<wall${attrs({ id: 'wall-g-kitchen', level: G, xStart: 480, yStart: 300, xEnd: W, yEnd: 300, height: 250, thickness: 20, leftSideColor: WALL, rightSideColor: WALL })}/>`);

// --- Rooms (floor colours); the stairwell has no ceiling, and the first
// floor leaves a hole over the stairs.
const room = (name, level, floorColor, points, extra = {}) => {
	xml.push(`<room${attrs({ id: `room-${nextId++}`, level, name, floorColor, ceilingColor: 'FFFFFFFF', ...extra })}>`, ...points.map(([x, y]) => `  <point x='${x}' y='${y}'/>`), '</room>');
};
room('Living room', G, 'FFC9A77C', [[0, 0], [480, 0], [480, D], [0, D]]);
room('Kitchen', G, 'FFD9D9D4', [[480, 0], [W, 0], [W, 300], [480, 300]]);
room('Hall', G, 'FFBFA98A', [[480, 300], [W, 300], [W, 400], [700, 400], [700, D], [480, D]]);
room('Stairwell', G, 'FFBFA98A', [[700, 400], [W, 400], [W, D], [700, D]], { ceilingVisible: 'false' });
room('Bedroom', F, 'FFD8C3A5', [[0, 0], [480, 0], [480, D], [0, D]]);
room('Study', F, 'FFCDB79E', [[480, 0], [W, 0], [W, 400], [700, 400], [700, D], [480, D]]);

const home = [
	"<?xml version='1.0'?>",
	"<home version='7200' name='Example home' camera='observerCamera' selectedLevel='level-ground' wallHeight='250'>", // (selectedLevel: without it Sweet Home 3D shows no level tabs and an empty plan)
	"  <environment groundColor='FF8FA37E' skyColor='FFCCE4FC' lightColor='FFD0D0D0' ceillingLightColor='FFD0D0D0'/>",
	// North is up the plan; latitude of Paris (radians), so the sun behaves like a European home.
	"  <compass x='-150' y='60' diameter='100' northDirection='0.0' longitude='0.0407' latitude='0.8529' timeZone='Europe/Paris'/>",
	// Standing just inside the front door, looking into the house.
	`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='590' y='640' z='170' yaw='${PI}' pitch='0.0' fieldOfView='1.0995574'/>`,
	`  <level id='${G}' name='Ground floor' elevation='0' floorThickness='12' height='250' elevationIndex='0'/>`,
	`  <level id='${F}' name='First floor' elevation='${UP}' floorThickness='12' height='250' elevationIndex='0'/>`,
	...xml.map((l) => `  ${l}`),
	'</home>',
	'',
].join('\n');

// Fixed dates and sorted names, so the same input always gives the same file.
const files = { 'Home.xml': strToU8(home), ...Object.fromEntries(Object.entries(entries).sort(([a], [c]) => (a < c ? -1 : 1))) };
const zip = zipSync(files, { level: 9, mtime: new Date('2026-01-01T12:00:00Z') });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip);
console.log(`${path.relative(process.cwd(), out)}: ${(zip.length / 1024).toFixed(1)} kB, ${modelIndex.size} models, ${Object.keys(files).length} entries`);
