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
