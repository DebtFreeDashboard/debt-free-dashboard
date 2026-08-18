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

Live: `mydebtdashboard.com` (homepage) and `/app/dashboard.html` (the app).

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
