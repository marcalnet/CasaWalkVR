// App configuration. Safe to commit: only public keys go here (the Google API
// key below works only from this site's address). Never put a secret here.
export const CONFIG = {
	// Google Drive links (js/links.js): Google only serves shared files to other
	// websites through its Drive API, which needs an API key. Public by design,
	// in Google Cloud, limit it to the "Google Drive
	// API" and to this site's address (README, "Google Drive links"). Empty:
	// Google Drive links explain how to open the file another way.
	// (Project "sweet-home-vr"; key limited to https://www.casawalkvr.com/* and the Drive API.)
	googleApiKey: 'AIzaSyDsgM_iWjpLeiLBpJIJaoZSBQ6VjtPbSNo',

	// Warn (but still load) above this many triangles; Quest 2 is a phone GPU.
	triangleWarning: 1_500_000,

	// Refuse, before building, a home counted above this many triangles, in the
	// headset's browser only (a computer opens it): over it a Quest 2's tab runs
	// out of memory (measured: 2-3 million already strain it). To
	// tune on the Quest.
	triangleLimit: 6_000_000,

	// What a model may cost to draw on a Quest 2 (code audit, A3; checked by
	// tests/budget.test.js on the sample, example and heavy homes). Draw calls
	// for the model alone: the gallery, the interface and the hands take about
	// 50 more, within the ~150 a Quest 2 keeps up with.
	budget: { drawCalls: 100, triangles: 1_000_000 },

	// Largest file a link may download, in MB (a wrong or hostile link must
	// not be able to fill the headset's memory).
	maxDownloadMB: 500,

	// Textures larger than this (pixels on the longer side) are shrunk after
	// loading: a few 4K images are enough to exhaust a Quest 2's memory.
	maxTextureSize: 2048,

	// Send to my Quest, for a model opened from a file on this computer: the
	// service that introduces the computer and the headset to each other
	// (js/pairing.js). Only connection details pass through it; the model goes
	// directly between the two devices, encrypted. The default is PeerJS's free
	// public server (https://peerjs.com/server/cloud). To use your own
	// PeerServer, change it here and in connect-src in index.html.
	pairing: { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' },

	// Default unit for OBJ files without a unit override ('auto' | 'cm' | 'm' | 'mm' | 'in').
	defaultObjUnits: 'auto',
};
