// Every word drawn in the headset, as big as it looks (build 215's C5): its
// cap height in degrees at the distance it is normally read from, against the
// UX handbook's type ramp (js/type-ramp.js: labels 0.6°, body 0.7°, headings
// 1.1°, the hand-lettered Kalam 1.4°). Sizes come from the modules' own
// constants; a word fitted to its space is fitted here with its width
// measured in Chromium (27 Nov 2026: Kalam bold from vendor/kalam, the
// interface font as Roboto, the Quest Browser's), in em.
// (Not listed: the ?hands and ?stats readouts, development only.)
import { test } from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { RAMP, CAP, capDeg, pxFor, kalamEm } from '../js/type-ramp.js';
import { PX_H, labelRange } from '../js/keys.js';
import { KEYS } from '../js/wrist-menu.js';
import { TAG } from '../js/tool-fan.js';
import { DOOR_TYPE, DOOR_IN, LEVEL_KEY, LEVEL_KEY_MANY, LEVEL_W, levelKeyWidth } from '../js/xr-dollhouse.js';
import { NOTE_W, LABEL_H as LABEL_CANVAS_H, PANEL_TYPE } from '../js/panel.js';
import { PHOTO_TEXT, PHOTO_NOTE, photoNoteType, NOTES, LABEL_PX_LASER } from '../js/xr-ui.js';
import { PAUSE } from '../js/pause.js';
import { BOARD_PX_PER_M } from '../js/xr-menus.js';
import { LINES } from '../js/guide.js';
import { SCREEN, LABEL_H as METER_LABEL_H, SLOT, LABEL_DEG, labelScale } from '../js/laser-meter.js';
import { PLATE, WRIST } from '../js/theme.js';
import { TAG as CAMERA_TAG } from '../js/street-camera.js';

// Widths in em (Chromium, 27 Nov 2026).
const KALAM = { '← Back': 3.5, Settings: 3.7, Camera: 3.31, Meter: 2.54, Marker: 2.97, 'Walk in →': 4.64, 'Level 0': 3.11, 'Level 12': 3.48, Second: 3.08, Attic: 2.28, 'First floor': 4.26, Basement: 4.4, 'Upper floor': 4.69, 'Ground floor': 5.17, 'Nice shot!': 4.67, "The photo didn't work": 9.8 };
const UI = { '87': 1.11, '2.45': 1.95, "12' 4½\"": 3.49, cm: 1.45, m: 0.86, 'ft in': 1.83, [PHOTO_TEXT.kept.line]: 15.7, [PHOTO_TEXT.full.line]: 10.84, [PHOTO_TEXT.failed.line]: 20.33 };

/** A key's word fitted as js/keys.js fits it: from max down in steps of 2 while wider than maxW, never under min. */
function fitKey(word, max, min, maxW) {
	let px = max;
	while (px > min && (KALAM[word] ?? kalamEm(word)) * px > maxW) px = Math.max(min, px - 2);
	return px;
}

const DIST = { plate: 1.0, roomName: 1.2, walkSpot: 3, meterNear: 2, meterFar: 5 }; // (m: where the plate on the plinth's front edge, the rooms' names over the scale model, the landing spot's name and a measured line are usually read from)

/** Every drawn word: { what, family, px, mPerPx, dist, line (degrees), open (a known shortfall, for the Designer) }. */
function texts() {
	const t = [], add = (what, family, px, mPerPx, dist, line, open = null) => t.push({ what, family, px, mPerPx, dist, line, open });
	// The main hand's keys: 7 cm round keys, read at 0.45 m; words fit 80% of the key's width.
	for (const [pad, type, words] of [['hand key', KEYS.TYPE, ['← Back', 'Settings']]]) {
		const k = { h: WRIST.key, type }, r = labelRange(k);
		for (const w of words) add(`${pad} "${w}"`, 'kalam', fitKey(w, r.max, r.min, WRIST.key / k.h * PX_H * type.fit), k.h / PX_H, type.readAt, RAMP.kalam);
	}
	add('hand key captions ("Leave VR", "Scale model", "and help")', 'ui', 26, WRIST.key / PX_H, KEYS.TYPE.readAt, RAMP.label);
	// The camera's instruction tag (build-215 asks C10 §6): two lines, Kalam bold, 11 mm capitals at 0.45 m.
	for (const w of ['Trigger:', 'Pinch:', 'photo']) add(`camera tag "${w}"`, 'kalam', CAMERA_TAG.px, CAMERA_TAG.size[1] / CAMERA_TAG.canvas[1], CAMERA_TAG.readAt, RAMP.kalam);
	// The tools' name tags.
	for (const w of ['Camera', 'Meter', 'Marker']) add(`tool tag "${w}"`, 'kalam', TAG.px, TAG.height / LABEL_CANVAS_H, TAG.readAt, RAMP.kalam);
	// The doors and the levels, from about 0.72 m. A wide key's word fits beside its icon (x0) with 30 px to spare.
	const walk = { h: DOOR_IN[1], type: DOOR_TYPE }, wr = labelRange(walk), walkW = Math.round(PX_H * DOOR_IN[0] / DOOR_IN[1]) - (40 + 120 + 24) - 30;
	add('Walk in →', 'kalam', fitKey('Walk in →', wr.max, wr.min, walkW), walk.h / PX_H, DOOR_TYPE.readAt, RAMP.kalam);
	// A stack's keys take one width, for its longest name at 1.4° (11-14 cm); only past 14 cm may a name shrink, to 1.2°, then "…".
	const stacks = [['Level 0', 'Level 12'], ['Ground floor', 'First floor'], ['Basement', 'Upper floor', 'Second', 'Attic'], ['Mezzanine le', 'Level 1'], Array.from({ length: 7 }, (_, i) => `Level ${i}`), ['Ground floor', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6']];
	for (const names of stacks) {
		const h = names.length > 6 ? LEVEL_KEY_MANY : LEVEL_KEY[1], w = levelKeyWidth(names, h), r = labelRange({ h, type: DOOR_TYPE }), room = Math.round(PX_H * w / h) - 70;
		for (const n of new Set(names)) {
			const wide = (KALAM[n] ?? kalamEm(n)) * pxFor(RAMP.kalam, 'kalam', h / PX_H, DOOR_TYPE.readAt) + 70 > LEVEL_W[1] * PX_H / h; // (past 14 cm at 1.4°)
			add(`level key "${n}" (${names.length} levels: keys ${(w * 100).toFixed(1)} x ${h * 100} cm)${wide ? ', past 14 cm: fitted' : ''}`, 'kalam', fitKey(n, r.max, r.min, room), h / PX_H, DOOR_TYPE.readAt, wide ? DOOR_TYPE.label[0] : RAMP.kalam);
		}
	}
	add('"Levels" over the stack', 'ui', 58, 0.026 / LABEL_CANVAS_H, DOOR_TYPE.readAt, RAMP.label);
	add('a room\'s name over the scale model', 'ui', 58, 0.05 / LABEL_CANVAS_H, DIST.roomName, RAMP.label);
	add('the scale plate: "Scale"', 'ui', PLATE.caption.px, PLATE.metres[1] / PLATE.size[1], DIST.plate, RAMP.label);
	add('the scale plate: the ratio', 'ui', PLATE.ratio.px, PLATE.metres[1] / PLATE.size[1], DIST.plate, RAMP.body);
	// The notes in front of the eyes.
	const pt = photoNoteType(), pm = PHOTO_NOTE.width / NOTE_W, pd = Math.hypot(...PHOTO_NOTE.at), lineW = NOTE_W - 120;
	add('photo note: "Nice shot!"', 'kalam', pt.titlePx, pm, pd, RAMP.kalam);
	assert.ok(KALAM["The photo didn't work"] * pt.titlePx <= lineW, 'the failed photo\'s title fits the card');
	for (const line of [PHOTO_TEXT.kept.line, PHOTO_TEXT.full.line]) {
		assert.ok(UI[line] * pt.smallPx <= lineW, `"${line}" fits one line at its size`);
		add(`photo note: "${line}"`, 'ui', pt.smallPx, pm, pd, PHOTO_NOTE.line);
	}
	add(`photo note: "${PHOTO_TEXT.failed.line}" (fitted)`, 'ui', Math.max(pt.minPx, Math.floor(lineW / UI[PHOTO_TEXT.failed.line])), pm, pd, RAMP.body);
	for (const [name, n] of Object.entries(NOTES)) {
		const m = n.width / NOTE_W, d = Math.hypot(...n.at);
		add(`${name} note: title`, 'ui', 64, m, d, RAMP.heading);
		add(`${name} note: its line`, 'ui', 34, m, d, RAMP.body);
	}
	// The pause.
	add('the pause: the tip', 'ui', PAUSE.TIP_PX, PAUSE.TIP_H / LABEL_CANVAS_H, PAUSE.AHEAD, 1.2);
	add('the pause: the room\'s name', 'ui', 58, PAUSE.NAME_H / LABEL_CANVAS_H, PAUSE.AHEAD, 1.5);
	add('the landing spot\'s name, inside', 'ui', 58, 0.12 / LABEL_CANVAS_H, DIST.walkSpot, RAMP.label);
	// The Settings wing: 0.55 m (hands), and the controllers' at up to 0.75 m with its row labels 15% larger.
	for (const [who, dist, row] of [['wing', 0.55, PANEL_TYPE.row.max], ['controllers\' wing', 0.75, LABEL_PX_LASER]]) {
		const m = 1 / BOARD_PX_PER_M;
		add(`${who}: title`, 'ui', PANEL_TYPE.title, m, dist, RAMP.heading);
		add(`${who}: the close line (smallest)`, 'ui', PANEL_TYPE.hint.min, m, dist, RAMP.label);
		add(`${who}: a row's label`, 'ui', row, m, dist, 0.9);
		add(`${who}: a tab (smallest)`, 'ui', PANEL_TYPE.tab.min, m, dist, RAMP.label);
		add(`${who}: a button (smallest)`, 'ui', PANEL_TYPE.button.min, m, dist, RAMP.label);
		add(`${who}: a disabled row's note (smallest)`, 'ui', PANEL_TYPE.note.min, m, dist, RAMP.label);
		add(`${who}: a switch's label (smallest)`, 'ui', PANEL_TYPE.switchRow.min, m, dist, RAMP.label);
		add(`${who}: How to move, a line (smallest)`, 'ui', LINES.min, m, dist, RAMP.body);
		add(`${who}: How to move, the build line`, 'ui', LINES.foot, m, dist, RAMP.label);
	}
	// The meter: its screen at 0.45 m, its labels in the home.
	const sm = SCREEN.size[1] / SCREEN.H, room = SCREEN.W * 30 / 32;
	for (const v of ['87', '2.45', "12' 4½\""]) {
		let px = 150;
		while (UI[v] * px > room && px > 40) px--;
		add(`meter screen: "${v}"`, 'ui', px, sm, SCREEN.readAt, RAMP.body);
		const unit = { '87': 'cm', '2.45': 'm', "12' 4½\"": 'ft in' }[v];
		add(`meter screen: "${unit}" under "${v}"`, 'ui', Math.max(Math.round(px * 0.6), SCREEN.unitMin), sm, SCREEN.readAt, RAMP.label);
	}
	for (const [m, d] of [['dollhouse', 0.8], ['walk', 1], ['walk', DIST.meterNear], ['walk', DIST.meterFar], ['walk', 12]]) add(`a measured line's label, ${m === 'dollhouse' ? 'at the scale model' : 'inside'}, ${d} m away`, 'ui', 40, labelScale(d, m) * METER_LABEL_H / SLOT[1], d, LABEL_DEG[0]);
	return t;
}

test('every drawn word is at least its line of the type ramp, at the distance it is read from (build 215\'s C5)', () => {
	const rows = texts(), under = [];
	const report = rows.map((r) => {
		const deg = capDeg(r.px, r.family, r.mPerPx, r.dist), mm = CAP[r.family] * r.px * r.mPerPx * 1000;
		if (deg < r.line - 1e-9 && !r.open) under.push(`${r.what}: ${deg.toFixed(2)}° (needs ${r.line}°)`);
		return `${deg.toFixed(2).padStart(5)}°  ${r.line.toFixed(1)}°  ${mm.toFixed(1).padStart(5)} mm at ${r.dist.toFixed(2)} m  ${r.what}${r.open ? `  [open: ${r.open}]` : ''}`;
	});
	console.log(`Every drawn word (cap height, its line, at its distance):\n${report.join('\n')}`);
	assert.deepEqual(under, [], 'under the ramp');
	assert.deepEqual(rows.filter((r) => r.open), [], 'nothing open (the camera\'s back has no words: the Designer)');
});

test('the C5 numbers: keys\' words 11-14 mm at 0.45 m, the level keys\' 18 mm at 0.72 m, the tool tags\' 12 mm at 0.5 m', () => {
	const mm = (px, family, m) => CAP[family] * px * m * 1000;
	const key = labelRange({ h: WRIST.key, type: KEYS.TYPE });
	assert.ok(Math.abs(mm(key.min, 'kalam', WRIST.key / PX_H) - 11) < 0.4 && Math.abs(mm(key.max, 'kalam', WRIST.key / PX_H) - 14) < 0.4, `the keys: ${mm(key.min, 'kalam', WRIST.key / PX_H).toFixed(1)}-${mm(key.max, 'kalam', WRIST.key / PX_H).toFixed(1)} mm`);
	const lvl = { h: LEVEL_KEY[1], type: DOOR_TYPE };
	assert.ok(mm(pxFor(RAMP.kalam, 'kalam', lvl.h / PX_H, DOOR_TYPE.readAt), 'kalam', lvl.h / PX_H) >= 17.6, 'a level key at 1.4°: about 18 mm');
	assert.ok(Math.abs(mm(TAG.px, 'kalam', TAG.height / LABEL_CANVAS_H) - 12.2) < 0.5, 'the tool tags: about 12 mm');
	assert.deepEqual([LEVEL_KEY, LEVEL_KEY_MANY, LEVEL_W], [[0.11, 0.05], 0.04, [0.11, 0.14]], 'the level keys: 5 cm tall, 4 cm with more than six levels; 11-14 cm wide');
	assert.ok(Math.abs(levelKeyWidth(['Ground floor', 'First floor'], 0.05) - 0.14) < 0.005 && levelKeyWidth(['Level 0', 'Level 1'], 0.05) === 0.11, 'one width for the stack, from its longest name');
	assert.equal(DOOR_TYPE.label[0], 1.2, 'past 14 cm a name shrinks to 1.2° at the least');
});

test('a measured line\'s label: the user\'s 20 cm at 1:1, its capitals never under 0.8° as seen; at the scale model never over 2.0° (about 2.8 cm), inside no cap (5x at any distance: about 7 cm, 4° at 1 m)', () => {
	assert.deepEqual(LABEL_DEG, [0.8, 2.0]);
	const capAt = (d, m) => CAP.ui * 40 / SLOT[1] * METER_LABEL_H * labelScale(d, m), deg = (d, m) => THREE.MathUtils.radToDeg(Math.atan(capAt(d, m) / d));
	for (const d of [0.3, 0.8, 1.5, 2, 3, 5, 9, 20]) assert.ok(deg(d, 'dollhouse') >= 0.8 - 1e-9 && deg(d, 'dollhouse') <= 2.0 + 1e-9, `the scale model, ${d} m: ${deg(d, 'dollhouse').toFixed(2)}°`);
	assert.ok(Math.abs(capAt(0.8, 'dollhouse') - 0.028) < 0.001, `at the scale model, 0.8 m: ${(capAt(0.8, 'dollhouse') * 100).toFixed(1)} cm of capitals`);
	for (const d of [0.5, 1, 1.5, 2, 5]) assert.equal(labelScale(d, 'walk'), 1, `inside, ${d} m: the user's size, no cap`);
	assert.ok(Math.abs(capAt(1, 'walk') - 0.072) < 1e-6 && deg(1, 'walk') > 4 && deg(1, 'walk') < 4.2, `inside at 1 m: 7.2 cm, ${deg(1, 'walk').toFixed(1)}°`);
	for (const d of [9, 20]) assert.ok(labelScale(d, 'walk') > 1 && Math.abs(deg(d, 'walk') - 0.8) < 1e-9, `inside, ${d} m: grown to the 0.8° floor`);
});

