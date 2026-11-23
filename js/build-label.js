// Which build is running (js/version.js), as people read it, and whether a
// newer one is live (the page asks the site for js/version.js, never from
// the cache). Pure formatting here; the page shows it (js/main.js).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Build 213 · 23 Nov 2026 14:05" (the stamp's time, in the viewer's own time zone). */
export function buildLabel(build, tz = undefined) {
	const d = new Date(build?.date ?? NaN);
	if (!build || Number.isNaN(d.getTime())) return '';
	const p = (v) => String(v).padStart(2, '0');
	const get = tz === 'UTC'
		? { day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), h: d.getUTCHours(), m: d.getUTCMinutes() }
		: { day: d.getDate(), month: d.getMonth(), year: d.getFullYear(), h: d.getHours(), m: d.getMinutes() };
	return `Build ${build.number} · ${get.day} ${MONTHS[get.month]} ${get.year} ${p(get.h)}:${p(get.m)}`;
}

/** The build number in the text of a js/version.js, or null. */
export function buildNumberIn(text) {
	const m = /number:\s*(\d+)/.exec(text ?? '');
	return m ? Number(m[1]) : null;
}
