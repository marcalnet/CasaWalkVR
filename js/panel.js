// Floating VR menu drawn on a canvas texture and clicked with the controller
// laser: a settings list. Each row holds one or more cells side by side:
//   button  an action (Walk in, Recentre, Dollhouse). `primary`: Exit VR, a
//           taller solid orange row at the bottom, set apart.
//   switch  on or off (Shadows, Ceilings, Solid walls); the whole cell is the
//           target, so it is easy to hit with a laser.
//   choice  a few options side by side, the current one filled (Time of day,
//           Turn, Height, View): every option is one click away, which beats
//           a dropdown in VR. More than CHOICE_MAX options become a stepper
//           (‹ value ›).
//   slider  a value from 0 to 1 (See-through): press the trigger on the
//           track and drag.
//   dropdown  a list that can be long (Levels: a home can have many): the
//           cell shows the current option; a click opens the list over the
//           panel, a click on an option picks it, a click anywhere else on
//           the panel closes it.
// A cell can be disabled, with a short note in place of its control (Levels
// in a one-storey home: "One level").
// hitTest() maps a ray hit (UV) to a target; press(target) returns the action
// to run ({ id, value }: the option of a choice or dropdown, 0..1 along a
// slider) or null when the click only opened or closed a dropdown.

import * as THREE from 'three';
import { FONT, COLOURS, BADGE, LABEL, PLATE } from './theme.js';

const PX_PER_M = 1024; // canvas pixels per metre of panel
const PAD = 28, GAP = 14, ROW_H = 80, TITLE_H = 72, HINT_H = 52;
const PRIMARY_H = 108, PRIMARY_GAP = 26; // the primary button: taller, set apart
const TAB_H = 66, TAB_GAP = 18; // the row of tabs, and the space under it
const TAB = '#tab'; // a click target's id for a tab (its value is the tab's id)
const CHOICE_MAX = 6; // more options than this: a stepper
const SWITCH_W = 96, SWITCH_H = 52;
const OPTION_H = 64, OPTION_MIN_H = 40; // dropdown list rows (shrunk to fit a long list)

export class Panel {
	/**
	 * @param rows  [[cell, cell], [cell], ...]; a cell is
	 *              { type: 'button', id, label, primary }
	 *              { type: 'switch', id, label, value: bool }
	 *              { type: 'choice', id, label, options: [{ value, label }], value }
	 *              { type: 'slider', id, label, value: 0..1, format(value) -> text }
	 *              { type: 'dropdown', id, label, options: [{ value, label }], value }
	 *              any cell: disabled, note (text shown instead of the control when disabled)
	 *              Or, for a menu with tabs: { tabs: [{ id, label, rows }], actions: rows }:
	 *              a row of tabs, the chosen tab's rows, then the actions, shown on
	 *              every tab. The panel is as tall as its tallest tab, so the
	 *              actions never move. Clicking a tab is handled here (like a dropdown).
	 * @param opts  { title, hint (small text at the bottom), width (m), pxPerM (canvas pixels per metre) }
	 */
	constructor(rows, { title = '', hint = '', width = 0.62, pxPerM = PX_PER_M } = {}) {
		const spec = Array.isArray(rows) ? { tabs: [{ id: '', label: '', rows }], actions: [] } : rows;
		const cellsOf = (rs) => rs.map((r) => r.map((c) => ({ type: 'button', ...c })));
		this.tabs = spec.tabs.map((t) => ({ id: t.id, label: t.label, rows: cellsOf(t.rows) }));
		this.actions = cellsOf(spec.actions ?? []);
		this.tab = this.tabs[0].id; // the tab shown
		this.cells = new Map([...this.tabs.flatMap((t) => t.rows), ...this.actions].flat().map((c) => [c.id, c]));
		this.title = title;
		this.hint = hint;
		this.hover = null; // key of the hovered target
		this.open = null; // id of the dropdown whose list is open
		const wPx = Math.round(width * pxPerM);
		this.size = { w: wPx, h: 0 };
		this.boxes = this.layout();
		const hPx = this.size.h;
		this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
		if (this.canvas) { this.canvas.width = wPx; this.canvas.height = hPx; }
		this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
		if (this.texture) { this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; }
		const geo = new THREE.PlaneGeometry(width, hPx / pxPerM);
		const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
		this.mesh = new THREE.Mesh(geo, mat);
		this.mesh.name = 'panel';
		this.mesh.renderOrder = 10;
		this.draw();
	}

	/** Every row, all tabs and the actions (to read the menu's content). */
	get rows() { return [...this.tabs.flatMap((t) => t.rows), ...this.actions]; }

	/** The tab a cell is on (its id), or null for the actions. */
	tabOf(id) { return this.tabs.find((t) => t.rows.some((r) => r.some((c) => c.id === id)))?.id ?? null; }

	/** Shows another tab. */
	setTab(id) {
		if (id === this.tab || !this.tabs.some((t) => t.id === id)) return;
		this.open = null;
		this.tab = id;
		this.hover = null;
		this.boxes = this.layout();
		this.draw();
	}

	/** Lays rows out from height y: boxes, and the height they end at. */
	place(rows, y, boxes) {
		const full = this.size.w - 2 * PAD;
		rows.forEach((row, i) => {
			const primary = row.some((c) => c.primary);
			if (i > 0) y += primary ? PRIMARY_GAP : GAP;
			const h = primary ? PRIMARY_H : ROW_H;
			const w = (full - (row.length - 1) * GAP) / row.length;
			row.forEach((cell, k) => boxes.push({ cell, x: PAD + k * (w + GAP), y, w, h, primary: !!cell.primary }));
			y += h;
		});
		return y;
	}

	/** Cell rectangles in canvas pixels (and the panel height). */
	layout() {
		let y = PAD + (this.title ? TITLE_H : 0);
		const boxes = [];
		if (this.tabs.length > 1) {
			const full = this.size.w - 2 * PAD, w = (full - (this.tabs.length - 1) * 8) / this.tabs.length;
			this.tabBoxes = this.tabs.map((t, i) => ({ id: t.id, label: t.label, x: PAD + i * (w + 8), y, w, h: TAB_H }));
			y += TAB_H + TAB_GAP;
		} else {
			this.tabBoxes = [];
		}
		// The tab's rows, in the space of the tallest tab, then the actions.
		const top = y;
		const tallest = Math.max(...this.tabs.map((t) => this.place(t.rows, top, [])));
		this.place(this.tabs.find((t) => t.id === this.tab).rows, top, boxes);
		y = tallest;
		if (this.actions.length) y = this.place(this.actions, y + (this.actions[0].some((c) => c.primary) ? PRIMARY_GAP : GAP + 14), boxes);
		this.size.h = Math.round(y + (this.hint ? HINT_H : 0) + PAD);
		return boxes;
	}

	/** Width given to a cell's label, before its control. */
	labelWidth(b) {
		return b.cell.type === 'switch' ? b.w - SWITCH_W - 40 : Math.round(Math.min(260, b.w * 0.3));
	}

	/** The control's area in a cell (choices, sliders). */
	controlArea(b) {
		const x = b.x + this.labelWidth(b);
		return { x, y: b.y + 10, w: b.x + b.w - 12 - x, h: b.h - 20 };
	}

	/**
	 * Clickable targets: { id, value?, slider?, toggle?, dismiss?, x, y, w, h }
	 * in canvas pixels. While a dropdown is open, only its options are (and
	 * the rest of the panel, which closes it).
	 */
	rects() {
		const out = this.open ? [] : this.tabBoxes.map((t) => ({ id: TAB, value: t.id, x: t.x, y: t.y, w: t.w, h: t.h }));
		if (this.open) {
			const list = this.list();
			if (list) {
				for (const o of list.options) out.push({ id: this.open, value: o.value, x: o.x, y: o.y, w: o.w, h: o.h });
				out.push({ id: this.open, dismiss: true, x: 0, y: 0, w: this.size.w, h: this.size.h });
				return out;
			}
		}
		for (const b of this.boxes) {
			const c = b.cell;
			if (c.disabled) continue;
			if (c.type === 'dropdown') {
				const a = this.controlArea(b);
				out.push({ id: c.id, toggle: true, x: a.x, y: b.y, w: a.w + 12, h: b.h });
			} else if (c.type === 'choice') {
				for (const s of this.segments(b)) if (s.value !== undefined) out.push({ id: c.id, value: s.value, x: s.x, y: s.y, w: s.w, h: s.h });
			} else if (c.type === 'slider') {
				const t = this.track(b);
				out.push({ id: c.id, slider: true, x: t.x - 24, y: b.y, w: t.w + 48, h: b.h, track: t });
			} else {
				out.push({ id: c.id, x: b.x, y: b.y, w: b.w, h: b.h, primary: b.primary });
			}
		}
		return out;
	}

	/** A choice's segments: one per option, or a stepper (‹ current ›) when there are many. */
	segments(b) {
		const c = b.cell, a = this.controlArea(b), gap = 6;
		const opts = c.options ?? [];
		if (opts.length > CHOICE_MAX) {
			const i = Math.max(0, opts.findIndex((o) => o.value === c.value));
			const arrow = 80;
			return [
				{ x: a.x, y: a.y, w: arrow, h: a.h, label: '‹', value: i > 0 ? opts[i - 1].value : undefined },
				{ x: a.x + arrow + gap, y: a.y, w: a.w - 2 * (arrow + gap), h: a.h, label: opts[i]?.label ?? '', current: true },
				{ x: a.x + a.w - arrow, y: a.y, w: arrow, h: a.h, label: '›', value: i < opts.length - 1 ? opts[i + 1].value : undefined },
			];
		}
		const w = (a.w - (opts.length - 1) * gap) / Math.max(1, opts.length);
		return opts.map((o, i) => ({ x: a.x + i * (w + gap), y: a.y, w, h: a.h, label: o.label, value: o.value, selected: o.value === c.value }));
	}

	/**
	 * The open dropdown's list: as wide as its control, starting level with
	 * the cell and growing upwards when there is no room below; rows shrink
	 * so a long list still fits on the panel.
	 */
	list() {
		const b = this.boxes.find((x) => x.cell.id === this.open);
		if (!b) return null;
		const opts = b.cell.options ?? [];
		const room = this.size.h - 2 * PAD - 16;
		const rowH = Math.max(OPTION_MIN_H, Math.min(OPTION_H, Math.floor(room / Math.max(1, opts.length))));
		const h = opts.length * rowH + 16;
		const a = this.controlArea(b);
		const y = THREE.MathUtils.clamp(b.y + b.h - h, PAD, Math.max(PAD, this.size.h - PAD - h)); // its bottom at the cell's bottom
		return {
			x: a.x - 8, y, w: a.w + 16, h,
			options: opts.map((o, i) => ({ ...o, x: a.x, y: y + 8 + i * rowH, w: a.w, h: rowH - 4, selected: o.value === b.cell.value })),
		};
	}

	/** A slider's track (the line the knob runs along), leaving room for the value on the right. */
	track(b) {
		const a = this.controlArea(b), valueW = 110;
		return { x: a.x + 24, y: b.y + b.h / 2, w: a.w - valueW - 48 };
	}

	draw() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		const { w, h } = this.size;
		ctx.clearRect(0, 0, w, h);
		roundRect(ctx, 0, 0, w, h, 36);
		ctx.fillStyle = COLOURS.panel;
		ctx.fill();
		ctx.textBaseline = 'middle';
		if (this.title) {
			ctx.fillStyle = COLOURS.text;
			ctx.font = `600 40px ${FONT}`;
			ctx.fillText(this.title, PAD + 8, PAD + TITLE_H / 2 - 4);
		}
		this.drawTabs(ctx);
		for (const b of this.boxes) this.drawCell(ctx, b);
		if (this.hint) {
			ctx.fillStyle = COLOURS.soft;
			ctx.textAlign = 'center';
			fitFont(ctx, this.hint, w - 2 * PAD, 28, 16, 400);
			ctx.fillText(this.hint, w / 2, h - PAD - HINT_H / 2 + 8);
			ctx.textAlign = 'left';
		}
		if (this.open) this.drawList(ctx);
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

	/** The open dropdown's list over a dimmed panel. */
	drawList(ctx) {
		const list = this.list();
		if (!list) return;
		roundRect(ctx, 0, 0, this.size.w, this.size.h, 36);
		ctx.fillStyle = 'rgba(29,35,41,0.35)';
		ctx.fill();
		roundRect(ctx, list.x, list.y, list.w, list.h, 18);
		ctx.fillStyle = COLOURS.cell;
		ctx.fill();
		ctx.lineWidth = 3;
		ctx.strokeStyle = COLOURS.hoverEdge;
		ctx.stroke();
		for (const o of list.options) {
			const hot = this.hover === `${this.open}|${o.value}`;
			roundRect(ctx, o.x, o.y, o.w, o.h, 12);
			ctx.fillStyle = o.selected ? COLOURS.accent : hot ? COLOURS.hover : COLOURS.cell;
			ctx.fill();
			if (hot && !o.selected) { ctx.lineWidth = 4; ctx.strokeStyle = COLOURS.hoverEdge; ctx.stroke(); }
			ctx.fillStyle = o.selected ? COLOURS.accentText : COLOURS.text;
			fitFont(ctx, o.label, o.w - 40, Math.min(30, o.h - 14), 16, o.selected ? 600 : 500);
			ctx.fillText(o.label, o.x + 20, o.y + o.h / 2 + 2);
		}
	}

	drawDropdown(ctx, b, hot) {
		const c = b.cell, a = this.controlArea(b);
		roundRect(ctx, a.x, a.y, a.w, a.h, 14);
		ctx.fillStyle = hot ? COLOURS.hover : COLOURS.segment;
		ctx.fill();
		ctx.lineWidth = hot ? 4 : 2;
		ctx.strokeStyle = hot ? COLOURS.hoverEdge : COLOURS.edge;
		ctx.stroke();
		const current = (c.options ?? []).find((o) => o.value === c.value)?.label ?? '';
		ctx.fillStyle = COLOURS.text;
		fitFont(ctx, current, a.w - 80, 30, 16, 600);
		ctx.fillText(current, a.x + 18, a.y + a.h / 2 + 2);
		// The arrow that says "this opens a list".
		const ax = a.x + a.w - 34, ay = a.y + a.h / 2;
		ctx.beginPath();
		ctx.moveTo(ax - 11, ay - 6); ctx.lineTo(ax + 11, ay - 6); ctx.lineTo(ax, ay + 8);
		ctx.closePath();
		ctx.fillStyle = COLOURS.soft;
		ctx.fill();
	}

	drawCell(ctx, b) {
		const c = b.cell;
		const hot = this.hover && this.hover.split('|')[0] === c.id;
		if (c.type === 'button') {
			roundRect(ctx, b.x, b.y, b.w, b.h, 20);
			if (b.primary) {
				ctx.fillStyle = hot ? COLOURS.primaryHover : COLOURS.primary;
				ctx.fill();
			} else {
				ctx.fillStyle = c.disabled ? COLOURS.off : hot ? COLOURS.hover : COLOURS.cell;
				ctx.fill();
				if (!c.disabled) { ctx.lineWidth = hot ? 5 : 2; ctx.strokeStyle = hot ? COLOURS.hoverEdge : COLOURS.edge; ctx.stroke(); }
			}
			ctx.fillStyle = b.primary ? COLOURS.primaryText : c.disabled ? COLOURS.offText : COLOURS.text;
			ctx.textAlign = 'center';
			const iconW = c.icon === 'camera' ? 58 : 0; // a camera drawn before the label
			fitFont(ctx, c.label, b.w - 32 - iconW, b.primary ? 46 : 36, 22, b.primary ? 600 : 500);
			const tw = ctx.measureText(c.label).width;
			const cx = b.x + b.w / 2 + iconW / 2, cy = b.y + b.h / 2;
			if (iconW) drawCamera(ctx, cx - tw / 2 - iconW / 2 - 4, cy, c.disabled ? COLOURS.offText : COLOURS.text);
			ctx.fillText(c.label, cx, cy + 2);
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
		fitFont(ctx, c.label, this.labelWidth(b) - 36, 32, 20, 500);
		ctx.fillText(c.label, b.x + 24, b.y + b.h / 2 + 2);
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
		else if (c.type === 'slider') this.drawSlider(ctx, b, hot);
		else if (c.type === 'dropdown') this.drawDropdown(ctx, b, hot && !this.open);
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
			const hot = s.value !== undefined && this.hover === `${id}|${s.value}`;
			roundRect(ctx, s.x, s.y, s.w, s.h, 14);
			ctx.fillStyle = s.selected ? COLOURS.accent : hot ? COLOURS.hover : COLOURS.segment;
			ctx.fill();
			if (hot && !s.selected) { ctx.lineWidth = 4; ctx.strokeStyle = COLOURS.hoverEdge; ctx.stroke(); }
			const dim = !s.current && s.value === undefined; // a stepper arrow at the end of the list
			ctx.fillStyle = s.selected ? COLOURS.accentText : dim ? COLOURS.offText : COLOURS.text;
			ctx.textAlign = 'center';
			fitFont(ctx, s.label, s.w - 14, s.current ? 30 : 28, 16, s.selected || s.current ? 600 : 500);
			ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2 + 2);
			ctx.textAlign = 'left';
		}
	}

	drawSlider(ctx, b, hot) {
		const c = b.cell, t = this.track(b), v = THREE.MathUtils.clamp(c.value ?? 0, 0, 1);
		roundRect(ctx, t.x, t.y - 5, t.w, 10, 5);
		ctx.fillStyle = COLOURS.track;
		ctx.fill();
		if (v > 0) { roundRect(ctx, t.x, t.y - 5, Math.max(10, t.w * v), 10, 5); ctx.fillStyle = COLOURS.accent; ctx.fill(); }
		ctx.beginPath();
		ctx.arc(t.x + t.w * v, t.y, 22, 0, Math.PI * 2);
		ctx.fillStyle = '#ffffff';
		ctx.fill();
		ctx.lineWidth = hot ? 6 : 3;
		ctx.strokeStyle = COLOURS.accent;
		ctx.stroke();
		const text = c.format ? c.format(v) : `${Math.round(v * 100)}%`;
		ctx.fillStyle = COLOURS.text;
		ctx.textAlign = 'right';
		ctx.font = `600 30px ${FONT}`;
		ctx.fillText(text, b.x + b.w - 24, b.y + b.h / 2 + 2);
		ctx.textAlign = 'left';
	}

	/** Target under a ray hit's UV coordinates ({ id, value } or { id, slider, value }), or null. */
	hitTest(uv) {
		if (!uv) return null;
		const x = uv.x * this.size.w, y = (1 - uv.y) * this.size.h;
		const r = this.rects().find((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
		if (!r) return null;
		if (r.slider) return { id: r.id, slider: true, value: this.sliderAt(r.track, uv) };
		if (r.toggle || r.dismiss) return { id: r.id, toggle: !!r.toggle, dismiss: !!r.dismiss };
		return r.value !== undefined ? { id: r.id, value: r.value } : { id: r.id };
	}

	/** The disabled cell under UV coordinates (a touch on it says no), or null. */
	disabledAt(uv) {
		if (!uv || this.open) return null;
		const x = uv.x * this.size.w, y = (1 - uv.y) * this.size.h;
		return this.boxes.find((b) => b.cell.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.cell ?? null;
	}

	/**
	 * A click on a target: opens or closes a dropdown (returns null), picks a
	 * dropdown option (closes the list; returns { id, value }), or returns the
	 * target itself as the action to run.
	 */
	press(target) {
		if (!target) return null;
		if (target.id === TAB) { this.setTab(target.value); return null; }
		if (target.toggle) { this.open = this.open === target.id ? null : target.id; this.hover = null; this.draw(); return null; }
		if (target.dismiss) { this.closeDropdown(); return null; }
		if (this.open) {
			this.closeDropdown();
			return target.value === this.cells.get(target.id)?.value ? null : target;
		}
		return target;
	}

	closeDropdown() {
		if (!this.open) return;
		this.open = null;
		this.draw();
	}

	/** While dragging a slider: its value under a ray hit anywhere on the panel. */
	sliderValue(id, uv) {
		const r = this.rects().find((t) => t.id === id && t.slider);
		return r && uv ? this.sliderAt(r.track, uv) : null;
	}

	sliderAt(track, uv) {
		return THREE.MathUtils.clamp((uv.x * this.size.w - track.x) / track.w, 0, 1);
	}

	/** Highlights the target under a laser (a hitTest() result, or null). */
	setHover(target) {
		const key = target && !target.dismiss ? `${target.id}|${target.slider || target.toggle ? '' : target.value ?? ''}` : null;
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
// Controls card: a drawing of the two Quest controllers (top view) with what
// each stick, trigger, grip and button does in the current mode. Shown beside
// the menu.
// ---------------------------------------------------------------------------

const CARD_W = 1200, CARD_H = 1140; // canvas pixels (room for 7 rows)
const FOOTER_H = 190; // extra height for the footer tip (screenshot reminder)

export class ControlsCard {
	/**
	 * @param title  e.g. 'Controls: dollhouse'
	 * @param hands  { left: [{ kind, key, text }], right: [...] }
	 *               kind: stick | trigger | grip | button | orb; key: badge text
	 * @param footer { key, lines: [text, text] }: a full-width tip under both hands
	 */
	constructor(title, hands, { width = 0.46, footer = null } = {}) {
		this.title = title;
		this.hands = hands;
		this.footer = footer;
		const w = CARD_W, h = CARD_H + (footer ? FOOTER_H : 0), height = width * h / w;
		this.size = { w, h };
		this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
		if (this.canvas) { this.canvas.width = w; this.canvas.height = h; }
		this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
		if (this.texture) { this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; }
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.mesh.name = 'controls-card';
		this.mesh.renderOrder = 10;
		this.draw();
	}

	draw() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		const { w, h } = this.size;
		ctx.clearRect(0, 0, w, h);
		roundRect(ctx, 0, 0, w, h, 48);
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		ctx.fill();
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#1d2329';
		ctx.font = `600 52px ${FONT}`;
		ctx.fillText(this.title, 48, 70);
		const half = w / 2;
		this.drawHand(ctx, 'left', 0, half);
		this.drawHand(ctx, 'right', half, half);
		// Divider
		ctx.strokeStyle = '#e3e7eb';
		ctx.lineWidth = 3;
		ctx.beginPath(); ctx.moveTo(half, 130); ctx.lineTo(half, CARD_H - 40); ctx.stroke();
		if (this.footer) this.drawFooter(ctx, CARD_H, w);
		this.texture.needsUpdate = true;
	}

	/** Full-width tip under both hands: a badge and up to two lines of text. */
	drawFooter(ctx, y0, w) {
		const { key, lines } = this.footer;
		ctx.strokeStyle = '#e3e7eb';
		ctx.lineWidth = 3;
		ctx.beginPath(); ctx.moveTo(44, y0 - 10); ctx.lineTo(w - 44, y0 - 10); ctx.stroke();
		const b = BADGE.shot, cy = y0 + FOOTER_H / 2 - 25;
		ctx.font = `700 28px ${FONT}`;
		const bw = Math.max(64, ctx.measureText(key).width + 32);
		roundRect(ctx, 44, cy - 26, bw, 52, 14);
		ctx.fillStyle = b.fill; ctx.fill();
		ctx.fillStyle = b.text;
		ctx.textAlign = 'center';
		ctx.fillText(key, 44 + bw / 2, cy + 1);
		ctx.textAlign = 'left';
		const x = 44 + bw + 20, max = w - x - 44;
		let px = 34;
		do ctx.font = `400 ${px}px ${FONT}`;
		while (lines.some((t) => ctx.measureText(t).width > max) && --px > 20);
		ctx.fillStyle = '#1d2329';
		lines.forEach((t, i) => ctx.fillText(t, x, cy + (i - (lines.length - 1) / 2) * (px + 12) + 1));
	}

	drawHand(ctx, side, x0, width) {
		const rows = this.hands[side] || [];
		const cx = x0 + width / 2, top = 130;
		const isLeft = side === 'left';
		const btn = isLeft ? ['X', 'Y'] : ['A', 'B'];

		// Controller, top view: tracking ring, handle, face with stick and buttons.
		ctx.save();
		ctx.translate(cx, top + 150);
		ctx.lineWidth = 10;
		ctx.strokeStyle = '#2b3036';
		ctx.beginPath(); ctx.arc(isLeft ? -40 : 40, -40, 105, 0, Math.PI * 2); ctx.stroke(); // ring
		ctx.fillStyle = '#2b3036';
		roundRect(ctx, -70, -60, 140, 230, 60); ctx.fill(); // body
		// Trigger (front) and grip (inner side) tabs
		ctx.fillStyle = BADGE.trigger.fill;
		roundRect(ctx, -34, -96, 68, 30, 12); ctx.fill();
		ctx.fillStyle = BADGE.grip.fill;
		roundRect(ctx, isLeft ? 64 : -84, 30, 20, 100, 8); ctx.fill();
		// Stick and buttons
		ctx.fillStyle = '#8a949e';
		ctx.beginPath(); ctx.arc(isLeft ? 18 : -18, -10, 30, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = '#5d6873';
		ctx.beginPath(); ctx.arc(isLeft ? 18 : -18, -10, 16, 0, Math.PI * 2); ctx.fill();
		ctx.font = `700 28px ${FONT}`;
		ctx.textAlign = 'center';
		const bx = isLeft ? -22 : 22;
		for (const [i, k] of btn.entries()) {
			const by = 60 + i * 56;
			ctx.fillStyle = '#e8ecef';
			ctx.beginPath(); ctx.arc(bx + (isLeft ? -6 : 6) * i, by, 22, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#1d2329';
			ctx.fillText(k, bx + (isLeft ? -6 : 6) * i, by + 1);
		}
		// Orb above the back of the hand
		ctx.fillStyle = BADGE.orb.fill;
		ctx.beginPath(); ctx.arc(0, 200, 16, 0, Math.PI * 2); ctx.fill();
		ctx.restore();

		ctx.textAlign = 'left';
		ctx.fillStyle = '#5d6873';
		ctx.font = `600 34px ${FONT}`;
		ctx.textAlign = 'center';
		ctx.fillText(isLeft ? 'Left hand' : 'Right hand', cx, top + 395);
		ctx.textAlign = 'left';

		// Rows: coloured badge + what it does.
		let y = top + 470;
		for (const r of rows) {
			const b = BADGE[r.kind] || BADGE.button;
			ctx.font = `700 28px ${FONT}`;
			const bw = Math.max(64, ctx.measureText(r.key).width + 32);
			roundRect(ctx, x0 + 44, y - 26, bw, 52, 14);
			ctx.fillStyle = b.fill; ctx.fill();
			ctx.fillStyle = b.text;
			ctx.textAlign = 'center';
			ctx.fillText(r.key, x0 + 44 + bw / 2, y + 1);
			ctx.textAlign = 'left';
			ctx.fillStyle = '#1d2329';
			let px = 34;
			do ctx.font = `400 ${px}px ${FONT}`;
			while (ctx.measureText(r.text).width > width - bw - 90 && --px > 22);
			ctx.fillText(r.text, x0 + 44 + bw + 20, y + 1);
			y += 68;
		}
	}
}

// ---------------------------------------------------------------------------
// Welcome card: floats above the dollhouse when you enter VR and says how to
// open the menu, until you open it. Lines are { key?, text, small? }; a key
// draws a coloured badge (like the controls card) before the text.
// ---------------------------------------------------------------------------

const WELCOME_W = 1300;

export class WelcomeCard {
	constructor(title, lines, { width = 0.62 } = {}) {
		this.title = title;
		this.lines = lines;
		const h = 150 + lines.reduce((n, l) => n + (l.small ? 64 : 92), 0) + 40;
		this.size = { w: WELCOME_W, h };
		this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
		if (this.canvas) { this.canvas.width = WELCOME_W; this.canvas.height = h; }
		this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
		if (this.texture) { this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; }
		// Drawn over the model, so a zoomed-in home never hides it.
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * h / WELCOME_W),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthTest: false }));
		this.mesh.name = 'welcome-card';
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
			let x = 60;
			if (l.key) {
				const b = BADGE[l.kind] || BADGE.orb;
				ctx.font = `700 34px ${FONT}`;
				const bw = Math.max(80, ctx.measureText(l.key).width + 40);
				roundRect(ctx, x, y + rowH / 2 - 30, bw, 60, 16);
				ctx.fillStyle = b.fill; ctx.fill();
				ctx.fillStyle = b.text;
				ctx.textAlign = 'center';
				ctx.fillText(l.key, x + bw / 2, y + rowH / 2 + 1);
				ctx.textAlign = 'left';
				x += bw + 28;
			}
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

/** A small camera (for the Photo button), centred on (x, y). */
function drawCamera(ctx, x, y, colour) {
	ctx.save();
	ctx.fillStyle = colour;
	roundRect(ctx, x - 22, y - 13, 44, 30, 7); // body
	ctx.fill();
	roundRect(ctx, x - 9, y - 19, 18, 8, 3); // viewfinder bump
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.beginPath(); ctx.arc(x, y + 2, 9, 0, Math.PI * 2); ctx.fill(); // lens
	ctx.fillStyle = colour;
	ctx.beginPath(); ctx.arc(x, y + 2, 5, 0, Math.PI * 2); ctx.fill();
	ctx.restore();
}

// ---------------------------------------------------------------------------
// Label: a short line of text floating in the world, turned to face you (a
// room's name above the "stand here" marker). Fixed height in metres, drawn
// over everything; redrawn only when its text changes.
// ---------------------------------------------------------------------------

const LABEL_W = 768, LABEL_H = 112; // canvas pixels

export class Label {
	/** height: metres, of the whole label (the pill around the text). */
	constructor({ height = 0.05 } = {}) {
		this.text = '';
		this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
		if (this.canvas) { this.canvas.width = LABEL_W; this.canvas.height = LABEL_H; }
		this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
		if (this.texture) { this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; }
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
		fitFont(ctx, this.text, LABEL_W - 80, 58, 30, LABEL.weight); // (sets ctx.font)
		const w = Math.min(LABEL_W - 8, ctx.measureText(this.text).width + 64);
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
		this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
		if (this.canvas) { this.canvas.width = w; this.canvas.height = h; }
		this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
		if (this.texture) { this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; }
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
