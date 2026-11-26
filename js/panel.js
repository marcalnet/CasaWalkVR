// The settings board drawn on a canvas texture (a wing: js/xr-ui.js), pressed
// by touch or a controller's laser. Each row holds one or more cells side by side:
//   button  an action (the two replay keys under How to move).
//   switch  on or off (Shadows, Depth shading, Passthrough); the whole cell is
//           the target, so it is easy to hit with a laser.
//   choice  a few options side by side, the current one filled (Time of day,
//           Height, Main hand): every option is one press away.
//   drawn   drawn by its owner, never pressed (the How to move tab).
// A cell can be disabled, with a short note in place of its control
// (Passthrough in a VR session). Tabs run along the top, under the title; the
// close line shares the title's row. hitTest() maps a ray hit (UV) to a target;
// press(target) returns the action to run ({ id, value }: the option of a
// choice) or null when the press only changed the tab.
// (Dropdowns, sliders, the ‹ › stepper, action rows, the primary button and the
// roomier non-compact layout went on 26 Nov 2026: no board used them.)

import * as THREE from 'three';
import { canvasTexture } from './canvas-card.js';
import { FONT, COLOURS, BADGE, LABEL, PLATE } from './theme.js';

const PX_PER_M = 1024; // canvas pixels per metre of panel
// The spacing a board is laid out with (canvas px): a wing no taller than 34 cm, its top within 10° of eye level
// (the interaction harmony's conflict 13): the title and the close line share one header row, rows of 66 px
// (4.5 cm with their gap), option segments exactly 4 cm tall (inset 4 px).
const L = { PAD: 16, GAP: 6, ROW_H: 66, TITLE_H: 38, TAB_H: 60, TAB_GAP: 8, INSET: 4, titleFont: 28 };
const TAB = '#tab'; // a click target's id for a tab (its value is the tab's id)
export const HINT_PX = { max: 22, min: 18 }; // the close line's size (canvas px at the board's px/m): never shrunk below 18 (the legibility floor)
const SWITCH_W = 96, SWITCH_H = 52;
const SWITCH_LABEL_MIN = 26; // px: a switch label smaller than this goes onto two lines instead

export class Panel {
	/**
	 * @param rows  [[cell, cell], [cell], ...]; a cell is
	 *              { type: 'button', id, label }
	 *              { type: 'switch', id, label, value: bool }
	 *              { type: 'choice', id, label, options: [{ value, label }], value }
	 *              { type: 'drawn', id, h (canvas pixels), draw(ctx, box) }: drawn by its owner, never pressed (the How to move tab)
	 *              any cell: disabled, note (text shown instead of the control when disabled)
	 *              Or, for a menu with tabs: { tabs: [{ id, label, rows }] }: a row
	 *              of tabs, then the chosen tab's rows. The panel is as tall as its
	 *              tallest tab. Pressing a tab is handled here.
	 * @param opts  { title, hint (the close line, in the title's row), width (m), pxPerM (canvas pixels per metre) }
	 */
	constructor(rows, { title = '', hint = '', width = 0.62, pxPerM = PX_PER_M, background = null } = {}) {
		this.L = L;
		const spec = Array.isArray(rows) ? { tabs: [{ id: '', label: '', rows }] } : rows;
		const cellsOf = (rs) => rs.map((r) => r.map((c) => ({ type: 'button', ...c })));
		this.tabs = spec.tabs.map((t) => ({ id: t.id, label: t.label, rows: cellsOf(t.rows) }));
		this.tab = this.tabs[0].id; // the tab shown
		this.cells = new Map(this.tabs.flatMap((t) => t.rows).flat().map((c) => [c.id, c]));
		this.title = title;
		this.hint = hint;
		this.background = background; // an image drawn under everything (the board's frame and paper), once loaded
		this.hover = null; // key of the hovered target
		const wPx = Math.round(width * pxPerM);
		this.size = { w: wPx, h: 0 };
		this.boxes = this.layout();
		const hPx = this.size.h;
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(wPx, hPx));
		const geo = new THREE.PlaneGeometry(width, hPx / pxPerM);
		const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
		this.mesh = new THREE.Mesh(geo, mat);
		this.mesh.name = 'panel';
		this.mesh.renderOrder = 10;
		this.draw();
	}

	/** Every row of every tab (to read the menu's content). */
	get rows() { return this.tabs.flatMap((t) => t.rows); }

	/** The tab a cell is on (its id), or null. */
	tabOf(id) { return this.tabs.find((t) => t.rows.some((r) => r.some((c) => c.id === id)))?.id ?? null; }

	/** Shows another tab. */
	setTab(id) {
		if (id === this.tab || !this.tabs.some((t) => t.id === id)) return;
		this.tab = id;
		this.hover = null;
		this.boxes = this.layout();
		this.draw();
	}

	/** Lays rows out from height y: boxes, and the height they end at. */
	place(rows, y, boxes) {
		const full = this.size.w - 2 * this.L.PAD;
		rows.forEach((row, i) => {
			if (i > 0) y += this.L.GAP;
			const h = Math.max(this.L.ROW_H, ...row.map((c) => c.h ?? 0));
			const w = (full - (row.length - 1) * this.L.GAP) / row.length;
			row.forEach((cell, k) => boxes.push({ cell, x: this.L.PAD + k * (w + this.L.GAP), y, w, h }));
			y += h;
		});
		return y;
	}

	/** Cell rectangles in canvas pixels (and the panel height). */
	layout() {
		let y = this.L.PAD + (this.title ? this.L.TITLE_H : 0);
		const boxes = [];
		if (this.tabs.length > 1) {
			const full = this.size.w - 2 * this.L.PAD, w = (full - (this.tabs.length - 1) * 8) / this.tabs.length;
			this.tabBoxes = this.tabs.map((t, i) => ({ id: t.id, label: t.label, x: this.L.PAD + i * (w + 8), y, w, h: this.L.TAB_H }));
			y += this.L.TAB_H + this.L.TAB_GAP;
		} else {
			this.tabBoxes = [];
		}
		// The tab's rows, in the space of the tallest tab.
		const top = y;
		const tallest = Math.max(...this.tabs.map((t) => this.place(t.rows, top, [])));
		this.place(this.tabs.find((t) => t.id === this.tab).rows, top, boxes);
		this.size.h = Math.round(tallest + this.L.PAD);
		return boxes;
	}

	/** Width given to a cell's label, before its control. */
	labelWidth(b) {
		return b.cell.type === 'switch' ? b.w - SWITCH_W - 40 : Math.round(Math.min(260, b.w * 0.3));
	}

	/** The control's area in a cell (a choice's options). */
	controlArea(b) {
		const x = b.x + this.labelWidth(b);
		return { x, y: b.y + this.L.INSET, w: b.x + b.w - 12 - x, h: b.h - 2 * this.L.INSET };
	}

	/** Clickable targets: { id, value?, x, y, w, h } in canvas pixels. */
	rects() {
		const out = this.tabBoxes.map((t) => ({ id: TAB, value: t.id, x: t.x, y: t.y, w: t.w, h: t.h }));
		for (const b of this.boxes) {
			const c = b.cell;
			if (c.disabled || c.type === 'drawn') continue;
			if (c.type === 'choice') {
				for (const s of this.segments(b)) out.push({ id: c.id, value: s.value, x: s.x, y: s.y, w: s.w, h: s.h });
			} else {
				out.push({ id: c.id, x: b.x, y: b.y, w: b.w, h: b.h });
			}
		}
		return out;
	}

	/** A choice's segments: one per option. */
	segments(b) {
		const c = b.cell, a = this.controlArea(b), gap = 6;
		const opts = c.options ?? [];
		const w = (a.w - (opts.length - 1) * gap) / Math.max(1, opts.length);
		return opts.map((o, i) => ({ x: a.x + i * (w + gap), y: a.y, w, h: a.h, label: o.label, value: o.value, selected: o.value === c.value }));
	}

	draw() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		const { w, h } = this.size;
		ctx.clearRect(0, 0, w, h);
		if (this.background?.complete && this.background.naturalWidth) ctx.drawImage(this.background, 0, 0, w, h);
		else {
			roundRect(ctx, 0, 0, w, h, 36);
			ctx.fillStyle = COLOURS.panel;
			ctx.fill();
		}
		ctx.textBaseline = 'middle';
		const mid = this.L.PAD + this.L.TITLE_H / 2;
		let titleW = 0;
		if (this.title) {
			ctx.fillStyle = COLOURS.text;
			ctx.font = `600 ${this.L.titleFont}px ${FONT}`;
			ctx.fillText(this.title, this.L.PAD + 8, mid);
			titleW = ctx.measureText(this.title).width;
		}
		this.drawTabs(ctx);
		for (const b of this.boxes) this.drawCell(ctx, b);
		if (this.hint) {
			// (The close line in caption size at the header's free end, in the secondary colour: 18-22 px, never smaller.)
			ctx.fillStyle = COLOURS.soft;
			ctx.textAlign = 'right';
			fitFont(ctx, this.hint, w - 2 * this.L.PAD - titleW - 32, HINT_PX.max, HINT_PX.min, 400);
			ctx.fillText(this.hint, w - this.L.PAD - 8, mid + 1);
			ctx.textAlign = 'left';
		}
		this.texture.needsUpdate = true;
	}

	/** The row of tabs: the shown one white and raised, the others flat. */
	drawTabs(ctx) {
		for (const t of this.tabBoxes) {
			const on = t.id === this.tab, hot = !on && this.hover === `${TAB}|${t.id}`;
			roundRect(ctx, t.x, t.y, t.w, t.h, 18);
			ctx.fillStyle = on ? COLOURS.tabActive : hot ? COLOURS.hover : COLOURS.tab;
			ctx.fill();
			if (on || hot) { ctx.lineWidth = hot ? 4 : 2; ctx.strokeStyle = hot ? COLOURS.hoverEdge : COLOURS.edge; ctx.stroke(); }
			ctx.fillStyle = on ? COLOURS.tabActiveText : COLOURS.tabText;
			ctx.textAlign = 'center';
			fitFont(ctx, t.label, t.w - 24, 32, 18, on ? 700 : 500);
			ctx.fillText(t.label, t.x + t.w / 2, t.y + t.h / 2 + 2);
			ctx.textAlign = 'left';
		}
	}

	drawCell(ctx, b) {
		const c = b.cell;
		if (c.type === 'drawn') { c.draw?.(ctx, b); return; }
		const hot = this.hover && this.hover.split('|')[0] === c.id;
		if (c.type === 'button') {
			roundRect(ctx, b.x, b.y, b.w, b.h, 20);
			ctx.fillStyle = c.disabled ? COLOURS.off : hot ? COLOURS.hover : COLOURS.cell;
			ctx.fill();
			if (!c.disabled) { ctx.lineWidth = hot ? 5 : 2; ctx.strokeStyle = hot ? COLOURS.hoverEdge : COLOURS.edge; ctx.stroke(); }
			ctx.fillStyle = c.disabled ? COLOURS.offText : COLOURS.text;
			ctx.textAlign = 'center';
			fitFont(ctx, c.label, b.w - 32, 36, 22, 500);
			ctx.fillText(c.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
			ctx.textAlign = 'left';
			return;
		}
		// Setting cells: white card, label on the left, control on the right.
		roundRect(ctx, b.x, b.y, b.w, b.h, 20);
		ctx.fillStyle = c.disabled ? COLOURS.off : COLOURS.cell;
		ctx.fill();
		const whole = c.type === 'switch' && hot && !c.disabled; // the whole switch cell is the target
		ctx.lineWidth = whole ? 5 : 2;
		ctx.strokeStyle = whole ? COLOURS.hoverEdge : COLOURS.edge;
		ctx.stroke();
		ctx.fillStyle = c.disabled ? COLOURS.offText : COLOURS.text;
		if (c.type === 'switch') this.drawSwitchLabel(ctx, b, c.label);
		else {
			fitFont(ctx, c.label, this.labelWidth(b) - 36, 32, 20, 500);
			ctx.fillText(c.label, b.x + 24, b.y + b.h / 2 + 2);
		}
		if (c.disabled) {
			if (c.note) {
				// (The note may use the space after the label, also over a switch's.)
				const room = b.w - Math.min(this.labelWidth(b) - 36, ctx.measureText(c.label).width) - 72;
				ctx.fillStyle = COLOURS.offText;
				ctx.textAlign = 'right';
				fitFont(ctx, c.note, room, 28, 18, 500);
				ctx.fillText(c.note, b.x + b.w - 24, b.y + b.h / 2 + 2);
				ctx.textAlign = 'left';
			}
			return;
		}
		if (c.type === 'switch') this.drawSwitch(ctx, b);
		else if (c.type === 'choice') this.drawChoice(ctx, b);
	}

	/**
	 * A switch's label, in all the room left of the switch: one line if it
	 * reads at SWITCH_LABEL_MIN px or more, else two lines (split at the space
	 * nearest its middle), so "Depth shading" and "Passthrough" are never
	 * shrunk under the switch (build 120: they were clipped by it).
	 */
	drawSwitchLabel(ctx, b, label) {
		const room = b.w - SWITCH_W - 20 - 24 - 14; // (from the label's start to 14 px before the switch)
		const x = b.x + 24, cy = b.y + b.h / 2 + 2;
		fitFont(ctx, label, room, 32, SWITCH_LABEL_MIN - 1, 500);
		const words = label.split(' ');
		if (ctx.measureText(label).width <= room || words.length < 2) {
			if (ctx.measureText(label).width > room) fitFont(ctx, label, room, 32, 16, 500);
			ctx.fillText(label, x, cy);
			return;
		}
		let best = null; // the split whose longer line is shortest
		for (let i = 1; i < words.length; i++) {
			const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
			ctx.font = `500 30px ${FONT}`;
			const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
			if (!best || w < best.w) best = { lines, w };
		}
		const longer = best.lines.reduce((a, l) => (ctx.measureText(l).width > ctx.measureText(a).width ? l : a));
		fitFont(ctx, longer, room, 30, 16, 500);
		const px = parseInt(ctx.font.split(' ')[1], 10), lead = Math.min(px * 1.05, (b.h - 12) / 2);
		ctx.fillText(best.lines[0], x, cy - lead / 2);
		ctx.fillText(best.lines[1], x, cy + lead / 2);
	}

	drawSwitch(ctx, b) {
		const on = !!b.cell.value;
		const x = b.x + b.w - SWITCH_W - 20, y = b.y + (b.h - SWITCH_H) / 2, r = SWITCH_H / 2;
		roundRect(ctx, x, y, SWITCH_W, SWITCH_H, r);
		ctx.fillStyle = on ? COLOURS.accent : COLOURS.track;
		ctx.fill();
		ctx.fillStyle = '#ffffff';
		ctx.beginPath();
		ctx.arc(on ? x + SWITCH_W - r : x + r, y + r, r - 6, 0, Math.PI * 2);
		ctx.fill();
	}

	drawChoice(ctx, b) {
		const id = b.cell.id;
		for (const s of this.segments(b)) {
			const hot = this.hover === `${id}|${s.value}`;
			roundRect(ctx, s.x, s.y, s.w, s.h, 14);
			ctx.fillStyle = s.selected ? COLOURS.accent : hot ? COLOURS.hover : COLOURS.segment;
			ctx.fill();
			if (hot && !s.selected) { ctx.lineWidth = 4; ctx.strokeStyle = COLOURS.hoverEdge; ctx.stroke(); }
			ctx.fillStyle = s.selected ? COLOURS.accentText : COLOURS.text;
			ctx.textAlign = 'center';
			fitFont(ctx, s.label, s.w - 14, 28, 16, s.selected ? 600 : 500);
			ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2 + 2);
			ctx.textAlign = 'left';
		}
	}

	/** Target under a ray hit's UV coordinates ({ id, value } or { id }), or null. */
	hitTest(uv) {
		if (!uv) return null;
		const x = uv.x * this.size.w, y = (1 - uv.y) * this.size.h;
		const r = this.rects().find((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
		if (!r) return null;
		return r.value !== undefined ? { id: r.id, value: r.value } : { id: r.id };
	}

	/** The disabled cell under UV coordinates (a touch on it says no), or null. */
	disabledAt(uv) {
		if (!uv) return null;
		const x = uv.x * this.size.w, y = (1 - uv.y) * this.size.h;
		return this.boxes.find((b) => b.cell.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.cell ?? null;
	}

	/** A press on a target: a tab is shown here (returns null); anything else is the action to run. */
	press(target) {
		if (!target) return null;
		if (target.id === TAB) { this.setTab(target.value); return null; }
		return target;
	}

	/** Highlights the target under a laser (a hitTest() result, or null). */
	setHover(target) {
		const key = target ? `${target.id}|${target.value ?? ''}` : null;
		if (key === this.hover) return;
		this.hover = key;
		this.draw();
	}

	get(id) { return this.cells.get(id); }

	/** Updates a cell (value, label, options, disabled, note); redraws if anything changed. */
	set(id, props) {
		const c = this.cells.get(id);
		if (!c) return;
		let changed = false;
		for (const [k, v] of Object.entries(props)) {
			const same = k === 'options' ? JSON.stringify(c[k]) === JSON.stringify(v) : c[k] === v;
			if (!same) { c[k] = v; changed = true; }
		}
		if (changed) this.draw();
	}
}

/** Sets the largest font (from `px` down to `min`) at which `text` fits in `max` pixels. */
function fitFont(ctx, text, max, px, min, weight) {
	do ctx.font = `${weight} ${px}px ${FONT}`;
	while (ctx.measureText(text).width > max && --px > min);
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

// ---------------------------------------------------------------------------
// Note card: a title and a line or two of text on a white card (the notes in
// js/xr-ui.js: "Pick up your controllers", the safety card, a photo kept).
// Lines are { text, small? }.
// ---------------------------------------------------------------------------

const NOTE_W = 1300;

export class NoteCard {
	constructor(title, lines, { width = 0.62 } = {}) {
		this.title = title;
		this.lines = lines;
		const h = 150 + lines.reduce((n, l) => n + (l.small ? 64 : 92), 0) + 40;
		this.size = { w: NOTE_W, h };
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(NOTE_W, h));
		// Drawn over everything, so the model never hides it.
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * h / NOTE_W),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.mesh.name = 'note-card';
		this.mesh.renderOrder = 11;
		this.draw();
	}

	draw() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		const { w, h } = this.size;
		ctx.clearRect(0, 0, w, h);
		roundRect(ctx, 0, 0, w, h, 48);
		ctx.fillStyle = 'rgba(255,255,255,0.96)';
		ctx.fill();
		ctx.lineWidth = 6;
		ctx.strokeStyle = BADGE.orb.fill;
		ctx.stroke();
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#1d2329';
		ctx.font = `700 64px ${FONT}`;
		ctx.fillText(this.title, 60, 92);
		let y = 150;
		for (const l of this.lines) {
			const rowH = l.small ? 64 : 92;
			const x = 60;
			ctx.fillStyle = l.small ? '#5d6873' : '#1d2329';
			let px = l.small ? 34 : 46;
			do ctx.font = `${l.small ? 400 : 500} ${px}px ${FONT}`;
			while (ctx.measureText(l.text).width > w - x - 60 && --px > 20);
			ctx.fillText(l.text, x, y + rowH / 2 + 2);
			y += rowH;
		}
		this.texture.needsUpdate = true;
	}
}

// ---------------------------------------------------------------------------
// Label: a short line of text floating in the world, turned to face you (a
// room's name above the "stand here" marker). Fixed height in metres, drawn
// over everything; redrawn only when its text changes.
// ---------------------------------------------------------------------------

const LABEL_W = 768, LABEL_H = 112; // canvas pixels

export class Label {
	/**
	 * height: metres, of the whole label (the pill around the text). px: a fixed
	 * type size (canvas px, never shrunk: the pause's tips); without it the text
	 * fits the label, 58 px down to 30.
	 */
	constructor({ height = 0.05, px = null } = {}) {
		this.text = '';
		this.px = px;
		this.width = 0; // the pill's width now (m)
		this.fits = true; // false if the text is wider than the label can show (a fixed size never shrinks)
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(LABEL_W, LABEL_H));
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * LABEL_W / LABEL_H, height),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.mesh.name = 'label';
		this.mesh.renderOrder = 12;
		this.mesh.visible = false;
	}

	/** Shows `text` (an empty text hides the label). */
	set(text) {
		text = String(text ?? '').trim();
		if (text !== this.text) { this.text = text; this.draw(); }
		this.mesh.visible = !!text;
	}

	draw() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		ctx.clearRect(0, 0, LABEL_W, LABEL_H);
		if (!this.text) return;
		if (this.px) ctx.font = `${LABEL.weight} ${this.px}px ${FONT}`;
		else fitFont(ctx, this.text, LABEL_W - 80, 58, 30, LABEL.weight); // (sets ctx.font)
		const need = ctx.measureText(this.text).width + 64, w = Math.min(LABEL_W - 8, need);
		this.fits = need <= LABEL_W - 8;
		this.width = w / LABEL_W * this.mesh.geometry.parameters.width;
		roundRect(ctx, (LABEL_W - w) / 2, 6, w, LABEL_H - 12, (LABEL_H - 12) / 2);
		ctx.fillStyle = LABEL.fill;
		ctx.fill();
		ctx.lineWidth = 4;
		ctx.strokeStyle = LABEL.edge;
		ctx.stroke();
		ctx.fillStyle = LABEL.text;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(this.text, LABEL_W / 2, LABEL_H / 2 + 2);
		this.texture.needsUpdate = true;
	}
}

// ---------------------------------------------------------------------------
// Scale plate: a small plate on the plinth's front edge showing the model's
// true scale (e.g. "1:42"), like a museum caption. The plate is artwork
// (assets/ui/scale-plate.png, replaceable); "Scale" and the ratio are drawn
// on it here, with the theme's font and colours (js/theme.js).
// ---------------------------------------------------------------------------

export class ScalePlate {
	constructor() {
		this.ratio = null;
		const [w, h] = PLATE.size;
		({ canvas: this.canvas, texture: this.texture } = canvasTexture(w, h));
		// Lit like the gallery, with a little light of its own so the ratio stays readable at night.
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(...PLATE.metres),
			new THREE.MeshLambertMaterial({ map: this.texture, transparent: true, emissive: 0xffffff, emissiveMap: this.texture, emissiveIntensity: 0.35 }));
		this.mesh.name = 'scale-plate';
		this.image = null;
		if (typeof Image !== 'undefined') {
			const img = new Image();
			img.onload = () => { this.image = img; this.draw(); };
			img.src = PLATE.image;
		}
	}

	/** Shows the scale 1:ratio (rounded: no false precision); redraws only when the number shown changes. */
	set(ratio) {
		if (!(ratio > 0)) return;
		const r = Math.max(1, Math.round(ratio));
		if (r === this.ratio) return;
		this.ratio = r;
		this.draw();
	}

	/** The text shown, e.g. "1:42". */
	get text() { return this.ratio ? `1:${this.ratio}` : ''; }

	draw() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		const [w, h] = PLATE.size;
		ctx.clearRect(0, 0, w, h);
		if (this.image) ctx.drawImage(this.image, 0, 0, w, h);
		else { roundRect(ctx, 6, 6, w - 12, h - 12, 26); ctx.fillStyle = PLATE.fallback; ctx.fill(); }
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const c = PLATE.caption, r = PLATE.ratio;
		ctx.fillStyle = c.colour;
		ctx.font = `${c.weight} ${c.px}px ${FONT}`;
		ctx.fillText(c.text, c.x, c.y);
		ctx.fillStyle = r.colour;
		ctx.font = `${r.weight} ${r.px}px ${FONT}`;
		ctx.fillText(this.text, r.x, r.y);
		this.texture.needsUpdate = true;
	}
}
