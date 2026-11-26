# Controller models

The real Quest controllers, from the WebXR Input Profiles collection
(https://github.com/immersive-web/webxr-input-profiles), package
`@webxr-input-profiles/assets` 1.0.20, `dist/profiles/`: MIT licence,
© 2019 Amazon (LICENSE.md). Drawn by js/controller-model.js; nothing is
loaded from the collection's CDN.

- `oculus-touch-v3/`: Quest 2 Touch controllers
- `meta-quest-touch-plus/`: Quest 3 and 3S Touch Plus controllers
- `meta-quest-touch-pro/`: Quest Pro Touch Pro controllers

Each holds `left.glb`, `right.glb` and `profile.json`, copied unchanged.
`profilesList.json` lists only these three (the package's own list names
every profile it ships; a device reporting none of these keeps the plain
bars). The models depict the manufacturer's products; as the collection's
README says, the licence grants no right to the trademarks.
