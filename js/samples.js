// The sample homes the page offers ("Try a sample home"), as data: adding a
// home is one more entry here, its file and picture in examples/ (made by its
// generator in scripts/), and nothing else. They are original homes made for
// CasaWalk, served by the app itself (same origin, kept offline by sw.js), and
// they double as test homes (SPEC.md, "Sample homes"). Pure: no page code.
//
// Each: id (the ?sample= link), name, line (what it shows), file, picture,
// size (as shown), credit (for a home "after" a famous one; '' for our own).

export const SAMPLES = [
	{
		id: 'pond-house',
		name: 'Pond House',
		line: 'A house by a pond: 2 levels, a floating stair, a deck, a terrace',
		file: 'examples/pond-house.sh3d',
		picture: 'examples/pond-house.jpg',
		size: '34 kB',
		credit: '',
	},
	{
		id: 'urban-flat',
		name: 'Urban Flat',
		line: 'A one-bedroom corner flat: one open room, balcony, glass on three sides',
		file: 'examples/urban-flat.sh3d',
		picture: 'examples/urban-flat.jpg',
		size: '47 kB',
		credit: '',
	},
];

/** The sample for a ?sample= value, or null (only listed ids: the link never names a file). */
export function sampleById(id) {
	return SAMPLES.find((s) => s.id === id) ?? null;
}
