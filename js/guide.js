// How to move (SPEC.md, C0; the Quest 2 design of 24 Nov, item 6): the
// settings board's first tab. It shows how to move in this layer, for bare
// hands or controllers, whichever you hold: four pictures from the sheet
// (assets/ui/guide-sheets.png, replaceable art) with a word each, at most
// four short lines (GUIDES in js/xr-menus.js), and which build is running at the foot.
// (It used to be a separate card beside the board and the wrist menu, with
// a Hide key; on the board it can't overlap anything, and choosing another
// tab is how it hides.)

import { GUIDE, FONT } from './theme.js';
import { GUIDES } from './xr-menus.js';

/** The lines under the frames (canvas px): their distance below the frames, apart, their type and its floor. */
export const LINES = { below: 84, step: 34, px: 24, min: 20 };

/** The pictures' sheet, loaded once; onLoad (set by the caller) redraws what shows it. */
export const guideSheet = { image: null, onLoad: null };
if (typeof Image !== 'undefined') {
	guideSheet.image = new Image();
	guideSheet.image.addEventListener('load', () => guideSheet.onLoad?.());
	guideSheet.image.src = GUIDE.sheets;
}

/**
 * Draws the guide of `kind` (a GUIDES key) into box { x, y, w, h } of a
 * board's canvas: four pictures in a row with a word under each, the lines,
 * and `foot` (small, at the bottom).
 */
export function drawGuide(ctx, kind, box, foot = '') {
	const g = GUIDES[kind];
	if (!g) return;
	const { x, y, w, h } = box, sheet = guideSheet.image;
	const gap = 12, size = Math.min((w - 3 * gap) / 4, h * 0.42);
	const left = x + (w - 4 * size - 3 * gap) / 2;
	ctx.textBaseline = 'middle';
	g.frames.forEach((word, i) => {
		const fx = left + i * (size + gap);
		roundRect(ctx, fx, y, size, size, 16);
		ctx.fillStyle = '#ffffff'; ctx.fill();
		ctx.lineWidth = 2; ctx.strokeStyle = GUIDE.edge; ctx.stroke();
		if (sheet?.complete && sheet.naturalWidth) ctx.drawImage(sheet, i * GUIDE.frame, g.row * GUIDE.frame, GUIDE.frame, GUIDE.frame, fx + 6, y + 6, size - 12, size - 12);
		ctx.fillStyle = GUIDE.text;
		ctx.textAlign = 'center';
		wrap(ctx, word, fx + size / 2, y + size + 22, size + gap - 4, 26, `600 22px ${GUIDE.font}`);
	});
	ctx.textAlign = 'left';
	ctx.fillStyle = GUIDE.soft;
	// The lines (four at most), 84 px under the frames and 34 px apart (the next-build asks 3.1: four lines
	// fit the 355 px tab with the foot); each fits the width at 24 px, smaller only if it must, never under 20.
	const top = y + size + LINES.below, bottom = y + h - (foot ? 30 : 12);
	const step = g.lines.length > 1 ? Math.min(LINES.step, (bottom - top) / (g.lines.length - 1)) : LINES.step;
	g.lines.forEach((line, i) => {
		let px = LINES.px;
		ctx.font = `500 ${px}px ${FONT}`;
		while (px > LINES.min && ctx.measureText(line).width > w - 16) ctx.font = `500 ${--px}px ${FONT}`;
		ctx.fillText(line, x + 8, top + i * step);
	});
	if (foot) {
		ctx.font = `400 19px ${FONT}`;
		ctx.fillText(foot, x + 8, y + h - 12);
	}
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/** Centred text over up to two lines. */
function wrap(ctx, text, cx, y, maxW, lineH, font) {
	ctx.font = font;
	const words = text.split(' '), lines = [''];
	for (const word of words) {
		const t = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
		if (ctx.measureText(t).width > maxW && lines[lines.length - 1]) lines.push(word);
		else lines[lines.length - 1] = t;
	}
	lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, cx, y + i * lineH));
}
