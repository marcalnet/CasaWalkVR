// What the headset menus say and do (SPEC.md, C0 "Hands and touch" and
// "Layers"). ("dollhouse" in the code is the scale model on screen.)
//
// The wrist menu (js/wrist-menu.js) has four keys: Settings, Help, ← Back and
// Walk in →. Settings opens the settings board: one per layer ("Settings ·
// Scale model", "Settings · Inside"), the same tabs in both (View, Walk,
// General), with a Close key; pressed by touch, or by a controller's laser.
// On/off settings are switches, settings with a few values are options with
// every one visible (one press), Levels is a ‹ › stepper. Help opens a card
// of what each control does, for controllers or for bare hands.
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
	type: 'drawn', id: 'guide', h: 5 * 80 + 4 * 14, kind: 'dollhouse-hands', foot: '',
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
	toolFan: { type: 'choice', id: 'toolFan', label: 'Tool fan', options: [{ value: 'left', label: 'Left hand' }, { value: 'right', label: 'Right hand' }], value: 'left' },
	lens: { type: 'choice', id: 'lens', label: 'Camera lens', options: [24, 28, 35, 50].map((mm) => ({ value: mm, label: `${mm} mm` })), value: 28 },
	sound: { type: 'choice', id: 'sound', label: 'Sound', options: [{ value: 'off', label: 'Off' }, { value: 'effects', label: 'Effects' }], value: 'effects' },
	guide: GUIDE_CELL,
	height: { type: 'choice', id: 'height', label: 'Height', options: HEIGHTS.map((h) => ({ value: h, label: h ? `${h.toFixed(1)} m` : 'Yours' })), value: 0 },
};


/** The board's tabs (the same at both layers), each with rows of cell ids. Camera lens joins General in milestone D. */
export const TABS = [
	{ id: 'move', label: 'How to move', rows: [['guide']] }, // (the guide, since 25 Nov: no card beside the board)
	{ id: 'view', label: 'View', rows: [['light'], ['shadows', 'depth'], ['ceilings', 'view'], ['seethrough']] },
	{ id: 'walk', label: 'Walk', rows: [['height'], ['solid']] }, // (Turn left the board: 30° stays, the user's call)
	{ id: 'tools', label: 'Tools', rows: [['lens']] }, // (the street camera's lens: wide for interiors; to get closer, walk closer)
	{ id: 'general', label: 'General', rows: [['toolFan'], ['sound']] },
];

/** The boards, one per layer: the title names the layer. */
export const MENUS = {
	dollhouse: { title: 'Settings · Scale model' },
	walk: { title: 'Settings · Inside' },
};

/**
 * The guide beside the menu (C0.4): how to move here, for bare hands or for
 * controllers. Each: a title, four frames (row of the sheet image, a word
 * each), and the lines under them.
 */
export const LESSONS = {
	// Each step: its words for bare hands and for controllers (none: skipped
	// for that input), what completes it (done: an event js/lessons.js is told;
	// none: the step ends with Got it), must (Got it waits for it), demo (the
	// looping hand: hold).
	scale: { title: 'Welcome to CasaWalk', steps: [
		{ id: 'start', done: 'start', must: true, hands: 'Press the Start key with your fingertip.', controllers: 'Press Start: touch it, or point and pull.' },
		{ id: 'menu', done: 'wrist', must: true, hands: 'Touch your right wrist with your left hand: your menu.', controllers: 'Press A (or touch the orb on your right controller): your menu.' },
		{ id: 'tools', done: 'fan', must: true, hands: 'Look at your {fan} hand: your tools. Touch one with your {take} hand.', controllers: 'Look at your {fan} controller: your tools. Touch one with your {take} controller.' },
		{ id: 'hold', done: 'held', demo: 'hold', hands: 'Close your hand on the home to hold it. Let go: it goes home.', controllers: 'Squeeze a grip to hold the home. Let go in the air: it goes home.' },
		{ id: 'inside', done: 'inside', hands: 'Pinch and hold, point at a room. Let go when it holds still: step inside.', controllers: 'Point at a room and pull the trigger: step inside.' },
	] },
	walk: { title: 'Moving around', steps: [
		{ id: 'arc', done: 'arc', hands: 'Pinch and hold: aim. An arc shows where you\'ll land.', controllers: 'Right stick forward, or hold a trigger: aim.' },
		{ id: 'go', done: 'teleport', must: true, hands: 'Aim at the orange ring. Let go on blue: go.', controllers: 'Aim at the orange ring. Let go: go.' },
		{ id: 'turn', done: 'turn', hands: 'While aiming, flick your wrist: turn.', controllers: 'Right stick left or right: turn.' },
		{ id: 'end', hands: 'Turn your palm towards you to cancel. Help shows how to move.', controllers: 'Left stick: walk. Grip and pull: slide.' },
	] },
};

export const GUIDES = {
	'walk-hands': { title: 'How to move', row: 0,
		frames: ['Pinch your fingers', 'Hold: aim', 'Point at the floor', 'Let go on blue: go'],
		lines: ['While aiming, flick your wrist: turn', 'Let go on white or red: nothing happens', 'Palm towards you: cancel', 'The Meta button leaves VR at any moment'] },
	'walk-controllers': { title: 'How to move', row: 1,
		frames: ['Right stick forward', 'or hold a trigger', 'Aim at the floor', 'Let go on blue: go'],
		lines: ['Right stick left or right: turn', 'Left stick: walk. Grip and pull: slide', 'B or Y: back to the scale model', 'The Meta button leaves VR at any moment'] },
	'dollhouse-hands': { title: 'The scale model', row: 2,
		frames: ['Close your hand on it: hold', 'Let go: it floats, then goes home', 'Pinch and hold, point at a room', 'Let go when it holds still: step inside'],
		lines: ['Lift it and turn it: it stays level', 'Palm towards you: cancel', 'The Meta button leaves VR at any moment'] },
	'dollhouse-controllers': { title: 'The scale model', row: 3,
		frames: ['Grip: hold it', 'Sticks: turn and zoom', 'Point at a room', 'Pull the trigger: step inside'],
		lines: ['Lift it and turn it: it stays level', 'Let go in the air: it goes home by itself', 'The Meta button leaves VR at any moment'] },
};

/**
 * Builds the settings boards (one per layer, hidden, in the rig). Returns
 * { menus: { dollhouse: Panel, walk: Panel } }. (Help opens a board on its
 * How to move tab: the help cards went on 25 Nov 2026.)
 */
export function buildMenus(rig) {
	const menus = {};
	const cells = (rows) => rows.map((row) => row.map((id) => CELLS[id]));
	const paper = typeof Image !== 'undefined' ? new Image() : null;
	for (const [mode, { title }] of Object.entries(MENUS)) {
		const p = new Panel({ tabs: TABS.map((t) => ({ ...t, rows: cells(t.rows) })), actions: [] }, { title, width: BOARD.width, pxPerM: BOARD_PX_PER_M, close: true, background: paper });
		p.mesh.visible = false;
		p.mesh.name = 'board';
		p.mesh.material.depthTest = false; // never hidden inside a wall
		// The handle bar on top: hold it to move the board.
		const [hw, hh] = BOARD.handle, height = p.mesh.geometry.parameters.height;
		p.handle = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, 0.012), new THREE.MeshLambertMaterial({ color: BOARD.handleColour }));
		p.handle.position.set(0, height / 2 + hh / 2 + 0.006, 0);
		p.handle.name = 'board-handle';
		p.mesh.add(p.handle);
		rig.add(p.mesh);
		menus[mode] = p;
	}
	if (paper) {
		paper.onload = () => { for (const p of Object.values(menus)) p.draw(); };
		paper.src = BOARD.image;
	}
	return { menus };
}

/** Shows the current settings in both menus (switch positions, chosen options, slider, levels). */
export function updateLabels(xr) {
	const ceilings = xr.model?.layers.ceilings.visible ?? true;
	const view = xr.sessionMode === 'vr' ? { disabled: true, note: 'Not available', value: false } : { disabled: false, value: xr.view === 'ar' };
	for (const p of Object.values(xr.menus)) {
		p.set('ceilings', { value: ceilings });
		p.set('view', view);
		p.set('seethrough', { value: xr.seeThroughAmount > 0 });
		p.set('toolFan', { value: xr.toolFan });
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
		case 'in': case 'walk':
			if (xr.mode === 'dollhouse') xr.goLayer('in', () => xr.modes.walk.walkIn());
			break;
		case 'back':
			if (xr.mode === 'walk') xr.goLayer('back', () => xr.setMode('dollhouse'));
			else xr.goLayer('out', () => xr.end()); // from the scale model, Back leaves VR (the door on the plinth is held 0.6 s; the wrist menu's, opened on purpose, is one press)
			break;
		case 'dollhouse': if (xr.mode === 'walk') xr.goLayer('back', () => xr.setMode('dollhouse')); break;
		case 'exit': xr.goLayer('out', () => xr.end()); break;
		case 'settings': ui.toggleBoard(); break;
		case 'help': ui.toggleHelp(); break;
		case 'close': ui.closeMenu(); break;
		case 'toolFan':
			xr.toolFan = SETTINGS.toolFan.options.includes(value) ? value : xr.toolFan === 'left' ? 'right' : 'left';
			writeSetting('toolFan', xr.toolFan);
			ui.wrist.setSide();
			updateLabels(xr);
			break;
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
