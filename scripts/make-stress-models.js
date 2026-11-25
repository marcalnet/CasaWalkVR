// Generates stress models for measuring how CasaWalk copes with very heavy
// homes (planning: heavy-models investigation). Everything in them is
// original and written here. They are large, so they are generated on demand
// into test-output/stress/ (ignored by git), never committed:
//   node scripts/make-stress-models.js            every case
//   node scripts/make-stress-models.js many-500k  one case
//
// Cases:
//   many-100k, many-500k, many-1m, many-2m
//       one storey of rooms with many furnished pieces (40 different
//       catalogue-like models, two materials each, every piece in its own
//       colour), about 100k / 500k / 1M / 2M triangles in all;
//   warehouse
//       a small room with two pieces imported from "3D Warehouse": one of
//       about 2M and one of about 5M triangles, each a single dense mesh, as
//       OBJ with normals (as SketchUp exports them), in a .sh3d;
//   warehouse-obj
//       the 2M piece alone, as a plain OBJ (+ .mtl) in a zip.
// The big OBJs are written in chunks and zipped as a stream (fflate), so the
// generator itself never holds a whole file as one string.

import fs from 'node:fs';
import path from 'node:path';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';

const OUT = path.resolve(import.meta.dirname, '../test-output/stress');
const TMP = path.join(OUT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const f3 = (n) => +n.toFixed(3);

// ---------------------------------------------------------------------------
// Writing OBJs in chunks
// ---------------------------------------------------------------------------

/** A file written line by line through a buffer (no giant strings). */
function lineWriter(file) {
	const fd = fs.openSync(file, 'w');
	let buf = [];
	let size = 0;
	return {
		line(s) { buf.push(s); size += s.length + 1; if (size > 1 << 20) this.flush(); },
		flush() { if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; size = 0; },
		close() { this.flush(); fs.closeSync(fd); },
	};
}

/**
 * A rippled sphere of lat x lon quads split into triangles: 2 * lat * lon
 * triangles. normals: write vn lines and f a//a (as a SketchUp/3D Warehouse
 * OBJ does). Two materials, top and bottom half. Returns its triangle count.
 */
function writeBlob(w, { lat, lon, r = 40, normals = false, seed = 1, base = 0 }) {
	const ripple = (t, p) => 1 + 0.06 * Math.sin(5 * p + seed) * Math.sin(3 * t) + 0.02 * Math.sin(17 * p) * Math.sin(11 * t + seed);
	for (let i = 0; i <= lat; i++) {
		const t = (i / lat) * Math.PI;
		for (let j = 0; j < lon; j++) {
			const p = (j / lon) * 2 * Math.PI, rr = r * ripple(t, p);
			const x = Math.sin(t) * Math.cos(p), y = Math.cos(t), z = Math.sin(t) * Math.sin(p);
			w.line(`v ${f3(r + rr * x)} ${f3(r + rr * y)} ${f3(r + rr * z)}`);
			if (normals) w.line(`vn ${f3(x)} ${f3(y)} ${f3(z)}`);
		}
	}
	let tris = 0;
	for (const [from, to, mat] of [[0, lat >> 1, 'upper'], [lat >> 1, lat, 'lower']]) {
		w.line(`usemtl ${mat}`);
		for (let i = from; i < to; i++) {
			for (let j = 0; j < lon; j++) {
				const a = base + i * lon + j + 1, b = base + i * lon + (j + 1) % lon + 1, c = base + (i + 1) * lon + (j + 1) % lon + 1, d = base + (i + 1) * lon + j + 1;
				if (normals) { w.line(`f ${a}//${a} ${d}//${d} ${c}//${c}`); w.line(`f ${a}//${a} ${c}//${c} ${b}//${b}`); }
				else { w.line(`f ${a} ${d} ${c}`); w.line(`f ${a} ${c} ${b}`); }
				tris += 2;
			}
		}
	}
	return tris;
}

const MTL = (k) => `newmtl upper\nKd ${f3(0.4 + 0.5 * ((k * 37) % 11) / 10)} ${f3(0.35 + 0.4 * ((k * 17) % 7) / 6)} 0.3\n\nnewmtl lower\nKd 0.3 0.28 0.26\n`;

/** One OBJ model file (+ its MTL) in TMP; returns { obj, mtl, tris, size: [w, h, d] cm }. */
function makeModel(name, opts) {
	const obj = path.join(TMP, `${name}.obj`), w = lineWriter(obj);
	w.line(`# ${name}: generated for CasaWalk's heavy-model measurements`);
	w.line(`mtllib ${name}.mtl`);
	const tris = writeBlob(w, opts);
	w.close();
	fs.writeFileSync(path.join(TMP, `${name}.mtl`), MTL(opts.seed ?? 1));
	const d = 2 * (opts.r ?? 40) * 1.1;
	return { obj, mtl: path.join(TMP, `${name}.mtl`), tris, size: [f3(d), f3(d), f3(d)] };
}

// ---------------------------------------------------------------------------
// Zipping as a stream
// ---------------------------------------------------------------------------

/** Writes a zip of entries ({ name, file } streamed from disk, or { name, text }) to out. */
async function writeZip(out, entries) {
	const fd = fs.openSync(out, 'w');
	await new Promise((resolve, reject) => {
		const zip = new Zip((err, chunk, final) => {
			if (err) return reject(err);
			fs.writeSync(fd, chunk);
			if (final) resolve();
		});
		for (const e of entries) {
			const f = e.text !== undefined ? new ZipPassThrough(e.name) : new ZipDeflate(e.name, { level: 6 });
			f.mtime = new Date('2026-01-01T12:00:00Z');
			zip.add(f);
			if (e.text !== undefined) { f.push(strToU8(e.text), true); continue; }
			const src = fs.openSync(e.file, 'r'), chunk = Buffer.alloc(8 << 20);
			for (;;) {
				const n = fs.readSync(src, chunk, 0, chunk.length, null);
				if (!n) break;
				f.push(new Uint8Array(chunk.buffer, chunk.byteOffset, n).slice(), false);
			}
			f.push(new Uint8Array(0), true);
			fs.closeSync(src);
		}
		zip.end();
	});
	fs.closeSync(fd);
}

// ---------------------------------------------------------------------------
// Home.xml
// ---------------------------------------------------------------------------

const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}='${String(v).replace(/&/g, '&amp;').replace(/'/g, '&apos;')}'`).join('');
function homeXml(name, items, W, D) {
	const xml = [...items];
	const WALL = 'FFF2EEE6';
	[[0, 0, W, 0], [W, 0, W, D], [W, D, 0, D], [0, D, 0, 0]].forEach(([xs, ys, xe, ye], i) => xml.push(`<wall${attrs({ id: `wall-${i}`, level: 'L0', xStart: xs, yStart: ys, xEnd: xe, yEnd: ye, height: 250, thickness: 15, leftSideColor: WALL, rightSideColor: WALL })}/>`));
	xml.push(`<room${attrs({ id: 'room-0', level: 'L0', name: 'Room', floorColor: 'FFC9B79C', ceilingColor: 'FFFFFFFF' })}>`, ...[[0, 0], [W, 0], [W, D], [0, D]].map(([x, y]) => `  <point x='${x}' y='${y}'/>`), '</room>');
	return ["<?xml version='1.0'?>", `<home version='7200' name='${name}' camera='observerCamera' selectedLevel='L0' wallHeight='250'>`,
		`  <observerCamera attribute='observerCamera' lens='PINHOLE' x='${W / 2}' y='${D - 50}' z='170' yaw='3.14159' pitch='0' fieldOfView='1.1'/>`,
		"  <level id='L0' name='Ground floor' elevation='0' floorThickness='12' height='250' elevationIndex='0'/>", ...xml.map((l) => `  ${l}`), '</home>', ''].join('\n');
}

const piece = (id, model, x, y, [w, h, d], color) => `<pieceOfFurniture${attrs({ id, level: 'L0', name: 'Piece', model, x: f3(x), y: f3(y), width: w, depth: d, height: h, color })}/>`;
const PAINT = (i) => `FF${[(i * 53) % 200 + 40, (i * 97) % 200 + 40, (i * 151) % 200 + 40].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`;

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

/** Many pieces: 40 models of `trisEach` triangles, `pieces` placed on a grid, each in its own colour. */
async function many(name, pieces, trisEach) {
	const lon = Math.round(Math.sqrt(trisEach)), lat = Math.max(4, Math.round(trisEach / 2 / lon));
	const models = Array.from({ length: Math.min(40, pieces) }, (_, k) => ({ k, ...makeModel(`${name}-m${k}`, { lat, lon, r: 30 + (k % 5) * 5, seed: k + 1 }) }));
	const cols = Math.ceil(Math.sqrt(pieces)), step = 130, W = cols * step + 100, D = Math.ceil(pieces / cols) * step + 100;
	const items = [];
	let tris = 0;
	for (let i = 0; i < pieces; i++) {
		const m = models[i % models.length];
		items.push(piece(`p${i}`, `${m.k}/${path.basename(m.obj)}`, 100 + (i % cols) * step, 100 + Math.floor(i / cols) * step, m.size, PAINT(i)));
		tris += m.tris;
	}
	const out = path.join(OUT, `${name}.sh3d`);
	await writeZip(out, [{ name: 'Home.xml', text: homeXml(name, items, W, D) },
		...models.flatMap((m) => [{ name: `${m.k}/${path.basename(m.obj)}`, file: m.obj }, { name: `${m.k}/${path.basename(m.mtl)}`, file: m.mtl }])]);
	return { out, tris };
}

/** Two dense single-mesh pieces (2M and 5M triangles), as 3D Warehouse furniture imported into Sweet Home 3D. */
async function warehouse() {
	const a = makeModel('warehouse-2m', { lat: 1000, lon: 1000, r: 45, normals: true, seed: 3 });
	const b = makeModel('warehouse-5m', { lat: 1581, lon: 1581, r: 60, normals: true, seed: 7 });
	const items = [piece('sofa', '0/warehouse-2m.obj', 200, 200, a.size, null), piece('tree', '1/warehouse-5m.obj', 450, 250, b.size, null)];
	const out = path.join(OUT, 'warehouse.sh3d');
	await writeZip(out, [{ name: 'Home.xml', text: homeXml('3D Warehouse furniture', items, 600, 450) },
		{ name: '0/warehouse-2m.obj', file: a.obj }, { name: '0/warehouse-2m.mtl', file: a.mtl }, { name: '1/warehouse-5m.obj', file: b.obj }, { name: '1/warehouse-5m.mtl', file: b.mtl }]);
	return { out, tris: a.tris + b.tris };
}

async function warehouseObj() {
	const a = fs.existsSync(path.join(TMP, 'warehouse-2m.obj')) ? { obj: path.join(TMP, 'warehouse-2m.obj'), mtl: path.join(TMP, 'warehouse-2m.mtl'), tris: 2 * 1000 * 1000 } : makeModel('warehouse-2m', { lat: 1000, lon: 1000, r: 45, normals: true, seed: 3 });
	const out = path.join(OUT, 'warehouse-obj.zip');
	await writeZip(out, [{ name: 'warehouse-2m.obj', file: a.obj }, { name: 'warehouse-2m.mtl', file: a.mtl }]);
	return { out, tris: a.tris };
}

const CASES = {
	'many-100k': () => many('many-100k', 100, 1000),
	'many-500k': () => many('many-500k', 250, 2000),
	'many-1m': () => many('many-1m', 500, 2000),
	'many-2m': () => many('many-2m', 500, 4000),
	warehouse,
	'warehouse-obj': warehouseObj,
};

const want = process.argv.slice(2);
for (const [name, make] of Object.entries(CASES)) {
	if (want.length && !want.includes(name)) continue;
	const t0 = Date.now();
	const { out, tris } = await make();
	console.log(`${path.relative(process.cwd(), out)}: ${(fs.statSync(out).size / 1048576).toFixed(1)} MB, ${(tris / 1e6).toFixed(2)}M triangles in the models' files (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
