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
	cell: '#ffffff', edge: '#d3d9df', text: '#1d2329', soft: '#5d6873', onDark: '#ffffff', // (onDark: text and lines over the room or the dark, e.g. the ring round the orb)
	hover: '#e3edfb', hoverEdge: '#3d6fd8', accent: '#3d6fd8', accentText: '#ffffff',
	segment: '#eef1f4', track: '#c4ccd4',
	primary: '#e07a1f',
	off: '#e2e6ea', offText: '#9aa3ac',
	tab: '#dde3e9', tabText: '#5d6873', tabActive: '#ffffff', tabActiveText: '#1d2329',
};

/** The orange accent, the thing to press (the edge of the note cards and labels, the tools' buttons). (The other badge colours went with the controls and welcome cards.) */
export const BADGE = {
	orb: { fill: '#d9822b', text: '#fff' },
};

/** A tool's empty place in the fan, while its tool is near enough to go back (js/tool-fan.js, the magnet): a thin outline, the orange accent at 40%. */
export const TOOL_OUTLINE = { color: '#e07a1f', opacity: 0.4, width: 0.0025 }; // (2.5 mm, depth-tested; once also the tools' control-part rings, gone with the simpler tools: build-215 asks C10)

/** The marker's one ink (the user's simpler tools; build-215 asks C10 §2): a dark warm-grey graphite, clearly not black (the text's #1d2329). */
export const MARKER = { ink: '#3A3F45' };

/** The real controllers (js/controller-model.js): the held tool's buttons glow faintly in the orange of the thing to press. */
export const CONTROLLER = { glow: COLOURS.primary };

/** The street camera's framing guide (js/framing-guide.js): its outline, red, never a fill (a tint would change the colours you judge the photo by). */
export const FRAME = { line: '#d64541', opacity: 0.7 };

/** The pause between places (js/pause.js; the next-build asks, "Tip screens"): its dark (black now; grey under a future light theme) and its floor ring's line. */
export const VOID = { color: 0x000000, line: 0xffffff };

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
	caption: { text: 'Scale', x: 256, y: 52, px: 38, weight: 600, colour: 'rgba(40,30,15,0.75)' },
	ratio: { x: 256, y: 122, px: 74, weight: 700, colour: '#2a1e0c' },
	fallback: '#d8c9a3', // plain plate if the artwork can't be loaded
};

/**
 * The wall portal's rim (js/portal.js): warm off-white (the ceiling white),
 * about 40%, no signal colour. Draft until the Graphic Designer's colour table.
 */
export const PORTAL = { rim: '#f4efe6', rimStrength: 0.55 }; // the portal's soft frame

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
 * The main hand's keys (build 215's C8; the wrist menu of milestone C0.3 until then), also the plinth's doors and the options row.
 * Icons come from assets/ui/wrist-keys.png (a row of dark icons over a row of
 * white ones, 128 px each: Settings, Help, In, Back); words are drawn by code.
 */
export const WRIST = {
	icons: 'assets/ui/wrist-keys.png', // (also the plinth's doors: js/keys.js)
	iconSize: 128, // pixels per icon in the atlas
	iconOrder: ['settings', 'help', 'in', 'back'],
	key: 0.07, // key face, metres (square): 7 cm, well above the 32 mm floor for icon plus text (HB §3)
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
