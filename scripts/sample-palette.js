// The sample homes' colour palettes: one table, every colour in the homes comes from here.
// Designer's draft, 22 Nov 2026; the user chose "Clay and sage" (claySage) (swatches
// drawn by the designer). Three options; ACTIVE picks one (or PALETTE=<key> on the command line).
// Shared by every sample home's generator (scripts/make-*.js).
// Change a hex and re-run a generator: walls, floors, furniture follow.
//
// Built from research and paint-maker trend cards: colours are taken as RGB only, never with paint names.
// Rules followed in all three: warm whites, never a blue-white or grey; a 60-30-10 balance (light
// shell, woods and textiles, then a small accent); muted rather than saturated accents; one feature
// wall at most; no pure white or pure black (under the app's Lambert light pure white glares and
// pure black loses its shape); woods kept slightly grey so the sunset sun doesn't turn them orange.
// Plants, glass and mirror stay outside the palette.

const COMMON = {
	green:  { name: 'Plant green',  hex: '#566E4B', use: 'plants (natural)' },
	glass:  { name: 'Glass',        hex: '#C4D6DE', use: 'windows, the shower screen (30% opaque)', opacity: 0.3 },
	mirror: { name: 'Mirror',       hex: '#C5CDD2', use: 'mirrors' },
	smoke:  { name: 'Smoked glass', hex: '#3E3F42', use: 'the turntable lid (50% opaque)', opacity: 0.5 },
	opal:   { name: 'Opal glass',   hex: '#F5F1E8', use: 'lamp globes' },
	// Outdoor and structure (Pond House and the masterpieces): natural, muted, shared by all options
	masonry:    { name: 'Warm stone',  hex: '#9C8D7B', use: 'stone walls, the core, piers, ledges, boulders' },
	concrete:   { name: 'Warm concrete', hex: '#D6CBB5', use: 'terrace parapets, planters' },
	paving:     { name: 'Paving',      hex: '#BDB3A3', use: 'terraces, paths' },
	paleStone:  { name: 'Pale stone floor', hex: '#E2DACB', use: 'the pavilion floor' },
	steelWhite: { name: 'White steel', hex: '#EEEBE4', use: 'columns, the glass pavilion frame' },
	water:      { name: 'Water',       hex: '#5F7F86', use: 'the pond' },
	grass:      { name: 'Grass',       hex: '#84927A', use: 'the ground' },
	foliage:    { name: 'Foliage',     hex: '#3F5A3C', use: 'tree crowns (dark)' },
	bark:       { name: 'Bark',        hex: '#5A4636', use: 'tree trunks' },
};

export const PALETTES = {
	// 1. Warm minimal: Scandinavian and Rams-like. Almost all light, pale oak, one quiet clay wall.
	warmMinimal: {
		title: 'Warm minimal', idea: 'Scandinavian calm: warm whites, pale oak, oatmeal, a quiet clay wall',
		walls:      { name: 'Warm white',     hex: '#EDE8DF', use: 'inner walls' },
		feature:    { name: 'Pale clay',      hex: '#DCCBB8', use: 'the TV wall and the bedroom wall' },
		ceiling:    { name: 'Paper',          hex: '#F4F1EB', use: 'ceilings, porcelain, inner frames' },
		putty:      { name: 'Putty',          hex: '#D2CBBF', use: 'outer walls, bathroom, landing' },
		floor:      { name: 'Pale oak floor', hex: '#C2AE95', use: 'wooden floors' },
		oak:        { name: 'Pale oak',       hex: '#AE9476', use: 'built-ins, shelving, chair frames' },
		walnut:     { name: 'Walnut',         hex: '#614836', use: 'tables, sideboard, bed' },
		oatmeal:    { name: 'Oatmeal',        hex: '#CBC1AE', use: 'sofa, armchairs' },
		wool:       { name: 'Wool',           hex: '#E0D9CC', use: 'rugs, blankets' },
		linen:      { name: 'Linen',          hex: '#E8E2D7', use: 'bedding, shades' },
		graphite:   { name: 'Graphite',       hex: '#323335', use: 'TV, metal, frames' },
		leather:    { name: 'Dark leather',   hex: '#3D2F27', use: 'lounge chair, stools' },
		stone:      { name: 'Stone',          hex: '#A8A298', use: 'worktops, shower tray, pots' },
		olive:      { name: 'Sage',           hex: '#8E9682', use: 'accent 1: throw, mat, reading chair' },
		terracotta: { name: 'Clay',           hex: '#B37A5E', use: 'accent 2: a cushion, a vase' },
		brass:      { name: 'Brushed brass',  hex: '#AA8C5C', use: 'pendants, handles' },
		...COMMON,
	},
	// 2. Clay and sage: the trend board's warm off-whites, soft clay and sage, with teak-toned wood.
	claySage: {
		title: 'Clay and sage', idea: 'The trend cards: warm off-white, soft clay, sage; pale ash and white oak, smoked oak sparingly; a sage feature wall',
		walls:      { name: 'Warm off-white', hex: '#EAE3D8', use: 'inner walls' },
		feature:    { name: 'Soft sage',      hex: '#A9AF9C', use: 'the TV wall and the bedroom wall' },
		ceiling:    { name: 'Paper',          hex: '#F3EFE8', use: 'ceilings, porcelain, inner frames' },
		putty:      { name: 'Clay plaster',   hex: '#D3C5B4', use: 'outer walls, bathroom, landing' },
		floor:      { name: 'White oak floor',hex: '#D3C6B1', use: 'wooden floors (pale, slightly greyed)' },
		oak:        { name: 'Pale ash',       hex: '#C2B49D', use: 'the main wood: shelving, tables, the bed, chair frames, built-ins' },
		walnut:     { name: 'Smoked oak',     hex: '#6F675D', use: 'sparingly, for contrast: sideboard, coffee table, nightstands, the lounge chair shells' },
		oatmeal:    { name: 'Oatmeal',        hex: '#C6B9A3', use: 'sofa, armchairs' },
		wool:       { name: 'Wool',           hex: '#DED4C4', use: 'rugs, blankets' },
		linen:      { name: 'Linen',          hex: '#E7DFD2', use: 'bedding, shades' },
		graphite:   { name: 'Warm graphite',  hex: '#34322F', use: 'TV, metal, frames' },
		leather:    { name: 'Dark leather',   hex: '#3B2C23', use: 'lounge chair, stools' },
		stone:      { name: 'Stone',          hex: '#A49B8E', use: 'worktops, shower tray, pots' },
		olive:      { name: 'Sage green',     hex: '#7C8669', use: 'accent 1: throw, mat, reading chair' },
		terracotta: { name: 'Terracotta',     hex: '#A9603F', use: 'accent 2: a cushion, a vase' },
		brass:      { name: 'Brushed brass',  hex: '#A98A58', use: 'pendants, handles' },
		...COMMON,
	},
	// 3. Mid-century deep: walnut and teak with a deep teal wall, mustard and olive; richer, moodier.
	midCenturyDeep: {
		title: 'Mid-century deep', idea: 'Walnut and teak, a deep teal wall, mustard and olive accents; richer, moodier',
		walls:      { name: 'Cream',          hex: '#ECE4D5', use: 'inner walls' },
		feature:    { name: 'Deep teal',      hex: '#3F5D5B', use: 'the TV wall and the bedroom wall' },
		ceiling:    { name: 'Paper',          hex: '#F3EFE7', use: 'ceilings, porcelain, inner frames' },
		putty:      { name: 'Sand',           hex: '#D4C7B2', use: 'outer walls, bathroom, landing' },
		floor:      { name: 'Teak floor',     hex: '#A88A6A', use: 'wooden floors' },
		oak:        { name: 'Teak',           hex: '#94704F', use: 'built-ins, shelving, chair frames' },
		walnut:     { name: 'Dark walnut',    hex: '#4E3A2C', use: 'tables, sideboard, bed' },
		oatmeal:    { name: 'Camel',          hex: '#B9A07E', use: 'sofa, armchairs' },
		wool:       { name: 'Cream wool',     hex: '#DED3BF', use: 'rugs, blankets' },
		linen:      { name: 'Linen',          hex: '#E6DED0', use: 'bedding, shades' },
		graphite:   { name: 'Charcoal',       hex: '#2E3030', use: 'TV, metal, frames' },
		leather:    { name: 'Cognac leather', hex: '#6B4430', use: 'lounge chair, stools' },
		stone:      { name: 'Warm stone',     hex: '#A09684', use: 'worktops, shower tray, pots' },
		olive:      { name: 'Olive',          hex: '#6E6F45', use: 'accent 1: throw, mat, reading chair' },
		terracotta: { name: 'Mustard',        hex: '#B98E3A', use: 'accent 2: a cushion, a vase' },
		brass:      { name: 'Brass',          hex: '#A6854F', use: 'pendants, handles' },
		...COMMON,
	},
};

export const ACTIVE = process.env.PALETTE || 'claySage'; // the user's choice
export const PALETTE = PALETTES[ACTIVE];
if (!PALETTE) throw new Error(`Unknown palette ${ACTIVE}: ${Object.keys(PALETTES).join(', ')}`);

/** [r, g, b] in 0..1 for an OBJ material, plus opacity when the colour has one. */
export function kd(role) {
	const p = PALETTE[role];
	const n = parseInt(p.hex.slice(1), 16);
	const rgb = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => +v.toFixed(3));
	return p.opacity != null ? [...rgb, p.opacity] : rgb;
}

/** An ARGB string for Home.xml (walls, floors, ceilings). */
export function argb(role) {
	return 'FF' + PALETTE[role].hex.slice(1).toUpperCase();
}

/** The OBJ material table for a generator: every palette role. */
export function materials() {
	return Object.fromEntries(Object.keys(PALETTE).filter((k) => PALETTE[k]?.hex).map((k) => [k, kd(k)]));
}
