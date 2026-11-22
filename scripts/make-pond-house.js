// Generates examples/pond-house.sh3d: CasaWalk's own sample home, the first the page offers
// ("Try a sample home", js/samples.js). Designed for CasaWalk, 22 Nov 2026.
// An original house between two mid-century ideas: a long glass pavilion with the calm of a
// steel-and-glass box, resting on a warm stone garden level and a stone core that rises through
// it, with a terrace cantilevered over a pond. Nothing here copies an existing building or model.
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
	// L-shaped stair, 17 risers of 17.6 cm on 26 cm treads (about 34°): 11 rising east along the core's north
	// wall, a 90 cm landing in the north-east corner, 6 more rising south along its east wall, arriving by the
	// core's south door on the pavilion. Model x = plan x from 1012.5, model z = plan y from 262.5.
	stairs: (() => {
		const r = 300 / 17, out = [];
		for (let i = 0; i < 11; i++) out.push(b(i * 26, 0, 0, (i + 1) * 26, +((i + 1) * r).toFixed(2), 90, i % 2 ? 'oak' : 'walnut'));
		out.push(b(285, 0, 0, 375, +(11 * r).toFixed(2), 90, 'oak'));
		for (let j = 0; j < 6; j++) out.push(b(285, 0, 90 + j * 26, 375, +((12 + j) * r).toFixed(2), 90 + (j + 1) * 26, j % 2 ? 'oak' : 'walnut'));
		return out;
	})(),
	railing: [b(0, 96, 0, 300, 100, 4, 'graphite'), ...Array.from({ length: 11 }, (_, i) => b(i * 29.6, 0, 1, i * 29.6 + 3, 96, 3, 'graphite'))],
	waterA: [b(0, 0, 0, 950, 1, 720, 'water')],
	waterB: [b(0, 0, 0, 700, 1, 570, 'water')],
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

const G = 'level-garden', P = 'level-pavilion';
const STONE = argb('masonry'), WHITE = argb('steelWhite'), OCHRE = argb('concrete'), PLASTER = argb('walls');

// --- Site: trees, shrubs, the pond's stone ledges and boulders (ground level)
furniture('Tree', 'tree', G, -250, 250);
furniture('Tree', 'tree', G, 1950, -150);
furniture('Tree', 'tree', G, 1550, 1250);
furniture('Shrub', 'shrub', G, 1850, 600);
furniture('Shrub', 'shrub', G, 300, -120);
furniture('Shrub', 'shrub', G, 1100, -100);
furniture('Stone ledge', 'ledge', G, 150, 1370);
furniture('Stone ledge', 'ledge', G, 700, 1380, { angle: 0.15 });
furniture('Stone ledge', 'ledge', G, 1180, 1150, { angle: PI / 2 });
furniture('Boulder', 'boulder', G, -220, 900, { angle: 0.4 });
furniture('Boulder', 'boulder', G, 1050, 950, { angle: -0.3 });
// The pond: flat water pieces (not a room, so nobody steps inside onto the water)
furniture('Pond', 'waterA', G, 125, 1060);
furniture('Pond', 'waterB', G, 950, 1135);
furniture('Water lilies', 'lily', G, 300, 1250, { elevation: 1 });
furniture('Water lilies', 'lily', G, 420, 1180, { elevation: 1 });
furniture('Water lilies', 'lily', G, 900, 1270, { elevation: 1 });
furniture('Steps', 'stepsOut', G, 1550, 885);

// --- Structure: white steel columns carrying the pavilion's west end; stone piers under the terrace
for (const [x, y] of [[120, 80], [120, 720], [1780, 80], [1780, 720]]) { furniture('Steel column', 'column', G, x, y); furniture('Steel column', 'columnP', P, x, y); }
furniture('Stone pier', 'pier', G, 250, 990);
furniture('Stone pier', 'pier', G, 700, 990);

// --- Garden level (stone): bedroom, entrance, stair hall, library, bathroom, study; covered terrace under the pavilion
furniture('Bed', 'bed', G, 780, 230, { angle: 0 });
furniture('Bedside table', 'bedside', G, 655, 135);
furniture('Bedside table', 'bedside', G, 905, 135);
light('Bedside lamp', 'tableLamp', G, 655, 135, { elevation: 45, bulbs: [{ z: 0.85, diameter: 0.6 }] });
light('Bedside lamp', 'tableLamp', G, 905, 135, { elevation: 45, bulbs: [{ z: 0.85, diameter: 0.6 }] });
furniture('Lounge chair', 'loungeChair', G, 690, 590, { angle: -0.6 });
furniture('Wardrobe', 'wardrobe', G, 965, 470, { angle: -PI / 2 });
furniture('Rug', 'rugRound', G, 780, 420);
furniture('Bench', 'daybed', G, 1200, 135, { angle: PI });
furniture('Plant', 'plant', G, 1040, 140);
light('Entrance lamp', 'pendant', G, 1200, 175, { elevation: 160, bulbs: [{ z: 0.1, diameter: 0.6 }] });
furniture('Stairs', 'stairs', G, 1200, 385.5); // footprint x 1012.5-1387.5, y 262.5-508.5
// Railings round the stairwell on the pavilion (its open edges: south of the first run, west of the second)
furniture('Railing', 'railing', P, 1145, 355);
furniture('Railing', 'railing', P, 1295, 432, { angle: PI / 2 });
furniture('Bookshelf', 'bookshelf', G, 1200, 566);
furniture('Lounge chair', 'loungeChair', G, 1080, 640, { angle: PI / 4 });
furniture('Floor lamp', 'floorLamp', G, 1030, 600);
furniture('Bath', 'bath', G, 1610, 150, { angle: PI });
furniture('Basin', 'basin', G, 1450, 300, { angle: PI / 2 });
furniture('Toilet', 'toilet', G, 1660, 300, { angle: -PI / 2 });
furniture('Desk', 'desk', G, 1550, 400, { angle: PI });
furniture('Desk chair', 'deskChair', G, 1550, 460);
furniture('Daybed', 'daybed', G, 1600, 640, { angle: PI });
furniture('Lounger', 'lounger', G, 250, 350, { angle: PI / 2 });
furniture('Lounger', 'lounger', G, 250, 520, { angle: PI / 2 });
furniture('Side table', 'sideTable', G, 380, 435);
furniture('Planter', 'planter', G, 520, 150);

// Openings, garden level
opening('Front door', 'frontDoor', G, 1200, 100, { angle: PI });
opening('Door', 'door', G, 1000, 175, { angle: PI / 2 });
opening('Door', 'door', G, 1300, 550);
opening('Door', 'door', G, 1400, 175, { angle: -PI / 2 });
opening('Door', 'door', G, 1400, 625, { angle: -PI / 2 });
opening('Glass wall', 'glassPanel', G, 800, 700);
opening('Glass wall', 'glassPanel', G, 600, 400, { angle: PI / 2 });
opening('Glass wall', 'glassPanelNarrow', G, 1200, 700);
opening('Glass wall', 'glassPanelNarrow', G, 1550, 700);
opening('Window', 'ribbon', G, 800, 100, { angle: PI, elevation: 170 });
opening('Window', 'ribbon', G, 1550, 100, { angle: PI, elevation: 170 });
opening('Window', 'ribbon', G, 1700, 500, { angle: -PI / 2, elevation: 170 });

// --- Pavilion level (glass): living, dining around the stone core, kitchen; terrace over the pond
furniture('Rug', 'rug', P, 330, 420);
furniture('Sofa', 'sofa', P, 330, 560, { angle: PI });
furniture('Lounge chair', 'loungeChair', P, 160, 330, { angle: 2.2 });
furniture('Ottoman', 'ottoman', P, 220, 250, { angle: 2.2 });
furniture('Lounge chair', 'loungeChair', P, 500, 300, { angle: -2.4 });
furniture('Coffee table', 'coffeeTable', P, 330, 420);
furniture('Sideboard', 'sideboard', P, 330, 125);
furniture('Floor lamp', 'floorLamp', P, 60, 600);
furniture('Plant', 'plant', P, 40, 140);
furniture('Bookshelf', 'bookshelf', P, 700, 125);
furniture('Fireplace', 'fireplace', P, 965, 400, { angle: PI / 2 });
furniture('Lounge chair', 'loungeChair', P, 800, 330, { angle: PI / 2 + 0.5 });
furniture('Lounge chair', 'loungeChair', P, 800, 480, { angle: PI / 2 - 0.5 });
furniture('Dining table', 'diningTable', P, 1200, 625);
for (const [dx, a] of [[-90, -PI / 2], [90, PI / 2]]) furniture('Dining chair', 'diningChair', P, 1200 + dx, 625, { angle: a });
furniture('Desk chair', 'diningChair', P, 1200, 200, { angle: 0 });
light('Pendant', 'pendant', P, 1200, 625, { elevation: 150, bulbs: [{ z: 0.1, diameter: 0.6 }] });
furniture('Desk', 'desk', P, 1200, 140, { angle: PI });
furniture('Kitchen counter', 'counter', P, 1431, 400, { angle: -PI / 2 });
furniture('Tall unit', 'tallUnit', P, 1735, 170, { angle: PI / 2 });
furniture('Kitchen island', 'island', P, 1610, 420, { angle: PI / 2 });
furniture('Stool', 'stool', P, 1690, 360);
furniture('Stool', 'stool', P, 1690, 480);
light('Pendant', 'pendant', P, 1610, 360, { elevation: 160, bulbs: [{ z: 0.1, diameter: 0.6 }] });
light('Pendant', 'pendant', P, 1610, 480, { elevation: 160, bulbs: [{ z: 0.1, diameter: 0.6 }] });
furniture('Lounger', 'lounger', P, 200, 870, { angle: PI });
furniture('Lounger', 'lounger', P, 320, 870, { angle: PI });
furniture('Side table', 'sideTable', P, 420, 800);
furniture('Planter', 'planter', P, 800, 1010);
furniture('Planter', 'planter', P, 60, 1010);

// Openings, pavilion: glass panels all round (one is the door to the terrace), the core's doors
for (let i = 0; i < 6; i++) opening('Glass wall', 'glassPanel', P, 150 + i * 300, 100, { angle: PI });
for (let i = 0; i < 6; i++) opening(i === 1 ? 'Glass door' : 'Glass wall', i === 1 ? 'glassDoor' : 'glassPanel', P, 150 + i * 300, 700);
for (const y of [250, 550]) { opening('Glass wall', 'glassPanel', P, 0, y, { angle: PI / 2 }); opening('Glass wall', 'glassPanel', P, 1800, y, { angle: -PI / 2 }); }
opening('Door', 'door', P, 1300, 550);

// --- Walls
const wall = (id, level, x0, y0, x1, y1, { height, thickness = 20, color = STONE, outer, start, end } = {}) =>
	xml.push(`<wall${attrs({ id, level, wallAtStart: start, wallAtEnd: end, xStart: x0, yStart: y0, xEnd: x1, yEnd: y1, height, thickness, leftSideColor: outer ?? color, rightSideColor: color, topColor: color })}/>`);
const loop = (tag, level, pts, opts) => pts.forEach(([x, y], i) => {
	const [x2, y2] = pts[(i + 1) % pts.length];
	wall(`wall-${tag}${i}`, level, x, y, x2, y2, { ...opts, start: `wall-${tag}${(i + pts.length - 1) % pts.length}`, end: `wall-${tag}${(i + 1) % pts.length}` });
});
// Garden level: stone shell, plaster partitions; the hall and the stair are one space under the core.
loop('g', G, [[600, 100], [1700, 100], [1700, 700], [600, 700]], { height: 288, thickness: 30 });
wall('wall-g-bed', G, 1000, 100, 1000, 700, { height: 288, thickness: 15, color: PLASTER });
wall('wall-g-bath', G, 1400, 100, 1400, 700, { height: 288, thickness: 15, color: PLASTER });
wall('wall-g-bath2', G, 1400, 350, 1700, 350, { height: 288, thickness: 15, color: PLASTER });
wall('wall-g-core', G, 1000, 550, 1400, 550, { height: 288, thickness: 25 }); // the core's foot: open to the hall, closed to the library
// Pavilion: thin white steel-and-glass skin (glass panels cut it to a fascia above and the slab edge below).
loop('p', P, [[0, 100], [1800, 100], [1800, 700], [0, 700]], { height: 300, thickness: 10, color: WHITE });
// The stone core rises through the pavilion and 80 cm above its roof.
loop('pc', P, [[1000, 250], [1400, 250], [1400, 550], [1000, 550]], { height: 380, thickness: 25 });
// Terrace parapets: warm concrete, rounded off visually by their colour top.
wall('wall-t0', P, 0, 700, 0, 1050, { height: 100, thickness: 20, color: OCHRE, end: 'wall-t1' });
wall('wall-t1', P, 0, 1050, 900, 1050, { height: 100, thickness: 20, color: OCHRE, start: 'wall-t0', end: 'wall-t2' });
wall('wall-t2', P, 900, 1050, 900, 700, { height: 100, thickness: 20, color: OCHRE, start: 'wall-t1' });

// A low curved stone wall round the far side of the pond (a round wall: arcExtent), and a sloping
// garden wall stepping down beside the entrance path (heightAtEnd): both test the parser's wall shapes.
xml.push(`<wall${attrs({ id: 'wall-pond', level: G, xStart: 1300, yStart: 1420, xEnd: -350, yEnd: 1420, arcExtent: 0.9, height: 55, thickness: 30, leftSideColor: STONE, rightSideColor: STONE, topColor: STONE })}/>`);
xml.push(`<wall${attrs({ id: 'wall-path', level: G, xStart: 1000, yStart: -250, xEnd: 1000, yEnd: 60, height: 40, heightAtEnd: 140, thickness: 25, leftSideColor: STONE, rightSideColor: STONE, topColor: STONE })}/>`);

// --- Rooms
const room = (name, level, floorColor, points, extra = {}) => {
	xml.push(`<room${attrs({ id: `room-${nextId++}`, level, name: name || undefined, floorColor, ceilingColor: argb('ceiling'), ...extra })}>`, ...points.map(([x, y]) => `  <point x='${x}' y='${y}'/>`), '</room>');
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const OAK = argb('floor'), TRAVERTINE = argb('paleStone'), PAVING = argb('paving'), WATER = argb('water'), SLATE = argb('stone');
const open = { ceilingVisible: 'false' };
// Garden level
room('Bedroom', G, OAK, rect(600, 100, 1000, 700));
room('Entrance', G, SLATE, rect(1000, 100, 1400, 250));
room('Hall', G, SLATE, [[1000, 355], [1295, 355], [1295, 512], [1400, 512], [1400, 550], [1000, 550]]);
room('', G, SLATE, [[1000, 250], [1400, 250], [1400, 512], [1295, 512], [1295, 355], [1000, 355]], open); // under the L stair: floor, no ceiling (the stairwell)
room('Library', G, OAK, rect(1000, 550, 1400, 700));
room('Bathroom', G, SLATE, rect(1400, 100, 1700, 350));
room('Study', G, OAK, rect(1400, 350, 1700, 700));
room('Covered terrace', G, PAVING, rect(0, 100, 600, 700));
room('', G, PAVING, rect(600, 700, 900, 850)); // covered part of the garden terrace
room('Garden terrace', G, PAVING, rect(900, 700, 1700, 850), open);
room('', G, PAVING, rect(0, 700, 600, 1050), { floorVisible: 'false' }); // the terrace's soffit over the pond (ceiling only)
room('', G, PAVING, rect(600, 850, 900, 1050), { floorVisible: 'false' });
room('', G, PAVING, rect(1700, 100, 1800, 700)); // under the kitchen's overhang
room('Path', G, PAVING, rect(1050, -60, 1350, 100), open);
// Pavilion level
room('Living room', P, TRAVERTINE, rect(0, 100, 800, 700));
room('Dining room', P, TRAVERTINE, [[800, 100], [1400, 100], [1400, 250], [1000, 250], [1000, 550], [1400, 550], [1400, 700], [800, 700]], { nameXOffset: -180, nameYOffset: 160 }); // label in the room's west band, clear of the core
room('Kitchen', P, TRAVERTINE, rect(1400, 100, 1800, 700));
room('Landing', P, SLATE, [[1000, 355], [1295, 355], [1295, 512], [1400, 512], [1400, 550], [1000, 550]]);
room('Terrace', P, PAVING, rect(0, 700, 900, 1050), open);

const home = [
	"<?xml version='1.0'?>",
	`<home version='7200' name='Pond House' camera='observerCamera' selectedLevel='${P}' wallHeight='288'>`,
	`  <environment groundColor='${argb('grass')}' skyColor='FFCCE4FC' lightColor='FFD0D0D0' ceillingLightColor='FFD0D0D0'/>`,
	"  <compass x='-500' y='-150' diameter='100' northDirection='0.0' longitude='0.0407' latitude='0.8529' timeZone='Europe/Paris'/>",
	// In the living room, looking south over the terrace and the pond.
	`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='450' y='250' z='470' yaw='0.35' pitch='0.1' fieldOfView='1.0995574'/>`,
	`  <level id='${G}' name='Garden level' elevation='0' floorThickness='12' height='288' elevationIndex='0'/>`,
	`  <level id='${P}' name='Pavilion' elevation='300' floorThickness='12' height='300' elevationIndex='0'/>`,
	...xml.map((l) => `  ${l}`),
	'</home>',
	'',
].join('\n');

const files = { 'Home.xml': strToU8(home), ...Object.fromEntries(Object.entries(entries).sort(([a], [b2]) => (a < b2 ? -1 : 1))) };
const zip = zipSync(files, { level: 9, mtime: new Date('2026-01-01T12:00:00Z') });
fs.writeFileSync(out, zip);
console.log(`${path.relative(process.cwd(), out)}: ${(zip.length / 1024).toFixed(1)} kB, ${modelIndex.size} models, ${Object.keys(files).length} entries`);
