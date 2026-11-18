# Play Store screenshots

`screenshots/` holds the eight phone screenshots on the Play listing (1080x1920,
light and dark alternating), remade Nov 18, 2026 for the v1.74 "Highlighter" look (not yet uploaded; the Nov 17 set is in Play review). Order: 1 Every debt, one
total; 2 Set up in under a minute (setup step 2); 3 This month; 4 Autopay logs
itself (setup step 3); 5 Payoff method; 6 What-if; 7 Each debt; 8 Reminders.
Shots 2 and 4 are captured mid-setup by `SETUP(n)` in `raw.js`; `probe.js`
pre-dismisses What's New and the monthly recap so neither covers a shot.

To remake them after a visible change:

1. Serve the repo root on port 8911 (`python3 -m http.server 8911`).
2. `npm i --no-save @fontsource/atkinson-hyperlegible` into `/tmp/fontsrc`
   (paths are set at the top of `probe.js` and `compose.js`), and have Playwright
   plus `tools/node_modules/chart.js`.
3. `node raw.js` captures the app (sample data from `seed.js`, Play build, Premium)
   into `raw/`; `node compose.js` adds the captions and writes `final/`.

Sample data uses made-up account names and no lender logos. Captions stay in
neutral-tool wording (see Compliance in Project_Instructions.md).

Captions: plain paper (#f1f2f0) or graphite (#1c1d20) background, Atkinson
Hyperlegible, the key phrase on a highlighter-yellow band (`*phrase*` in `C`).
`probe.js` hides the payment check ("Did these go out?") so it never covers a shot.

`feature-graphic-1024x500.png` is the Play feature graphic (F1 Light). The Play
store icon is `assets/icons/icon-512.png`.

Homepage videos: `node film.js` films eight scenes into /home/claude/build/video;
`app-demo.mp4` is all eight joined (ffmpeg concat, `-c copy`), `app-hero.mp4` is
s2-swipe + s3-paid + s6-whatif. `node film-setup.js` records first setup from an
empty app in real time with a caption bar and timer (`setup-demo.mp4`). Covers are
an early frame of each.
