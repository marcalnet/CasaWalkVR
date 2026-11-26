// Copies the runtime dependencies (libraries and the one font) from
// node_modules into vendor/ so the app never loads anything from a CDN. Run after changing versions in package.json:
//   npm install && npm run vendor
// Only the three.js addons listed in ADDONS are copied, plus every file they
// import through relative paths (followed recursively).

import fs from 'node:fs';
import path from 'node:path';
import { WORKER_COPIES, workerCopy } from './worker-copies.js';

const root = path.resolve(import.meta.dirname, '..');
const nm = path.join(root, 'node_modules');
const vendor = path.join(root, 'vendor');

const ADDONS = [
	'controls/OrbitControls.js',
	'loaders/OBJLoader.js',
	'loaders/MTLLoader.js',
	'loaders/GLTFLoader.js',
	'loaders/ColladaLoader.js',
	'loaders/TDSLoader.js',
	'loaders/DRACOLoader.js',
	'libs/meshopt_decoder.module.js',
	'libs/meshopt_simplifier.module.js', // (MIT; WebAssembly only, no eval: heavy pieces simplified for the Quest, js/simplify.js)
	'utils/BufferGeometryUtils.js',
	'libs/motion-controllers.module.js', // (MIT, the WebXR Input Profiles' reader: which controller model, its buttons moving; js/controller-model.js)
];

// Copied once by hand, not from a dev dependency: kept when vendor/ is rebuilt (see the end).
const HAND_COPIED = ['generic-hand', 'controllers'];

function copy(src, dst) {
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.copyFileSync(src, dst);
}

// Recursively copy a JS module and its relative imports.
function copyModule(srcBase, dstBase, rel, seen = new Set()) {
	if (seen.has(rel)) return;
	seen.add(rel);
	const src = path.join(srcBase, rel);
	copy(src, path.join(dstBase, rel));
	const code = fs.readFileSync(src, 'utf8');
	const re = /(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
	for (const m of code.matchAll(re)) {
		const spec = m[1] || m[2];
		copyModule(srcBase, dstBase, path.normalize(path.join(path.dirname(rel), spec)), seen);
	}
}

for (const f of fs.existsSync(vendor) ? fs.readdirSync(vendor) : []) {
	if (!HAND_COPIED.includes(f)) fs.rmSync(path.join(vendor, f), { recursive: true, force: true });
}

// three.js core (three.module.js imports three.core.js)
copy(path.join(nm, 'three/build/three.module.js'), path.join(vendor, 'three/three.module.js'));
copy(path.join(nm, 'three/build/three.core.js'), path.join(vendor, 'three/three.core.js'));
copy(path.join(nm, 'three/LICENSE'), path.join(vendor, 'three/LICENSE'));
const seen = new Set();
for (const a of ADDONS) copyModule(path.join(nm, 'three/examples/jsm'), path.join(vendor, 'three/addons'), a, seen);

// Decoders for compressed glTF, loaded only when a file uses them (js/formats.js):
// Draco geometry (Apache-2.0, Google; the smaller glTF-only build). The meshopt
// decoder (MIT) came with the addons above. Not vendored: the Basis Universal
// transcoder for KTX2 textures, which builds functions from strings at run
// time (Emscripten's embind), and the page's security policy forbids that.
const libs = path.join(nm, 'three/examples/jsm/libs');
for (const f of ['draco/gltf/draco_wasm_wrapper.js', 'draco/gltf/draco_decoder.wasm']) {
	copy(path.join(libs, f), path.join(vendor, 'three/addons/libs', f));
}
// The Apache License 2.0 text, taken from a dev dependency that ships it
// unchanged (Playwright), up to the end of its terms.
const apache = fs.readFileSync(path.join(nm, 'playwright-core/LICENSE'), 'utf8');
const END = 'END OF TERMS AND CONDITIONS';
const terms = apache.slice(0, apache.indexOf(END) + END.length) + '\n';
fs.writeFileSync(path.join(vendor, 'three/addons/libs/draco/LICENSE'), 'Draco 3D Data Compression decoder. Copyright Google LLC. https://github.com/google/draco\n\n' + terms);

// The worker copies (scripts/worker-copies.js): the addons a module worker needs, with 'three'
// imported by relative path (a worker has no import map).
for (const [name, rel] of Object.entries(WORKER_COPIES)) {
	fs.mkdirSync(path.join(vendor, 'worker'), { recursive: true });
	fs.writeFileSync(path.join(vendor, 'worker', name), workerCopy(fs.readFileSync(path.join(vendor, 'three/addons', rel), 'utf8')));
}

// three-mesh-bvh (single ES module that imports 'three')
copy(path.join(nm, 'three-mesh-bvh/build/index.module.js'), path.join(vendor, 'three-mesh-bvh/index.module.js'));
copy(path.join(nm, 'three-mesh-bvh/LICENSE'), path.join(vendor, 'three-mesh-bvh/LICENSE'));

// fflate (browser ES module build)
copy(path.join(nm, 'fflate/esm/browser.js'), path.join(vendor, 'fflate/fflate.module.js'));
copy(path.join(nm, 'fflate/LICENSE'), path.join(vendor, 'fflate/LICENSE'));

// Kalam, the handwriting font of the welcome notes (SIL Open Font Licence):
// the Latin subset in two weights, so the notes look the same on every device.
for (const weight of [400, 700]) copy(path.join(nm, `@fontsource/kalam/files/kalam-latin-${weight}-normal.woff2`), path.join(vendor, `kalam/kalam-latin-${weight}.woff2`));
copy(path.join(nm, '@fontsource/kalam/LICENSE'), path.join(vendor, 'kalam/LICENSE'));

// PeerJS (MIT): the direct link between a computer and a headset for Send to
// my Quest (js/pairing.js). Its browser build defines window.peerjs; the page
// loads it only when that feature is used.
copy(path.join(nm, 'peerjs/dist/peerjs.min.js'), path.join(vendor, 'peerjs/peerjs.min.js'));
copy(path.join(nm, 'peerjs/LICENSE'), path.join(vendor, 'peerjs/LICENSE'));

// The generic hand (MIT, © 2019 Amazon): the WebXR Input Profiles' hand model,
// dressed in CasaWalk's look by js/hand-model.js. Copied once by hand from
// @webxr-input-profiles/assets 1.0.20 (dist/profiles/generic-hand: left.glb,
// right.glb, profile.json, and its LICENSE as LICENSE.md) into
// vendor/generic-hand/; not a dev dependency, so this script leaves it alone.
// Never loaded from the CDN path three.js's XRHandMeshModel uses by default.
const GENERIC_HAND = '1.0.20';
// The controller models (MIT, © 2019 Amazon): the same package and version,
// dist/profiles/ oculus-touch-v3, meta-quest-touch-plus and meta-quest-touch-pro
// (left.glb, right.glb, profile.json each), copied by hand into vendor/controllers/
// with a profilesList.json naming only those three (vendor/controllers/README.md).
const CONTROLLERS = '1.0.20';

const versions = Object.fromEntries(['three', 'three-mesh-bvh', 'fflate', '@fontsource/kalam', 'peerjs'].map(
	(p) => [p, JSON.parse(fs.readFileSync(path.join(nm, p, 'package.json'), 'utf8')).version]));
versions['@webxr-input-profiles/assets (generic-hand)'] = GENERIC_HAND;
versions['@webxr-input-profiles/assets (controllers)'] = CONTROLLERS;
fs.writeFileSync(path.join(vendor, 'VERSIONS.json'), JSON.stringify(versions, null, 2) + '\n');
console.log('Vendored', versions, `(${seen.size} three.js addon files)`);
