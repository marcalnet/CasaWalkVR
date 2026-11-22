# CasaWalk

WebXR viewer for Meta Quest (Quest 3, 3S, 2 and Pro; Quest 3/3S first; Quest 1 not supported) that opens Sweet Home 3D (`.sh3d`) files directly (plus OBJ/zip and GLB): view the home as a tabletop scale model, then walk through it at 1:1 scale. Replaces SketchUp Viewer for Quest for that one job. Name: "CasaWalk VR" where people meet the app (tab title, page header, README), "CasaWalk" inside the headset and in photo names (SPEC.md, "2D page"). First called Sweet Home VR; renamed CasaWalk in Nov 2026, internal identifiers included (`casawalk.*` storage keys, the `casawalk` IndexedDB and pairing tag, `window.__casawalk`). The Google Cloud project keeps its id `sweet-home-vr` (ids cannot change).

**SPEC.md is the source of truth** for SH3D parsing rules, furniture placement, walls/openings/rooms, controls and performance targets. Read the relevant section before touching that area. Don't propose alternatives to decisions in SPEC.md unless there is a concrete blocker, and explain the blocker.

## Hard constraints

- three.js + WebXR in the Meta Quest Browser. No Unity/native app, no frameworks beyond three.js. Keep it portable: the same web app may later be packaged as an installable app (PWA), so readers and geometry code stay free of the page, and browser-only code (file pickers, IndexedDB, downloads, pairing) stays in few, clearly named modules.
- Plain ES modules + import map, **no build step**. All runtime dependencies vendored in `vendor/` (three.js + used addons, the Draco and meshopt glTF decoders, fflate, three-mesh-bvh, PeerJS, the Kalam font of the welcome notes) with their licences. Nothing loads from a CDN at runtime. Apart from the storage service of a link the user loads (for Google Drive and OneDrive links, that service's API: see SPEC.md, "Links from storage services"), the one outside service is the PeerJS pairing server, contacted only when Send to my Quest sends a file (`connect-src` in `index.html` must match `CONFIG.pairing`; `npm test` checks it).
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
config.js         Dropbox app key, Google API key, defaults
js/main.js        2D page, renderer, loading, Enter VR/AR buttons
js/xr.js          XR session: the parts below, the frame order, setMode, photo capture, shared state
js/xr-dollhouse.js  scale model mode ("dollhouse" in code): plinth, rotate/zoom/grab, scale plate and zoom settling, where stepping inside lands
js/xr-walk.js     walk mode: locomotion, teleport and fade, snap turn, grip pull, floor following, solid walls
js/xr-ui.js       wrist orbs, opening/closing/pointing at the menu (trigger claims), welcome card, photo note
js/xr-menus.js    the menus as data (cells by id; tabs and actions as rows of ids), controls cards, labels, what a click does
js/xr-scene.js    scenery builders: gallery room, plinth, skies, markers
js/xr-targets.js  what lasers, the teleport arc and the feet may hit (pure, Node-testable)
js/xr-tools.js    hand-held tool system: claims, routing, annotations in model space (tools from milestone C)
js/settings.js    every remembered setting: key, default, meaning (page and headset)
js/rooms.js       where stepping inside lands: a room's clear middle and long direction (pure, Node-testable)
js/theme.js       fonts, colours, corner radii of everything drawn in the headset (restyle here)
js/tween.js       feedback motion: easing, spring, arcs, tweens on the frame clock (pure)
js/haptics.js     controller vibration: one named pattern per meaning
js/sound.js       synthesised sound effects (recipes as data), unlocked by Enter VR
js/sh3d.js        SH3D parser and scene builder (pure functions, Node-testable)
js/formats.js     OBJ / zip / GLB / DAE / 3DS loading and unit detection
js/optimise.js    merge-by-material and BVH
js/xr-input.js    controllers, rays, thumbsticks, teleport arc, per-frame button claims; bare hands told apart (a pinch never clicks); touch state for hands and controllers (poke point, pinch); controller tip nub
js/touch.js       touch keys: hover, contact, click, release, front-only (pure, Node-testable)
js/hands.js       bare hands drawn from the WebXR joints (translucent capsules, orange fingertip)
js/panel.js       canvas-texture VR menu (switches, options, slider, buttons) and controls card
js/walls.js       solid walls while walking and see-through walls and furniture (headset only)
js/photo.js       the menu's Photo button: renders the view without the menu and saves a JPEG
js/lighting.js    time of day (sun from the compass) and on-demand shadows
js/depth.js       depth shading (headset only): corner gradients baked per vertex, no post-process
js/storage.js     IndexedDB recent files and the photos taken in VR (saved to Downloads from the page)
js/links.js       which links may be downloaded, storage-service links (Dropbox, Google Drive, OneDrive, GitHub), Send to my Quest address (pure, Node-testable)
js/transfer.js    computer-to-headset file transfer protocol and its checks (pure, Node-testable)
js/pairing.js     the direct computer-to-headset link (PeerJS, loaded only when used)
sw.js             service worker: offline use and clean updates (network-first, cache fallback)
assets/ui/        replaceable interface artwork (drafts by scripts/make-ui-assets.js; listed in its README)
examples/         example-home.sh3d, generated by scripts/make-example.js (original content; commit the output)
vendor/           vendored dependencies + licences
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
- `?nomerge` on the page URL skips the geometry merge, to tell merge bugs from loader bugs.
- Don't commit files the user drops in the folder (e.g. `.rtf`, `.webloc`); stage paths explicitly.
- This folder lives in Dropbox: keep `node_modules/` and Playwright output excluded from Dropbox sync and from git.
- Never commit personal home files or the Dropbox app secret (the Chooser only needs the public app key).
- `planning/` (ignored by git, may be absent in a clone) holds private product notes. When it exists, read `planning/architecture-decisions.md` before architecture work. Never copy from it into tracked files, commit messages or outside services.
- The repository is public and shared with other developers: everything must work from a fresh clone (`npm test` with no install and no downloaded fixtures; the browser tests fall back to `examples/example-home.sh3d`). Keep file names, comments and pictures free of personal details.
