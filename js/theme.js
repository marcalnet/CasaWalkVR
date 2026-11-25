// The look of everything drawn by code in the headset: fonts, colours and
// corner radii of the menus, cards, labels and the scale plate (SPEC.md,
// "Replaceable graphics"). The layouts and artwork are drafts the designer
// will redesign: change them here (and the texture files in assets/ui/),
// not in the drawing code.

/** Font family for all text drawn on canvases (system UI fonts). */
export const FONT = '-apple-system, "Segoe UI", Roboto, sans-serif';

/** Menu (settings list) colours. */
export const COLOURS = {
	panel: 'rgba(233,237,241,0.96)',
	cell: '#ffffff', edge: '#d3d9df', text: '#1d2329', soft: '#5d6873',
	hover: '#e3edfb', hoverEdge: '#3d6fd8', accent: '#3d6fd8', accentText: '#ffffff',
	segment: '#eef1f4', track: '#c4ccd4',
	primary: '#e07a1f', primaryHover: '#b85f12', primaryText: '#ffffff',
	off: '#e2e6ea', offText: '#9aa3ac',
	tab: '#dde3e9', tabText: '#5d6873', tabActive: '#ffffff', tabActiveText: '#1d2329',
};

/** Badges on the controls card and the welcome card: one colour per kind of control. */
export const BADGE = {
	stick: { fill: '#5d6873', text: '#fff' },
	shot: { fill: '#7a4fd0', text: '#fff' },
	trigger: { fill: '#3d6fd8', text: '#fff' },
	grip: { fill: '#2f9e6a', text: '#fff' },
	button: { fill: '#1d2329', text: '#fff' },
	orb: { fill: '#d9822b', text: '#fff' }, // the orange accent: the thing to press
};

/** Corner radii, in canvas pixels. */
export const RADIUS = { panel: 36, cell: 20, card: 48, badge: 14 };

/** Floating labels (a room's name above the landing marker). */
export const LABEL = { fill: 'rgba(255,255,255,0.94)', edge: BADGE.orb.fill, text: COLOURS.text, weight: 600 };

/**
 * The scale plate on the plinth: the ratio is drawn by code on top of the
 * plate's artwork (assets/ui/scale-plate.png), inside its text area.
 */
export const PLATE = {
	image: 'assets/ui/scale-plate.png',
	size: [512, 192], // pixels (the artwork's size)
	metres: [0.2, 0.075], // how big it is on the plinth
	caption: { text: 'Scale', x: 256, y: 52, px: 30, weight: 600, colour: 'rgba(40,30,15,0.75)' },
	ratio: { x: 256, y: 122, px: 74, weight: 700, colour: '#2a1e0c' },
	fallback: '#d8c9a3', // plain plate if the artwork can't be loaded
};

/**
 * The wall portal's rim (js/portal.js): warm off-white (the ceiling white),
 * about 40%, no signal colour. Draft until the Graphic Designer's colour table.
 */
export const PORTAL = { rim: '#f4efe6', rimStrength: 0.4 };

/**
 * Bare hands (milestone C0.2): frosted paper white, translucent, with the
 * index fingertip in the orange accent (the thing that presses). In
 * passthrough only a faint outline and the fingertip show: your real hand is
 * already there.
 */
export const HAND = {
	fill: '#f4f1ea', // the hand
	opacity: 0.55, // VR view
	passthroughOpacity: 0.15, // passthrough view
	tip: COLOURS.accent, // the fingertip "pen": blue, the thing that presses (orange is the thing to press)
	tipIdle: 0.35, // its opacity when no key is near
	fade: 0.15, // seconds to fade out when tracking is lost
	ready: '#e07a1f', // a bare hand's pointing ray at the scale model (orange: a gesture you can do now)
	// How hands are drawn: 'generic' (the WebXR generic hand model, js/hand-model.js) or
	// 'capsules' (C0.2's capsules, js/hands.js: also the fallback while it loads or if it can't).
	model: 'generic',
};

/** Touch keys on panels: the ring under a fingertip, and the controller's tip nub. */
export const KEY = {
	ring: COLOURS.accent, // the hover ring under the fingertip (blue, like the fingertip)
	nub: '#c9ced4', // a controller's tip nub
	nubEnd: COLOURS.accent, // its blue end (like the fingertip)
};

/**
 * Doors between the layers (page, scale model, inside; SPEC.md C0, "Layers"):
 * blue means moving between layers, everywhere. The same blue as the page's
 * Enter VR button (--xr in index.html): change both together.
 */
export const DOOR = { fill: '#2f5fd0', outline: '#2f5fd0', text: '#ffffff', soft: '#5d6873' };

/**
 * The wrist menu (milestone C0.3): four keys in a cross around the orb.
 * Icons come from assets/ui/wrist-keys.png (a row of dark icons over a row of
 * white ones, 128 px each: Settings, Help, In, Back); words are drawn by code.
 */
export const WRIST = {
	icons: 'assets/ui/wrist-keys.png', // (also the plinth's doors: js/keys.js)
	iconSize: 128, // pixels per icon in the atlas
	iconOrder: ['settings', 'help', 'in', 'back'],
	key: 0.07, // key face, metres (square): 7 cm, well above the 32 mm floor for icon plus text (HB §3)
	// The keys sit on an arc over the upper outer side of the orb, like a quarter rainbow (the design of 24 Nov, item 5):
	// the left side and the underside of the orb stay clear for the other index. Angles in degrees from the orb's right, as seen,
	// counter-clockwise: ← Back just above the orb, then Settings (11 cm long), and Walk in → to its right (inside: the flat Inside plate there); about 2.8 cm between keys at 14 cm: about 1.8 cm between keys.
	arc: { radius: 0.14, angles: { left: 100, up: 50, right: 0 } },
	settingsW: 0.11, // the middle key is longer: Settings, and help (7 cm high like the others)
	raise: 0.006, // a key's face above its base
	face: '#ffffff', edge: '#d3d9df', text: COLOURS.text, flat: COLOURS.off, flatText: COLOURS.offText,
	labelFont: '"Kalam", "Bradley Hand", cursive', // hand-lettered labels (vendor/kalam)
};

/** The guide beside the menu (C0.4): how to move, as pictures and a line each. */
export const GUIDE = {
	sheets: 'assets/ui/guide-sheets.png', // 4 rows (walk hands, walk controllers, scale hands, scale controllers) x 4 frames
	frame: 256, // pixels per frame in the sheet
	edge: '#d8d3c6', text: COLOURS.text, soft: COLOURS.soft, // (drawn on the board's How to move tab: js/guide.js)
	font: '"Kalam", "Bradley Hand", cursive',
};

/** The settings board (C0.3): its artwork and where it opens. */
export const BOARD = {
	image: 'assets/ui/board.png', // aluminium frame and paper, under the settings drawn by code
	width: 0.52, // metres (the wings are 0.40 and 0.34 wide: js/xr-menus.js WING_SIZE)
};
