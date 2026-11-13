# Play Store screenshots

`screenshots/` holds the eight phone screenshots on the Play listing (1080x1920,
light and dark alternating), uploaded Nov 13, 2026.

To remake them after a visible change:

1. Serve the repo root on port 8911 (`python3 -m http.server 8911`).
2. `npm i --no-save @fontsource/sora @fontsource/jetbrains-mono` into `/tmp/fontsrc`
   (paths are set at the top of `probe.js` and `compose.js`), and have Playwright
   plus `tools/node_modules/chart.js`.
3. `node raw.js` captures the app (sample data from `seed.js`, Play build, Premium)
   into `raw/`; `node compose.js` adds the captions and writes `final/`.

Sample data uses made-up account names and no lender logos. Captions stay in
neutral-tool wording (see Compliance in Project_Instructions.md).
