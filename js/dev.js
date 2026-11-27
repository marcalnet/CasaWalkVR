// The development switches, in one place (code audit, A4). Each is a word in
// the page address; none is in the menus or the settings, and a user never
// needs one:
//   ?test     the browser tests: window.__casawalk (the test hooks) exists,
//             and the drawing buffer is kept so screenshots can be read
//   ?hands    the bare-hand tuning card over each wrist (js/hand-readout.js)
//   ?stats    fps and draw calls in the headset (js/frame-stats.js)
//   ?nomerge  skip the geometry merge (tells merge bugs from loader bugs)
//   ?nofold   merge, but keep each plain colour its own material (stage B3's fold off: tells fold bugs apart)
//   ?sw       the service worker on plain http (local testing; https always has it)
//   ?worker   OBJ models read in a worker (js/obj-worker.js): off until measured on a Quest 2
//   ?tips     a pause on every move between places, cycling through every tip, never retiring one (js/pause.js)
//   ?tipwait  a tip waits for a press ("Pinch to go on"), with a Skip tips key: the draft the user tries (build 215's C9, js/pause.js)
// Pure: devFlags() reads any address, so it runs in Node tests.

/** The switches in a page address's search part ('?hands&stats', ...). */
export function devFlags(search = '') {
	const p = new URLSearchParams(search);
	return { test: p.has('test'), hands: p.has('hands'), stats: p.has('stats'), nomerge: p.has('nomerge'), nofold: p.has('nofold'), sw: p.has('sw'), worker: p.has('worker'), tips: p.has('tips'), tipwait: p.has('tipwait') };
}

/** The switches of this page (all off outside a browser). */
export const DEV = devFlags(globalThis.location?.search ?? '');
