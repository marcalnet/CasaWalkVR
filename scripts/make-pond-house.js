// Generates examples/pond-house.sh3d: CasaWalk's own sample home, the first the page offers
// ("Try a sample home", js/samples.js). Designed for CasaWalk, 22 Nov 2026.
// A two-storey house by a pond, designed for CasaWalk (revised 22 Nov 2026 with the user, to an
// architect's standard; see THE PLAN below): a glazed day floor at the water's edge, a solid night floor
// above, a floating stair in the living room. Nothing here copies an existing building or model.
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
const ALIAS = { bark: 'walnut', foliage: 'green', linen: 'wool', leather: 'graphite', steelWhite: 'ceiling', terracotta: 'oak', brass: 'oak', concrete: 'wool' };

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
const steps = (n, rise, going, width) => Array.from({ length: n }, (_, i) => b(0, 0, i * going, width, (i + 1) * rise, (i + 1) * going, i % 2 ? 'oak' : 'walnut'));

const MODELS = {
	// Openings
	glassPanel: [b(0, 0, 0, 4, 270, 10, 'steelWhite'), b(296, 0, 0, 300, 270, 10, 'steelWhite'), b(4, 0, 4.5, 296, 270, 5.5, 'glass')],
	glassPanelNarrow: [b(0, 0, 0, 4, 240, 10, 'steelWhite'), b(256, 0, 0, 260, 240, 10, 'steelWhite'), b(4, 0, 4.5, 256, 240, 5.5, 'glass')],
	glassDoor: [b(0, 0, 0, 4, 270, 10, 'steelWhite'), b(296, 0, 0, 300, 270, 10, 'steelWhite'), b(4, 0, 4.5, 296, 270, 5.5, 'glass'), b(150, 90, 10, 153, 180, 13, 'steelWhite'), b(150, 90, -3, 153, 180, 0, 'steelWhite')],
	ribbon: [b(0, 0, 0, 240, 4, 30, 'steelWhite'), b(0, 56, 0, 240, 60, 30, 'steelWhite'), b(0, 4, 0, 4, 56, 30, 'steelWhite'), b(236, 4, 0, 240, 56, 30, 'steelWhite'), b(4, 4, 14, 236, 56, 16, 'glass')],
	door: [b(0, 0, 0, 5, 212, 20, 'walnut'), b(85, 0, 0, 90, 212, 20, 'walnut'), b(5, 207, 0, 85, 212, 20, 'walnut'), b(5, 0, 8, 85, 207, 12, 'oak'), b(74, 98, 5, 78, 102, 15, 'brass')],
	frontDoor: [b(0, 0, 0, 5, 230, 30, 'walnut'), b(115, 0, 0, 120, 230, 30, 'walnut'), b(5, 225, 0, 115, 230, 30, 'walnut'), b(5, 0, 13, 115, 225, 17, 'walnut'), b(95, 80, 8, 98, 160, 22, 'brass')],
	// Structure and site
	column: [b(0, 0, 0, 20, 288, 20, 'steelWhite')], // one storey each: the garden level part and the pavilion part are separate pieces
	columnP: [b(0, 0, 0, 20, 300, 20, 'steelWhite')],
	pier: [b(0, 0, 0, 80, 288, 120, 'masonry')],
	// Floating stair: 16 oak treads 7 cm thick, 90 cm deep from the wall, 26 cm goings, 17 risers of 17.6 cm,
	// cantilevered from the wall on the model's east side (model x 90); rising north (model z 0 = the top,
	// plan y 269). No stringer, nothing beneath.
	stairsFloating: (() => {
		const r = 300 / 17, out = [];
		for (let i = 0; i < 16; i++) { const z1 = 416 - i * 26, z0 = z1 - 26, top = +((i + 1) * r).toFixed(2); out.push(b(0, +(top - 7).toFixed(2), z0, 90, top, z1, 'oak')); }
		// The invisible balustrade (the user's call): frameless clear glass, 1.2 cm, on the open side, its top
		// edge 1 m above the pitch line (in 13 cm steps, as near a raked edge as boxes allow), from the floor
		// to the landing, so nobody falls off the open side.
		for (let k = 0; k < 32; k++) { const z1 = 416 - k * 13, z0 = z1 - 13, top = +((416 - z0) / 26 * r + 100).toFixed(2); out.push(b(-1.2, Math.max(0, +(Math.floor(k / 2) * r - 7).toFixed(2)), z0, 0, top, z1, 'glass')); }
		return out;
	})(),
	// Outdoor stair in the east wall's slot: 16 solid stone steps rising north to the terrace (model z 0 = the top)
	stairsOut: Array.from({ length: 16 }, (_, i) => b(0, 0, 416 - (i + 1) * 26, 110, +((i + 1) * 300 / 17).toFixed(2), 416 - i * 26, 'masonry')),
	shower: [b(0, 0, 0, 90, 6, 90, 'stone'), b(0, 6, 88, 90, 200, 90, 'glass'), c(70, 12, 10, 196, 198, 'brass', 10), c(70, 6, 1, 160, 198, 'brass', 6)],
	tallWindow: [b(0, 0, 0, 4, 200, 30, 'steelWhite'), b(146, 0, 0, 150, 200, 30, 'steelWhite'), b(4, 0, 0, 146, 4, 30, 'steelWhite'), b(4, 196, 0, 146, 200, 30, 'steelWhite'), b(4, 4, 14, 146, 196, 16, 'glass')],
	railing: [b(0, 96, 0, 300, 100, 4, 'graphite'), ...Array.from({ length: 11 }, (_, i) => b(i * 29.6, 0, 1, i * 29.6 + 3, 96, 3, 'graphite'))],
	waterA: [b(0, 0, 0, 950, 1, 520, 'water')],
	waterB: [b(0, 0, 0, 700, 1, 520, 'water')],
	stepsOut: steps(2, 15, 35, 160),
	ledge: [b(0, 0, 0, 260, 22, 90, 'masonry'), b(30, 22, 10, 200, 38, 80, 'masonry')],
	boulder: [b(0, 0, 0, 120, 45, 90, 'masonry'), b(20, 45, 15, 95, 70, 70, 'masonry')],
	tree: [c(0, 0, 12, 0, 260, 'bark', 6), c(0, 0, 130, 180, 330, 'foliage', 8, 95), c(0, 0, 95, 330, 450, 'green', 8, 35)],
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
// THE PLAN (revised 22 Nov 2026 with the user, to an architect's standard)
// A two-storey house on a 3 m grid, 18 x 6 m to the wall axes (plus the outdoor stair).
// Zoning: the ground floor is the day floor (living room, kitchen and dining, a bathroom), glazed to
// the south and west where the pond is, opening onto a deck at the water's edge. The upper floor is the
// night floor (main bedroom with its en-suite, a second bedroom, an office), a solid plastered box
// with punched windows, off one landing along the north side (rooms face south, to the sun and pond).
// Circulation first: the front door (north) opens into a hall that joins the living room (west) and the
// kitchen (east). The stair is part of the living room: floating oak treads cantilevered from its stone
// wall (mid-century, the user's choice), rising north to the middle of the upper landing.
// Wet rooms stack: the ground-floor bathroom sits under the upper shower room; the en-suite shares
// its wet wall line and sits over the kitchen's sink run.
// The outdoor stair is built into the east wall: a stone screen wall continues the east facade, and the
// stair rises between it and the house to the main bedroom's terrace (on the kitchen's roof).
// Stairs: 17 risers of 17.6 cm, 26 cm goings (2R + G = 61 cm), landings at least the stair's width.
// Grid: x 0 | 375 | 760 (stair) 870 | 1050 | 1200 | 1500 | 1800 | 1920 (screen wall); y 100 | 269/275 | 700.
// ===========================================================================

const G = 'level-ground', P = 'level-upper';
const STONE = argb('masonry'), FRAME = argb('steelWhite'), RENDER = argb('putty'), PLASTER = argb('walls'), OCHRE = argb('concrete');

// --- Site: trees, shrubs, the pond (south-west, at the deck's edge), its stone ledges and boulders
furniture('Tree', 'tree', G, -250, 250);
furniture('Tree', 'tree', G, 2150, -150);
furniture('Tree', 'tree', G, 1550, 1300);
furniture('Shrub', 'shrub', G, 2100, 600);
furniture('Shrub', 'shrub', G, 300, -120);
furniture('Shrub', 'shrub', G, 1350, -100);
furniture('Stone ledge', 'ledge', G, 150, 1370);
furniture('Stone ledge', 'ledge', G, 700, 1380, { angle: 0.15 });
furniture('Stone ledge', 'ledge', G, 1180, 1180, { angle: PI / 2 });
furniture('Boulder', 'boulder', G, -220, 1000, { angle: 0.4 });
furniture('Boulder', 'boulder', G, 1050, 1000, { angle: -0.3 });
// The pond: flat water pieces (not a room, so nobody steps inside onto the water), from the deck's edge
furniture('Pond', 'waterA', G, 125, 1160);
furniture('Pond', 'waterB', G, 950, 1160);
furniture('Water lilies', 'lily', G, 300, 1250, { elevation: 1 });
furniture('Water lilies', 'lily', G, 420, 1180, { elevation: 1 });
furniture('Water lilies', 'lily', G, 900, 1270, { elevation: 1 });

// --- Ground floor: living room (west), hall, open stair, bathroom, kitchen and dining (east)
// Living room, round the fireplace on the north wall; the pond to the south and west
furniture('Fireplace', 'fireplace', G, 380, 150);
furniture('Rug', 'rug', G, 380, 400);
furniture('Coffee table', 'coffeeTable', G, 380, 395);
furniture('Sofa', 'sofa', G, 380, 525, { angle: PI });
furniture('Lounge chair', 'loungeChair', G, 160, 380, { angle: -PI / 2 });
furniture('Lounge chair', 'loungeChair', G, 600, 380, { angle: PI / 2 });
furniture('Sideboard', 'sideboard', G, 610, 138);
furniture('Floor lamp', 'floorLamp', G, 60, 620);
furniture('Plant', 'plant', G, 45, 145);
// The stair: floating oak treads fixed into the living room's stone wall (the bathroom wall), rising north;
// no stringer, nothing beneath: the room flows under it. An invisible balustrade (frameless clear glass)
// on the open side. Treads x 772.5-862.5, y 269-685.
furniture('Stair', 'stairsFloating', G, 816.9, 477);
// Hall: the front door, a lamp, a plant
light('Hall lamp', 'pendant', G, 960, 190, { elevation: 160, bulbs: [{ z: 0.1, diameter: 0.6 }] });
furniture('Plant', 'plant', G, 1025, 140);
// Bathroom (stacked under the upper shower room): from the hall, and from the deck (after the pond)
furniture('Basin', 'basin', G, 1016, 370, { angle: PI / 2 });
furniture('Toilet', 'toilet', G, 1012, 500, { angle: PI / 2 });
furniture('Shower', 'shower', G, 997, 630, { angle: PI / 2 });
// Kitchen and dining: a run along the north wall, tall units on the east wall, the table by the glass
furniture('Kitchen counter', 'counter', G, 1335, 146);
furniture('Kitchen counter', 'counter', G, 1635, 146);
furniture('Tall unit', 'tallUnit', G, 1754, 310, { angle: PI / 2 });
furniture('Tall unit', 'tallUnit', G, 1754, 430, { angle: PI / 2 });
furniture('Dining table', 'diningTable', G, 1330, 480);
for (const [dx, dy, a] of [[-90, 0, -PI / 2], [90, 0, PI / 2], [0, -90, PI], [0, 90, 0]]) furniture('Dining chair', 'diningChair', G, 1330 + dx, 480 + dy, { angle: a });
light('Pendant', 'pendant', G, 1330, 480, { elevation: 150, bulbs: [{ z: 0.1, diameter: 0.6 }] });
// Deck at the pond's edge
furniture('Lounger', 'lounger', G, 120, 755, { angle: PI / 2 });
furniture('Lounger', 'lounger', G, 120, 845, { angle: PI / 2 });
furniture('Side table', 'sideTable', G, 265, 800);
furniture('Planter', 'planter', G, 700, 860);
furniture('Planter', 'planter', G, 1550, 860);
// The outdoor stair, in the east wall's slot: up to the main bedroom's terrace (x 1805-1915, y 274-690)
furniture('Outdoor stair', 'stairsOut', G, 1860, 482);

// Openings, ground floor
opening('Front door', 'frontDoor', G, 960, 100, { angle: PI });
opening('Door', 'door', G, 922, 269); // hall -> bathroom
opening('Door', 'door', G, 922, 700); // bathroom -> deck
for (const x of [165, 1500]) opening('Glass wall', 'glassPanel', G, x, 700);
for (const x of [465, 1200]) opening('Glass door', 'glassDoor', G, x, 700); // living and kitchen to the deck
for (const y of [255, 545]) opening('Glass wall', 'glassPanelNarrow', G, 0, y, { angle: PI / 2 });
opening('Window', 'ribbon', G, 380, 100, { angle: PI, elevation: 170 }); // above the fireplace
opening('Window', 'ribbon', G, 1500, 100, { angle: PI, elevation: 110 }); // above the worktop

// --- Upper floor: landing (north), office, bedroom, shower room, main bedroom with en-suite, terrace
// Office
furniture('Desk', 'desk', P, 190, 650, { angle: PI });
furniture('Desk chair', 'deskChair', P, 190, 585);
furniture('Bookshelf', 'bookshelf', P, 353, 480, { angle: PI / 2 });
// Bedroom
furniture('Bed', 'bed', P, 489, 520, { angle: -PI / 2 });
furniture('Bedside table', 'bedside', P, 405, 392);
furniture('Wardrobe', 'wardrobe', P, 722, 480, { angle: PI / 2 });
// Shower room (over the ground-floor bathroom)
furniture('Basin', 'basin', P, 1016, 370, { angle: PI / 2 });
furniture('Toilet', 'toilet', P, 1012, 500, { angle: PI / 2 });
furniture('Shower', 'shower', P, 997, 630, { angle: PI / 2 });
// Main bedroom and en-suite
furniture('Bed', 'bed', P, 1164, 500, { angle: -PI / 2 });
furniture('Bedside table', 'bedside', P, 1081, 382);
furniture('Bedside table', 'bedside', P, 1081, 618);
light('Bedside lamp', 'tableLamp', P, 1081, 382, { elevation: 45, bulbs: [{ z: 0.85, diameter: 0.6 }] });
light('Bedside lamp', 'tableLamp', P, 1081, 618, { elevation: 45, bulbs: [{ z: 0.85, diameter: 0.6 }] });
furniture('Wardrobe', 'wardrobe', P, 1385, 653, { angle: PI });
furniture('Lounge chair', 'loungeChair', P, 1420, 330, { angle: PI / 2 + 0.4 });
furniture('Basin', 'basin', P, 1320, 141);
furniture('Toilet', 'toilet', P, 1230, 145);
furniture('Shower', 'shower', P, 1440, 160, { angle: -PI / 2 });
// Terrace
furniture('Lounger', 'lounger', P, 1650, 520);
furniture('Planter', 'planter', P, 1650, 140);

// Openings, upper floor
for (const [x, label] of [[300, 'Door'], [700, 'Door'], [960, 'Door'], [1125, 'Door'], [1350, 'Door']]) opening(label, 'door', P, x, 275);
opening('Glass door', 'glassDoor', P, 1500, 480, { angle: -PI / 2 }); // main bedroom -> terrace
for (const x of [190, 570, 1165]) opening('Window', 'tallWindow', P, x, 700, { elevation: 40 });
opening('Window', 'tallWindow', P, 0, 480, { angle: PI / 2, elevation: 40 }); // the office looks west over the pond
for (const x of [300, 640]) opening('Window', 'ribbon', P, x, 100, { angle: PI, elevation: 100 }); // the landing
opening('Window', 'ribbon', P, 1080, 100, { angle: PI, elevation: 100 });
opening('Window', 'ribbon', P, 1340, 100, { angle: PI, elevation: 160 }); // en-suite, high

// --- Walls
const wall = (id, level, x0, y0, x1, y1, { height, heightAtEnd, thickness = 15, left, right, color = PLASTER, start, end } = {}) =>
	xml.push(`<wall${attrs({ id, level, wallAtStart: start, wallAtEnd: end, xStart: x0, yStart: y0, xEnd: x1, yEnd: y1, height, heightAtEnd, thickness, leftSideColor: left ?? color, rightSideColor: right ?? color, topColor: left ?? color })}/>`);
// Ground floor: stone to the north and east (the screen wall's line continues it), steel-and-glass to the south and west
wall('wall-g-n', G, 0, 100, 1935, 100, { height: 288, thickness: 30, left: STONE, right: PLASTER, end: 'wall-g-e' });
wall('wall-g-e', G, 1800, 100, 1800, 700, { height: 288, thickness: 30, left: STONE, right: PLASTER, start: 'wall-g-n', end: 'wall-g-s1' });
wall('wall-g-s1', G, 1800, 700, 1050, 700, { height: 288, thickness: 10, color: FRAME, start: 'wall-g-e' });
wall('wall-g-s2', G, 1050, 700, 870, 700, { height: 288, thickness: 30, left: STONE, right: PLASTER }); // the bathroom's outer wall
wall('wall-g-s3', G, 870, 700, 0, 700, { height: 288, thickness: 10, color: FRAME, end: 'wall-g-w' });
wall('wall-g-w', G, 0, 700, 0, 100, { height: 288, thickness: 10, color: FRAME, start: 'wall-g-s3' });
wall('wall-g-bath-w', G, 870, 700, 870, 269, { height: 288 }); // the stair's wall
wall('wall-g-bath-n', G, 870, 269, 1050, 269, { height: 288 });
wall('wall-g-bath-e', G, 1050, 269, 1050, 700, { height: 288 });
// The east wall's slot: a stone screen wall carries the east facade's plane past the outdoor stair, 1 m above the terrace
wall('wall-screen', G, 1920, 100, 1920, 700, { height: 400, thickness: 30, color: STONE });
// Upper floor: a plastered box, warm render outside
const shell = [[0, 100], [1500, 100], [1500, 700], [0, 700]];
shell.forEach(([x, y], i) => { const [x2, y2] = shell[(i + 1) % 4]; wall(`wall-p${i}`, P, x, y, x2, y2, { height: 280, thickness: 30, left: RENDER, right: PLASTER, start: `wall-p${(i + 3) % 4}`, end: `wall-p${(i + 1) % 4}` }); });
wall('wall-p-land-w', P, 0, 275, 760, 275, { height: 280, thickness: 12 }); // landing | office, bedroom
wall('wall-p-land-e', P, 870, 275, 1500, 275, { height: 280, thickness: 12 }); // landing | shower room, main bedroom; en-suite | main bedroom
wall('wall-p-office', P, 375, 275, 375, 700, { height: 280, thickness: 12 });
wall('wall-p-void-w', P, 760, 275, 760, 700, { height: 280, thickness: 12 }); // the stairwell's sides
wall('wall-p-void-e', P, 870, 275, 870, 700, { height: 280, thickness: 12 });
wall('wall-p-shower', P, 1050, 275, 1050, 700, { height: 280, thickness: 12 });
wall('wall-p-ensuite', P, 1200, 100, 1200, 275, { height: 280, thickness: 12 });
// Terrace parapets (render)
wall('wall-t-n', P, 1500, 100, 1920, 100, { height: 100, thickness: 20, color: RENDER });
wall('wall-t-s', P, 1500, 700, 1800, 700, { height: 100, thickness: 20, color: RENDER });
wall('wall-t-e', P, 1800, 274, 1800, 700, { height: 100, thickness: 20, color: RENDER }); // over the outdoor stair

// A low curved stone wall round the far side of the pond (a round wall: arcExtent), and a sloping
// garden wall stepping down beside the entrance path (heightAtEnd): both test the parser's wall shapes.
xml.push(`<wall${attrs({ id: 'wall-pond', level: G, xStart: 1300, yStart: 1420, xEnd: -350, yEnd: 1420, arcExtent: 0.9, height: 55, thickness: 30, leftSideColor: STONE, rightSideColor: STONE, topColor: STONE })}/>`);
xml.push(`<wall${attrs({ id: 'wall-path', level: G, xStart: 1150, yStart: -250, xEnd: 1150, yEnd: 60, height: 40, heightAtEnd: 140, thickness: 25, leftSideColor: STONE, rightSideColor: STONE, topColor: STONE })}/>`);

// --- Rooms
const room = (name, level, floorColor, points, extra = {}) => {
	xml.push(`<room${attrs({ id: `room-${nextId++}`, level, name: name || undefined, floorColor, ceilingColor: argb('ceiling'), ...extra })}>`, ...points.map(([x, y]) => `  <point x='${x}' y='${y}'/>`), '</room>');
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const OAK = argb('floor'), LIMESTONE = argb('paleStone'), PAVING = argb('paving'), SLATE = argb('stone');
const open = { ceilingVisible: 'false' };
// Ground floor
room('Living room', G, LIMESTONE, rect(0, 100, 760, 700));
room('', G, LIMESTONE, rect(760, 269, 870, 700), open); // under the open stair: no ceiling (the stairwell)
room('Hall', G, LIMESTONE, rect(760, 100, 1050, 269));
room('Bathroom', G, SLATE, rect(870, 269, 1050, 700));
room('Kitchen and dining', G, LIMESTONE, rect(1050, 100, 1800, 700));
room('Deck', G, PAVING, rect(0, 700, 1920, 900), open);
room('', G, PAVING, rect(1800, 100, 1920, 700), open); // the outdoor stair's slot
room('Path', G, PAVING, rect(810, -120, 1110, 100), open);
// Upper floor
room('Landing', P, OAK, rect(0, 100, 1200, 269));
room('Office', P, OAK, rect(0, 275, 375, 700));
room('Bedroom', P, OAK, rect(375, 275, 760, 700));
room('Shower room', P, SLATE, rect(870, 275, 1050, 700));
room('Main bedroom', P, OAK, rect(1050, 275, 1500, 700));
room('En-suite', P, SLATE, rect(1200, 100, 1500, 275));
room('Terrace', P, PAVING, [[1500, 100], [1920, 100], [1920, 274], [1800, 274], [1800, 700], [1500, 700]], open);

const home = [
	"<?xml version='1.0'?>",
	`<home version='7200' name='Pond House' camera='observerCamera' selectedLevel='${G}' wallHeight='288'>`,
	`  <environment groundColor='${argb('grass')}' skyColor='FFCCE4FC' lightColor='FFD0D0D0' ceillingLightColor='FFD0D0D0'/>`,
	"  <compass x='-500' y='-150' diameter='100' northDirection='0.0' longitude='0.0407' latitude='0.8529' timeZone='Europe/Paris'/>",
	// In the living room, looking south-west to the pond.
	`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='650' y='250' z='165' yaw='0.6' pitch='0.05' fieldOfView='1.0995574'/>`,
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
