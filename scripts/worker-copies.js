// The worker copies of the three.js addons a module worker needs (heavy homes,
// step 5: OBJ loading in a worker, js/obj-worker.js). A worker has no import
// map, so the bare name 'three' these addons import cannot resolve there: each
// copy imports the same vendored file by its relative path instead (the same
// URL as the page's import map gives, so the page and the worker share one
// three.js). Written by scripts/vendor.js; tests/worker-copies.test.js checks
// that they stay in step with vendor/three/addons/.

export const WORKER_COPIES = {
	'OBJLoader.js': 'loaders/OBJLoader.js',
	'BufferGeometryUtils.js': 'utils/BufferGeometryUtils.js',
};

/** An addon's source with its 'three' import pointed at the vendored file (from vendor/worker/). */
export function workerCopy(source) {
	const out = source.replace(/(\bfrom\s*)(['"])three\2/g, "$1'../three/three.module.js'");
	if (/from\s*['"]three(\/|['"])/.test(out.replace(/^\s*\*.*$/gm, ''))) throw new Error('an import of three is left: extend workerCopy()');
	return `// Worker copy (scripts/worker-copies.js): 'three' imported by relative path. Do not edit.\n${out}`;
}
