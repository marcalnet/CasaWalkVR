// What the headset menus say and do (SPEC.md, C0 "Hands and touch" and
// "Layers"). ("dollhouse" in the code is the scale model on screen.)
//
// The wrist menu (js/wrist-menu.js) has three keys: ← Back, Settings and
// Walk in →. Settings opens the settings board: one per layer ("Settings ·
// Scale model", "Settings · Inside"), the same tabs in both (View, Walk,
// General), with no Close key (a press at empty space closes it: js/xr-ui.js);
// pressed by touch, or by a controller's laser. On/off settings are switches,
// settings with a few values are options with every one visible (one press).
// How to move (the guideKey on the board's tab row) opens the left wing.
//
// Every cell is defined once (CELLS) and the boards list cell ids by row
// (TABS), so the same setting looks and behaves the same at every layer.
// updateLabels() shows the current settings; menuAction() runs a key or a
// cell. Opening, closing and pointing are js/xr-ui.js.

import * as THREE from 'three';
import { Panel } from './panel.js';
import { TIMES } from './lighting.js';
import { SETTINGS, writeSetting } from './settings.js';
import { BOARD } from './theme.js';
import { drawGuide } from './guide.js';

const BOARD_PX_PER_M = 1450; // canvas pixels per metre: a row of 80 px is 5.5 cm
const TIME_LABELS = { morning: 'Morning', noon: 'Noon', sunset: 'Sunset', night: 'Night' };
const HEIGHTS = SETTINGS.height.options; // person height, metres (0 = your own)
// Transparent walls (called See-through until the user's bare-hands test: too
// close to Passthrough) is one switch: on is 75% (the user's Quest 2 test: the only level that reads well; 100% is too thin).
export const SEE_THROUGH_ON = 0.75;

const sw = (id, label) => ({ type: 'switch', id, label, value: false });

/**
 * How to move: the first tab's one cell, drawn by js/guide.js (pictures and
 * lines for the input in hand, at this layer). js/xr-ui.js sets its kind and
 * foot (the build) before the board is drawn; it is never pressed. As tall as
 * the View tab's five rows, so the board keeps its size.
 */
const GUIDE_CELL = {
	type: 'drawn', id: 'guide', h: 390, kind: 'dollhouse-hands', foot: '',
	draw(ctx, box) { drawGuide(ctx, this.kind, box, this.foot); },
};

/** Every cell of the settings boards, by id. */
const CELLS = {
	light: { type: 'choice', id: 'light', label: 'Time of day', options: TIMES.map((t) => ({ value: t, label: TIME_LABELS[t] ?? t })), value: 'morning' },
	shadows: sw('shadows', 'Shadows'),
	depth: sw('depth', 'Depth shading'),
	ceilings: sw('ceilings', 'Ceilings'),
	solid: sw('solid', 'Solid walls'),
	seethrough: sw('seethrough', 'Transparent walls'),
	view: sw('view', 'Passthrough'), // on: the room around you; off: the VR world
	mainHand: { type: 'choice', id: 'mainHand', label: 'Main hand', options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }], value: 'right' }, // flips the wrist menu and the tool fan together
	lens: { type: 'choice', id: 'lens', label: 'Camera lens', options: [24, 28, 35, 50].map((mm) => ({ value: mm, label: `${mm} mm` })), value: 28 },
	sound: { type: 'choice', id: 'sound', label: 'Sound', options: [{ value: 'off', label: 'Off' }, { value: 'effects', label: 'Effects' }], value: 'effects' },
	guide: GUIDE_CELL,
	replayTools: { type: 'button', id: 'replayTools', label: 'Tools show' }, // the left wing's two replay keys
	replayPinch: { type: 'button', id: 'replayPinch', label: 'Pinch hand' },
	height: { type: 'choice', id: 'height', label: 'Height', options: HEIGHTS.map((h) => ({ value: h, label: h ? `${h.toFixed(1)} m` : 'Yours' })), value: 0 },
};


/** The board's tabs (the same at both layers), each with rows of cell ids. Camera lens joins General in milestone D. */
export const TABS = [
	{ id: 'view', label: 'View', rows: [['light'], ['shadows', 'ceilings'], ['depth'], ['view'], ['seethrough']] }, // (the long words on full rows: half a row clipped "Depth shading" and "Passthrough", build 120)
	{ id: 'walk', label: 'Walk', rows: [['height'], ['solid']] }, // (Turn left the board: 30° stays, the user's call)
	{ id: 'tools', label: 'Tools', rows: [['lens']] }, // (the street camera's lens: wide for interiors; to get closer, walk closer)
	{ id: 'general', label: 'General', rows: [['mainHand'], ['sound']] },
];

/** The boards, one per layer: the title names the layer. */
export const MENUS = {
	dollhouse: { title: 'Settings · Scale model' },
	walk: { title: 'Settings · Inside' },
};

/** The two wings beside the model (build 111's design): Settings on the right, How to move on the left. */
export const WING_SIZE = { settings: 0.40, guide: 0.34 }; // widths, metres

/**
 * The guide beside the menu (C0.4): how to move here, for bare hands or for
 * controllers. Each: a title, four frames (row of the sheet image, a word
 * each), and the lines under them.
 */
export const GUIDES = {
	'walk-hands': { title: 'How to move', row: 0,
		frames: ['Pinch your fingers', 'Hold: aim', 'Point at the floor', 'Let go on blue: go'],
		lines: ['While aiming, flick your wrist: turn', 'Let go on white or red: nothing happens', 'Palm towards you: cancel', 'Pinch outside the panels: close them', 'The Meta button leaves VR at any moment'] },
	'walk-controllers': { title: 'How to move', row: 1,
		frames: ['Right stick forward', 'or hold a trigger', 'Aim at the floor', 'Let go on blue: go'],
		lines: ['Right stick left or right: turn', 'Left stick: walk. Grip and pull: slide', 'B or Y: back to the scale model', 'Trigger outside the panels: close them', 'The Meta button leaves VR at any moment'] },
	'dollhouse-hands': { title: 'The scale model', row: 2,
		frames: ['Close your hand on it: hold', 'Let go: it floats, then goes home', 'Pinch and hold, point at a room', 'Let go when it holds still: step inside'],
		lines: ['Lift it and turn it: it stays level', 'Palm towards you: cancel', 'Pinch outside the panels: close them', 'The Meta button leaves VR at any moment'] },
	'dollhouse-controllers': { title: 'The scale model', row: 3,
		frames: ['Grip: hold it', 'Stick: turn', 'Point at a room', 'Pull the trigger: step inside'],
		lines: ['Lift it and turn it: it stays level', 'Let go in the air: it goes home by itself', 'Trigger outside the panels: close them', 'The Meta button leaves VR at any moment'] },
};

// The line at each wing's foot, saying how to close it (there is no Close key: build 120, M1; js/xr-ui.js sets it on opening).
export const CLOSE_HINT = { controllers: 'Pull the trigger outside to close', hands: 'Pinch outside to close' };

/**
 * Builds the settings boards (one per layer, hidden, in the rig). Returns
 * { menus: { dollhouse: Panel, walk: Panel } }. (Help opens a board on its
 * How to move tab: the help cards went on 25 Nov 2026.)
 */
export function buildMenus(rig) {
	const menus = {}, guides = {};
	const cells = (rows) => rows.map((row) => row.map((id) => CELLS[id]));
	const paper = typeof Image !== 'undefined' ? new Image() : null;
	for (const [mode, { title }] of Object.entries(MENUS)) {
		// The right wing: Settings (the tabs), with the How to move key at the tabs' left end.
		const p = new Panel({ tabs: TABS.map((t) => ({ ...t, rows: cells(t.rows) })) }, {
			title, width: WING_SIZE.settings, pxPerM: BOARD_PX_PER_M, hint: CLOSE_HINT.controllers, background: paper, // (no Close key: build 120, M1; 34 cm tall at most: the harmony's conflict 13)
			lead: { id: 'guideKey', label: '? How to move', w: 150 },
		});
		p.mesh.visible = false;
		p.mesh.name = 'board';
		p.mesh.material.depthTest = false; // never hidden inside a wall
		rig.add(p.mesh);
		menus[mode] = p;
		// The left wing: How to move (moving pictures for the input in hand), the two replay keys, the Meta button's line.
		const g = new Panel({ tabs: [{ id: 'guide', label: '', rows: cells([['guide'], ['replayTools', 'replayPinch']]) }] }, {
			title: 'How to move', width: WING_SIZE.guide, pxPerM: BOARD_PX_PER_M, hint: CLOSE_HINT.controllers, background: paper,
		});
		g.mesh.visible = false;
		g.mesh.name = 'guide-wing';
		g.mesh.material.depthTest = false;
		rig.add(g.mesh);
		guides[mode] = g;
	}
	if (paper) {
		paper.onload = () => { for (const p of [...Object.values(menus), ...Object.values(guides)]) p.draw(); };
		paper.src = BOARD.image;
	}
	return { menus, guides };
}

/** Shows the current settings in both menus (switch positions, chosen options, levels). */
export function updateLabels(xr) {
	const ceilings = xr.model?.layers.ceilings.visible ?? true;
	const view = xr.sessionMode === 'vr' ? { disabled: true, note: 'Not available', value: false } : { disabled: false, value: xr.view === 'ar' };
	for (const p of Object.values(xr.menus)) {
		p.set('ceilings', { value: ceilings });
		p.set('view', view);
		p.set('seethrough', { value: xr.seeThroughAmount > 0 });
		p.set('mainHand', { value: xr.mainHand });
		if (xr.lighting) {
			p.set('light', { value: xr.lighting.time });
			p.set('shadows', { value: xr.lighting.shadows });
		}
		if (xr.depth) {
			const preparing = xr.depth.enabled && xr.depth.state === 'baking';
			p.set('depth', { value: xr.depth.enabled, label: preparing ? `Depth shading ${xr.depth.label()}` : 'Depth shading' });
		}
		p.set('sound', { value: xr.soundLevel === 'off' ? 'off' : 'effects' });
		p.set('lens', { value: xr.cameraLens });
	}
	// The left wing's replay keys: the tools' show is at the scale model, the pinch hand inside.
	xr.guides.dollhouse.set('replayPinch', { disabled: true, note: 'Inside' });
	xr.guides.walk.set('replayTools', { disabled: true, note: 'At the scale model' });
	const walk = xr.menus.walk, doll = xr.menus.dollhouse;
	walk.set('height', { value: xr.personHeight });
	const walls = (xr.model?.layers.walls?.children.length ?? 0) > 0;
	walk.set('solid', walls ? { disabled: false, value: xr.solid } : { disabled: true, note: 'No walls', value: false });
	// (Levels are not here: a stack of keys beside the doors at the scale model, js/xr-dollhouse.js.)
	xr.modes.dollhouse?.refreshLevels?.();
}

/**
 * Runs a key or a board cell: { id } for keys and switches (a switch flips),
 * { id, value } for an option. A bare id string works too. The doors (In,
 * Back) move one layer, through xr.goLayer(); Settings and Help open and
 * close the board and the help card; settings stay open.
 */
export function menuAction(xr, target) {
	const { id, value } = typeof target === 'string' ? { id: target } : target;
	const ui = xr.ui;
	switch (id) {
		// The doors: one layer at a time (no key skips a layer; SPEC.md C0, "Layers").
		case 'in':
			if (xr.mode === 'dollhouse') xr.goLayer('in', () => xr.modes.walk.walkIn(), xr.modes.walk.walkInPoint().modelPt);
			break;
		case 'back':
			if (xr.mode === 'walk') xr.goLayer('back', () => xr.setMode('dollhouse'));
			else xr.goLayer('out', () => xr.end()); // from the scale model, Back leaves VR (the door on the plinth is held 0.6 s; the wrist menu's, opened on purpose, is one press)
			break;
		case 'settings': ui.toggleBoard(); break;
		case 'guideKey': ui.toggleHelp(); break; // (How to move: the left wing)
		case 'replayTools':
			ui.closeAll(); // (it must play where it can be seen)
			if (xr.mode === 'dollhouse' && xr.toolsIntro?.start({ again: true })) xr.introAgain = true;
			break;
		case 'replayPinch':
			ui.closeAll();
			if (xr.mode === 'walk') xr.pinchDemo.play(xr.pinchDemo.inputKind());
			break;
		case 'mainHand': {
			const main = SETTINGS.mainHand.options.includes(value) ? value : xr.mainHand === 'left' ? 'right' : 'left';
			xr.toolFan = main === 'left' ? 'right' : 'left';
			writeSetting('mainHand', main);
			ui.wrist.setSide();
			updateLabels(xr);
			break;
		}
		case 'ceilings': {
			const c = xr.model.layers.ceilings;
			c.visible = !c.visible;
			updateLabels(xr);
			break;
		}
		case 'view': {
			const next = value ?? (xr.view === 'vr' ? 'ar' : 'vr');
			if (xr.sessionMode !== 'ar' || next === xr.view) break;
			xr.view = next;
			writeSetting('view', xr.view);
			xr.applyView();
			updateLabels(xr);
			break;
		}
		case 'height':
			xr.personHeight = HEIGHTS.includes(value) ? value : HEIGHTS[(HEIGHTS.indexOf(xr.personHeight) + 1) % HEIGHTS.length];
			writeSetting('height', xr.personHeight);
			if (xr.mode === 'walk') xr.setLift(xr.modes.walk.personLift());
			updateLabels(xr);
			break;
		case 'levels': {
			// Show storeys up to `value` (0 = the lowest); the top one means all.
			const count = xr.model.storeys ?? 1;
			if (count < 2) break;
			const top = value ?? ((xr.maxStorey ?? -1) + 1) % count; // (bare id: the next one)
			xr.maxStorey = top >= count - 1 ? null : top;
			xr.applyStoreys();
			updateLabels(xr); // (also refreshes the level keys)
			break;
		}
		case 'light':
			if (value) xr.lighting?.setTime(value);
			else xr.lighting?.nextTime();
			updateLabels(xr);
			break;
		case 'shadows': xr.lighting?.setShadows(!xr.lighting.shadows); updateLabels(xr); break;
		case 'lens':
			xr.cameraLens = SETTINGS.cameraLens.options.includes(value) ? value : 28;
			writeSetting('cameraLens', xr.cameraLens);
			xr.fan?.camera?.setLens(xr.cameraLens);
			updateLabels(xr);
			break;
		case 'sound':
			xr.soundLevel = value === 'off' ? 'off' : value === 'effects' ? 'effects' : xr.soundLevel === 'off' ? 'effects' : 'off';
			writeSetting('sound', xr.soundLevel);
			xr.sound.setLevel(xr.soundLevel);
			if (xr.soundLevel !== 'off') xr.sound.play('tick'); // (so you hear what you chose)
			updateLabels(xr);
			break;
		case 'depth': xr.depth?.setEnabled(!xr.depth.enabled); updateLabels(xr); break;
		case 'solid':
			xr.solid = !xr.solid;
			writeSetting('solid', xr.solid);
			xr.modes.walk.body = null; // start again from where you stand
			updateLabels(xr);
			break;
		case 'seethrough': {
			// A switch: on is 75%. (A number, from a test or an old setting: any amount above 0 is on.)
			const on = typeof value === 'number' ? value > 0 : typeof value === 'boolean' ? value : !(xr.seeThroughAmount > 0);
			const v = on ? SEE_THROUGH_ON : 0;
			if (v === xr.seeThroughAmount) break;
			xr.seeThroughAmount = v;
			writeSetting('seeThrough', v);
			xr.applySeeThrough();
			updateLabels(xr);
			break;
		}
	}
}
