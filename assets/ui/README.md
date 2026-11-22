# Interface artwork

Draft textures for the headset's interface. They are placeholders for the designer's own artwork: replace a file with one of **the same name and pixel size** and the look changes, with no code involved. Text that changes (numbers, names) is drawn by the app on top, inside the safe area below, with the fonts and colours of `js/theme.js`.

The drafts are drawn by `scripts/make-ui-assets.js` (`npm run ui-assets`, needs the dev tools). The service worker keeps these files for offline use. Keep the whole folder small: about 8 MB at most, for the Quest 2's memory.

| File | Pixels | Where it appears | Text drawn on it (safe area) | Transparency |
|---|---|---|---|---|
| `scale-plate.png` | 512 × 192 | A small plate on the plinth's front edge, on the right, tilted up towards you: the model's true scale. Shown 20 × 7.5 cm. | "Scale" centred at (256, 52), about 30 px tall; the ratio (e.g. "1:42") centred at (256, 122), about 74 px tall. Keep x 70-442, y 30-165 free of busy detail. Positions and colours: `PLATE` in `js/theme.js`. | Yes: rounded corners |
