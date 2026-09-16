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

`raw.githubusercontent.com` serves the committed file with no CDN lag, so it is
more reliable than checking the live site. In Cowork, read from the local clone
instead: `C:\Users\kevin\Documents\GitHub\debt-free-dashboard` (pull first).

## The product

DebtFree Dashboard — a single-file PWA debt payoff tool. `dashboard.html` is the
entire app (HTML/CSS/JS, localStorage, Chart.js, no backend). Freemium: generous
free tier, $12 one-time premium via Gumroad, verified by license key.

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
| `app/dev.html` | **Generated** dev build — never edit by hand (see below) |
| `tools/make-dev.js` | Generates `app/dev.html` from `app/dashboard.html` |
| `tools/verify-dev.js` | Proves the dev build is isolated from real data |

Live: `mydebtdashboard.com` (homepage) and `/app/dashboard.html` (the app).
Dev build: `/app/dev.html` — same origin, deliberately inert (see below).

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
