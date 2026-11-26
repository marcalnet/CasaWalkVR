// The OBJ worker (heavy homes, step 5; on only with ?worker until it is
// measured on a Quest 2, js/dev.js): reads, prepares, parses and simplifies an
// OBJ off the page's thread, so the page, or the view in VR, never freezes on
// a heavy model. Its geometry goes back as transferred arrays (not copied);
// the page makes the materials (js/obj-core.js buildObj). Started from this
// site's own file (the security policy's worker-src 'self').
import { parseObjBytes, transferables } from './obj-core.js';

self.onmessage = async (e) => {
	const { id, bytes, ratio } = e.data;
	try {
		const parsed = await parseObjBytes(bytes, ratio);
		self.postMessage({ id, parsed }, transferables(parsed));
	} catch (err) {
		self.postMessage({ id, error: String(err?.message ?? err) });
	}
};
