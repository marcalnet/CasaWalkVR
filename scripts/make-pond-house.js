// Generates examples/pond-house.sh3d: CasaWalk's own sample home, the first the page offers
// ("Try a sample home", js/samples.js). Designed for CasaWalk, 22 Nov 2026.
// A two-storey house by a pond, designed for CasaWalk (revised 22 Nov 2026 with the user, to an
// architect's standard; see THE PLAN below): an open day floor at the water's edge, a solid night floor
// above with a terrace over the pond, a floating stair in the living room. Nothing here copies an existing building or model.
//
// Written like scripts/make-example.js: the plan in Home.xml, furniture built from plain boxes and
// cylinders (OBJ + MTL), zipped with fixed dates so the output is reproducible.
//   npm run pond-house     (commit the output)

import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { materials, argb } from './sample-palette.js';

const out = path.resolve(import.meta.dirname, '../examples/pond-house.sh3d');
const PI = Math.PI;

// ---------------------------------------------------------------------------
// Solids -> OBJ + MTL. Model axes: x = width, y = up, z = depth (the front of a piece faces +z). cm.
// ---------------------------------------------------------------------------

// Every colour comes from the shared palette (scripts/sample-palette.js): material names are palette roles.
const MATERIALS = materials();

/** b(x0, y0, z0, x1, y1, z1, material): a box. */
const b = (x0, y0, z0, x1, y1, z1, mat) => ({ box: [[x0, y0, z0], [x1, y1, z1]], mat });
/** c(cx, cz, r, y0, y1, material, segments, r1): an upright cylinder (or cone when r1 is given). */
const c = (cx, cz, r, y0, y1, mat, seg = 12, r1 = r) => ({ cyl: [cx, cz, r, r1, y0, y1, seg], mat });

// Fewer distinct materials = fewer draw calls (one per material per storey after the merge).
// These roles fold into a near neighbour in this home.
// Roles that look the same under the app's light share one material (each material is a draw call per storey;
// Quest 2 budget ~150 at the scale model with see-through walls): oatmeal ~ pale ash, stone ~ warm stone,
// wool, linen and concrete ~ the light off-white.
const ALIAS = { bark: 'walnut', foliage: 'green', linen: 'ceiling', leather: 'graphite', steelWhite: 'ceiling', terracotta: 'oak', brass: 'oak', concrete: 'ceiling', wool: 'ceiling', oatmeal: 'oak', stone: 'masonry' };

function toObj(name, solids) {
	const lines = [`# ${name}: generated for CasaWalk (Pond House)`, `mtllib ${name}.mtl`];
	const used = new Set();
	let n = 0;
	const all = [];
	for (const s of solids) {
		const mat = ALIAS[s.mat] ?? s.mat;
		used.add(mat);
		lines.push(`usemtl ${mat}`);
		if (s.box) {
			const [[x0, y0, z0], [x1, y1, z1]] = s.box;
			const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
			for (const p of v) { lines.push(`v ${p.join(' ')}`); all.push(p); }
			for (const f of [[5, 6, 7, 8], [2, 1, 4, 3], [6, 2, 3, 7], [1, 5, 8, 4], [8, 7, 3, 4], [1, 2, 6, 5]]) lines.push(`f ${f.map((i) => i + n).join(' ')}`);
			n += 8;
		} else {
			const [cx, cz, r0, r1, y0, y1, seg] = s.cyl;
			for (const [y, r] of [[y0, r0], [y1, r1]]) for (let i = 0; i < seg; i++) {
				const a = (i / seg) * PI * 2, p = [+(cx + r * Math.cos(a)).toFixed(2), y, +(cz + r * Math.sin(a)).toFixed(2)];
				lines.push(`v ${p.join(' ')}`); all.push(p);
			}
			for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; lines.push(`f ${n + 1 + i} ${n + 1 + seg + i} ${n + 1 + seg + j} ${n + 1 + j}`); }
			lines.push(`f ${Array.from({ length: seg }, (_, i) => n + seg + 1 + i).join(' ')}`); // top
			lines.push(`f ${Array.from({ length: seg }, (_, i) => n + seg - i).join(' ')}`); // bottom
			n += seg * 2;
		}
	}
	const mtl = [...used].map((m) => { const [r, g, bl, d] = MATERIALS[m]; return `newmtl ${m}\nKd ${r} ${g} ${bl}\n${d !== undefined ? `d ${d}\n` : ''}`; }).join('\n');
	const size = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])) - Math.min(...all.map((p) => p[i])));
	return { obj: `${lines.join('\n')}\n`, mtl, size };
}

const legs = (w, d, h, t, mat, inset = 0) => [b(inset, 0, inset, inset + t, h, inset + t, mat), b(w - inset - t, 0, inset, w - inset, h, inset + t, mat), b(inset, 0, d - inset - t, inset + t, h, d - inset, mat), b(w - inset - t, 0, d - inset - t, w - inset, h, d - inset, mat)];
/** An oak rod railing `len` cm long: 3 cm rods about 11 cm apart, 97 cm tall, and a handrail. */
const rail = (len) => { const n = Math.max(2, Math.round((len - 10) / 10.9) + 1), gap = (len - 10) / (n - 1); return [...Array.from({ length: n }, (_, i) => c(5 + i * gap, 2, 1.5, 0, 97, 'oak', 6)), b(0, 97, -1, len, 101, 5, 'oak')]; };
const steps = (n, rise, going, width) => Array.from({ length: n }, (_, i) => b(0, 0, i * going, width, (i + 1) * rise, (i + 1) * going, i % 2 ? 'oak' : 'walnut'));

const MODELS = {
	// Openings
	glassPanel: [b(0, 0, 0, 4, 270, 10, 'steelWhite'), b(296, 0, 0, 300, 270, 10, 'steelWhite'), b(4, 0, 4.5, 296, 270, 5.5, 'glass')],
	glassPanelNarrow: [b(0, 0, 0, 4, 240, 10, 'steelWhite'), b(256, 0, 0, 260, 240, 10, 'steelWhite'), b(4, 0, 4.5, 256, 240, 5.5, 'glass')],
	glassDoor: [b(0, 0, 0, 4, 270, 10, 'steelWhite'), b(296, 0, 0, 300, 270, 10, 'steelWhite'), b(4, 0, 4.5, 296, 270, 5.5, 'glass'), b(150, 90, 10, 153, 180, 13, 'steelWhite'), b(150, 90, -3, 153, 180, 0, 'steelWhite')],
	highWindow: [b(0, 0, 0, 100, 4, 30, 'steelWhite'), b(0, 56, 0, 100, 60, 30, 'steelWhite'), b(0, 4, 0, 4, 56, 30, 'steelWhite'), b(96, 4, 0, 100, 56, 30, 'steelWhite'), b(4, 4, 14, 96, 56, 16, 'glass')], // the bathroom's, 1 m
	ribbon: [b(0, 0, 0, 240, 4, 30, 'steelWhite'), b(0, 56, 0, 240, 60, 30, 'steelWhite'), b(0, 4, 0, 4, 56, 30, 'steelWhite'), b(236, 4, 0, 240, 56, 30, 'steelWhite'), b(4, 4, 14, 236, 56, 16, 'glass')],
	door: [b(0, 0, 0, 5, 212, 20, 'oak'), b(85, 0, 0, 90, 212, 20, 'oak'), b(5, 207, 0, 85, 212, 20, 'oak'), b(5, 0, 8, 85, 207, 12, 'oak'), b(74, 98, 5, 78, 102, 15, 'brass')], // one material: openings merge apart
	// The front door, a pair of oak leaves (25 Nov 2026, the user): 160 cm in all, a handle on each leaf by the meeting stile
	frontDoor: [b(0, 0, 0, 5, 230, 30, 'oak'), b(155, 0, 0, 160, 230, 30, 'oak'), b(5, 225, 0, 155, 230, 30, 'oak'), b(5, 0, 13, 79, 225, 17, 'oak'), b(81, 0, 13, 155, 225, 17, 'oak'), b(70, 80, 8, 73, 160, 22, 'brass'), b(87, 80, 8, 90, 160, 22, 'brass')],
	// A sectional garage door, 250 x 220 cm: white panels with oak grooves and frame (materials the openings already use)
	garageDoor: [b(0, 0, 0, 6, 220, 20, 'oak'), b(244, 0, 0, 250, 220, 20, 'oak'), b(6, 214, 0, 244, 220, 20, 'oak'), b(6, 0, 8, 244, 214, 12, 'ceiling'), ...[53, 106, 160].map((y) => b(6, y, 12, 244, y + 2, 13, 'oak'))],
	// A plain car to show the garage's scale: a body, a cabin and four wheels, no make or shape of any real model
	car: [b(0, 18, 0, 180, 78, 440, 'graphite'), b(15, 78, 110, 165, 128, 330, 'graphite'), ...[[0, 75], [0, 365], [180, 75], [180, 365]].map(([x, z]) => b(x === 0 ? -2 : 168, 0, z - 32, x === 0 ? 12 : 182, 62, z + 32, 'graphite'))],
	// Structure and site
	column: [b(0, 0, 0, 20, 288, 20, 'steelWhite')], // one storey each: the garden level part and the pavilion part are separate pieces
	columnP: [b(0, 0, 0, 20, 300, 20, 'steelWhite')],
	pier: [b(0, 0, 0, 80, 288, 120, 'masonry')],
	// Floating stair (v4): 16 oak treads 7 cm thick, 90 cm deep, 26 cm goings, 17 risers of 17.6 cm,
	// cantilevered from the wall on the model's x 0 side; rising towards model z 0 (the top). No stringer,
	// nothing beneath. Balustrade (the user's call): slim vertical oak rods, 3 cm, two per tread on the open
	// side, from each tread up to the ceiling (288 cm): a mid-century rod screen.
	stairsFloating: (() => {
		const r = 300 / 17, out = [];
		for (let i = 0; i < 16; i++) {
			const z1 = 416 - i * 26, z0 = z1 - 26, top = +((i + 1) * r).toFixed(2);
			out.push(b(0, +(top - 7).toFixed(2), z0, 90, top, z1, 'oak'));
			for (const dz of [6.5, 19.5]) out.push(c(87, z0 + dz, 1.5, top, 288, 'oak', 6));
		}
		return out;
	})(),
	// The same oak rods as a railing (100 cm, with a handrail) where the upper hall overlooks the stair: 250 long;
	// the gallery's over the double-height kitchen (26 Nov 2026), 430 and 80 long
	rodRail: rail(250),
	railGallery: rail(430),
	railShort: rail(80),
	// Outdoor stair in the west wall's slot: 16 solid stone steps (model z 0 = the top)
	stairsOut: Array.from({ length: 16 }, (_, i) => b(0, 0, 416 - (i + 1) * 26, 110, +((i + 1) * 300 / 17).toFixed(2), 416 - i * 26, 'masonry')),
	shower: [b(0, 0, 0, 90, 6, 90, 'stone'), b(0, 6, 84, 90, 200, 90, 'stone'), // a stone screen wall (no glass: one material fewer)
		 c(70, 12, 10, 196, 198, 'brass', 10), c(70, 6, 1, 160, 198, 'brass', 6)],
	tallWindow: [b(0, 0, 0, 4, 200, 30, 'steelWhite'), b(146, 0, 0, 150, 200, 30, 'steelWhite'), b(4, 0, 0, 146, 4, 30, 'steelWhite'), b(4, 196, 0, 146, 200, 30, 'steelWhite'), b(4, 4, 14, 146, 196, 16, 'glass')],
	railing: [b(0, 96, 0, 300, 100, 4, 'graphite'), ...Array.from({ length: 11 }, (_, i) => b(i * 29.6, 0, 1, i * 29.6 + 3, 96, 3, 'graphite'))],
	// The pond (reworked 25 Nov 2026 for the Interior Design Advisor, the Quest 2 list's item 12; one wide basin since
	// v7, 26 Nov 2026): the water is sunk in a stone basin. Coping 18 cm high, 25 cm wide (one piece, 1340 x 520, no
	// two boxes overlapping); the water's top at 5 cm, 13 cm below it, so the basin's sides show; the water slab floats
	// 4 cm over the ground (elevation 4). Nothing else at water level; no two surfaces nearer than 3 cm. The pond's
	// pieces are named Pond (water, never stood on); the coping and the stepping stones are not, so they can be stood
	// on, in a different colour.
	water: [b(0, 0, 0, 1290, 1, 470, 'water')],
	pondCoping: [
		b(0, 0, 0, 25, 18, 520, 'masonry'), b(25, 0, 0, 1315, 18, 25, 'masonry'), b(1315, 0, 0, 1340, 18, 520, 'masonry'), // west, north, east
		b(25, 0, 495, 1315, 18, 520, 'masonry')], // south
	// Nine stepping stones across the basin, north to south: 60 x 40 cm, 10 cm apart, tops 5 cm above the water.
	stepStones: Array.from({ length: 9 }, (_, i) => b(0, 0, i * 50, 60, 10, i * 50 + 40, 'walnut')),
	// A flat stone set in the courtyard's paving (the roofed courtyard by the entrance hall, v7): 90 cm square, 3 cm proud
	paver: [b(0, 0, 0, 90, 3, 90, 'walnut')],
	stepsOut: steps(2, 15, 35, 160),
	ledge: [b(0, 0, 0, 260, 22, 90, 'masonry'), b(30, 22, 10, 200, 38, 80, 'masonry')],
	boulder: [b(0, 0, 0, 120, 45, 90, 'masonry'), b(20, 45, 15, 95, 70, 70, 'masonry')],
	tree: [c(0, 0, 12, 0, 260, 'bark', 6), c(0, 0, 130, 180, 330, 'foliage', 8, 95), c(0, 0, 95, 330, 450, 'green', 8, 35)],
	smallTree: [c(0, 0, 8, 0, 180, 'bark', 6), c(0, 0, 100, 120, 230, 'foliage', 8, 75), c(0, 0, 75, 230, 320, 'green', 8, 25)], // (a young tree, about 2 m across)
	shrub: [c(0, 0, 55, 0, 70, 'green', 8, 40)],
	lily: [c(0, 0, 40, 0, 2, 'green', 8)],
	// Living
	fireplace: [b(0, 0, 0, 180, 30, 70, 'masonry'), b(10, 30, 0, 170, 120, 60, 'masonry'), b(50, 30, 58, 130, 90, 61, 'graphite')],
	sofa: [b(0, 14, 0, 240, 40, 85, 'oatmeal'), b(0, 40, 0, 240, 72, 18, 'oatmeal'), b(0, 40, 18, 14, 56, 85, 'oatmeal'), b(226, 40, 18, 240, 56, 85, 'oatmeal'), b(16, 40, 22, 120, 50, 82, 'oatmeal'), b(120, 40, 22, 224, 50, 82, 'oatmeal'), ...legs(240, 85, 14, 4, 'walnut', 6)],
	loungeChair: [b(0, 0, 0, 80, 6, 80, 'graphite'), b(37, 6, 37, 43, 30, 43, 'graphite'), b(5, 30, 10, 75, 40, 80, 'walnut'), b(10, 40, 14, 70, 50, 78, 'leather'), b(5, 40, 0, 75, 80, 12, 'walnut'), b(10, 46, 10, 70, 86, 18, 'leather'), b(0, 40, 14, 6, 58, 70, 'walnut'), b(74, 40, 14, 80, 58, 70, 'walnut')],
	ottoman: [b(0, 0, 0, 60, 5, 50, 'graphite'), b(27, 5, 22, 33, 28, 28, 'graphite'), b(3, 28, 3, 57, 36, 47, 'walnut'), b(6, 36, 6, 54, 44, 44, 'leather')],
	coffeeTable: [b(0, 32, 0, 130, 36, 65, 'walnut'), ...legs(130, 65, 32, 3, 'graphite', 8)],
	sideboard: [b(0, 20, 0, 220, 70, 45, 'walnut'), ...[0, 1, 2, 3].map((i) => b(5 + i * 53, 25, 45, 55 + i * 53, 65, 46, i % 2 ? 'oak' : 'walnut')), ...legs(220, 45, 20, 3, 'graphite', 10)],
	rug: [b(0, 0, 0, 320, 1, 220, 'wool')],
	rugRound: [c(0, 0, 110, 0, 1, 'terracotta', 16)],
	floorLamp: [c(0, 0, 16, 0, 2, 'graphite', 10), c(0, 0, 1.5, 2, 160, 'graphite', 6), c(0, 0, 22, 140, 170, 'brass', 12, 12)],
	pendant: [c(0, 0, 0.6, 30, 120, 'graphite', 4), c(0, 0, 25, 0, 30, 'brass', 12, 6)],
	bookshelf: [b(0, 0, 0, 4, 180, 32, 'walnut'), b(176, 0, 0, 180, 180, 32, 'walnut'), ...[0, 45, 90, 135, 176].map((y) => b(4, y, 0, 176, y + 4, 32, 'walnut')), b(10, 4, 6, 70, 32, 28, 'terracotta'), b(90, 49, 6, 160, 75, 28, 'oatmeal'), b(20, 94, 6, 60, 128, 28, 'wool'), b(110, 139, 6, 170, 165, 28, 'linen')],
	plant: [c(0, 0, 18, 0, 40, 'ceiling', 10, 14), c(0, 0, 32, 40, 120, 'green', 8, 10)],
	// Dining and kitchen
	diningTable: [c(0, 0, 32, 0, 4, 'ceiling', 16), c(0, 0, 6, 4, 70, 'ceiling', 8), c(0, 0, 65, 70, 74, 'walnut', 20)],
	diningChair: [b(0, 42, 0, 46, 46, 44, 'ceiling'), b(2, 46, 0, 44, 82, 5, 'ceiling'), ...legs(46, 44, 42, 3, 'walnut', 3)],
	counter: [b(0, 0, 0, 300, 86, 62, 'ceiling'), b(0, 86, 0, 300, 90, 64, 'walnut'), b(120, 90, 15, 180, 91, 50, 'steelWhite')],
	island: [b(0, 0, 0, 240, 86, 90, 'walnut'), b(-5, 86, -5, 245, 90, 95, 'ceiling')],
	stool: [c(0, 0, 18, 62, 68, 'graphite', 10), c(0, 0, 2, 0, 62, 'steelWhite', 6), c(0, 0, 16, 0, 2, 'steelWhite', 10)],
	tallUnit: [b(0, 0, 0, 120, 220, 62, 'ceiling'), b(59, 5, 62, 61, 215, 63, 'steelWhite')],
	// Bedrooms, study, bath
	bed: [b(0, 0, 0, 180, 25, 215, 'walnut'), b(5, 25, 10, 175, 47, 212, 'linen'), b(0, 0, 0, 180, 90, 8, 'walnut'), b(15, 47, 15, 85, 57, 55, 'ceiling'), b(95, 47, 15, 165, 57, 55, 'ceiling'), b(5, 47, 100, 175, 51, 212, 'wool')],
	bedside: [b(0, 0, 0, 50, 45, 40, 'walnut'), b(5, 26, 40, 45, 40, 41, 'oak')],
	tableLamp: [c(0, 0, 8, 0, 3, 'brass', 8), c(0, 0, 1, 3, 30, 'brass', 4), c(0, 0, 14, 30, 50, 'linen', 10, 10)],
	wardrobe: [b(0, 0, 0, 200, 220, 62, 'walnut'), b(99, 5, 62, 101, 215, 63, 'oak'), b(92, 100, 62, 95, 120, 65, 'brass'), b(105, 100, 62, 108, 120, 65, 'brass')],
	desk: [b(0, 72, 0, 150, 76, 70, 'walnut'), b(0, 50, 0, 40, 72, 70, 'walnut'), ...legs(150, 70, 72, 3, 'graphite', 4)],
	deskChair: [b(0, 44, 0, 48, 50, 46, 'leather'), b(3, 50, 0, 45, 86, 6, 'leather'), c(24, 23, 2.5, 4, 44, 'steelWhite', 6), c(24, 23, 28, 0, 4, 'steelWhite', 5)],
	daybed: [b(0, 0, 0, 200, 30, 85, 'walnut'), b(4, 30, 4, 196, 46, 81, 'oatmeal'), b(0, 30, 0, 200, 70, 10, 'walnut')],
	bath: [b(0, 0, 0, 170, 55, 75, 'ceiling'), b(8, 12, 8, 162, 56, 67, 'ceiling')],
	basin: [b(0, 0, 0, 120, 82, 50, 'walnut'), b(0, 82, 0, 120, 86, 52, 'ceiling'), b(40, 86, 10, 80, 96, 40, 'ceiling')],
	toilet: [b(10, 0, 20, 30, 40, 55, 'ceiling'), b(0, 40, 10, 40, 45, 60, 'ceiling'), b(0, 0, 0, 40, 80, 18, 'ceiling')],
	// Terrace
	lounger: [b(0, 25, 0, 70, 32, 190, 'oak'), b(5, 32, 5, 65, 38, 140, 'linen'), b(5, 32, 140, 65, 70, 150, 'linen'), ...legs(70, 190, 25, 4, 'oak', 5)],
	sideTable: [c(0, 0, 22, 0, 2, 'graphite', 10), c(0, 0, 2, 2, 45, 'graphite', 6), c(0, 0, 22, 45, 48, 'oak', 12)],
	planter: [b(0, 0, 0, 120, 50, 45, 'concrete'), b(8, 50, 8, 112, 90, 37, 'green')],
};

// ---------------------------------------------------------------------------
// The home. Plan units cm; x east, y south (down the page); north is up.
// Angles: 0 = the piece's front faces south (+y), PI/2 = west, -PI/2 = east, PI = north.
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
const r2 = (x) => +x.toFixed(2);

function piece(kind, label, model, level, x, y, { angle = 0, elevation = 0, bulbs = null } = {}) {
	const { ref, size: [w, h, d] } = modelRef(model);
	const a = attrs({ id: `${kind}-${nextId++}`, level, name: label, model: ref, x, y, elevation: elevation || undefined, angle: angle ? r2(angle) : undefined, width: r2(w), depth: r2(d), height: r2(h), power: bulbs ? 0.5 : undefined });
	if (!bulbs) { xml.push(`<${kind}${a}/>`); return; }
	xml.push(`<${kind}${a}>`, ...bulbs.map((s) => `  <lightSource${attrs({ x: 0.5, y: 0.5, z: s.z, color: '00FFE2B0', diameter: s.diameter })}/>`), `</${kind}>`);
}
const furniture = (...a) => piece('pieceOfFurniture', ...a);
const opening = (...a) => piece('doorOrWindow', ...a);
const light = (...a) => piece('light', ...a);

// ===========================================================================
// THE PLAN (v4, 22 Nov 2026, with the user, to an architect's standard)
// A two-storey house by a pond on a 3 m grid, 18 x 6 m to the wall axes, with a terrace cantilevered
// over the water (a nod to the great American house over a waterfall; nothing copied).
// Ground floor, the day floor: two thirds (x 0-1200) one open space, living room (west, by the stone
// fireplace wall) and kitchen (east), the kitchen bar between them as the divider; glazed to the south,
// onto a deck at the pond. Then, half as wide as the last third (x 1200-1500): a bathroom (opening onto the
// deck) and a store; beyond them the upper floor overhangs a covered terrace by 3 m (stepped, brutalist volumes).
// The stair: floating oak treads fixed into the north wall, rising east from the living room to the
// two-thirds line, with a screen of slim oak rods on the open side and nothing beneath.
// Revised 25 Nov 2026 with the user (build 111 test): the upper floor's en-suite over the kitchen is gone, so
// the kitchen and dining rise double height and the upper floor is a U open to the pond (from the scale model
// you can point straight into the kitchen or the dining room). The dressing became the main bedroom's
// en-suite, and the way into the main bedroom (hall -> en-suite -> bedroom). A double front door. A garage for
// two cars on the east (the left as you face the front door), under the upper floor's overhang and 3 m
// beyond it, with a door into the store. A smaller bathroom (a third less). A paved deck all the way round.
// Revised again 25 Nov 2026 from the user's own mark-up of the plans: the entrance becomes a small hall
// projecting north (the double front door at its north end, a double door into the living room); the garage
// moves 4 m north (y -300 to 300), clear of the upper floor except its west strip, with a covered deck south of it;
// the second bedroom moves north, cantilevered over the deck east of the entrance hall, its door from the stair's
// landing; its old room becomes a snug. The user's second mark-up: a tall window in the entrance hall's east wall
// (its shelves gone); the bathroom 30 cm deeper (to y 600) with a high window east, its east wall stopping there so the
// covered corner opens onto the deck east.
// v7, 26 Nov 2026, from the user's third mark-up: the store goes and the garage moves 3 m west onto it (x 1200-1800,
// next to the kitchen, its door from the kitchen where the store's was, a side door west onto the courtyard, a window
// south where its deck door was); the bathroom runs down to the south facade (y 300-700, its deck door in the south
// wall); one wide pond instead of two basins, further from the house; flat stepping stones in the roofed courtyard
// between the entrance hall and the garage; the trees moved and more planted. Upstairs the snug becomes a bedroom; a
// narrow gallery (1.2 m) runs along the south glass over the double-height kitchen, which keeps its double height
// behind a rod railing, with a door from the main bedroom; the en-suite is reached from the main bedroom only (a
// small window north); the terrace ends at x 700.
// Upper floor, the night floor: the stair arrives in a square hall (no long corridor) that opens to every
// room: the main bedroom suite to the west (through a walk-in dressing, with its en-suite), next to the
// pond and onto the terrace over it; a shower room; the office and a second bedroom to the east.
// Wet rooms cluster: the en-suite and the shower room share a wall, over the kitchen and the bathroom.
// The outdoor stair rises in a slot along the west wall, behind a stone screen that continues the facade,
// from the garden to the terrace.
// Stairs: 17 risers of 17.6 cm, 26 cm goings (2R + G = 61 cm), landings at least the stair's width.
// ===========================================================================

const G = 'level-ground', P = 'level-upper';
const STONE = argb('masonry'), FRAME = argb('walls'), // (the white steel frame reads as the plaster: one colour)
	 RENDER = argb('putty'), PLASTER = argb('walls'), OCHRE = argb('concrete');

// --- Site: trees, shrubs, the pond (south of the deck), ledges and a boulder in it
furniture('Tree', 'tree', G, -420, 450);
furniture('Tree', 'tree', G, 2650, -250);
furniture('Tree', 'tree', G, 2000, 1350);
furniture('Tree', 'smallTree', G, 2095, 620);
furniture('Tree', 'smallTree', G, 2140, 960);
furniture('Tree', 'smallTree', G, -100, 1340);
furniture('Shrub', 'shrub', G, 2600, 600);
furniture('Shrub', 'shrub', G, 300, -300);
furniture('Shrub', 'shrub', G, 290, -475);
furniture('Shrub', 'shrub', G, 290, -115);
furniture('Shrub', 'shrub', G, -65, -140);
furniture('Shrub', 'shrub', G, 2000, 205);
furniture('Stone ledge', 'ledge', G, 240, 1245, { angle: PI / 2 });
furniture('Stone ledge', 'ledge', G, 1070, 1420);
furniture('Boulder', 'boulder', G, 340, 1065, { angle: 0.4 });
// The pond: a flat water piece (not a room, so nobody steps inside onto the water): x 140-1480, y 960-1480 outside the coping
furniture('Stone coping', 'pondCoping', G, 810, 1220);
furniture('Pond', 'water', G, 810, 1220, { elevation: 4 });
furniture('Stepping stones', 'stepStones', G, 1100, 1220);
furniture('Lily pads', 'lily', G, 463, 1331, { elevation: 8 }); // 3 cm clear of the water's top (5 cm)
furniture('Lily pads', 'lily', G, 851, 1245, { elevation: 8 });
furniture('Lily pads', 'lily', G, 949, 1314, { elevation: 8 });

// --- Ground floor
// Living room: round the fireplace in the west stone wall
furniture('Fireplace', 'fireplace', G, 50, 400, { angle: -PI / 2 });
furniture('Rug', 'rug', G, 260, 400, { angle: PI / 2 });
furniture('Coffee table', 'coffeeTable', G, 250, 400, { angle: PI / 2 });
furniture('Sofa', 'sofa', G, 420, 400, { angle: PI / 2 });
furniture('Lounge chair', 'loungeChair', G, 200, 200, { angle: -0.5 });
furniture('Lounge chair', 'loungeChair', G, 200, 600, { angle: PI + 0.5 });
light('Floor lamp', 'floorLamp', G, 480, 620, { bulbs: [{ z: 0.88, diameter: 0.6 }] });
furniture('Plant', 'plant', G, 40, 140);
// Dining by the glass, between the sofa and the bar
furniture('Dining table', 'diningTable', G, 650, 520);
for (const [dx, dy, a] of [[-90, 0, -PI / 2], [90, 0, PI / 2], [0, -90, PI], [0, 90, 0]]) furniture('Dining chair', 'diningChair', G, 650 + dx, 520 + dy, { angle: a });
light('Pendant', 'pendant', G, 650, 520, { elevation: 150, bulbs: [{ z: 0.1, diameter: 0.6 }] });
// The kitchen bar (the divider), stools on the living side; the worktop run on the east wall
furniture('Kitchen bar', 'island', G, 900, 480, { angle: PI / 2 });
for (const y of [400, 480, 560]) furniture('Stool', 'stool', G, 815, y);
for (const y of [420, 540]) light('Pendant', 'pendant', G, 900, y, { elevation: 160, bulbs: [{ z: 0.1, diameter: 0.6 }] });
furniture('Kitchen counter', 'counter', G, 1160, 545, { angle: PI / 2 });
// The stair: floating oak treads fixed into the north wall (y 115-205), rising east, foot at x 784, top at
// x 1200; its rod screen on the open (south) side
furniture('Stair', 'stairsFloating', G, 992, 161.5, { angle: PI / 2 });
// The bathroom (x 1200-1500, y 300-700 since v7: under the garage's south wall, down to the south facade)
furniture('Bath', 'bath', G, 1385, 357);
furniture('Toilet', 'toilet', G, 1462, 480, { angle: PI / 2 });
furniture('Basin', 'basin', G, 1232, 500, { angle: -PI / 2 });
furniture('Shower', 'shower', G, 1447, 630, { angle: PI / 2 });
// The garage (x 1200-1800, y -300 to 300 since v7): parking for two, one car in; a door from the kitchen, a side door
// west onto the courtyard, a window south
furniture('Car', 'car', G, 1650, -20);
// The roofed courtyard between the entrance hall and the garage (under the north bedroom): flat stepping stones
for (const [x, y] of [[855, 15], [955, -105], [965, 25], [1070, 0]]) furniture('Stepping stone', 'paver', G, x, y);
// Entrance hall (x 460-800, y -170 to 100): a bench on the west wall, a tall window on the east
furniture('Bench', 'daybed', G, 517, -35, { angle: -PI / 2 });
// Deck at the pond's edge: two loungers under the terrace, and a pair at an angle each side of the pond
furniture('Lounger', 'lounger', G, 300, 835, { angle: PI / 2 });
furniture('Lounger', 'lounger', G, 300, 915, { angle: PI / 2 });
furniture('Side table', 'sideTable', G, 180, 865);
furniture('Planter', 'planter', G, 40, 927);
for (const [x, y] of [[-230, 980], [1680, 1280]]) for (const d of [-1, 1]) furniture('Lounger', 'lounger', G, x + d * 32, y + d * 32, { angle: PI / 4 });
// The outdoor stair in the west wall's slot (x -125 to -15, y 284-700), rising south to the terrace
furniture('Outdoor stair', 'stairsOut', G, -70, 492, { angle: PI });

// Openings, ground floor
opening('Front door', 'frontDoor', G, 630, -170, { angle: PI }); // a double door, the entrance hall's north end
opening('Double door', 'frontDoor', G, 630, 100, { angle: PI }); // entrance hall -> living room
opening('Door', 'door', G, 1200, 250, { angle: -PI / 2 }); // kitchen -> garage
opening('Door', 'door', G, 1200, 350, { angle: -PI / 2 }); // bathroom
opening('Door', 'door', G, 1260, 700); // bathroom -> deck
opening('Window', 'highWindow', G, 1500, 415, { angle: -PI / 2, elevation: 150 }); // bathroom, east, high
opening('Window', 'tallWindow', G, 800, -38, { angle: -PI / 2, elevation: 40 }); // entrance hall, east
opening('Door', 'door', G, 1200, -140, { angle: -PI / 2 }); // garage -> the courtyard (its side door)
opening('Window', 'tallWindow', G, 1650, 300, { elevation: 40 }); // garage, south (onto the covered deck)
for (const x of [1350, 1650]) opening('Garage door', 'garageDoor', G, x, -300, { angle: PI });
for (const x of [150, 750, 1050]) opening('Glass wall', 'glassPanel', G, x, 700);
opening('Glass door', 'glassDoor', G, 450, 700); // living -> deck
opening('Window', 'ribbon', G, 330, 100, { angle: PI, elevation: 170 }); // living, high

// --- Upper floor
// Main bedroom (west, by the pond, onto the terrace)
furniture('Bed', 'bed', P, 300, 223);
furniture('Bedside table', 'bedside', P, 185, 140);
furniture('Bedside table', 'bedside', P, 415, 140);
light('Bedside lamp', 'tableLamp', P, 185, 140, { elevation: 45, bulbs: [{ z: 0.85, diameter: 0.6 }] });
light('Bedside lamp', 'tableLamp', P, 415, 140, { elevation: 45, bulbs: [{ z: 0.85, diameter: 0.6 }] });
furniture('Rug', 'rugRound', P, 300, 450);
furniture('Plant', 'plant', P, 40, 650);
// The main bedroom's en-suite (the old dressing), reached from the main bedroom only since v7: the bath on its east wall
furniture('Bath', 'bath', P, 906, 385, { angle: PI / 2 });
furniture('Toilet', 'toilet', P, 700, 150);
furniture('Shower', 'shower', P, 651, 449);
furniture('Basin', 'basin', P, 780, 469, { angle: PI });
// Hall: the rod railing over the stair, a bench on the en-suite's wall
furniture('Railing', 'rodRail', P, 1075, 213);
furniture('Railing', 'railShort', P, 990, 500); // the hall's edge over the double-height kitchen (beside the way onto the gallery)
furniture('Bench', 'daybed', P, 998, 340, { angle: -PI / 2 });
// The gallery (v7): 1.2 m along the south glass over the double-height kitchen, its rod railing on the void's side
furniture('Railing', 'railGallery', P, 815, 580);
furniture('Railing', 'railShort', P, 1030, 540, { angle: PI / 2 });
furniture('Plant', 'plant', P, 1380, 130);
// Shower room
furniture('Shower', 'shower', P, 1349, 640, { angle: PI / 2 });
furniture('Basin', 'basin', P, 1220, 659, { angle: PI });
furniture('Toilet', 'toilet', P, 1364, 540, { angle: PI / 2 });
// Office and bedroom (east)
furniture('Desk', 'desk', P, 1600, 150);
furniture('Desk chair', 'deskChair', P, 1600, 215, { angle: PI });
furniture('Bookshelf', 'bookshelf', P, 1600, 378, { angle: PI });
// Bedroom (south-east; the snug until v7): bed head to the west wall, a wardrobe on the office's wall
furniture('Bed', 'bed', P, 1515, 585, { angle: -PI / 2 });
furniture('Wardrobe', 'wardrobe', P, 1650, 437);
// Bedroom (north, x 784-1400, y -170 to 100, cantilevered over the deck): bed head to the west wall, wardrobe east
furniture('Bed', 'bed', P, 908, -35, { angle: -PI / 2 });
furniture('Wardrobe', 'wardrobe', P, 1354, -55, { angle: PI / 2 });
light('Bedside lamp', 'tableLamp', P, 1050, -130, { bulbs: [{ z: 0.85, diameter: 0.6 }] });
furniture('Lounge chair', 'loungeChair', P, 1220, -80, { angle: 0.6 });
// Terrace over the pond
furniture('Lounger', 'lounger', P, 110, 900, { angle: PI }); // (at the terrace's west end: its middle stays clear for landing)
furniture('Lounger', 'lounger', P, 210, 900, { angle: PI });
furniture('Side table', 'sideTable', P, 290, 790);
furniture('Planter', 'planter', P, 570, 1000);
furniture('Planter', 'planter', P, 60, 1010);

// Openings, upper floor
opening('Glass door', 'glassDoor', P, 300, 700); // main bedroom -> terrace
opening('Window', 'ribbon', P, 0, 400, { angle: PI / 2, elevation: 140 }); // main bedroom, west, over the stair's screen wall
opening('Door', 'door', P, 600, 300, { angle: -PI / 2 }); // main bedroom -> en-suite (opening into it)
opening('Door', 'door', P, 600, 640, { angle: PI / 2 }); // main bedroom <- gallery (v7)
opening('Window', 'highWindow', P, 700, 100, { angle: PI, elevation: 160 }); // en-suite, north, high (v7)
opening('Door', 'door', P, 1230, 500); // hall -> shower room
opening('Door', 'door', P, 1400, 250, { angle: -PI / 2 }); // hall -> office
opening('Door', 'door', P, 1400, 450, { angle: -PI / 2 }); // hall -> bedroom (south-east)
opening('Door', 'door', P, 1250, 100, { angle: PI }); // hall (the stair's landing) -> bedroom
opening('Glass wall', 'glassPanel', P, 875, 700); // the gallery's glass, over the double-height kitchen
opening('Window', 'ribbon', P, 1275, 700, { elevation: 160 }); // shower room
opening('Window', 'ribbon', P, 1000, -170, { angle: PI, elevation: 100 }); // bedroom, north
opening('Window', 'ribbon', P, 1600, 100, { angle: PI, elevation: 100 }); // office
for (const y of [250, 550]) opening('Window', 'tallWindow', P, 1800, y, { angle: -PI / 2, elevation: 40 }); // office, bedroom
opening('Window', 'tallWindow', P, 1600, 700, { elevation: 40 }); // bedroom

// --- Walls
const wall = (id, level, x0, y0, x1, y1, { height, heightAtEnd, thickness = 15, left, right, color = PLASTER, start, end } = {}) =>
	xml.push(`<wall${attrs({ id, level, wallAtStart: start, wallAtEnd: end, xStart: x0, yStart: y0, xEnd: x1, yEnd: y1, height, heightAtEnd, thickness, leftSideColor: left ?? color, rightSideColor: right ?? color, topColor: left ?? color })}/>`);
// Ground floor: stone to the north, east and west (the fireplace wall), steel-and-glass to the south of the open space
wall('wall-g-n', G, 0, 100, 1200, 100, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-g-w' });
wall('wall-g-e2', G, 1500, 300, 1500, 700, { height: 288, thickness: 30, left: STONE, right: PLASTER, end: 'wall-g-s1' }); // bathroom | the covered deck
// The garage (v7: x 1200-1800, next to the kitchen), stone like the rest of the ground floor
wall('wall-gar-w', G, 1200, 100, 1200, -300, { height: 288, thickness: 30, left: STONE, right: PLASTER, end: 'wall-gar-n' });
wall('wall-gar-n', G, 1200, -300, 1800, -300, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-gar-w', end: 'wall-gar-e' });
wall('wall-gar-e', G, 1800, -300, 1800, 300, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-gar-n', end: 'wall-gar-s' });
wall('wall-gar-s', G, 1800, 300, 1500, 300, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-gar-e', end: 'wall-gar-s2' }); // | the covered deck
wall('wall-gar-s2', G, 1500, 300, 1200, 300, { height: 288, thickness: 30, start: 'wall-gar-s' }); // garage | bathroom
// The entrance hall, a small stone box projecting north
wall('wall-hall-w', G, 460, 100, 460, -170, { height: 288, thickness: 30, left: STONE, right: PLASTER, end: 'wall-hall-n' });
wall('wall-hall-n', G, 460, -170, 800, -170, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-hall-w', end: 'wall-hall-e' });
wall('wall-hall-e', G, 800, -170, 800, 100, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-hall-n' });
wall('wall-g-s1', G, 1500, 700, 1200, 700, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-g-e2' }); // the bathroom's south wall, on the facade (v7)
wall('wall-g-s2', G, 1200, 700, 0, 700, { height: 288, thickness: 10, color: FRAME, end: 'wall-g-w' });
wall('wall-g-w', G, 0, 700, 0, 100, { height: 288, thickness: 30, left: STONE, right: STONE, start: 'wall-g-s2', end: 'wall-g-n' }); // the fireplace wall, stone inside too
wall('wall-g-third', G, 1200, 100, 1200, 700, { height: 288 }); // the open space | garage, bathroom
// The west wall's slot: a stone screen continues the west facade's plane past the outdoor stair, 1 m above the terrace
wall('wall-screen', G, -145, 200, -145, 690, { height: 400, thickness: 30, color: STONE }); // (ends at the stair's top since 25 Nov: the deck passes round the west)
// Upper floor: a plastered box, warm render outside
const shellWall = { height: 280, thickness: 30, left: RENDER, right: PLASTER };
wall('wall-p0', P, 0, 100, 784, 100, { ...shellWall, start: 'wall-p3' });
wall('wall-p0b', P, 784, 100, 1400, 100, { height: 280, thickness: 30 }); // the stairwell, hall | the north bedroom (inside both sides)
wall('wall-p0c', P, 1400, 100, 1800, 100, { ...shellWall, end: 'wall-p1' });
wall('wall-p1', P, 1800, 100, 1800, 700, { ...shellWall, start: 'wall-p0c', end: 'wall-p2' });
wall('wall-p2', P, 1800, 700, 0, 700, { ...shellWall, start: 'wall-p1', end: 'wall-p3' });
wall('wall-p3', P, 0, 700, 0, 100, { ...shellWall, start: 'wall-p2', end: 'wall-p0' });
// The north bedroom, a render box cantilevered 2.7 m over the deck
wall('wall-pb-w', P, 784, 100, 784, -170, { ...shellWall, end: 'wall-pb-n' });
wall('wall-pb-n', P, 784, -170, 1400, -170, { ...shellWall, start: 'wall-pb-w', end: 'wall-pb-e' });
wall('wall-pb-e', P, 1400, -170, 1400, 100, { ...shellWall, start: 'wall-pb-n' });
wall('wall-p-bed', P, 600, 100, 600, 700, { height: 280, thickness: 12 }); // main bedroom | dressing, en-suite
wall('wall-p-wet', P, 600, 500, 950, 500, { height: 280, thickness: 12 }); // en-suite | the double-height void (the gallery beyond it)
wall('wall-p-wet2', P, 1150, 500, 1400, 500, { height: 280, thickness: 12 }); // hall | shower room (between them, the hall's railing over the void)
wall('wall-p-dress', P, 950, 211, 950, 500, { height: 280, thickness: 12 }); // dressing | hall
wall('wall-p-void-s', P, 784, 211, 950, 211, { height: 280, thickness: 12 }); // the stairwell | dressing
wall('wall-p-void-w', P, 784, 100, 784, 211, { height: 280, thickness: 12 });
wall('wall-p-wc', P, 1150, 500, 1150, 700, { height: 280, thickness: 12 }); // en-suite | shower room
wall('wall-p-east', P, 1400, 100, 1400, 700, { height: 280, thickness: 12 }); // hall | office, bedroom
wall('wall-p-office', P, 1400, 400, 1800, 400, { height: 280, thickness: 12 });
// Terrace over the pond: render parapets; the outdoor stair arrives at its north-west corner
wall('wall-t-w', P, 0, 810, 0, 1050, { height: 100, thickness: 20, color: RENDER, end: 'wall-t-s' });
wall('wall-t-s', P, 0, 1050, 700, 1050, { height: 100, thickness: 20, color: RENDER, start: 'wall-t-w', end: 'wall-t-e' });
wall('wall-t-e', P, 700, 1050, 700, 700, { height: 100, thickness: 20, color: RENDER, start: 'wall-t-s' }); // (x 700 since v7)
wall('wall-t-landing', P, -130, 810, 0, 810, { height: 100, thickness: 20, color: RENDER });

// A low curved stone wall round the far side of the pond (a round wall: arcExtent), and a sloping
// garden wall stepping down along the drive (heightAtEnd): both test the parser's wall shapes.
xml.push(`<wall${attrs({ id: 'wall-pond', level: G, xStart: 1480, yStart: 1510, xEnd: 140, yEnd: 1510, arcExtent: 0.9, height: 55, thickness: 30, leftSideColor: STONE, rightSideColor: STONE, topColor: STONE })}/>`);
xml.push(`<wall${attrs({ id: 'wall-path', level: G, xStart: 1185, yStart: -800, xEnd: 1185, yEnd: -315, height: 40, heightAtEnd: 140, thickness: 25, leftSideColor: STONE, rightSideColor: STONE, topColor: STONE })}/>`); // (along the drive's west edge since v7)

// --- Rooms
const room = (name, level, floorColor, points, extra = {}) => {
	xml.push(`<room${attrs({ id: `room-${nextId++}`, level, name: name || undefined, floorColor, ceilingColor: argb('ceiling'), ...extra })}>`, ...points.map(([x, y]) => `  <point x='${x}' y='${y}'/>`), '</room>');
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const OAK = argb('floor'), LIMESTONE = argb('paleStone'), PAVING = argb('paving'), SLATE = PAVING; // (bathroom floors as the paving: one colour fewer)
const open = { ceilingVisible: 'false' };
// Ground floor
room('Living room and kitchen', G, LIMESTONE, [[0, 100], [784, 100], [784, 211], [1200, 211], [1200, 700], [1150, 700], [1150, 500], [600, 500], [600, 700], [0, 700]]);
room('', G, LIMESTONE, rect(600, 500, 1030, 580), open); // the kitchen and dining's double height (no ceiling here)
room('', G, LIMESTONE, [[600, 580], [1030, 580], [1030, 500], [1150, 500], [1150, 700], [600, 700]]); // under the gallery (its soffit, v7)
room('', G, LIMESTONE, rect(784, 100, 1200, 211), open); // under the stair: no ceiling (the stairwell)
room('Bathroom', G, SLATE, rect(1200, 300, 1500, 700));
room('Garage', G, PAVING, rect(1200, -300, 1800, 300));
room('Entrance hall', G, LIMESTONE, rect(460, -170, 800, 100));
// The deck, all the way round the house: separate pieces that never overlap (no coplanar floors), stopping at the
// pond's stone coping (x 140-1480 from y 960), wider east of the pond.
room('Deck', G, PAVING, rect(-420, 700, 2400, 960), open); // the name on the largest piece (south, between the house and the pond)
room('', G, PAVING, rect(-420, 960, 140, 1170), open); // west of the pond
room('', G, PAVING, rect(1480, 960, 2400, 1480), open); // east of the pond
room('', G, PAVING, rect(-420, -170, -160, 700), open); // west, past the outdoor stair
room('', G, PAVING, rect(-160, -170, 460, 100), open); // north, west of the entrance hall
room('', G, PAVING, rect(460, -410, 800, -170), open); // the front step, before the entrance hall
room('', G, PAVING, rect(800, -170, 1200, 100)); // the roofed courtyard, under the bedroom's cantilever (its soffit)
room('Drive', G, PAVING, rect(1200, -800, 2400, -300), open);
room('', G, PAVING, rect(1800, -300, 2400, 300), open); // east of the garage
room('', G, PAVING, rect(1500, 300, 1800, 700)); // south of the garage, under the upper floor (its soffit)
room('', G, PAVING, rect(1800, 300, 2400, 700), open);
room('', G, PAVING, rect(0, 700, 700, 1050), { floorVisible: 'false' }); // the terrace's soffit over the deck (ceiling only)
room('', G, PAVING, rect(-130, 200, 0, 700), open); // the outdoor stair's slot
// Upper floor
room('Main bedroom', P, OAK, rect(0, 100, 600, 700));
room('En-suite', P, SLATE, [[600, 100], [784, 100], [784, 211], [950, 211], [950, 500], [600, 500]]); // the main bedroom's, and the way in
room('', P, SLATE, rect(600, 500, 1030, 580), { floorVisible: 'false' }); // the roof over the double-height kitchen (ceiling only)
room('Gallery', P, OAK, [[600, 580], [1030, 580], [1030, 500], [1150, 500], [1150, 700], [600, 700]]); // v7: 1.2 m along the south glass, and its way from the hall
room('Hall', P, OAK, [[950, 211], [1200, 211], [1200, 100], [1400, 100], [1400, 500], [950, 500]]);
room('Shower room', P, SLATE, rect(1150, 500, 1400, 700));
room('Office', P, OAK, rect(1400, 100, 1800, 400));
room('Bedroom', P, OAK, rect(1400, 400, 1800, 700)); // (the snug until v7)
room('Bedroom', P, OAK, rect(784, -170, 1400, 100));
room('Terrace', P, PAVING, [[-130, 700], [700, 700], [700, 1050], [0, 1050], [0, 810], [-130, 810]], open);

const home = [
	"<?xml version='1.0'?>",
	`<home version='7200' name='Pond House' camera='observerCamera' selectedLevel='${G}' wallHeight='288'>`,
	`  <environment groundColor='${argb('grass')}' skyColor='FFCCE4FC' lightColor='FFD0D0D0' ceillingLightColor='FFD0D0D0'/>`,
	"  <compass x='-500' y='-150' diameter='100' northDirection='0.0' longitude='0.0407' latitude='0.8529' timeZone='Europe/Paris'/>",
	// In the living room, looking south-west to the pond.
	`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='700' y='300' z='165' yaw='0.6' pitch='0.05' fieldOfView='1.0995574'/>`,
	`  <level id='${G}' name='Ground floor' elevation='0' floorThickness='12' height='288' elevationIndex='0'/>`,
	`  <level id='${P}' name='Upper floor' elevation='300' floorThickness='12' height='280' elevationIndex='0'/>`,
	...xml.map((l) => `  ${l}`),
	'</home>',
	'',
].join('\n');

const files = { 'Home.xml': strToU8(home), ...Object.fromEntries(Object.entries(entries).sort(([a], [b2]) => (a < b2 ? -1 : 1))) };
const zip = zipSync(files, { level: 9, mtime: new Date('2026-01-01T12:00:00Z') });
fs.writeFileSync(out, zip);
console.log(`${path.relative(process.cwd(), out)}: ${(zip.length / 1024).toFixed(1)} kB, ${modelIndex.size} models, ${Object.keys(files).length} entries`);
