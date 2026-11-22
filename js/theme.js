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
 * Bare hands (milestone C0.2): frosted paper white, translucent, with the
 * index fingertip in the orange accent (the thing that presses). In
 * passthrough only a faint outline and the fingertip show: your real hand is
 * already there.
 */
export const HAND = {
	fill: '#f4f1ea', // the hand
	opacity: 0.55, // VR view
	passthroughOpacity: 0.15, // passthrough view
	tip: BADGE.orb.fill, // the fingertip "pen"
	tipIdle: 0.35, // its opacity when no key is near
	fade: 0.15, // seconds to fade out when tracking is lost
};

/** Touch keys on panels: the ring under a fingertip, and the controller's tip nub. */
export const KEY = {
	ring: BADGE.orb.fill, // the hover ring under the fingertip
	nub: '#c9ced4', // a controller's tip nub
	nubEnd: BADGE.orb.fill, // its orange end
};
