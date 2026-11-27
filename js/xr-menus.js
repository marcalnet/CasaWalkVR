// What the headset menus say and do (SPEC.md, C0 "Hands and touch" and
// "Layers"). ("dollhouse" in the code is the scale model on screen.)
//
// The wrist menu (js/wrist-menu.js) has two keys: ← Back and Settings.
// Settings opens the one settings wing: one per layer, both titled
// "Settings", the same three tabs in both (How to move, View, General; the
// next-build asks 3.1 and 3.3), with no Close key (a press at empty space
// closes it: js/xr-ui.js); pressed by touch, or by a controller's laser.
// On/off settings are switches, settings with a few values are options with
// every one visible (one press).
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
 * foot (the build) before the board is drawn; it is never pressed. 355 px:
 * all the 34 cm wing leaves a tab (493 px less the title, the tabs and the
 * pads), a little more than the View tab's five rows (354 px).
 */
const GUIDE_CELL = {
	type: 'drawn', id: 'guide', h: 355, kind: 'dollhouse-hands', foot: '',
	draw(ctx, box) { drawGuide(ctx, this.kind, box, this.foot); },
};

/** Every cell of the settings boards, by id. */
const CELLS = {
	light: { type: 'choice', id: 'light', label: 'Time of day', options: TIMES.map((t) => ({ value: t, label: TIME_LABELS[t] ?? t })), value: 'morning' },
	shadows: sw('shadows', 'Shadows'),
	depth: sw('depth', 'Depth shading'),
	seethrough: sw('seethrough', 'Transparent walls'),
	view: sw('view', 'Passthrough'), // on: the room around you; off: the VR world
	newVisitor: { type: 'button', id: 'newVisitor', label: 'New visitor' }, // (General's last row: the session starts over for the next person)
	mainHand: { type: 'choice', id: 'mainHand', label: 'Main hand', options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }], value: 'right' }, // flips the wrist menu and the tool fan together
	sound: sw('sound', 'Sound'), // on: the sound effects (a choice again when ambience comes, milestone H)
	guide: GUIDE_CELL,
	height: { type: 'choice', id: 'height', label: 'Height', options: HEIGHTS.map((h) => ({ value: h, label: h ? `${h.toFixed(1)} m` : 'Yours' })), value: 0 },
};


/**
 * The board's tabs (the same at both layers), each with rows of cell ids.
 * How to move first (it opens there the first time at each place in a
 * session: js/xr-ui.js). The camera's lens is on the camera's dial (js/tool-dial.js).
 */
export const TABS = [
	{ id: 'move', label: 'How to move', rows: [['guide']] },
	{ id: 'view', label: 'View', rows: [['light'], ['shadows'], ['depth'], ['view'], ['seethrough']] }, // (the long words on full rows: half a row clipped "Depth shading" and "Passthrough", build 120)
	{ id: 'general', label: 'General', rows: [['height'], ['mainHand'], ['sound'], ['newVisitor']] }, // (New visitor last: it resets Height and starts the tips over)
];

/** The boards, one per layer: the title names the layer. */
export const MENUS = {
	dollhouse: { title: 'Settings' }, // (one title at both layers: the next-build asks 3.1)
	walk: { title: 'Settings' },
};

/** The one wing beside the model, on the main hand's side: its width (metres; 34 cm tall at most, the harmony's conflict 13). */
export const WING_SIZE = { settings: 0.40 };

/**
 * How to move (C0.4; the final words of the next-build asks 3.1): how to move
 * here, for bare hands or for controllers. Each: four frames (row of the
 * sheet image, a word each) and at most four lines under them (MAX_LINES:
 * what fits the 34 cm wing at 24 px). No close line: the wing's header says it.
 */
export const GUIDE_MAX_LINES = 4;
export const GUIDES = {
	'walk-hands': { row: 0,
		frames: ['Pinch your fingers', 'Hold: aim', 'Point at the floor', 'Let go on blue: go'],
		lines: ['While aiming, flick your wrist: turn', 'Let go on red: nothing happens', 'Palm towards you: cancel', 'The Meta button leaves VR at any moment'] },
	'walk-controllers': { row: 1,
		frames: ['Right stick forward', 'or hold a trigger', 'Aim at the floor', 'Let go on blue: go'],
		lines: ['Right stick left or right: turn', 'Left stick: walk', 'Hold B or Y: back to the scale model', 'The Meta button leaves VR at any moment'] },
	'dollhouse-hands': { row: 2,
		frames: ['Close your hand on it: hold', 'Let go: it floats, then goes home', 'Pinch and hold, point at a room', 'Let go: walk in'],
		lines: ['Turn it: it stays level', 'Palm towards you: cancel', 'Touch the ring on a tool: options', 'Hold \u2190 Back: leave VR'] },
	'dollhouse-controllers': { row: 3,
		frames: ['Grip: hold it', 'Stick: turn', 'Point at a room', 'Pull the trigger: walk in'],
		lines: ['Turn it: it stays level', 'Let go: it floats home', 'Holding a tool, stick: its options', 'Hold B or Y: leave VR'] },
};

/**
 * The pause's tips (js/pause.js; the next-build asks, "Tip screens" and 3.6):
 * one line each, labels with no full stop, at most 60 cm wide at their full
 * size (the emulator measures them), for bare hands and for controllers.
 * Shown in this order, per transition, each at most once a session.
 */
export const TIPS = {
	enter: [{ id: 'walkin', hands: 'Pinch a room, let go: walk in', controllers: 'Trigger on a room: walk in', demo: 'door' }],
	in: [
		{ id: 'teleport', hands: 'Pinch, aim, let go to jump', controllers: 'Hold the trigger, aim, let go', demo: 'pinch', practise: true },
		{ id: 'turn', hands: 'Pinch, flick your wrist: turn', controllers: 'Flick the right stick to turn', demo: 'flick' },
		{ id: 'portal', hands: 'Touch a wall: see through', controllers: 'Touch a wall: see through', demo: 'touch' },
	],
	back: [{ id: 'grab', hands: 'Grab the model to turn it', controllers: 'Grip the model to turn it', demo: 'grab' }],
};

// The close line, in the wing's header (there is no Close key: build 120, M1; js/xr-ui.js sets it on opening): the colon form
// How to move uses, short enough to draw at 18-22 px beside the title, never shrunk (the Lead, 26 Nov 2026; js/panel.js HINT_PX).
export const CLOSE_HINT = { controllers: 'Trigger outside: close', hands: 'Pinch outside: close' };

/**
 * Builds the settings wings (one per layer, hidden, in the rig). Returns
 * { menus: { dollhouse: Panel, walk: Panel } }.
 */
export function buildMenus(rig) {
	const menus = {};
	const cells = (rows) => rows.map((row) => row.map((id) => CELLS[id]));
	const paper = typeof Image !== 'undefined' ? new Image() : null;
	for (const [mode, { title }] of Object.entries(MENUS)) {
		// The one wing: Settings, its three tabs (each layer's own copy: the guide's cell differs).
		const p = new Panel({ tabs: TABS.map((t) => ({ ...t, rows: cells(t.rows) })) }, {
			title, width: WING_SIZE.settings, pxPerM: BOARD_PX_PER_M, hint: CLOSE_HINT.controllers, background: paper, // (no Close key: build 120, M1; 34 cm tall at most: the harmony's conflict 13)
		});
		p.mesh.visible = false;
		p.mesh.name = 'board';
		p.mesh.material.depthTest = false; // never hidden inside a wall
		rig.add(p.mesh);
		menus[mode] = p;
	}
	if (paper) {
		paper.onload = () => { for (const p of Object.values(menus)) p.draw(); };
		paper.src = BOARD.image;
	}
	return { menus };
}

/** Shows the current settings in both menus (switch positions, chosen options, levels). */
export function updateLabels(xr) {
	const view = xr.sessionMode === 'vr' ? { disabled: true, note: 'Not available', value: false } : { disabled: false, value: xr.view === 'ar' };
	for (const p of Object.values(xr.menus)) {
		p.set('view', view);
		p.set('seethrough', { value: xr.seeThroughAmount > 0 });
		p.set('mainHand', { value: xr.mainHand });
		if (xr.lighting) {
			p.set('light', { value: xr.lighting.time });
			p.set('shadows', { value: xr.lighting.shadows || !!xr.shadowsBusy, label: xr.shadowsBusy ? 'Shadows \u2026' : 'Shadows' }); // (switching on: a visible pause on a heavy home, said while it works)
		}
		if (xr.depth) {
			const preparing = xr.depth.enabled && xr.depth.state === 'baking';
			p.set('depth', { value: xr.depth.enabled, label: preparing ? `Depth shading ${xr.depth.label()}` : 'Depth shading' });
		}
		p.set('sound', { value: xr.soundLevel !== 'off' });
		p.set('height', { value: xr.personHeight });
	}
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
			else xr.goLayer('out', () => xr.end()); // from the scale model, Back leaves VR (the wrist menu's, opened on purpose: one press)
			break;
		case 'settings': ui.toggleBoard(); break;
		case 'newVisitor': // the next person, the headset still on: the tips, the first tabs, the height and the first-target ring start over
			xr.newVisitor();
			break;
		case 'mainHand': {
			const main = SETTINGS.mainHand.options.includes(value) ? value : xr.mainHand === 'left' ? 'right' : 'left';
			xr.toolFan = main === 'left' ? 'right' : 'left';
			writeSetting('mainHand', main);
			ui.wrist.setSide();
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
		case 'shadows':
			if (!xr.lighting || xr.shadowsBusy) break;
			if (xr.lighting.shadows) { xr.lighting.setShadows(false); updateLabels(xr); break; }
			// Switching on recompiles every material (a pause of a second or more on a heavy home): the
			// switch says so first ("Shadows …", drawn before the pause), then shadows go on, then it settles.
			xr.shadowsBusy = true;
			updateLabels(xr);
			xr.tweens.start({ duration: 0.05, step: () => {}, done: () => {
				xr.lighting.setShadows(true);
				xr.tweens.start({ duration: 0.1, step: () => {}, done: () => { xr.shadowsBusy = false; updateLabels(xr); } });
			} });
			break;
		case 'lens':
			xr.cameraLens = SETTINGS.cameraLens.options.includes(value) ? value : SETTINGS.cameraLens.fallback;
			writeSetting('cameraLens', xr.cameraLens);
			xr.fan?.camera?.setLens(xr.cameraLens);
			updateLabels(xr);
			break;
		case 'sound': // a switch: on is the effects (an old 'off' / 'effects' value still works)
			xr.soundLevel = value === true || value === 'effects' ? 'effects' : value === false || value === 'off' ? 'off' : xr.soundLevel === 'off' ? 'effects' : 'off';
			writeSetting('sound', xr.soundLevel);
			xr.sound.setLevel(xr.soundLevel);
			if (xr.soundLevel !== 'off') xr.sound.play('tick'); // (so you hear what you chose)
			updateLabels(xr);
			break;
		case 'depth': xr.depth?.setEnabled(!xr.depth.enabled); updateLabels(xr); break;
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
