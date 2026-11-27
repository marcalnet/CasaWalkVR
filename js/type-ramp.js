// Text sizes in the headset, in degrees (build 215's C5; the UX handbook's
// type ramp, §2). A word's size is the angle its capital letters fill at the
// distance it is normally read from: canvas pixels mean nothing on their own,
// which is how the sizes before build 216 came out too small.
//
//   label    ≥ 0.6°   captions, a key's second line, small labels
//   body     ≥ 0.7°   running text (a note's line: 0.9° where the spec asks)
//   heading  ≥ 1.1°   titles
//   kalam    ≥ 1.4°   the hand-lettered words (Kalam): keys, tool tags, the photo note's title
//
// tests/type-ramp.test.js lists every drawn text with its size and fails any
// under its line. Pure: runs in Node tests.

export const RAMP = { label: 0.6, body: 0.7, heading: 1.1, kalam: 1.4 };

/**
 * Cap height over font size (the "px" of a canvas font), measured in
 * Chromium (27 Nov 2026): Kalam bold 0.745 (vendor/kalam), the interface font
 * 0.72 (Roboto, the Quest Browser's).
 */
export const CAP = { ui: 0.72, kalam: 0.745 };

const DEG = 180 / Math.PI;

/** The cap height of a font size px (canvas pixels) in degrees: family 'ui' or 'kalam', mPerPx metres per canvas pixel, dist the distance it is read from (m). */
export function capDeg(px, family, mPerPx, dist) {
	return Math.atan((CAP[family] * px * mPerPx) / dist) * DEG;
}

/** The font size (canvas pixels, rounded up) whose capitals fill deg degrees. */
export function pxFor(deg, family, mPerPx, dist) {
	return Math.ceil((Math.tan(deg / DEG) * dist) / (CAP[family] * mPerPx));
}

/**
 * Kalam bold's advance widths (em) for the printable ASCII characters, space
 * to "~", measured in Chromium from vendor/kalam (27 Nov 2026): a word's width
 * known before the font has loaded, the same in Node (the level keys' width:
 * js/xr-dollhouse.js). Kerning is left out, so a word comes out a little wide.
 */
const KALAM_ADVANCE = '0.385,0.478,0.484,0.78,0.592,0.991,0.786,0.22,0.478,0.53,0.375,0.6,0.262,0.531,0.237,0.282,0.513,0.302,0.583,0.547,0.545,0.506,0.542,0.472,0.59,0.506,0.246,0.306,0.475,0.672,0.616,0.608,1.078,0.63,0.624,0.617,0.666,0.551,0.542,0.597,0.651,0.309,0.486,0.602,0.546,0.756,0.631,0.619,0.549,0.659,0.601,0.552,0.544,0.595,0.532,0.785,0.585,0.561,0.646,0.463,0.6,0.521,0.422,0.619,0.258,0.51,0.567,0.489,0.539,0.488,0.435,0.481,0.563,0.26,0.26,0.493,0.266,0.819,0.554,0.456,0.538,0.519,0.362,0.467,0.451,0.486,0.422,0.71,0.474,0.52,0.48,0.462,0.456,0.626,0.586'.split(',').map(Number);

/** A word's width in Kalam bold (em); a character outside ASCII counts as a wide one (0.8 em). */
export function kalamEm(text) {
	let em = 0;
	for (const ch of String(text)) { const c = ch.codePointAt(0) - 32; em += c >= 0 && c < KALAM_ADVANCE.length ? KALAM_ADVANCE[c] : 0.8; }
	return em;
}
