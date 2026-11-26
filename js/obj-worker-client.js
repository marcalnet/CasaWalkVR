// The page's side of the OBJ worker (js/obj-worker.js; ?worker, js/dev.js):
// workerObjParser() returns an objParser for js/formats.js, or null where
// there are no module workers. One worker, started on first use, reused for
// every model; each model's bytes are copied once and handed over. A model
// that takes longer than TIMEOUT ends the worker and fails with a timeout (the
// page says so); a worker that cannot start or breaks makes js/formats.js read
// the model on the page instead. Browser only.

const TIMEOUT = 120; // seconds for one model

let worker = null, nextId = 1;
const waiting = new Map(); // id -> { ok, fail, timer }

function failAll(error) {
	for (const w of waiting.values()) { clearTimeout(w.timer); w.fail(error); }
	waiting.clear();
}

function start() {
	const w = new Worker(new URL('./obj-worker.js', import.meta.url), { type: 'module', name: 'casawalk-obj' });
	w.onmessage = (e) => {
		const job = waiting.get(e.data.id);
		if (!job) return;
		waiting.delete(e.data.id);
		clearTimeout(job.timer);
		if (e.data.error) job.fail(new Error(e.data.error)); else job.ok(e.data.parsed);
	};
	w.onerror = (e) => { e.preventDefault?.(); w.terminate(); if (worker === w) worker = null; failAll(new Error(`The OBJ worker stopped: ${e.message ?? 'unknown error'}`)); };
	return w;
}

/** An objParser (bytes, ratio) -> Promise<parsed> for js/formats.js, or null without module workers. */
export function workerObjParser() {
	if (typeof Worker === 'undefined') return null;
	return (bytes, ratio = 1) => new Promise((ok, fail) => {
		worker ??= start();
		const id = nextId++;
		const timer = setTimeout(() => {
			waiting.delete(id);
			worker?.terminate(); worker = null;
			failAll(new Error('The OBJ worker was ended'));
			fail(Object.assign(new Error(`A model took over ${TIMEOUT} s to read: it is too heavy to open here.`), { timeout: true }));
		}, TIMEOUT * 1000);
		waiting.set(id, { ok, fail, timer });
		const copy = bytes.slice(); // (the page keeps its own bytes: Recent, Send to my Quest)
		worker.postMessage({ id, bytes: copy, ratio }, [copy.buffer]);
	});
}
