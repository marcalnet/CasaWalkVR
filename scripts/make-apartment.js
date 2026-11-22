// Generates examples/apartment.sh3d ("Apartment"; called Urban Flat until 23 Nov 2026): CasaWalk's small sample home, the second the page offers
// ("Try a sample home", js/samples.js). Designed for CasaWalk, 22 Nov 2026 (plan "Open L").
// A one-bedroom city flat of about 50 m² (54 m² to the wall axes) on a corner, with a balcony.
// The entrance opens straight into one 34 m² space (dining, kitchen, living) wrapped round by glass;
// the bathroom and the bedroom open off it through 90 cm doors. No corridor.
// Furnished as a good interior designer would: calm, well proportioned, clearly inspired by
// mid-century and Rams-era pieces (a lounge chair on a swivel base, a pedestal table, shell chairs,
// a layered pendant, a modular shelving divider, white audio boxes) but every shape is our own,
// built from plain boxes and cylinders: no brands, no logos, no replicas.
// With a big TV, a game console, speakers, a yoga corner and a shelving divider full of books.
//
// As a test home it is the opposite of the masterpiece houses: one level and no <level> elements,
// small rooms, furniture close together, a balcony, glass on two sides.
//
// Written like scripts/make-example.js; reproducible output (fixed zip dates, sorted entries).
//   npm run apartment     (commit the output)

import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { materials, argb } from './sample-palette.js';

const out = path.resolve(import.meta.dirname, '../examples/apartment.sh3d');
fs.mkdirSync(path.dirname(out), { recursive: true });
const PI = Math.PI;

// Every colour comes from the shared palette (scripts/sample-palette.js): material names are palette roles.
const MATERIALS = materials();

const b = (x0, y0, z0, x1, y1, z1, mat) => ({ box: [[x0, y0, z0], [x1, y1, z1]], mat });
const c = (cx, cz, r, y0, y1, mat, seg = 12, r1 = r) => ({ cyl: [cx, cz, r, r1, y0, y1, seg], mat });

function toObj(name, solids) {
	const lines = [`# ${name}: generated for CasaWalk (Apartment)`, `mtllib ${name}.mtl`];
	const used = new Set();
	let n = 0;
	const all = [];
	for (const s of solids) {
		used.add(s.mat);
		lines.push(`usemtl ${s.mat}`);
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
			lines.push(`f ${Array.from({ length: seg }, (_, i) => n + seg + 1 + i).join(' ')}`);
			lines.push(`f ${Array.from({ length: seg }, (_, i) => n + seg - i).join(' ')}`);
			n += seg * 2;
		}
	}
	const mtl = [...used].map((m) => { const [r, g, bl, d] = MATERIALS[m]; return `newmtl ${m}\nKd ${r} ${g} ${bl}\n${d !== undefined ? `d ${d}\n` : ''}`; }).join('\n');
	const size = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i])) - Math.min(...all.map((p) => p[i])));
	return { obj: `${lines.join('\n')}\n`, mtl, size };
}

const legs = (w, d, h, t, mat, inset = 0) => [b(inset, 0, inset, inset + t, h, inset + t, mat), b(w - inset - t, 0, inset, w - inset, h, inset + t, mat), b(inset, 0, d - inset - t, inset + t, h, d - inset, mat), b(w - inset - t, 0, d - inset - t, w - inset, h, d - inset, mat)];
const roundLegs = (w, d, h, r, mat, inset) => [[inset, inset], [w - inset, inset], [inset, d - inset], [w - inset, d - inset]].map(([x, z]) => c(x, z, r, 0, h, mat, 6));

const books = (x0, x1, y, z0, z1, seed) => { // a row of books of varied height and colour
	const cols = ['graphite', 'terracotta', 'oatmeal', 'olive', 'ceiling', 'wool', 'graphite', 'linen'];
	const out = []; let x = x0, k = seed;
	while (x < x1 - 4) { const w = 2.5 + (k * 7 % 5), h = 20 + (k * 13 % 11); out.push(b(x, y, z0, Math.min(x + w, x1), y + h, z1, cols[k % cols.length])); x += w + 0.3; k++; }
	return out;
};
const MODELS = {
	// Openings
	entryDoor: [b(0, 0, 0, 5, 212, 25, 'ceiling'), b(95, 0, 0, 100, 212, 25, 'ceiling'), b(5, 207, 0, 95, 212, 25, 'ceiling'), b(5, 0, 10, 95, 207, 15, 'walnut'), b(80, 98, 6, 84, 102, 19, 'brass')],
	door: [b(0, 0, 0, 5, 210, 12, 'ceiling'), b(95, 0, 0, 100, 210, 12, 'ceiling'), b(5, 205, 0, 95, 210, 12, 'ceiling'), b(5, 0, 4, 95, 205, 8, 'oak'), b(84, 98, 2, 87, 102, 10, 'brass')], // 90 cm clear
	glassWall: [b(0, 0, 0, 3, 245, 12, 'graphite'), b(135, 0, 0, 138, 245, 12, 'graphite'), b(3, 0, 0, 135, 4, 12, 'graphite'), b(3, 241, 0, 135, 245, 12, 'graphite'), b(3, 4, 5.5, 135, 241, 6.5, 'glass')],
	glassDoor: [b(0, 0, 0, 3, 245, 12, 'graphite'), b(135, 0, 0, 138, 245, 12, 'graphite'), b(3, 0, 0, 135, 4, 12, 'graphite'), b(3, 241, 0, 135, 245, 12, 'graphite'), b(3, 4, 5.5, 135, 241, 6.5, 'glass'), b(120, 95, 0, 123, 135, 12, 'brass')],
	// Smaller windows on the west side: the bathroom (privacy height) and a wide one above the bed.
	smallWindow: [b(0, 0, 0, 100, 3, 25, 'graphite'), b(0, 97, 0, 100, 100, 25, 'graphite'), b(0, 3, 0, 3, 97, 25, 'graphite'), b(97, 3, 0, 100, 97, 25, 'graphite'), b(3, 3, 12, 97, 97, 13, 'glass')],
	wideWindow: [b(0, 0, 0, 180, 3, 25, 'graphite'), b(0, 87, 0, 180, 90, 25, 'graphite'), b(0, 3, 0, 3, 87, 25, 'graphite'), b(177, 3, 0, 180, 87, 25, 'graphite'), b(89, 3, 10, 91, 87, 15, 'graphite'), b(3, 3, 12, 177, 87, 13, 'glass')],
	tallWindow: [b(0, 0, 0, 3, 225, 25, 'graphite'), b(137, 0, 0, 140, 225, 25, 'graphite'), b(3, 0, 0, 137, 4, 25, 'graphite'), b(3, 221, 0, 137, 225, 25, 'graphite'), b(69, 4, 10, 71, 221, 15, 'graphite'), b(3, 4, 12, 137, 221, 13, 'glass')],
	railing: [b(0, 0, 0, 570, 4, 4, 'graphite'), b(0, 96, 0, 570, 100, 4, 'graphite'), ...Array.from({ length: 39 }, (_, i) => b(i * 14.9, 4, 1, i * 14.9 + 1.5, 96, 3, 'graphite'))],
	// Living: TV wall, sofa, lounge chair, coffee table
	credenza: [b(0, 16, 0, 200, 58, 45, 'walnut'), ...[0, 1, 2, 3].map((i) => b(2 + i * 49, 19, 45, 49 + i * 49, 55, 46, i === 1 || i === 2 ? 'oak' : 'walnut')), ...roundLegs(200, 45, 16, 1.5, 'graphite', 10)],
	tv: [b(0, 0, 0, 168, 97, 4, 'graphite'), b(2, 2, 4, 166, 95, 4.3, 'graphite')], // 75-inch class, on the wall
	console: [b(0, 0, 0, 30, 6, 24, 'ceiling'), b(0, 2.6, 24, 30, 3.4, 24.5, 'graphite')], // a plain box, no brand
	speakerSmall: [b(0, 0, 0, 20, 32, 22, 'ceiling'), b(1.5, 3, 22, 18.5, 29, 22.4, 'graphite'), ...[0, 1, 2, 3, 4].map((i) => b(1.5, 5 + i * 5, 22.4, 18.5, 5.8 + i * 5, 22.6, 'graphite'))], // white box, slotted grille
	sofa: [...roundLegs(190, 86, 14, 1.2, 'graphite', 5), b(0, 14, 0, 190, 42, 86, 'oatmeal'), b(0, 42, 0, 190, 74, 16, 'oatmeal'), b(0, 42, 16, 12, 60, 86, 'oatmeal'), b(178, 42, 16, 190, 60, 86, 'oatmeal'),
		b(14, 42, 18, 95, 50, 84, 'oatmeal'), b(95, 42, 18, 176, 50, 84, 'oatmeal'), b(20, 50, 18, 58, 72, 28, 'terracotta'), b(132, 50, 18, 170, 72, 28, 'olive')],
	// A lounge chair on a swivel base, in the spirit of the mid-century classics: stepped walnut shells, black leather cushions.
	loungeChair: [c(42, 42, 3, 0, 2, 'graphite', 10), c(42, 42, 26, 0, 1.5, 'graphite', 5), c(42, 42, 3, 2, 30, 'graphite', 8),
		b(4, 30, 10, 80, 36, 80, 'walnut'), b(8, 36, 14, 76, 46, 78, 'leather'), b(4, 36, 0, 80, 66, 10, 'walnut'), b(8, 42, 8, 76, 70, 16, 'leather'), b(6, 66, -6, 78, 92, 4, 'walnut'), b(10, 70, 2, 74, 94, 10, 'leather'),
		b(0, 52, 16, 6, 56, 70, 'walnut'), b(78, 52, 16, 84, 56, 70, 'walnut')],
	ottoman: [c(30, 25, 2.5, 0, 26, 'graphite', 8), c(30, 25, 20, 0, 1.5, 'graphite', 5), b(2, 26, 2, 58, 31, 48, 'walnut'), b(5, 31, 5, 55, 41, 45, 'leather')],
	coffeeTable: [b(0, 34, 0, 110, 38, 60, 'walnut'), b(10, 0, 26, 100, 34, 34, 'oak'), b(51, 0, 6, 59, 34, 54, 'oak')],
	rug: [b(0, 0, 0, 230, 1, 170, 'wool')],
	tripodLamp: [c(0, 0, 1.2, 0, 140, 'oak', 6), c(14, 8, 1.2, 0, 120, 'oak', 6), c(-14, 8, 1.2, 0, 120, 'oak', 6), c(0, 0, 20, 140, 168, 'linen', 14, 18)],
	// Yoga corner
	yogaMat: [b(0, 0, 0, 61, 0.6, 183, 'olive')],
	meditationCushion: [c(0, 0, 22, 0, 14, 'terracotta', 14)],
	blanket: [b(0, 0, 0, 45, 8, 30, 'oatmeal')],
	plantLarge: [c(0, 0, 20, 0, 40, 'stone', 12, 17), c(0, 0, 8, 40, 90, 'green', 8, 14), c(0, 0, 32, 90, 160, 'green', 8, 12)],
	plantSmall: [c(0, 0, 9, 0, 16, 'stone', 10, 8), c(0, 0, 13, 16, 42, 'green', 8, 5)],
	// The shelving divider between kitchen and living: oak uprights, walnut shelves, white cabinets, books and
	// objects, open on both sides (you see through it). Modular in the Rams-era spirit, our own construction.
	shelving: [
		...[0, 79, 158, 237].map((x) => b(x, 0, 0, x + 3, 200, 36, 'oak')),
		...[8, 70, 132, 196].flatMap((y) => [0, 79, 158].map((x) => b(x + 3, y, 0, x + 79, y + 2.5, 36, 'oak'))),
		b(3, 10.5, 0, 79, 52, 36, 'ceiling'), b(161, 10.5, 0, 237, 52, 36, 'ceiling'),
		...books(84, 156, 10.5, 6, 30, 1), ...books(6, 60, 72.5, 6, 30, 5), ...books(164, 230, 134.5, 6, 30, 9), ...books(86, 130, 134.5, 6, 30, 3),
		c(30, 18, 7, 134.5, 160, 'terracotta', 10, 5), c(110, 18, 9, 72.5, 90, 'stone', 10), b(178, 72.5, 10, 220, 82, 28, 'ceiling'), b(180, 82, 10, 218, 83, 28, 'smoke'), // a white turntable box with a smoked lid
		b(100, 72.5, 8, 150, 88, 30, 'ceiling'), b(102, 80, 30, 112, 86, 30.5, 'graphite'), c(140, 30.2, 2, 78, 82, 'graphite', 8), // a white radio box
		c(40, 18, 10, 198.5, 222, 'green', 8, 5), b(200, 198.5, 10, 226, 214, 26, 'graphite'),
	],
	// Kitchen and dining
	kitchenRun: [b(0, 8, 0, 210, 86, 60, 'ceiling'), b(0, 0, 4, 210, 8, 56, 'graphite'), b(0, 86, 0, 210, 90, 62, 'stone'), b(130, 90, 12, 190, 91, 52, 'graphite'), b(30, 87, 14, 80, 90.5, 46, 'stone'), c(55, 8, 1.2, 90, 118, 'stone', 6), ...[1, 2, 3].map((i) => b(i * 52.5 - 0.4, 10, 60, i * 52.5 + 0.4, 84, 60.5, 'graphite'))],
	tallUnits: [b(0, 0, 0, 120, 240, 62, 'ceiling'), b(59.6, 4, 62, 60.4, 236, 62.5, 'graphite'), b(4, 110, 62, 56, 111, 62.5, 'graphite')],
	openShelf: [b(0, 0, 0, 210, 4, 25, 'oak'), b(20, 4, 6, 50, 22, 20, 'stone'), c(120, 12, 6, 4, 26, 'ceiling', 10), c(160, 12, 5, 4, 20, 'olive', 10)],
	island: [b(0, 0, 4, 180, 8, 86, 'graphite'), b(0, 8, 0, 180, 88, 90, 'oak'), b(-4, 88, -4, 184, 92, 94, 'stone')],
	stool: [c(0, 0, 17, 64, 69, 'leather', 12), c(0, 0, 2, 0, 64, 'graphite', 6), c(0, 0, 18, 0, 1.5, 'graphite', 12), c(0, 0, 15, 24, 25.5, 'graphite', 12)],
	pedestalTable: [c(0, 0, 30, 0, 3, 'ceiling', 16, 24), c(0, 0, 6, 3, 70, 'ceiling', 10, 4), c(0, 0, 55, 70, 74, 'oak', 24)],
	shellChair: [...[[6, 6], [38, 6], [6, 38], [38, 38]].map(([x, z]) => c(x, z, 1.2, 0, 40, 'walnut', 6)), b(4, 40, 4, 40, 42, 40, 'graphite'), b(2, 42, 2, 42, 47, 42, 'ceiling'), b(4, 47, 0, 40, 80, 5, 'ceiling'), b(2, 47, 4, 5, 60, 36, 'ceiling'), b(39, 47, 4, 42, 60, 36, 'ceiling')],
	layeredPendant: [c(0, 0, 0.6, 32, 110, 'graphite', 4), c(0, 0, 25, 22, 28, 'brass', 16, 12), c(0, 0, 17, 11, 17, 'opal', 14, 9), c(0, 0, 11, 0, 6, 'brass', 12, 5)],
	pendant: [c(0, 0, 0.6, 22, 110, 'graphite', 4), c(0, 0, 13, 0, 22, 'opal', 12, 13)],
	ceilingLamp: [c(0, 0, 1, 28, 45, 'graphite', 6), c(0, 0, 15, 0, 28, 'opal', 12, 12)],
	// Entrance
	closet: [b(0, 0, 0, 88, 240, 58, 'oak'), b(43.6, 3, 58, 44.4, 237, 58.5, 'graphite')],
	hallMirror: [b(0, 0, 0, 50, 120, 2.5, 'oak'), b(3, 3, 2.5, 47, 117, 2.9, 'mirror')],
	// Bedroom
	bed: [b(0, 0, 0, 160, 22, 212, 'oak'), b(4, 22, 6, 156, 46, 208, 'linen'), b(4, 46, 60, 156, 52, 208, 'ceiling'), b(4, 52, 160, 156, 54, 208, 'olive'), b(0, 0, 0, 160, 95, 6, 'oak'), b(14, 46, 12, 74, 58, 52, 'linen'), b(86, 46, 12, 146, 58, 52, 'linen')],
	nightstand: [b(0, 18, 0, 45, 44, 38, 'walnut'), b(3, 22, 38, 42, 40, 38.5, 'oak'), ...roundLegs(45, 38, 18, 1.2, 'graphite', 4)],
	tableLamp: [c(0, 0, 7, 0, 2, 'brass', 10), c(0, 0, 1, 2, 24, 'brass', 6), c(0, 0, 12, 24, 46, 'opal', 12, 12)],
	// Built-in closet: full height (to the ceiling), flush fronts in the wall colour, shadow gaps, a recessed plinth.
	builtInCloset: [b(0, 8, 0, 252, 255, 60, 'walls'), b(2, 0, 0, 250, 8, 54, 'graphite'), ...[63, 126, 189].map((x) => b(x - 0.4, 8, 60, x + 0.4, 255, 60.4, 'graphite')),
		...[57, 69, 183, 195].map((x) => b(x, 100, 60, x + 1.5, 140, 60.6, 'graphite'))],
	wardrobe: [b(0, 0, 0, 120, 240, 60, 'oak'), b(59.6, 3, 60, 60.4, 237, 60.5, 'graphite'), b(3, 0, 0, 117, 6, 61, 'graphite')],
	readingChair: [...roundLegs(66, 70, 36, 1.4, 'walnut', 5), b(2, 36, 2, 64, 46, 68, 'olive'), b(2, 46, 0, 64, 84, 10, 'olive'), b(0, 36, 8, 6, 58, 66, 'walnut'), b(60, 36, 8, 66, 58, 66, 'walnut')],
	// Bathroom
	shower: [b(0, 0, 0, 90, 6, 90, 'stone'), b(0, 6, 88, 90, 200, 90, 'glass'), c(70, 12, 10, 196, 198, 'brass', 10), c(70, 6, 1, 160, 198, 'brass', 6)],
	toilet: [b(10, 0, 20, 30, 40, 55, 'ceiling'), b(0, 40, 10, 40, 45, 60, 'ceiling'), b(0, 0, 0, 40, 80, 18, 'ceiling')],
	vanity: [b(0, 30, 0, 80, 80, 46, 'walnut'), b(0, 80, 0, 80, 82, 48, 'stone'), b(23, 82, 8, 57, 92, 38, 'ceiling'), c(40, 4, 1.2, 82, 100, 'brass', 6), b(10, 105, 0, 70, 175, 3, 'mirror')],
	linenCabinet: [b(0, 0, 0, 60, 190, 40, 'oak'), b(29.6, 4, 40, 30.4, 186, 40.5, 'oak')],
	// Balcony
	balconyChair: [...legs(55, 60, 38, 3, 'oak', 2), b(2, 34, 2, 53, 38, 58, 'oak'), b(5, 38, 6, 50, 46, 56, 'olive'), b(2, 38, 0, 53, 78, 4, 'oak'), b(5, 46, 4, 50, 74, 10, 'olive')],
	balconyTable: [c(0, 0, 25, 44, 47, 'oak', 16), c(0, 0, 2, 0, 44, 'graphite', 6), c(0, 0, 16, 0, 2, 'graphite', 10)],
	planterOlive: [c(0, 0, 24, 0, 45, 'stone', 12, 20), c(0, 0, 3, 45, 110, 'walnut', 6), c(0, 0, 32, 110, 170, 'olive', 8, 18)],
};

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
function piece(kind, label, model, x, y, { angle = 0, elevation = 0, bulbs = null } = {}) {
	const { ref, size: [w, h, d] } = modelRef(model);
	const a = attrs({ id: `${kind}-${nextId++}`, name: label, model: ref, x, y, elevation: elevation || undefined, angle: angle ? r2(angle) : undefined, width: r2(w), depth: r2(d), height: r2(h), power: bulbs ? 0.5 : undefined });
	if (!bulbs) { xml.push(`<${kind}${a}/>`); return; }
	xml.push(`<${kind}${a}>`, ...bulbs.map((s) => `  <lightSource${attrs({ x: 0.5, y: 0.5, z: s.z, color: '00FFE2B0', diameter: s.diameter })}/>`), `</${kind}>`);
}
const furniture = (...a) => piece('pieceOfFurniture', ...a);
const opening = (...a) => piece('doorOrWindow', ...a);
const light = (...a) => piece('light', ...a);
const lamp = (label, x, y) => light(label, 'ceilingLamp', x, y, { elevation: 195, bulbs: [{ z: 0.2, diameter: 0.6 }] });

// ---------------------------------------------------------------------------
// The flat, plan A "Open L", a corner end unit with windows on three sides (west, south, east). Plan cm, x east, y south; outer walls on 0-900 x 0-600 (about 50 m² inside).
//   west side: bathroom (0-330 x 0-240), bedroom (0-330 x 240-600), both opening east through 90 cm doors
//   the open space (330-900 x 0-600): dining by the entrance (NW), kitchen (NE), living (south, glass to
//   the balcony), a shelving divider between kitchen and living, open at both ends.
//   Glass: floor to ceiling along the balcony; tall windows on the east (a corner flat) and in the bedroom.
// Angles: 0 = front faces south (+y), PI/2 = west, -PI/2 = east, PI = north.
// ---------------------------------------------------------------------------

// Entrance and dining (the entrance opens straight into the room)
furniture('Closet', 'closet', 365, 56, { angle: -PI / 2 });
furniture('Mirror', 'hallMirror', 336, 230, { angle: -PI / 2, elevation: 80 });
lamp('Entrance lamp', 470, 90);
furniture('Dining table', 'pedestalTable', 450, 290);
for (const [dx, dy, a] of [[0, -68, 0], [0, 68, PI], [-68, 0, -PI / 2], [68, 0, PI / 2]]) furniture('Dining chair', 'shellChair', 450 + dx, 290 + dy, { angle: a });
light('Dining pendant', 'layeredPendant', 450, 290, { elevation: 140, bulbs: [{ z: 0.3, diameter: 0.6 }] });
furniture('Plant', 'plantLarge', 548, 34);
// Kitchen
furniture('Tall units', 'tallUnits', 620, 44);
furniture('Kitchen units', 'kitchenRun', 785, 44);
furniture('Open shelf', 'openShelf', 785, 26, { elevation: 150 });
furniture('Kitchen island', 'island', 745, 210);
for (const x of [700, 790]) furniture('Stool', 'stool', x, 285);
for (const x of [705, 785]) light('Island pendant', 'pendant', x, 210, { elevation: 150, bulbs: [{ z: 0.1, diameter: 0.6 }] });
// The shelving divider: kitchen on its north side, living on its south; open both ends (330-570 and 810-900)
furniture('Shelving', 'shelving', 668, 380);
// Living: TV wall on the west, sofa facing it, lounge chair by the glass, yoga corner in the east
furniture('Sideboard', 'credenza', 358, 490, { angle: -PI / 2 });
furniture('TV', 'tv', 337, 490, { angle: -PI / 2, elevation: 100 });
furniture('Game console', 'console', 362, 470, { angle: -PI / 2, elevation: 58 });
furniture('Speaker', 'speakerSmall', 360, 410, { angle: -PI / 2, elevation: 58 });
furniture('Speaker', 'speakerSmall', 360, 570, { angle: -PI / 2, elevation: 58 });
furniture('Rug', 'rug', 530, 490, { angle: PI / 2 });
furniture('Coffee table', 'coffeeTable', 500, 490, { angle: PI / 2 });
furniture('Sofa', 'sofa', 650, 490, { angle: PI / 2 });
furniture('Lounge chair', 'loungeChair', 440, 552, { angle: 2.5 });
furniture('Ottoman', 'ottoman', 445, 430, { angle: -2.2 });
light('Floor lamp', 'tripodLamp', 395, 585, { bulbs: [{ z: 0.9, diameter: 0.5 }] });
furniture('Yoga mat', 'yogaMat', 840, 495);
furniture('Meditation cushion', 'meditationCushion', 775, 545);
furniture('Blanket', 'blanket', 840, 420);
furniture('Plant', 'plantLarge', 865, 575);
lamp('Living room lamp', 560, 490);
// Bedroom: walnut bed against the west wall, tall oak wardrobe, a reading chair by the window
furniture('Built-in closet', 'builtInCloset', 139, 275); // along the bathroom wall, stopping short of the door
furniture('Bed', 'bed', 118, 450, { angle: -PI / 2 });
furniture('Nightstand', 'nightstand', 33, 345, { angle: -PI / 2 });
furniture('Nightstand', 'nightstand', 33, 555, { angle: -PI / 2 });
light('Bedside lamp', 'tableLamp', 33, 345, { elevation: 44, bulbs: [{ z: 0.8, diameter: 0.6 }] });
light('Bedside lamp', 'tableLamp', 33, 555, { elevation: 44, bulbs: [{ z: 0.8, diameter: 0.6 }] });
furniture('Reading chair', 'readingChair', 270, 545, { angle: -2.6 });
furniture('Plant', 'plantSmall', 290, 270);
lamp('Bedroom lamp', 165, 420);
// Bathroom
furniture('Shower', 'shower', 58, 58);
furniture('Toilet', 'toilet', 150, 43);
furniture('Washbasin', 'vanity', 262, 37);
furniture('Linen cabinet', 'linenCabinet', 200, 214, { angle: PI }); // on the bedroom wall, leaving the west window free
lamp('Bathroom lamp', 165, 120);
// Balcony
furniture('Balcony chair', 'balconyChair', 590, 660);
furniture('Balcony chair', 'balconyChair', 700, 660);
furniture('Balcony table', 'balconyTable', 645, 715);
furniture('Olive tree', 'planterOlive', 380, 700);
furniture('Plant', 'plantSmall', 860, 720);
furniture('Railing', 'railing', 615, 758);

// Openings: the entrance, two 90 cm doors, glass to the balcony (one panel a door), tall windows
opening('Entrance door', 'entryDoor', 470, 0, { angle: PI });
opening('Door', 'door', 330, 150, { angle: -PI / 2 });
opening('Door', 'door', 330, 320, { angle: -PI / 2 });
[404, 542, 680, 818].forEach((x) => opening(x === 542 ? 'Glass door' : 'Glass wall', x === 542 ? 'glassDoor' : 'glassWall', x, 600));
opening('Window', 'tallWindow', 165, 600, { elevation: 15 });
// A corner end unit: exterior on three sides (west, south, east). West: the bathroom and above the bed.
opening('Window', 'smallWindow', 0, 150, { angle: PI / 2, elevation: 115 });
opening('Window', 'wideWindow', 0, 450, { angle: PI / 2, elevation: 125 });
opening('Window', 'tallWindow', 900, 140, { angle: -PI / 2, elevation: 15 });
opening('Window', 'tallWindow', 900, 480, { angle: -PI / 2, elevation: 15 });

// Walls (one storey, no levels): warm white plaster; outer walls 25 cm, partitions 10 cm.
const WHITE = argb('walls'), PARTY = argb('putty'), FEATURE = argb('feature');
const wall = (id, x0, y0, x1, y1, { height = 255, thickness = 10, left = WHITE, right = WHITE, start, end } = {}) =>
	xml.push(`<wall${attrs({ id, wallAtStart: start, wallAtEnd: end, xStart: x0, yStart: y0, xEnd: x1, yEnd: y1, height, thickness, leftSideColor: left, rightSideColor: right, topColor: WHITE })}/>`);
const shell = [[0, 0], [900, 0], [900, 600], [0, 600]];
shell.forEach(([x, y], i) => { const [x2, y2] = shell[(i + 1) % 4]; wall(`wall-o${i}`, x, y, x2, y2, { thickness: 25, left: PARTY, right: i === 3 ? FEATURE : WHITE, start: `wall-o${(i + 3) % 4}`, end: `wall-o${(i + 1) % 4}` }); });
wall('wall-west-rooms', 330, 0, 330, 600, { left: FEATURE }); // its east face is the living room's TV wall
wall('wall-bath-bed', 0, 240, 330, 240);
wall('wall-bal-w', 330, 600, 330, 760, { height: 100, thickness: 12 });
wall('wall-bal-e', 900, 600, 900, 760, { height: 100, thickness: 12 });

const room = (name, floorColor, points, extra = {}) =>
	xml.push(`<room${attrs({ id: `room-${nextId++}`, name: name || undefined, floorColor, ceilingColor: argb('ceiling'), ...extra })}>`, ...points.map(([x, y]) => `  <point x='${x}' y='${y}'/>`), '</room>');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const OAK = argb('floor'), TILE = argb('putty'), DECK = argb('stone');
room('Bathroom', TILE, rect(0, 0, 330, 240));
room('Bedroom', OAK, rect(0, 240, 330, 600));
room('Dining', OAK, rect(330, 0, 560, 380));
room('Kitchen', OAK, rect(560, 0, 900, 380));
room('Living room', OAK, rect(330, 380, 900, 600));
room('Balcony', DECK, rect(330, 600, 900, 760), { ceilingVisible: 'false' });
room('Landing', argb('putty'), rect(350, -180, 590, 0), { ceilingVisible: 'false' }); // the building's shared landing

const home = [
	"<?xml version='1.0'?>",
	"<home version='7200' name='Apartment' camera='observerCamera' wallHeight='255'>",
	"  <environment groundColor='FFB9B6AE' skyColor='FFCCE4FC' lightColor='FFD0D0D0' ceillingLightColor='FFD0D0D0'/>",
	"  <compass x='-120' y='-120' diameter='100' northDirection='0.0' longitude='0.0407' latitude='0.8529' timeZone='Europe/Paris'/>",
	// Just inside the entrance, looking across the room to the glass and the balcony.
	`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='470' y='60' z='165' yaw='-0.35' pitch='0.05' fieldOfView='1.0995574'/>`,
	...xml.map((l) => `  ${l}`),
	'</home>',
	'',
].join('\n');

const files = { 'Home.xml': strToU8(home), ...Object.fromEntries(Object.entries(entries).sort(([a], [b2]) => (a < b2 ? -1 : 1))) };
const zip = zipSync(files, { level: 9, mtime: new Date('2026-01-01T12:00:00Z') });
fs.writeFileSync(out, zip);
console.log(`${path.relative(process.cwd(), out)}: ${(zip.length / 1024).toFixed(1)} kB, ${modelIndex.size} models, ${Object.keys(files).length} entries`);
