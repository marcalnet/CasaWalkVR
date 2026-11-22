// What the headset menus say and do (SPEC.md, "Experience and controls"):
// one menu per mode, each a settings list in tabs (View, Walk, Sound; the same
// tabs in both modes) with the actions below them on every tab, and a
// controls card beside it. ("dollhouse" in the code is the scale model on
// screen.)
// On/off settings are switches, settings with a few values are choices with
// every option visible (one click, no dropdown to open in VR), a list that
// can be long is a dropdown (Levels), see-through is a slider, and actions
// are buttons. Exit VR is always last.
//
// Every cell is defined once (CELLS) and the menus list cell ids by row
// (MENUS), so the same setting looks and behaves the same in both menus.
// updateLabels() shows the current settings in both; menuAction() runs a
// click. Opening, closing and pointing are js/xr-ui.js.

import * as THREE from 'three';
import { Panel, ControlsCard } from './panel.js';
import { TIMES } from './lighting.js';
import { SETTINGS, writeSetting } from './settings.js';

const MENU_WIDTH = 0.62; // metres
const HINT = 'To open this menu: touch a wrist, or press A or X';
const TIME_LABELS = { morning: 'Morning', noon: 'Noon', sunset: 'Sunset', night: 'Night' };
const TURNS = SETTINGS.turn.options; // snap turn, degrees
const HEIGHTS = SETTINGS.height.options; // person height, metres (0 = your own)

const sw = (id, label) => ({ type: 'switch', id, label, value: false });

/** Every cell of every menu, by id. */
const CELLS = {
	walk: { id: 'walk', label: 'Walk in' },
	recentre: { id: 'recentre', label: 'Recentre' },
	photo: { id: 'photo', label: 'Photo', icon: 'camera' },
	light: { type: 'choice', id: 'light', label: 'Time of day', options: TIMES.map((t) => ({ value: t, label: TIME_LABELS[t] ?? t })), value: 'morning' },
	shadows: sw('shadows', 'Shadows'),
	depth: sw('depth', 'Depth shading'),
	ceilings: sw('ceilings', 'Ceilings'),
	solid: sw('solid', 'Solid walls'),
	seethrough: { type: 'slider', id: 'seethrough', label: 'See-through', value: 0, format: (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off') },
	levels: { type: 'dropdown', id: 'levels', label: 'Levels', options: [], disabled: true, note: 'One level' },
	view: sw('view', 'Passthrough'), // on: the room around you; off: the VR world
	sound: { type: 'choice', id: 'sound', label: 'Sound', options: [{ value: 'off', label: 'Off' }, { value: 'effects', label: 'Effects' }], value: 'effects' },
	turn: { type: 'choice', id: 'turn', label: 'Turn', options: TURNS.map((t) => ({ value: t, label: `${t}°` })), value: 30 },
	height: { type: 'choice', id: 'height', label: 'Height', options: HEIGHTS.map((h) => ({ value: h, label: h ? `${h.toFixed(1)} m` : 'Yours' })), value: 0 },
	dollhouse: { id: 'dollhouse', label: 'Back to the scale model' },
	exit: { id: 'exit', label: 'Exit VR', primary: true },
};

/** The tabs (the same in both menus), each with rows of cell ids. A Tools tab joins with the tools (milestone C). */
export const TABS = [
	{ id: 'view', label: 'View', rows: [['light'], ['shadows', 'depth'], ['ceilings', 'view'], ['seethrough'], ['levels']] },
	{ id: 'walk', label: 'Walk', rows: [['turn'], ['height'], ['solid']] },
	{ id: 'sound', label: 'Sound', rows: [['sound']] },
];

/** The menus: a title, the tabs, and the actions shown under every tab. */
export const MENUS = {
	dollhouse: { title: 'Scale model', actions: [['walk', 'recentre', 'photo'], ['exit']] },
	// The two ways out, side by side at the bottom (at the user's request), after Photo.
	walk: { title: 'Walking', actions: [['photo', 'dollhouse', 'exit']] },
};

/** The controls card beside each menu: what each stick, trigger, grip and button does in that mode. */
function controlsCards() {
	const either = (btn) => [
		{ kind: 'stick', key: 'Stick', text: '↔ turn   ↕ zoom' },
		{ kind: 'trigger', key: 'Point', text: 'At a room: see where you land' },
		{ kind: 'trigger', key: 'Trigger', text: 'Step inside there' },
		{ kind: 'grip', key: 'Grip', text: 'Hold to move the model' },
		{ kind: 'button', key: btn[0], text: 'Menu' },
		{ kind: 'button', key: btn[1], text: 'Close the menu' },
		{ kind: 'orb', key: 'Wrist', text: 'Touch with the other hand: menu' },
	];
	// Pictures: the menu's Photo button (the Quest's own screenshot, Meta
	// button + trigger, also sends the trigger here and jumps you).
	const footer = { footer: { key: 'Photo', lines: [
		'Takes a picture of what you see, without the menu.',
		'They wait on the page for when you leave VR.',
	] } };
	return {
		dollhouse: new ControlsCard('Controls: scale model', { left: either('XY'), right: either('AB') }, footer),
		walk: new ControlsCard('Controls: walking', {
			left: [
				{ kind: 'stick', key: 'Stick', text: 'Walk where you look' },
				{ kind: 'trigger', key: 'Trigger', text: 'Hold, aim, let go: teleport' },
				{ kind: 'grip', key: 'Grip', text: 'Hold and pull: move' },
				{ kind: 'button', key: 'X', text: 'Menu' },
				{ kind: 'button', key: 'Y', text: 'Back to the scale model' },
				{ kind: 'orb', key: 'Wrist', text: 'Touch with the other hand: menu' },
			],
			right: [
				{ kind: 'stick', key: 'Stick ↔', text: 'Turn' },
				{ kind: 'stick', key: 'Stick ↑', text: 'Aim, let go: teleport' },
				{ kind: 'trigger', key: 'Trigger', text: 'Hold, aim, let go: teleport' },
				{ kind: 'grip', key: 'Grip', text: 'Hold and pull: move' },
				{ kind: 'button', key: 'A', text: 'Menu' },
				{ kind: 'button', key: 'B', text: 'Back to the scale model' },
				{ kind: 'orb', key: 'Wrist', text: 'Touch with the other hand: menu' },
			],
		}, footer),
	};
}

/**
 * Builds both menus, each with its controls card on its left (out of the
 * main view, turned towards the user), hidden, in the rig.
 * Returns { dollhouse: Panel, walk: Panel }; panel.card is its ControlsCard.
 */
export function buildMenus(rig) {
	const cards = controlsCards();
	const menus = {};
	const cells = (rows) => rows.map((row) => row.map((id) => CELLS[id]));
	for (const [mode, { title, actions }] of Object.entries(MENUS)) {
		const p = new Panel({ tabs: TABS.map((t) => ({ ...t, rows: cells(t.rows) })), actions: cells(actions) }, { title, hint: HINT, width: MENU_WIDTH, pxPerM: 1600 });
		p.mesh.visible = false;
		p.mesh.material.depthTest = false; // never hidden inside a wall
		const card = cards[mode];
		const mw = p.mesh.geometry.parameters.width, cw = card.mesh.geometry.parameters.width;
		card.mesh.position.set(-(mw / 2 + 0.03 + cw / 2 * Math.cos(0.4)), 0, cw / 2 * Math.sin(0.4));
		card.mesh.rotation.y = 0.4;
		p.mesh.add(card.mesh);
		p.card = card;
		rig.add(p.mesh);
		menus[mode] = p;
	}
	return menus;
}

/** Shows the current settings in both menus (switch positions, chosen options, slider, levels). */
export function updateLabels(xr) {
	const ceilings = xr.model?.layers.ceilings.visible ?? true;
	const view = xr.sessionMode === 'vr' ? { disabled: true, note: 'Not available', value: false } : { disabled: false, value: xr.view === 'ar' };
	for (const p of Object.values(xr.menus)) {
		p.set('ceilings', { value: ceilings });
		p.set('view', view);
		p.set('seethrough', { value: xr.seeThroughAmount });
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
	walk.set('turn', { value: xr.snapAngle });
	walk.set('height', { value: xr.personHeight });
	const walls = (xr.model?.layers.walls?.children.length ?? 0) > 0;
	walk.set('solid', walls ? { disabled: false, value: xr.solid } : { disabled: true, note: 'No walls', value: false });
	// Levels: a dropdown, since a home can have many. "All levels" first,
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
 * Runs a menu target: { id } for buttons and switches (a switch flips),
 * { id, value } for a choice's option or a slider's position. A bare id
 * string works too. The menu closes on the actions that take you somewhere
 * (Walk in, Back, Recentre, Photo, Exit VR) and stays open for settings.
 */
export function menuAction(xr, target) {
	const { id, value } = typeof target === 'string' ? { id: target } : target;
	const ui = xr.ui;
	switch (id) {
		case 'walk': ui.closeMenu(); xr.modes.walk.walkIn(); break;
		case 'dollhouse': ui.closeMenu(); xr.setMode('dollhouse'); break;
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
		case 'turn':
			xr.snapAngle = TURNS.includes(value) ? value : TURNS[(TURNS.indexOf(xr.snapAngle) + 1) % TURNS.length];
			writeSetting('turn', xr.snapAngle);
			updateLabels(xr);
			break;
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
			// Steps of 5%, so the end of the track is exactly 0 or 100%.
			const v = Math.round(THREE.MathUtils.clamp(value ?? 0, 0, 1) * 20) / 20;
			if (v === xr.seeThroughAmount) break;
			xr.seeThroughAmount = v;
			writeSetting('seeThrough', v);
			xr.applySeeThrough();
			updateLabels(xr);
			break;
		}
		case 'photo': ui.closeMenu(); xr.photoPending = true; break; // taken in update(), once the menu is gone
		case 'recentre': ui.closeMenu(); xr.modes.dollhouse.measureLift(xr.camera.matrix); xr.modes.dollhouse.recentre(); break;
		case 'exit': ui.closeMenu(); xr.end(); break;
	}
}
