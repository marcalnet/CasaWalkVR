// Draws the draft interface artwork into assets/ui/ (SPEC.md, "Replaceable
// graphics"). These are placeholders for the designer's own textures: a file
// replaced by one with the same name and size changes the look, no code
// involved. Text that changes (the scale ratio) is drawn by the app on top,
// inside the safe area listed in assets/ui/README.md.
//   npm run ui-assets    (needs the dev tools: npm install)

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'assets/ui');
fs.mkdirSync(out, { recursive: true });

/** Each asset: a file name, a size, and a function drawn on a 2D canvas in the browser. */
const ASSETS = [
	{
		// The plate on the plinth's front edge that shows the scale (e.g. "1:42"):
		// engraved brass with two screws; the app writes "Scale" and the ratio on it.
		name: 'scale-plate.png', w: 512, h: 192,
		draw: (ctx, w, h) => {
			const r = 26;
			const plate = new Path2D();
			plate.roundRect(6, 6, w - 12, h - 12, r);
			// Soft shadow under the plate.
			ctx.save();
			ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
			ctx.fillStyle = '#b8954e';
			ctx.fill(plate);
			ctx.restore();
			// Brass: a warm gradient with fine horizontal brushing.
			const g = ctx.createLinearGradient(0, 0, 0, h);
			g.addColorStop(0, '#e9d49a'); g.addColorStop(0.45, '#cfae64'); g.addColorStop(1, '#a9853d');
			ctx.fillStyle = g;
			ctx.fill(plate);
			ctx.save();
			ctx.clip(plate);
			let seed = 7;
			const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
			for (let y = 8; y < h - 8; y += 2) {
				ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '255,245,210' : '90,65,20'},${0.04 + rnd() * 0.06})`;
				ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(w - 6, y + (rnd() - 0.5)); ctx.stroke();
			}
			ctx.restore();
			// Bevel and an engraved inner line.
			ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,245,215,0.7)'; ctx.stroke(plate);
			const inner = new Path2D();
			inner.roundRect(22, 22, w - 44, h - 44, r - 12);
			ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(70,50,15,0.55)'; ctx.stroke(inner);
			// Two screws.
			for (const x of [44, w - 44]) {
				const sg = ctx.createRadialGradient(x - 3, h / 2 - 3, 1, x, h / 2, 9);
				sg.addColorStop(0, '#f6e7bd'); sg.addColorStop(1, '#7d6128');
				ctx.fillStyle = sg;
				ctx.beginPath(); ctx.arc(x, h / 2, 9, 0, Math.PI * 2); ctx.fill();
				ctx.strokeStyle = 'rgba(60,40,10,0.8)'; ctx.lineWidth = 2;
				ctx.beginPath(); ctx.moveTo(x - 6, h / 2 - 6); ctx.lineTo(x + 6, h / 2 + 6); ctx.stroke();
			}
		},
	},
	{
		// The wrist menu's icons (milestone C0.3): four columns (Settings, Help,
		// In, Back), three rows (dark ink, white for the filled blue door, blue
		// for the outline door), 128 px each, on transparency. The words are
		// drawn by the app (WRIST in js/theme.js).
		name: 'wrist-keys.png', w: 512, h: 384,
		draw: (ctx, w, h) => {
			const inks = ['#1d2329', '#ffffff', '#2f5fd0'];
			const S = 128;
			const door = (x, y) => { ctx.beginPath(); ctx.moveTo(x - 22, y + 34); ctx.lineTo(x - 22, y - 34); ctx.lineTo(x + 22, y - 34); ctx.lineTo(x + 22, y + 34); ctx.stroke(); };
			const arrow = (x0, x1, y) => {
				ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
				const d = Math.sign(x1 - x0) * 16;
				ctx.beginPath(); ctx.moveTo(x1 - d, y - 15); ctx.lineTo(x1, y); ctx.lineTo(x1 - d, y + 15); ctx.stroke();
			};
			inks.forEach((ink, row) => {
				ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
				const cy = row * S + S / 2;
				// Settings: a gear.
				{
					const cx = S / 2;
					ctx.beginPath();
					for (let i = 0; i < 16; i++) {
						const a = (i / 16) * Math.PI * 2, r = i % 2 ? 30 : 40;
						const a2 = ((i + 1) / 16) * Math.PI * 2;
						ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
						ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
					}
					ctx.closePath(); ctx.fill();
					ctx.save(); ctx.globalCompositeOperation = 'destination-out';
					ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
					ctx.restore();
				}
				// Help: a question mark in a circle.
				{
					const cx = S * 1.5;
					ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.stroke();
					ctx.font = '700 58px -apple-system, "Segoe UI", Roboto, sans-serif';
					ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
					ctx.fillText('?', cx, cy + 3);
				}
				// In: an arrow going right, into a door.
				{ const cx = S * 2.5; door(cx + 18, cy); arrow(cx - 44, cx + 10, cy); }
				// Back: an arrow going left, out of a door.
				{ const cx = S * 3.5; door(cx + 18, cy); arrow(cx + 14, cx - 44, cy); }
			});
		},
	},
	{
		// The settings board (C0.3): a brushed aluminium frame round a sheet of
		// warm paper, under the settings the app draws (tabs, rows, the Close
		// key). Stretched to the board's size (52 cm wide).
		name: 'board.png', w: 1024, h: 832,
		draw: (ctx, w, h) => {
			const frame = new Path2D(); frame.roundRect(4, 4, w - 8, h - 8, 40);
			const g = ctx.createLinearGradient(0, 0, w, h);
			g.addColorStop(0, '#d9dee3'); g.addColorStop(0.5, '#b9c0c7'); g.addColorStop(1, '#a3abb4');
			ctx.fillStyle = g; ctx.fill(frame);
			ctx.save(); ctx.clip(frame);
			let seed = 11;
			const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
			for (let y = 4; y < h; y += 2) {
				ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '60,70,80'},${0.03 + rnd() * 0.05})`;
				ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (rnd() - 0.5)); ctx.stroke();
			}
			ctx.restore();
			ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke(frame);
			// The paper sheet, with a soft shadow.
			const paper = new Path2D(); paper.roundRect(22, 22, w - 44, h - 44, 24);
			ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
			ctx.fillStyle = '#f5f2ea'; ctx.fill(paper); ctx.restore();
			ctx.save(); ctx.clip(paper);
			for (let i = 0; i < 2500; i++) {
				ctx.fillStyle = `rgba(120,100,70,${0.02 + rnd() * 0.03})`;
				ctx.fillRect(22 + rnd() * (w - 44), 22 + rnd() * (h - 44), 1.5, 1.5);
			}
			ctx.restore();
		},
	},
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of ASSETS) {
	const dataUrl = await page.evaluate(({ w, h, draw }) => {
		const c = document.createElement('canvas');
		c.width = w; c.height = h;
		// eslint-disable-next-line no-new-func
		new Function('ctx', 'w', 'h', `(${draw})(ctx, w, h)`)(c.getContext('2d'), w, h);
		return c.toDataURL('image/png');
	}, { w: a.w, h: a.h, draw: a.draw.toString() });
	fs.writeFileSync(path.join(out, a.name), Buffer.from(dataUrl.split(',')[1], 'base64'));
	console.log(`assets/ui/${a.name}  ${a.w} x ${a.h}`);
}
await browser.close();
