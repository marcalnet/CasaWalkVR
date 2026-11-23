# Interface artwork

Draft textures for the headset's interface. They are placeholders for the designer's own artwork: replace a file with one of **the same name and pixel size** and the look changes, with no code involved. Text that changes (numbers, names) is drawn by the app on top, inside the safe area below, with the fonts and colours of `js/theme.js`.

The drafts are drawn by `scripts/make-ui-assets.js` (`npm run ui-assets`, needs the dev tools). The service worker keeps these files for offline use. Keep the whole folder small: about 8 MB at most, for the Quest 2's memory.

| File | Pixels | Where it appears | Text drawn on it (safe area) | Transparency |
|---|---|---|---|---|
| `scale-plate.png` | 512 × 192 | A small plate on the plinth's front edge, on the right, tilted up towards you: the model's true scale. Shown 20 × 7.5 cm. | "Scale" centred at (256, 52), about 30 px tall; the ratio (e.g. "1:42") centred at (256, 122), about 74 px tall. Keep x 70-442, y 30-165 free of busy detail. Positions and colours: `PLATE` in `js/theme.js`. | Yes: rounded corners |
| `wrist-keys.png` | 512 × 384 | The wrist menu's key icons (milestone C0.3): four columns (Settings, Help, In, Back), three rows (dark ink; white, for the filled blue door; blue, for the outline door), 128 px each. Shown 2 cm on 4.5 cm keys. | None: the words (Settings, Help, Walk in →, ← Back, captions) are drawn by the app under the icon (`WRIST` in `js/theme.js`). | Yes |
| `board.png` | 1024 × 832 | The settings board: an aluminium frame round a sheet of paper, stretched to the board (52 cm wide, its height set by the rows). | Everything: tabs, rows and the Close key are drawn on top by the app; keep a 22 px frame clear at the edges. | Yes: rounded corners |
| `guide-sheets.png` | 1024 × 1024 | The guide beside the menu (C0.4): four rows (walking with bare hands, walking with controllers, the scale model with bare hands, with controllers) of four pictures, 256 px each, shown about 5 cm on a 24 × 16 cm card. | None: the title, a word under each picture and the lines are drawn by the app (`GUIDE` in `js/theme.js`, words in `GUIDES`, `js/xr-menus.js`). | Yes |
| `tag-coming-soon.png` | 256 × 128 | The paper tag hanging from the street camera in the tool fan while it is inactive (until milestone D), hand-lettered "Coming soon" (the designer's draft). Shown about 5.6 × 2.8 cm, on both faces. | None (its words are the artwork) | Yes |
