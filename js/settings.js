// Remembered settings: one list of every key, its default and the values it
// may take, so a stored value always means the same thing on the 2D page and
// in the headset. Stored in localStorage as plain strings (as before this
// module existed, so everyone's saved settings keep working):
//   flag     '1' on, '0' off; anything else (or nothing) is the default
//   options  one of a few values (numbers are stored as their text)
//   range    a number in (0, 1]; anything else is the default
// readSetting() and writeSetting() never throw: in a private window, or with
// storage switched off, the defaults are used and nothing is remembered.
// Each setting has a scope (the shared-headset principle, SPEC.md "Design
// principles"): 'remembered' (the default: what you see, the home's light and
// view, and the main hand) or 'session' (who you are: your height; never
// stored, every Enter VR and New visitor starts from the default).
// (Recent files and the last link live in storage.js: they are data, not settings.)

import { TIMES } from './lighting.js';

export const SETTINGS = {
	// 2D page and headset
	// (The light used to be saved as 'casawalk.time' on every visit, chosen or not.
	// A new key let everyone start from the morning default once.)
	light: { key: 'casawalk.light', options: TIMES, fallback: null }, // null: lighting.js's own default
	shadows: { key: 'casawalk.shadows', flag: true, fallback: false },
	depth: { key: 'casawalk.depth', flag: true, fallback: false },
	// Headset
	view: { key: 'casawalk.view', options: ['vr', 'ar'], fallback: 'vr' }, // VR or passthrough, in an AR session
	// (Turn and its 'casawalk.snapAngle' setting left the board in Nov 2026: snap turns are 30°. A stored value is simply never read.)
	height: { key: 'casawalk.height', options: [0, 1.4, 1.7, 2.0], fallback: 0, scope: 'session' }, // person height, metres (0 = your own); per session: the next person is not the last
	// (The scale figure and its 'casawalk.figure' switch were removed in Nov 2026:
	// the landing markers show a person's size. A stored value is simply never read.)
	// (Solid walls and its 'casawalk.solidWalls' setting went on 26 Nov 2026: the stick walk always stops at walls,
	// your real body never. A stored value is simply never read.)
	seeThrough: { key: 'casawalk.seeThrough', range: true, fallback: 0 }, // 0 = as modelled, 1 = glass house
	mainHand: { key: 'casawalk.mainHand', options: ['right', 'left'], fallback: 'right' }, // the hand that wears the wrist menu and takes tools from the fan (the fan floats over the other)
	sound: { key: 'casawalk.sound', options: ['off', 'effects', 'all'], fallback: 'all' }, // all: effects and the ambience (milestone H)
	// (The guide's 'casawalk.walkGuide' setting went in Nov 2026: nothing read it. A stored value is simply never read.)
	cameraLens: { key: 'casawalk.cameraLens', options: [24, 50, 75], fallback: 24 }, // the street camera's lens, mm (milestone D; three since build 215's B3: a stored 28 or 35 reads as the fallback)
	markerColour: { key: 'casawalk.markerColour', options: ['black', 'blue', 'green', 'red'], fallback: 'black' }, // the marker's ink (its cap's dial)
	meterUnits: { key: 'casawalk.meterUnits', options: ['cm', 'ftin'], fallback: null }, // the laser meter's units (null: from the browser's region, js/measure.js defaultUnits)
	// (The first-time lessons' and the pinch hand's 'casawalk.welcome.*' keys went on 26 Nov 2026: tips are per VR
	// session and nothing about them is stored, js/pause.js. A stored value is simply never read.)
	// (The tools' first-time show and its 'casawalk.toolsIntro' went on 26 Nov 2026: the tools always float over the left hand.)
};

/** The value a stored string stands for (null or undefined: nothing stored). */
export function decode(spec, raw) {
	if (raw == null) return spec.fallback;
	if (spec.flag) return raw === '1' ? true : raw === '0' ? false : spec.fallback;
	if (spec.range) {
		const v = Number(raw);
		return v > 0 && v <= 1 ? v : spec.fallback;
	}
	const numeric = typeof spec.options[0] === 'number';
	const v = numeric ? Number(raw) : raw;
	return spec.options.includes(v) ? v : spec.fallback;
}

/** The string stored for a value. */
export function encode(spec, value) {
	if (spec.flag) return value ? '1' : '0';
	return String(value);
}

/** A remembered setting by name (a key of SETTINGS), or its default. */
export function readSetting(name) {
	const spec = SETTINGS[name];
	if (spec.scope === 'session') return spec.fallback; // (a session's value lives in the app, never in storage)
	let raw = null;
	try { raw = globalThis.localStorage?.getItem(spec.key) ?? null; } catch { /* private mode */ }
	return decode(spec, raw);
}

/** Remembers a setting by name. */
export function writeSetting(name, value) {
	const spec = SETTINGS[name];
	if (spec.scope === 'session') return;
	try { globalThis.localStorage?.setItem(spec.key, encode(spec, value)); } catch { /* private mode */ }
}
