// The guide beside the menu (SPEC.md, C0.4): whenever the wrist menu or the
// settings board opens, a card on its right shows how to move here (menu on
// the left, guide on the right: "what you can choose", then "how you move").
// Four pictures from the sheet (assets/ui/guide-sheets.png, replaceable art)
// with a word each, and a few lines under them; the words are in
// js/xr-menus.js (GUIDES). For bare hands or for controllers, whichever you
// hold. A Hide guide key on its corner folds it into a small Guide tab at the
// menu's right edge (remembered); after your 5th teleport it folds by itself,
// once. Both are keys (js/keys.js): touch, a controller's tip or its laser.

import * as THREE from 'three';
import { canvasTexture } from './canvas-card.js';
import { GUIDE, FONT } from './theme.js';
import { KeyPad } from './keys.js';
import { GUIDES } from './xr-menus.js';

const PX_W = 1200, PX_H = 800; // canvas pixels (the card's 3:2)

export class Guide {
	/** xr: the XRExperience. */
	constructor(xr) {
		this.xr = xr;
		this.kind = null; // which guide is drawn (a GUIDES key)
		this.group = new THREE.Group(); // placed by the caller (beside the wrist menu or the board)
		this.group.name = 'guide';
		this.group.visible = false;
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(PX_W, PX_H));
		this.card = new THREE.Mesh(new THREE.PlaneGeometry(GUIDE.width, GUIDE.height),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.card.name = 'guide-card';
		this.card.renderOrder = 10;
		// The Hide guide key (top right of the card) and the folded Guide tab.
		this.keys = new KeyPad(xr, 'guide');
		const hide = this.keys.add('hide', GUIDE.hideKey, GUIDE.hideKey);
		hide.group.position.set(GUIDE.width / 2 - GUIDE.hideKey / 2 - 0.006, GUIDE.height / 2 - GUIDE.hideKey / 2 - 0.006, 0.002);
		this.keys.setSpec('hide', { id: 'guide-hide', look: 'plain', label: 'Hide', caption: 'guide' });
		const tab = this.keys.add('tab', ...GUIDE.tab);
		this.keys.setSpec('tab', { id: 'guide-show', look: 'plain', label: 'Guide' });
		this.card.add(hide.group);
		this.tab = tab.group;
		this.group.add(this.card, this.tab);
		for (const k of this.keys.keys.values()) k.out = true;
		// The pictures.
		this.sheet = null;
		if (typeof Image !== 'undefined') {
			this.sheet = new Image();
			this.sheet.addEventListener('load', () => this.draw(true));
			this.sheet.src = GUIDE.sheets;
		}
		globalThis.document?.fonts?.load?.(`700 40px ${GUIDE.font}`).then(() => this.draw(true)).catch(() => {});
	}

	/**
	 * Shows the guide of `kind` (a GUIDES key), full or folded into its tab.
	 * width: the card's width there (metres; its height follows).
	 */
	show(kind, folded, width = GUIDE.width) {
		if (kind !== this.kind) { this.kind = kind; this.draw(true); }
		this.card.visible = !folded;
		this.tab.visible = folded;
		this.card.scale.setScalar(width / GUIDE.width);
		// The tab sits where the card's left edge would be (at the menu's right edge).
		this.tab.position.set(-width / 2 + GUIDE.tab[0] / 2, 0, 0.002);
		this.group.visible = true;
	}

	hide() {
		this.group.visible = false;
		this.keys.reset();
	}

	/** Once a frame while shown: the Hide key and the tab. Returns { action, near }. */
	update(dt, opts) {
		if (!this.group.visible) return { action: null, near: false };
		this.keys.keys.get('hide').out = this.card.visible;
		this.keys.keys.get('tab').out = this.tab.visible;
		return this.keys.update(dt, opts);
	}

	/** Draws the card: title, four pictures with a word each, and the lines. */
	draw(force = false) {
		const g = GUIDES[this.kind];
		if (!this.canvas || !g) return;
		const ctx = this.canvas.getContext('2d'), w = PX_W, h = PX_H;
		ctx.clearRect(0, 0, w, h);
		roundRect(ctx, 4, 4, w - 8, h - 8, 40);
		ctx.fillStyle = GUIDE.paper;
		ctx.fill();
		ctx.lineWidth = 4; ctx.strokeStyle = GUIDE.edge; ctx.stroke();
		ctx.fillStyle = GUIDE.text;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		ctx.font = `700 56px ${GUIDE.font}`;
		ctx.fillText(g.title, 48, 70);
		// Four frames in a row.
		const n = GUIDE.frame, size = 236, gap = (w - 96 - 4 * size) / 3, top = 120;
		g.frames.forEach((word, i) => {
			const x = 48 + i * (size + gap);
			roundRect(ctx, x, top, size, size, 24);
			ctx.fillStyle = '#ffffff'; ctx.fill();
			ctx.lineWidth = 3; ctx.strokeStyle = GUIDE.edge; ctx.stroke();
			if (this.sheet?.complete && this.sheet.naturalWidth) ctx.drawImage(this.sheet, i * n, g.row * n, n, n, x + 8, top + 8, size - 16, size - 16);
			ctx.fillStyle = GUIDE.text;
			ctx.textAlign = 'center';
			wrap(ctx, word, x + size / 2, top + size + 42, size + gap - 12, 38, `600 34px ${GUIDE.font}`);
		});
		// The lines.
		ctx.textAlign = 'left';
		ctx.fillStyle = GUIDE.soft;
		ctx.font = `500 34px ${FONT}`;
		g.lines.forEach((line, i) => ctx.fillText(line, 56, 520 + i * 70));
		this.texture.needsUpdate = true;
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
