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
	{
		// The guide beside the menu (C0.4): four pictures per row, 256 px each.
		// Rows: walking with hands, walking with controllers, the scale model
		// with hands, with controllers. The words under them are drawn by the app.
		name: 'guide-sheets.png', w: 1024, h: 1024,
		draw: (ctx) => {
			const INK = '#1d2329', BLUE = '#3d6fd8', ORANGE = '#e07a1f', SOFT = '#9aa3ac', WHITE = '#ffffff';
			ctx.lineCap = 'round'; ctx.lineJoin = 'round';
			const line = (pts, color = INK, w = 7, dash = null) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore(); };
			const dot = (x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
			const ring = (x, y, color) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.beginPath(); ctx.ellipse(x, y, 46, 16, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
			const arrow = (x0, y0, x1, y1, color = INK) => { line([[x0, y0], [x1, y1]], color, 7); const a = Math.atan2(y1 - y0, x1 - x0); line([[x1 - 18 * Math.cos(a - 0.5), y1 - 18 * Math.sin(a - 0.5)], [x1, y1], [x1 - 18 * Math.cos(a + 0.5), y1 - 18 * Math.sin(a + 0.5)]], color, 7); };
			// A hand seen from the side, fingers curled, thumb on top of the index (the ready pose).
			const fist = (x, y, { thumbUp = false, ready = true, open = false } = {}) => {
				ctx.save(); ctx.translate(x, y);
				ctx.fillStyle = '#f4f1ea'; ctx.strokeStyle = INK; ctx.lineWidth = 6;
				ctx.beginPath(); ctx.roundRect(-55, -30, 80, 70, 24); ctx.fill(); ctx.stroke(); // palm
				ctx.beginPath(); ctx.roundRect(-80, 0, 34, 70, 14); ctx.fill(); ctx.stroke(); // wrist
				if (open) { for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.roundRect(22, -28 + i * 17, 70, 14, 7); ctx.fill(); ctx.stroke(); } }
				else for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(28, -12 + i * 16, 14, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
				const ty = thumbUp ? -62 : -38;
				ctx.beginPath(); ctx.roundRect(-20, ty, 58, 16, 8); ctx.fill(); ctx.stroke(); // thumb
				if (ready && !open) dot(34, ty + 8, 9, ORANGE);
				ctx.restore();
			};
			const controller = (x, y, { trigger = false, grip = false } = {}) => {
				ctx.save(); ctx.translate(x, y);
				ctx.fillStyle = '#2b3036'; ctx.beginPath(); ctx.roundRect(-24, -20, 48, 100, 20); ctx.fill();
				dot(0, -42, 34, '#2b3036'); dot(0, -42, 14, '#5d6873');
				if (trigger) { ctx.fillStyle = BLUE; ctx.beginPath(); ctx.roundRect(-34, -10, 14, 36, 6); ctx.fill(); }
				if (grip) { ctx.fillStyle = '#2f9e6a'; ctx.beginPath(); ctx.roundRect(18, 10, 14, 50, 6); ctx.fill(); }
				ctx.restore();
			};
			const house = (x, y, s = 1) => { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#e8dcc8'; ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.beginPath(); ctx.rect(-40, -10, 80, 56); ctx.fill(); ctx.stroke(); line([[-50, -8], [0, -50], [50, -8]]); ctx.restore(); };
			const arc = (x0, y0, x1, y1, color) => { for (let i = 0; i <= 12; i++) { const t = i / 12; dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * 60, 5, color); } };
			const F = 256, at = (col, row) => [col * F + F / 2, row * F + F / 2];
			// Row 0: walking, bare hands.
			let [x, y] = at(0, 0); fist(x, y);
			[x, y] = at(1, 0); fist(x, y + 10, { thumbUp: true }); arrow(x + 4, y - 70, x + 4, y - 98, ORANGE); arrow(x + 4, y - 98 + 8, x + 4, y - 64, ORANGE);
			[x, y] = at(2, 0); fist(x - 60, y + 30); arc(x - 30, y - 10, x + 70, y + 70, WHITE === '#fff' ? WHITE : SOFT); ring(x + 70, y + 74, SOFT);
			[x, y] = at(3, 0); fist(x - 60, y + 30, { thumbUp: true }); arc(x - 30, y - 10, x + 70, y + 70, BLUE); ring(x + 70, y + 74, BLUE);
			// Row 1: walking, controllers.
			[x, y] = at(0, 1); controller(x, y + 20); arrow(x, y - 30, x, y - 100, BLUE);
			[x, y] = at(1, 1); controller(x, y + 20, { trigger: true });
			[x, y] = at(2, 1); controller(x - 70, y + 40); arc(x - 60, y - 20, x + 70, y + 70, BLUE); ring(x + 70, y + 74, BLUE);
			[x, y] = at(3, 1); ring(x, y + 40, BLUE); arrow(x, y - 70, x, y + 20, INK); dot(x, y + 40, 8, BLUE);
			// Row 2: the scale model, bare hands.
			[x, y] = at(0, 2); house(x + 30, y + 20); fist(x - 40, y + 10, { ready: false });
			[x, y] = at(1, 2); house(x, y - 30, 0.8); line([[x, y + 10], [x, y + 80]], SOFT, 5, [10, 10]); ring(x, y + 90, SOFT);
			[x, y] = at(2, 2); fist(x - 60, y + 40, { thumbUp: true }); line([[x - 30, y + 10], [x + 60, y - 40]], ORANGE, 6); house(x + 70, y - 50, 0.6);
			[x, y] = at(3, 2); house(x + 50, y - 40, 0.6); fist(x - 50, y + 40, { thumbUp: true }); arrow(x - 10, y + 0, x + 40, y - 30, BLUE);
			// Row 3: the scale model, controllers.
			[x, y] = at(0, 3); house(x + 40, y - 30, 0.7); controller(x - 50, y + 30, { grip: true });
			[x, y] = at(1, 3); dot(x, y, 50, '#5d6873'); dot(x, y, 26, '#2b3036'); arrow(x - 70, y, x - 105, y, INK); arrow(x + 70, y, x + 105, y, INK); arrow(x, y - 70, x, y - 105, INK); arrow(x, y + 70, x, y + 105, INK);
			[x, y] = at(2, 3); controller(x - 70, y + 40); line([[x - 70, y - 2], [x + 50, y - 50]], WHITE === '#fff' ? WHITE : SOFT, 5); house(x + 70, y - 60, 0.6);
			[x, y] = at(3, 3); controller(x - 70, y + 40, { trigger: true }); house(x + 70, y - 60, 0.6); arrow(x + 20, y + 40, x + 70, y - 10, BLUE);
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
