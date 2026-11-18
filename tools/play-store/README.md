# Play Store screenshots

`screenshots/` holds the eight phone screenshots on the Play listing (1080x1920,
light and dark alternating), uploaded Nov 17, 2026. Order: 1 Every debt, one
total; 2 Set up in under a minute (setup step 2); 3 This month; 4 Autopay logs
itself (setup step 3); 5 Payoff method; 6 What-if; 7 Each debt; 8 Reminders.
Shots 2 and 4 are captured mid-setup by `SETUP(n)` in `raw.js`; `probe.js`
pre-dismisses What's New and the monthly recap so neither covers a shot.

To remake them after a visible change:

1. Serve the repo root on port 8911 (`python3 -m http.server 8911`).
2. `npm i --no-save @fontsource/sora @fontsource/jetbrains-mono` into `/tmp/fontsrc`
   (paths are set at the top of `probe.js` and `compose.js`), and have Playwright
   plus `tools/node_modules/chart.js`.
3. `node raw.js` captures the app (sample data from `seed.js`, Play build, Premium)
   into `raw/`; `node compose.js` adds the captions and writes `final/`.

Sample data uses made-up account names and no lender logos. Captions stay in
neutral-tool wording (see Compliance in Project_Instructions.md).
