# DebtFree Dashboard — Project Instructions

## Before touching any code: pull the live files

**Never build on an uploaded or remembered file without verifying it against the
repo first.** Versions ship frequently; a stale baseline silently reverts shipped
work. This has happened, and it cost a full rebuild.

The repo is public, so fetch it directly:

```bash
BASE="https://raw.githubusercontent.com/DebtFreeDashboard/debt-free-dashboard/main"
curl -sS "$BASE/app/dashboard.html" -o dashboard.html
curl -sS "$BASE/app/version.json"   -o version.json
curl -sS "$BASE/sw.js"              -o sw.js
curl -sS "$BASE/index.html"         -o index.html
```

Then **verify before writing a single line**:

```bash
grep -o "APP_VERSION = '[^']*'" dashboard.html | head -1
grep -o "CACHE_NAME = '[^']*'" sw.js
python3 -c "import json;print(json.load(open('version.json'))['version'])"
```

All three must match. If they don't, stop and tell Kevin — something didn't
deploy. If Kevin uploads a file, still fetch the repo copy and compare; if they
differ, ask which is authoritative rather than guessing.

`raw.githubusercontent.com` is usually the fastest way to see a committed file,
but it is **not** instantly consistent — verified 2026-09-16, when it served the
previous release for several minutes after a push had completed, including with
a cache-buster and `Cache-Control: no-cache`. Do not read a stale answer there as
a failed deploy. The authoritative check is the server itself:

```bash
git ls-remote origin main          # what GitHub actually has
git show <sha>:app/version.json    # what is in that commit
```

Two more cache layers sit between a push and what a device sees:

- **GitHub Pages serves `app/dev.html` with `cache-control: max-age=600`.** A
  normal navigation can therefore load a dev build up to ten minutes old, which
  is long enough to test the wrong thing and believe it. When testing dev right
  after a push, hard-reload it, or `fetch('/app/dev.html', {cache:'reload'})`
  first. `app/dashboard.html` is affected the same way.
- **The service worker serves the previous HTML for one more load.** After a
  release, the first page load still reports the old `APP_VERSION` while the new
  worker installs; the reload after it is correct. This is normal and is not a
  broken deploy. In Cowork, read from the local clone
instead: `C:\Users\kevin\Documents\GitHub\debt-free-dashboard` (pull first).

## The product

DebtFree Dashboard — a single-file PWA debt payoff tool. `dashboard.html` is the
entire app (HTML/CSS/JS, localStorage, Chart.js, no backend). Freemium: generous
free tier, $24 one-time Premium.

It ships two ways from the same files:

- **Website / PWA** at `mydebtdashboard.com`. Premium is sold on Gumroad ($24)
  and unlocked with a license key.
- **Google Play app** "DebtFree: Debt Payoff Tracker" (`com.mydebtdashboard.app`),
  live since **November 7, 2026**. It is a Trusted Web Activity: a thin Android
  wrapper that loads this website, so **merging to `main` updates the website
  and the Play app together**. Premium is a Play in-app purchase
  (`premium_unlock`, $24, same price as Gumroad). See "Google Play app" below.

Kevin is a non-coder founder and product owner. He decides direction; Claude
handles technical execution end to end.

## Repo layout

| Path | What |
|---|---|
| `app/dashboard.html` | The entire application |
| `app/version.json` | Drives the in-app update check |
| `sw.js` | Service worker (repo root) |
| `index.html` | Marketing homepage (repo root) |
| `test-fixtures/` | `test-primary.json`, `test-minimal.json`, `README.md` |
| `tools/gumroad/` | Gumroad cover + thumbnail (PNGs, HTML sources, `render.mjs`). Manual step of any price change; `set-price.py` does not touch them |
| `app/dev.html` | **Generated** dev build — never edit by hand (see below) |
| `tools/make-dev.js` | Generates `app/dev.html` from `app/dashboard.html` |
| `tools/verify-dev.js` | Proves the dev build is isolated from real data |
| `calculators/` | Free calculator and spreadsheet pages (search traffic). **Generated** — see "Calculator pages" |
| `calculators/content/<slug>.json` | Copy for each calculator page (edit this, then rebuild) |
| `tools/build-calculators.js` | Builds `/calculators/` (hub + every page) from `content/` and its `PAGES` list |
| `tools/make-calc-engine.js` | Generates `calculators/assets/engine.js` from `dashboard.html` so the math never drifts |
| `sitemap.xml` | Every public page, calculators included. Add new pages here |
| `.well-known/assetlinks.json` | Links the Play app to the site (upload + Play App Signing keys). Don't touch unless the signing key changes |
| `tools/play-billing/` | Cloudflare Worker that verifies and acknowledges Play purchases (the only server; never sees debt data) |

Live: `mydebtdashboard.com` (homepage), `/app/dashboard.html` (the app),
`/calculators/` (calculator hub). Dev build: `/app/dev.html` — same origin,
deliberately inert (see below).

## Google Play app

- **One codebase.** The Play app is the website inside a Trusted Web Activity,
  so there is no separate Android build to ship. A merge to `main` deploys the
  site (GitHub Pages) and the Play app picks it up on next load. A new Play
  *release* (new bundle in Play Console) is only needed to change the wrapper
  itself or to show a "What's new" note on the Play listing.
- **Detecting the Play app.** `IS_PLAY_BUILD` near the top of
  `app/dashboard.html` is true when the page was opened by
  `android-app://com.mydebtdashboard.app` (and remembered in
  `sessionStorage.debtfree_play`). The homepage and calculator pages add the
  class `in-play-app` to `<html>` from the same flag.
- **The Play app must never show the Gumroad link or price.** Google Play's
  payments policy forbids steering to outside payment. On the site, anything
  Gumroad carries `web-only` (hidden by `.in-play-app .web-only`), and the
  Play badge is hidden inside the Play app and on iPhone/iPad. Any new upgrade
  button or Gumroad mention needs the same treatment.
- **Premium in the Play app** uses Google Play Billing (Digital Goods API, Chrome
  only; the app explains how to switch if another browser opened it).
  `tools/play-billing/worker.mjs` verifies and acknowledges each purchase
  (Google refunds anything not acknowledged within 3 days).
- **Review prompt** (v1.55.0): Play build only, after a logged payment and 3+ days
  of use, opens the Play listing. Follows Google's rules (no pre-question, no
  reward).
- **Analytics differ by build.** GA4 runs on the website and the Play app.
  Microsoft Clarity (session recording) runs on the website only; it is not
  loaded when `IS_PLAY_BUILD` (v1.55.4). The Play Data safety form must match
  whatever the Play app actually collects, so tell Kevin before adding any new
  tracking to the Play build.
- **Store listing** (Play Console, Kevin edits it himself). Nov 10, 2026: new short
  description ("Debt payoff planner & calculator. Snowball or avalanche. No bank
  login.") and six new captioned phone screenshots were sent for Google review.
- **Compliance.** Trader status is declared in Play Console. Keep listing copy in
  the same neutral-tool framing as the app (see Compliance below).

## Calculator pages

`/calculators/` holds free calculators and spreadsheet pages that bring in
search traffic and point to the app. They are generated; never hand-edit the
HTML in `calculators/<slug>/`.

- Copy lives in `calculators/content/<slug>.json`; behaviour and starting
  numbers live in `PAGES` in `tools/build-calculators.js`.
- Rebuild with `BUILD_DATE=YYYY-MM-DD node tools/build-calculators.js`
  (`BUILD_DATE` keeps unchanged pages' dates stable). If the dashboard's math
  changed, run `node tools/make-calc-engine.js` first.
- A new page also needs a `<url>` entry in `sitemap.xml`.
- Modes: `sheet` (month-by-month table with a free CSV download and print) and
  `planner` (debt-free date plus what to pay each debt this month). Pages with
  `appStrip: true` end with "Keep this plan going on your phone" (Play badge on
  Android, web app, Gumroad on the web only).
- Tests: `node tools/test-calculators.js`.
- After new pages go live, Kevin resubmits `sitemap.xml` and requests indexing
  in Google Search Console (site verified for `https://mydebtdashboard.com/`).

## Analytics events (GA4)

Besides page views, the site sends:

| Event | Where | Meaning |
|---|---|---|
| `play_badge_click` | Homepage, calculator pages, the app's example screen and install page (Android browsers only) | Someone tapped the Google Play badge (`location` says which one: `home_hero`, `home_final`, calculator slots, `app_demo`, `install_page`) |
| `gumroad_click` | Homepage, calculator pages, the app (web only) | Someone tapped a Gumroad link. In the app `location` is `app_` plus the button (`app_settings`, `app_whatif-transfer`, `app_whatif-dialdate`); the app also still sends its older `buy_clicked` |
| `home_to_app` | Homepage | Someone went from the homepage to the dashboard |
| `demo_scrolled_half`, `demo_scrolled_end` | The app's example screen | A first-time visitor scrolled half way, or to the end, of the example (once each per visit) |
| `demo_tab_view` | The app's example screen | A first-time visitor opened another tab while the example was showing (`tab` says which) |
| `demo_dismissed` | The app's example screen | A first-time visitor left the example for their own numbers (`via` is `start_my_numbers` for the banner button, `fab` for the floating button) |
| `arrive_from_search` | Calculator pages and hub | First page of a visit that came from a search engine. Params `landed_on` (page slug) and `source` (referrer or utm) |
| `arrive_from_ai` | Calculator pages and hub | Same, for visits from AI assistants (ChatGPT, Perplexity, Claude, Gemini, Copilot and similar) |

`arrive_from_*` is checked once per browser session, on the first page viewed,
and fires only for an outside search or AI referrer (or a matching
`utm_source`). Google's AI Overviews and AI Mode arrive as google.com and count
as search; Google doesn't separate them.
To break them down by page in GA4 reports, `landed_on` and `source` have to be
registered as custom dimensions (a Kevin step in GA4 admin).

## Shipping rules

**Three files move together and must carry the same version:**

- `APP_VERSION` in `dashboard.html`
- `CACHE_NAME` in `sw.js` — format `debtfree-<version>`, e.g. `debtfree-1.28.5`
- `version` in `app/version.json`

If `version.json` doesn't ship, every device goes blind on the update. If
`CACHE_NAME` doesn't change, installed PWAs keep serving stale HTML. Both have
happened; both cost hours.

Other rules:

- **Commit all changed files in ONE commit** via GitHub Desktop. Separate pushes
  cancel each other's Pages builds and produce alarming red X's.
- **Preserve CRLF line endings** — the repo files use them. Normalize to LF for
  editing, write back as CRLF, or the diff shows every line as changed.
- Add a `RELEASE_NOTES` entry in `dashboard.html` and matching notes in
  `version.json`, written for users (plain language, no jargon, explain what it
  means for them, not what the code does).
- Use real dates. Kevin's date is authoritative if it differs from Claude's.
- Bump patch for fixes, minor for user-visible features.
- **Never run `git commit` from the Cowork Linux VM.** It has no `autocrlf`, so
  it would write CRLF into the blobs and turn a 30-line change into a
  23,000-line diff. Claude writes files; Kevin commits in GitHub Desktop.
  To see what GitHub Desktop will see:
  `git -c core.autocrlf=true --no-optional-locks status --short`
- **Claude pushes to `main` itself (Kevin, 2026-11-12).** Cloud sessions
  commit and push directly to `main` once the tests pass; no pull request and
  no separate go-ahead. This reverses the PR-only rule of 2026-11-10. `main` is
  production: a push deploys the website and the Play app within minutes.
  Rules for every push:
  - Gate is the test run. Any new failure (compared with `main` before the
    change) means do not push; report it instead.
  - Read all user-facing copy for compliance before pushing; tests can't.
  - `git fetch origin main` and rebase immediately before pushing (Kevin may
    have committed from GitHub Desktop).
  - One commit per release, with `APP_VERSION`, `CACHE_NAME` and
    `version.json` matching. Several commits may go up in one push; never
    push twice in quick succession (Pages builds cancel each other).
  - Never force-push `main`.
  - After pushing, confirm with `git ls-remote origin main` and report the
    commit hash, version and what changed.
  - Kevin pulls in GitHub Desktop before any local edit.
  The repo stores LF in git, so a Linux commit is fine; the CRLF warning above
  is about the Cowork VM's working copy.

## The dev build (`app/dev.html`)

**Why it exists.** GitHub Pages only serves `main`, so a feature branch cannot
be opened on a real iPhone. Every hard bug this project has hit — viewport
units, the header haze, blocked storage, the service worker that had never
precached anything — was only visible on a real device. `app/dev.html` is how
in-progress work gets onto that device.

**It is a build output.** Never edit `app/dev.html`. Every change belongs in
`app/dashboard.html`; then regenerate:

```bash
node tools/make-dev.js          # app/dashboard.html -> app/dev.html
```

The generator refuses to write a partly-transformed file. If an anchor stops
matching because `dashboard.html` changed shape, fix the anchor in
`tools/make-dev.js` — do not ship past the error. A dev build that has lost its
storage namespace writes directly into real debt data.

**Five transforms, each guarding a specific hazard:**

| Transform | Hazard it prevents |
|---|---|
| `localStorage` namespaced to `dev::` | An in-progress schema change overwriting real debt data in the same browser — permanently, with no undo |
| Service worker disabled + torn down | `sw.js` is scoped at the site root, so it caches `dev.html` and serves a stale build back on the next test |
| Update check neutered | Dev carries a higher `APP_VERSION` than live `version.json`, so the real check reports an "update" and tries to migrate the tester onto prod |
| GA4 + Clarity removed | Four weeks of dev reloads quietly inflating the funnel numbers the pricing decision rests on |
| `noindex`, `[DEV]` title, no manifest, DEV badge | Dev being indexed, installed over the real PWA, or mistaken for prod in a tab switcher |

The storage guard is a **façade over `localStorage`**, not a rename of the known
keys. The app already uses at least one un-prefixed key (`installDismissed`) and
new features add more; a façade cannot miss a key that did not exist when it was
written.

**After changing `tools/make-dev.js`, or when `dashboard.html` changes shape
around an anchor, re-run the proof:**

```bash
python3 -m http.server 8911      # from the repo root, another shell
node tools/verify-dev.js         # expect ALL PASS
```

The last check is a negative control — prod must **still** send analytics — so a
green run cannot just mean everything is broken.

**Two things the dev build does not isolate.** Google Drive backup still talks to
the real Google account (it will create its own file rather than overwrite the
real backup, because `debtfree_drive_fileid` is namespaced — but do not use dev
to test Drive against real data). And a Gumroad licence entered in dev is stored
under `dev::`, so premium must be re-activated there.

## Branching

`app/dev.html` solves device testing; it does not solve isolation of the work
itself. For a long-running feature, branch — GitHub Desktop handles it from the
branch dropdown.

A branch beats a duplicated file for this codebase specifically: `dashboard.html`
is one ~650KB file, so a second copy means every prod hotfix has to be applied
twice by hand, and a missed one silently reverts shipped work at merge time.
Git applies a hotfix to the right lines on its own and only raises a conflict
where the same lines genuinely changed.

Rules that keep a long branch cheap:

- Merge `main` into the branch the **same day** as any prod hotfix, not at the
  end. Four weeks of unmerged hotfixes is where the pain actually lives.
- Only branch for work with real blast radius. Additive, paywalled features
  (amortization, CSV export) can go straight to `main` — a free user's
  experience is unchanged, and shipping early beats a dark branch.
- Branch when a change alters what an existing number *means* across tabs.
  Sinking funds touches `extraMonthly`, which Dashboard, Strategy, What-If,
  Cash-Flow and Roadmap all read — that is a branch.

## Testing expectations

Nothing ships without tests run against real data. There is a Node harness
pattern: extract the second `<script>` block, stub the DOM/localStorage/Chart,
cut the script at the boot marker, and eval the definitions plus a test body.
Playwright is available for real-browser checks.

Always verify:

- **Ledger identity** for every debt:
  `balance = originalBalance + accruals + adjustments − non-pending payments`
- **Monotonicity**: more money (monthly extra or lump) must never produce a
  later payoff date or higher interest. Sweep a range, don't spot-check.
- **Cross-tab agreement**: Dashboard, Strategy, What-If, Cash-Flow and Roadmap
  must agree on months and interest for the same inputs.
- **Both tiers**: premium renders a portfolio table, free renders cards, via
  different code paths. A change to one usually needs the other.
- **Both debt views**: the free tier renders cards and premium renders the
  portfolio table, via different code paths. Anything added to one must be
  checked against the other. True Cost (v1.30.1) and the promo/progress data
  (v1.32.0) were each built for cards and silently skipped the table, leaving
  paying users with less information than free ones.
- **State-meaning changes need a sweep, not a patch.** When a change alters what
  a debt's state *means* — balance transfers being the example — grep for every
  site that infers meaning rather than fixing them as they surface. `balance <= 0`
  is treated as "eliminated" in at least nine places: progress %, totalPaid,
  the trophy case, the Wins list, the Wins stat cards, milestone keys,
  celebration payloads, share cards and the payment log. Missing one ships a
  metric that contradicts the others.
- **Fixtures**: `test-primary.json` (9 debts, engineered so all three strategies
  diverge, plus promo expiry, a payment trap, an excluded debt, HTML-escaping
  bait, and a paid-off debt) and `test-minimal.json` (first-run states).

## Compliance — non-negotiable

Kevin works at a major financial firm in a non-licensed capacity. All user-facing
copy stays in personal-experience or neutral-tool framing. No "you should"
advice, no recommending specific financial products. Describe what the math
shows; never tell someone what to do with their money.

## Working style

- Pull him back before building: is this viable, does it solve a real problem?
- Ask clarifying questions before challenging a proposal; show the *why* behind
  objections with specifics, never a bare verdict.
- Flag problems proactively — Claude knows the code better than he does.
- Be a thinking partner, not a yes-man. If data suggests pausing or stopping,
  say so directly.
- Thoroughness over speed on correctness; speed on shipping once decided.
- Concise responses. Skip nitpicky code commentary.
- When a calculation looks wrong, reproduce it computationally before
  explaining. Several real bugs surfaced exactly this way.

## Change log

The app's own version history, written for users, is `RELEASE_NOTES` in
`app/dashboard.html` (mirrored in `app/version.json`). This log adds what those
notes don't cover: site pages, tracking, the Play listing and project setup.
Dates are Kevin's (Eastern time). Newest first.

- **2026-11-13 (later)** — v1.64.0: example screen. The floating button
  says "Start with my numbers" while the example shows (it used to log a
  payment on the sample debts); the "Add due dates" invite is hidden on the
  example; inside Instagram, Facebook and TikTok the "open in your browser"
  warning waits until the visitor starts with their own numbers instead of
  greeting them on arrival. New events `demo_scrolled_half`,
  `demo_scrolled_end` and `demo_tab_view` show how far people get into the
  example. Why: none of the ~7 US web-app visitors in Nov 6–12 left the
  example, and the example offered no way out below the first screen.

- **2026-11-13** — v1.63.0 (PR #7): Google Play badge for Android browsers
  on the app's example screen and the install page (never in the Play app or
  on iPhone). The app's Gumroad buttons now also send `gumroad_click`, and
  Play badges in the app send `play_badge_click`, so the traction report's
  click counts cover the app. Why: GA4 for Nov 5–11 showed only 2 of 23 US
  visitors reached the homepage, where the buy buttons were; most opened the
  app straight from a bio or shared link, and none of the web-app visitors
  left the example screen to enter a debt.

- **2026-11-12 (later)** — v1.58.1: debts saved before issuers existed get
  one guessed from the name once (`issuer === undefined` only; an explicit
  null "Not listed" is kept). v1.59.0: 28 more logos (43 of 52) rasterised at
  build time from Wikimedia Commons to 72px WebP and embedded in `ISSUERS`
  (`img` field); monograms remain for USAA, Credit One, Bread/Comenity,
  Mission Lane, Upstart, Best Egg, MOHELA, Aidvantage, Westlake. v1.59.1:
  `.modal-overlay` scrolls when a modal is taller than the screen (Edit Debt
  Save was unreachable on phones). v1.60.0: strategy picker cards show each
  method's debt-free month and interest on the "Your plan today" basis, with
  a neutral "Lowest interest" chip (`strategyCardResults`, own optimizer memo
  so switching strategies stays fast); Add Debt now shows a preview and only
  saves on "Confirm and save" (`addDebt(true)`).
- **2026-11-12** — Process: Claude pushes straight to `main` again (see
  Shipping rules). v1.57.0 "See your progress at a glance": red-to-green
  payoff bar on every debt (cards and premium table share one helper),
  debt-type colour bands, add-debt field guide, light theme for new users
  only, theme applied before first paint. v1.58.0 "Logos and credit
  limits": new debt fields `issuer` (52-entry bundled catalog, 15 Simple
  Icons logos, brand-colour monograms for the rest; bundled so no lender
  name leaves the device) and `creditLimit` (credit cards only) with a
  credit-used bar. Next planned (Release 3): strategy cards showing the
  user's own months/interest per method, and a preview before saving a debt.
- **2026-11-10** — Calculator pages `debt-snowball-spreadsheet`,
  `debt-payoff-spreadsheet` and `debt-payoff-planner` added (PR #4), with a
  free CSV download of the payoff schedule and print, and added to
  `sitemap.xml`. GA4 `arrive_from_search` / `arrive_from_ai` added to every
  calculator page and the hub (PR #5). Kevin resubmitted the sitemap and
  requested indexing for the three pages in Search Console.
- **2026-11-10** — v1.56.0 "Pay twice a month" (PR #3): optional second payment
  day per debt (`dueDay2`); Coming Up shows half the minimum by the earlier day
  and the rest by the later one; payoff math unchanged. Confirmed live on
  Kevin's iPhone.
- **2026-11-10** — v1.55.3 and v1.55.4: the Play app explains that buying
  Premium needs Chrome; Microsoft Clarity no longer loads in the Play app
  (website unchanged). New Play short description and six captioned
  screenshots sent for Google review. Trader status declared in Play Console.
- **2026-11-08** — v1.55.1: Play billing retries; Play-build detection limited
  to our own app.
- **2026-11-07** — Android app live on Google Play ($24 Premium, same as
  Gumroad). v1.55.0: Play review prompt, any orientation. Google Play badge on
  the homepage and calculator pages.
