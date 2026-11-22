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
import { Panel, ControlsCard, WelcomeCard } from './panel.js';
import { TIMES } from './lighting.js';
import { SETTINGS, writeSetting } from './settings.js';
import { BOARD } from './theme.js';

const BOARD_PX_PER_M = 1450; // canvas pixels per metre: a row of 80 px is 5.5 cm
const TIME_LABELS = { morning: 'Morning', noon: 'Noon', sunset: 'Sunset', night: 'Night' };
const HEIGHTS = SETTINGS.height.options; // person height, metres (0 = your own)
// Transparent walls (called See-through until the user's bare-hands test: too
// close to Passthrough) is one switch: on is 75% (the user's Quest 2 test: the only level that reads well; 100% is too thin).
export const SEE_THROUGH_ON = 0.75;

const sw = (id, label) => ({ type: 'switch', id, label, value: false });

/** Every cell of the settings boards, by id. */
const CELLS = {
	light: { type: 'choice', id: 'light', label: 'Time of day', options: TIMES.map((t) => ({ value: t, label: TIME_LABELS[t] ?? t })), value: 'morning' },
	shadows: sw('shadows', 'Shadows'),
	depth: sw('depth', 'Depth shading'),
	ceilings: sw('ceilings', 'Ceilings'),
	solid: sw('solid', 'Solid walls'),
	seethrough: sw('seethrough', 'Transparent walls'),
	levels: { type: 'choice', stepper: true, id: 'levels', label: 'Levels', options: [], disabled: true, note: 'One level' },
	view: sw('view', 'Passthrough'), // on: the room around you; off: the VR world
	toolFan: { type: 'choice', id: 'toolFan', label: 'Tool fan', options: [{ value: 'left', label: 'Left hand' }, { value: 'right', label: 'Right hand' }], value: 'left' },
	sound: { type: 'choice', id: 'sound', label: 'Sound', options: [{ value: 'off', label: 'Off' }, { value: 'effects', label: 'Effects' }], value: 'effects' },
	height: { type: 'choice', id: 'height', label: 'Height', options: HEIGHTS.map((h) => ({ value: h, label: h ? `${h.toFixed(1)} m` : 'Yours' })), value: 0 },
};

/** The board's tabs (the same at both layers), each with rows of cell ids. Camera lens joins General in milestone D. */
export const TABS = [
	{ id: 'view', label: 'View', rows: [['light'], ['shadows', 'depth'], ['ceilings', 'view'], ['seethrough'], ['levels']] },
	{ id: 'walk', label: 'Walk', rows: [['height'], ['solid']] }, // (Turn left the board: 30° stays, the user's call)
	{ id: 'general', label: 'General', rows: [['toolFan'], ['sound']] },
];

/** The boards, one per layer: the title names the layer. */
export const MENUS = {
	dollhouse: { title: 'Settings · Scale model' },
	walk: { title: 'Settings · Inside' },
};

/** Help with controllers: what each stick, trigger, grip and button does at that layer. */
function controlsCards() {
	const either = (btn) => [
		{ kind: 'stick', key: 'Stick', text: '↔ turn   ↕ zoom' },
		{ kind: 'trigger', key: 'Point', text: 'At a room: see where you land' },
		{ kind: 'trigger', key: 'Trigger', text: 'Step inside there' },
		{ kind: 'grip', key: 'Grip', text: 'Hold to move the model' },
		{ kind: 'button', key: btn[0], text: btn[0] === 'A' ? 'Menu' : '' },
		{ kind: 'button', key: btn[1], text: 'Close the menu' },
		{ kind: 'orb', key: 'Wrist', text: 'Touch with the other hand: menu' },
	].filter((r) => r.text);
	const footer = { footer: { key: 'Meta', lines: ['To leave VR at any moment: the Meta button.', 'Or ← Back on your wrist menu.'] } };
	return {
		dollhouse: new ControlsCard('Help: scale model', { left: either('XY'), right: either('AB') }, footer),
		walk: new ControlsCard('Help: inside', {
			left: [
				{ kind: 'stick', key: 'Stick', text: 'Walk where you look' },
				{ kind: 'trigger', key: 'Trigger', text: 'Hold, aim, let go: teleport' },
				{ kind: 'grip', key: 'Grip', text: 'Hold and pull: move' },
				{ kind: 'button', key: 'Y', text: '← Back to the scale model' },
			],
			right: [
				{ kind: 'stick', key: 'Stick ↔', text: 'Turn' },
				{ kind: 'stick', key: 'Stick ↑', text: 'Aim, let go: teleport' },
				{ kind: 'trigger', key: 'Trigger', text: 'Hold, aim, let go: teleport' },
				{ kind: 'grip', key: 'Grip', text: 'Hold and pull: move' },
				{ kind: 'button', key: 'A', text: 'Menu' },
				{ kind: 'button', key: 'B', text: '← Back to the scale model' },
				{ kind: 'orb', key: 'Wrist', text: 'Touch with the other hand: menu' },
			],
		}, { footer: { key: 'Meta', lines: ['To leave VR at any moment: the Meta button.', 'Or ← Back twice on your wrist menu.'] } }),
	};
}

/**
 * Help with bare hands (milestone C0.3: moving with hands comes in C0.4, and
 * this card says so). side: the wrist that wears the menu.
 */
export function handsHelp(side = 'right') {
	const other = side === 'right' ? 'left' : 'right';
	return [
		{ key: 'Wrist', kind: 'orb', text: `Touch your ${side} wrist with your ${other} index: menu` },
		{ small: true, text: 'Press its keys with your fingertip, like real keys.' },
		{ key: 'Move', kind: 'trigger', text: 'Moving with your hands comes in the next update' },
		{ small: true, text: 'Until then: Walk in → and ← Back on your wrist, or pick up the controllers.' },
		{ small: true, text: 'To leave VR at any moment: the Meta button.' },
	];
}

/**
 * Builds the settings boards (one per layer, hidden, in the rig) and the help
 * cards. Returns { menus: { dollhouse: Panel, walk: Panel }, help: { dollhouse,
 * walk: ControlsCard, hands: WelcomeCard } }.
 */
export function buildMenus(rig) {
	const cards = controlsCards();
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
	const help = { dollhouse: cards.dollhouse, walk: cards.walk, hands: new WelcomeCard('Help: bare hands', handsHelp(), { width: 0.5 }) };
	for (const c of Object.values(help)) { c.mesh.visible = false; c.mesh.material.depthTest = false; } // (they live in the wrist menu: js/xr.js)
	return { menus, help };
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
	}
	const walk = xr.menus.walk, doll = xr.menus.dollhouse;
	walk.set('height', { value: xr.personHeight });
	const walls = (xr.model?.layers.walls?.children.length ?? 0) > 0;
	walk.set('solid', walls ? { disabled: false, value: xr.solid } : { disabled: true, note: 'No walls', value: false });
	// Levels: a ‹ › stepper, since a home can have many. "All levels" first,
	// then from the top down, each meaning "show up to this storey"
	// (named as in Sweet Home 3D when the levels have names).
	const storeys = xr.model?.storeys ?? 1;
	const names = xr.model?.storeyNames ?? [];
	const upTo = (i) => `Up to ${names[i] || `level ${i + 1}`}`;
	// (Levels belong to the scale model: greyed out while walking.)
	walk.set('levels', { disabled: true, note: 'Scale model only', options: [] });
	doll.set('levels', storeys < 2 ? { disabled: true, note: 'One level' } : {
		disabled: false,
		options: [{ value: storeys - 1, label: `All levels (${storeys})` }, ...Array.from({ length: storeys - 1 }, (_, k) => storeys - 2 - k).map((i) => ({ value: i, label: upTo(i) }))],
		value: xr.maxStorey ?? storeys - 1,
	});
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
			else xr.goLayer('out', () => xr.end()); // from the scale model, Back leaves VR
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
			updateLabels(xr);
			break;
		}
		case 'light':
			if (value) xr.lighting?.setTime(value);
			else xr.lighting?.nextTime();
			updateLabels(xr);
			break;
		case 'shadows': xr.lighting?.setShadows(!xr.lighting.shadows); updateLabels(xr); break;
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
