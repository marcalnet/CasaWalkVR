// The sample homes the page offers ("Try a sample home"), as data: adding a
// home is one more entry here, its file and picture in examples/ (made by its
// generator in scripts/), and nothing else. They are original homes made for
// CasaWalk, served by the app itself (same origin, kept offline by sw.js), and
// they double as test homes (SPEC.md, "Sample homes"). Pure: no page code.
//
// Each: id (the ?sample= link), name, line (what it shows), file, picture,
// size (as shown), credit (for a home "after" a famous one; '' for our own),
// aliases (old ?sample= ids that still open it, so old links never break).

export const SAMPLES = [
	{
		id: 'pond-house',
		name: 'Pond House',
		line: 'A house by a pond: 2 levels, a floating stair, a deck, a terrace',
		file: 'examples/pond-house.sh3d',
		picture: 'examples/pond-house.jpg',
		size: '38 kB',
		credit: '',
	},
	{
		id: 'apartment',
		name: 'Apartment',
		line: 'A one-bedroom corner flat: one open room, balcony, glass on three sides',
		file: 'examples/apartment.sh3d',
		picture: 'examples/apartment.jpg',
		size: '47 kB',
		credit: '',
		aliases: ['urban-flat'], // (its name until 23 Nov 2026)
	},
];

/** The sample for a ?sample= value, or null (only listed ids: the link never names a file). */
export function sampleById(id) {
	return SAMPLES.find((s) => s.id === id || s.aliases?.includes(id)) ?? null;
}
