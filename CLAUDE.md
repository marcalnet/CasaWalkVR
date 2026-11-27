# CasaWalk

WebXR viewer for Meta Quest (Quest 3, 3S, 2 and Pro; Quest 3/3S first; Quest 1 not supported) that opens Sweet Home 3D (`.sh3d`) files directly (plus OBJ/zip and GLB): view the home as a tabletop scale model, then walk through it at 1:1 scale. Replaces SketchUp Viewer for Quest for that one job. Name: "CasaWalk VR" where people meet the app (tab title, page header, README), "CasaWalk" inside the headset and in photo names (SPEC.md, "2D page"). First called Sweet Home VR; renamed CasaWalk in Nov 2026, internal identifiers included (`casawalk.*` storage keys, the `casawalk` IndexedDB and pairing tag, `window.__casawalk`). The Google Cloud project keeps its id `sweet-home-vr` (ids cannot change).

**SPEC.md is the source of truth** for SH3D parsing rules, furniture placement, walls/openings/rooms, controls and performance targets. Read the relevant section before touching that area. Don't propose alternatives to decisions in SPEC.md unless there is a concrete blocker, and explain the blocker.

## Hard constraints

- three.js + WebXR in the Meta Quest Browser. No Unity/native app, no frameworks beyond three.js. Keep it portable: the same web app may later be packaged as an installable app (PWA), so readers and geometry code stay free of the page, and browser-only code (file pickers, IndexedDB, downloads, pairing) stays in few, clearly named modules.
- Plain ES modules + import map, **no build step**. All runtime dependencies vendored in `vendor/` (three.js + used addons, the Draco and meshopt glTF decoders, the meshopt simplifier, fflate, three-mesh-bvh, PeerJS, the Kalam font of the welcome notes, the WebXR generic hand model, the Quest controller models from WebXR Input Profiles) with their licences. Nothing loads from a CDN at runtime. Apart from the storage service of a link the user loads (for Google Drive and OneDrive links, that service's API: see SPEC.md, "Links from storage services"), the only outside services are the PeerJS pairing server and the connection servers named in `CONFIG.pairing` (Google's STUN server, PeerJS's TURN relay), contacted only when Send to my Quest sends a file (`connect-src` in `index.html` must match `CONFIG.pairing`'s server; `npm test` checks it; the browser's WebRTC connections are not governed by `connect-src`, so the named servers are the whole list).
- Hosted on GitHub Pages at https://www.casawalkvr.com/ (repo marcalnet/CasaWalkVR; `CNAME` holds the address; casawalkvr.app and casawalkvr.pro forward to it from their own small Pages repos). HTTPS is required for WebXR. The same URL works on desktop Chrome/Safari as a 2D orbit preview.
- Quest Browser file picker: read picked files with `await file.arrayBuffer()` immediately; never create a blob URL from a picked `File`; no restrictive `accept` attribute; accept `.zip` wherever `.sh3d` is accepted.
- Quest 2 is the performance floor (a phone GPU): merged geometry by material (< ~150 draw calls), BVH for every raycast, Lambert materials. Shadows only as the optional on-demand map in lighting.js (never per-frame); no post-process or temporal anti-aliasing (flickers).
- Model files and links are untrusted input (see "Safety" in SPEC.md): never fetch a URL found inside a model, never build HTML from file content (use `textContent`), keep the zip, download and texture limits, and keep the Content Security Policy in `index.html` strict (no `unsafe-inline` or `unsafe-eval` for scripts, no outside hosts). The only exceptions, approved by the user for compressed GLB: `'wasm-unsafe-eval'` (WebAssembly only) and `worker-src 'self' blob:` (the page's own service worker, sw.js, and the decoders' workers, built from vendored files); never add a decoder that needs JavaScript eval. If the import map changes, update its hash in the policy; `npm test` checks it.
- Every interface follows Dieter Rams' ten principles as SPEC.md applies them ("Design principles"): self-explanatory, honest, consistent in every detail, no needless complication. When they clash, fun and mood come first (the user's decision), never at the cost of usefulness or honesty. Hand-held tools follow BRINK Traveler's feel (SPEC.md phase 17) without copying its art.
- Graphics and layouts are drafts the user will redesign: static artwork is a replaceable texture file in `assets/ui/` (listed in its README), and menus take colours and fonts from one theme module (SPEC.md, "Replaceable graphics").
- Out of scope: editing the model, collaboration, accounts, scenes. Measuring and drawing are in scope (SPEC.md phase 17) but nothing they make is saved; the Photo button keeps them in a picture.

## Layout

```
index.html        2D UI and import map
config.js         Google API key, defaults
js/main.js        2D page: renderer and view, showing the model opened, and the order the page's parts start in
js/model-service.js one service for models: files or a link in, a finished model out (reading, merging, superseding, freeing, downloading); no page code (Node-testable)
js/page/files-card.js  the files card: Open file, the sample homes, the link box, Recent, the photos taken in VR
js/page/send.js   Send to my Quest (computers) and Receive (headset)
js/page/enter-vr.js the Enter VR button (Send to my Quest beside it on computers)
js/page/welcome.js the welcome notes over the empty view, the files card folding away, dropping files on the page
js/page/updates.js which build is running (Reload when the site has a newer one), offline use (sw.js)
js/xr.js          XR session: the parts below, the frame order, setMode, the live keys, photo capture, shared state (moves between places: js/pause.js)
js/safety.js      the safety net in the headset: errors show a calm card, repeated errors end the session (pure, Node-testable)
js/xr-dollhouse.js  scale model mode ("dollhouse" in code): one plinth (1.24 m), turn and hold, one round scale per visit and its plate, the doors and levels on the plinth, where walking in lands
js/xr-walk.js     walk mode: teleport and fade, snap turn, the stick walk (it stops at walls), floor following
js/xr-ui.js       the one Settings wing (opening on the tab per place, closing, touch and lasers, trigger claims), B / Y held, notes
js/wings.js       where the wing goes: 0.55 m, 40-50° to the main hand's side, never over the scale model (pure, Node-testable)
js/wrist-menu.js  the wrist menu: orb on one wrist (it makes room for live keys), two keys on an arc: the round held ← Back, and Settings
js/keys.js        keys pressed by touch or laser (wrist menu, the doors and levels on the plinth, the tool dial), held keys and their ring
js/xr-menus.js    the wing as data (cells by id; tabs as rows of ids), How to move's words, the pause's tips, what a key or cell does
js/xr-scene.js    scenery builders: gallery room, plinth, skies, markers
js/xr-targets.js  what lasers, the teleport arc and the feet may hit (pure, Node-testable)
js/xr-tools.js    hand-held tool system: claims, routing, annotations in model space (tools from milestone C)
js/tool-fan.js    the tools over the left hand, or waiting at the edge of the centre: touch and grip (or a closed hand) to take, swap, put back; the reach
js/tool-dial.js   each tool's one option (lens, colour, units) on one round dial at its control part, and the quiet ring there
js/tool-models.js the three tools' models (camera, meter, marker), plain theme colours
js/laser-meter.js the laser meter tool: beam and dot, live reading, measured lines with labels in model space
js/marker-tool.js the marker tool: strokes as growing tubes (one draw call each), colours, undo
js/measure.js     the meter's measuring: snapping, labels, undo (pure, Node-testable)
js/street-camera.js the street camera tool: shutter (photo from the lens, 3:2), viewfinder render target, lens setting, the print
js/framing-guide.js the camera's red frame: where the photo's edges fall, at the depth it is aimed at (never in photos)
js/settings.js    every remembered setting: key, default, meaning (page and headset)
js/rooms.js       where stepping inside lands: a room's clear middle and long direction (pure, Node-testable)
js/theme.js       fonts, colours, corner radii of everything drawn in the headset (restyle here)
js/tween.js       feedback motion: easing, spring, arcs, tweens on the frame clock (pure)
js/haptics.js     controller vibration: one named pattern per meaning
js/sound.js       synthesised sound effects (recipes as data), unlocked by Enter VR
js/sh3d.js        SH3D parser and scene builder (pure functions, Node-testable)
js/formats.js     OBJ / zip / GLB / DAE / 3DS loading and unit detection
js/triangles.js   a home's triangles counted from the raw bytes before building; too heavy for the headset: refused calmly (pure, Node-testable)
js/simplify.js    heavy models simplified for the Quest (meshoptimizer): sizes, materials and thin parts kept, said on the page (no DOM)
js/obj-core.js    OBJ reading shared by the page and the OBJ worker: prepare, parse, simplify, plain data, rebuilt with materials (no DOM)
js/obj-worker.js  the OBJ worker, and js/obj-worker-client.js its page side (only with ?worker until measured on a Quest 2)
js/obj-defaults.js Sweet Home 3D's built-in OBJ materials and see-through window panes (pure, Node-testable)
js/optimise.js    merge-by-material (plain colours folded into vertex colours) and BVH
js/xr-input.js    controllers, rays, thumbsticks, teleport arc, per-frame button claims; bare hands told apart (a pinch never clicks); touch state for hands and controllers (poke point, pinch); controller tip nub
js/controller-model.js the real controllers (vendor/controllers/), one draw call each, their buttons moving; faded while holding a tool; the touch point at the nose
js/touch.js       touch keys: hover, contact, click, release, front-only (pure, Node-testable)
js/hands.js       bare hands drawn from the WebXR joints (translucent capsules, orange fingertip)
js/gestures.js    bare-hand gestures from the joints: the pinch-and-hold teleport and wrist flick, the quick pinch (closes the wing), the closed hand, the aim ray (pure, Node-testable)
js/hand-owner.js  who owns a hand this frame: the ladder (a held tool, a dial, the wing, the wrist menu, a key, the tools, the model) (pure, Node-testable)
js/zones.js       the areas (left, centre, right), where the tools wait, the orb's line of sight (pure, Node-testable)
js/dev.js         the development switches in the page address (?test, ?hands, ?stats, ?nomerge, ?nofold, ?sw, ?worker), read in one place
js/device.js      which device: the headset's own browser, a Quest 2 (the one place that reads the browser's name)
js/hand-readout.js the bare-hand tuning readout over each wrist, only with ?hands on the page URL (development)
js/frame-stats.js the headset's fps and draw-call counter, only with ?stats on the page URL (measuring)
js/hotspots.js    teleport hotspots: room middles and doorways, and snapping to them (pure, Node-testable)
js/landing.js     where the teleport lands beside what you can't stand on: a wall's foot, clear floor round furniture (pure, Node-testable)
js/guide.js       How to move, the wing's first tab: pictures and lines for hands or controllers, the build at its foot
js/pause.js       every move between places (Enter VR, Walk in, ← Back, leaving), held until the place is ready, and the tips on the way
js/tip-demo.js    the pause's looping hand, showing the tip's move
js/session-store.js what belongs to this VR session only (the tips, the first tabs): cleared at Enter VR and by New visitor
js/transient-pointer.js Apple Vision Pro's look-and-pinch: one pinch acts along its ray (isolated)
js/hand-model.js  the hand model: the generic hand (vendor/generic-hand/) dressed in the hand look, posed from joints or presets
js/hand-poses.js  preset hand poses (from IWER, MIT) for the pause's demonstration hand
js/panel.js       canvas-texture wing (switches, options, buttons, tabs), note cards, labels
js/canvas-card.js the one way every drawn card, key and label makes its canvas and texture
js/veil.js        the one sphere round the eyes: teleport fade, layer change, photo flash
js/walls.js       the walls the stick walk stops at, and see-through walls and furniture (headset only)
js/portal.js      the wall portal: a circle fades open where a fingertip touches a wall or door, or the eyes come within 30 cm (headset only)
js/photo.js       photos: renders the view without the interface (its own layer, INTERFACE_LAYER) and saves a JPEG
js/lighting.js    time of day (sun from the compass) and on-demand shadows
js/depth.js       depth shading (headset only): corner gradients baked per vertex, no post-process
js/storage.js     IndexedDB recent files and the photos taken in VR (saved to Downloads from the page)
js/links.js       which links may be downloaded, storage-service links (Dropbox, Google Drive, OneDrive, GitHub), Send to my Quest address (pure, Node-testable)
js/transfer.js    computer-to-headset file transfer protocol and its checks (pure, Node-testable)
js/pairing.js     the direct computer-to-headset link (PeerJS, loaded only when used)
sw.js             service worker: offline use and clean updates (network-first, cache fallback)
js/version.js     the build stamp (number, date), written by scripts/stamp.js (npm run stamp) before each push
js/build-label.js how the build reads ("Build 213 · 23 Nov 2026 14:05"), and the newer-build check
assets/ui/        replaceable interface artwork (drafts by scripts/make-ui-assets.js; listed in its README)
examples/         sample homes (pond-house, apartment: .sh3d + card picture, listed in js/samples.js; colours from scripts/sample-palette.js) example-home.sh3d (the tests' small fixture) and heavy-home.sh3d (the budget test's heavy home, not offered on the page), each made by its generator in scripts/ (original content; commit the output)
js/samples.js     the sample homes the page offers, as data (one entry per home)
vendor/           vendored dependencies + licences (vendor/controllers/: the Quest controller models); vendor/worker/: addons with 'three' imported by relative path, for module workers (written by scripts/vendor.js, checked by a test)
tests/            Node tests (node:test)
scripts/          vendoring, fixtures, example home, UI artwork, local server, screenshots, emulated XR test, screenshot compare
tests/fixtures/   sample .sh3d files (not committed; see README)
docs/             README pictures (from the example home only, never a personal file)
```

## Working rules

- Work in the phases listed in SPEC.md ("Working style"). Commit at the end of each phase, then stop for on-headset testing with a checklist.
- Use Node 24 (`nvm use`, see `.nvmrc`); the machine default is Node 12, which is too old. `package.json` holds dev-only tools (Playwright); the app itself never needs `npm install`.
- Keep code plain and commented. `sh3d.js` must not touch the DOM so it runs in Node tests.
- When unsure about a Sweet Home 3D detail, check the official sources (`HomeXMLExporter`, `ModelManager`, `Wall3D`, `Room3D`) rather than guessing.
- Before finishing a parser/scene change: run `npm test`, run `npm run shots`, and look at the screenshots against what Sweet Home 3D shows.
- Before finishing an XR change: run `npm run xr-test` (Meta's IWER emulator drives a fake Quest 2 in headless Chromium) and `XR_DEVICE=metaQuest3 npm run xr-test`, and look at the `test-output/xr-*.png` screenshots. It cannot judge comfort or frame rate: give the user an on-headset checklist. For a change that must look the same (a refactor), compare a before and an after run: `XR_STEADY=1 XR_OUT=… XR_BASELINE=…` and `node scripts/xr-compare.js` (see the top of `scripts/xr-test.js`).
- `?nomerge` on the page URL skips the geometry merge, to tell merge bugs from loader bugs. All such switches live in `js/dev.js`; `window.__casawalk` (the test hooks) exists only with `?test`.
- Run `npm run stamp` right before committing what you will push: it writes `js/version.js` (the build number and time the page shows bottom left, and that tells a cached copy a newer build is live). Stage `js/version.js` with the commit.
- Don't commit files the user drops in the folder (e.g. `.rtf`, `.webloc`); stage paths explicitly.
- This folder lives in Dropbox: keep `node_modules/` and Playwright output excluded from Dropbox sync and from git.
- Never commit personal home files or any secret (config.js holds only public keys).
- `planning/` (ignored by git, may be absent in a clone) holds private product notes. When it exists, read `planning/architecture-decisions.md` before architecture work. Never copy from it into tracked files, commit messages or outside services.
- The repository is public and shared with other developers: everything must work from a fresh clone (`npm test` with no install and no downloaded fixtures; the browser tests fall back to `examples/example-home.sh3d`). Keep file names, comments and pictures free of personal details.
