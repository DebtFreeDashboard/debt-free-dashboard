# DebtFree Dashboard — Test Fixtures

Three JSON backups for regression testing. Load via **Backup & Restore → Import
Backup** on the Dashboard tab. Validated against **v1.26.1** (Aug 6, 2026).

> **Always export your own data first** — restoring overwrites localStorage.

---

## `test-primary.json` — full regression fixture

9 debts, engineered so **every strategy produces a visibly different plan**.
Real user data usually doesn't have that property, and its absence is what let
several bugs hide for weeks.

**Settings:** avalanche · $450/mo extra · premium expected · light theme

### Expected results (v1.26.1, $450 extra)

| Strategy  | Attacks       | Months | Total interest |
|-----------|---------------|--------|----------------|
| Snowball  | Store Card    | 25     | ~$8,181        |
| Avalanche | Big Bank Visa | 24     | ~$7,299        |
| Hybrid    | Auto Loan     | 25     | ~$9,621        |

**If all three collapse to the same numbers, something is broken.**
Exact figures drift as today's date advances — the *differences* are the test.

### What each debt covers

| Debt | Purpose |
|---|---|
| **Auto Loan** | Installment loan, fixed term. First in the array → **hybrid's target**. |
| **Big Bank Visa** | Highest passive interest cost → **avalanche's target**. Also carries a pending payment and a lump sum. |
| **Costco Citi** | Oversized minimum ($520) pays it off first while extra dollars go elsewhere → fires the **"attacking" line** on the Next Target card. |
| **Store Card** | Smallest balance → **snowball's target**. |
| **Balance Transfer 0%** | Promo expires ~10 months out → tests the 0% → 24.99% flip at the boundary month. |
| **Furniture 0% Plan** | 0% now, jumps to 26.99% in ~4 months, and the $55 minimum won't cover the interest → **True Cost promo time-bomb warning**. |
| **Medical** | `includeInStrategy: false` → must appear in lists but **never** in the payoff plan. |
| **Bob & Sue's \<Home\> Card** | Contains `&`, `<`, `>`, `'` → **HTML-escaping regression**. Must render literally, never as markup. |
| **Old Best Buy Card** | $0 balance → **Paid Off Debts** card, progress math, milestone baseline. |

### Also exercised
- **Pending future-dated payment** ($400, +1 month) — appears in
  `plannedDisbursements()` but must **not** reduce the balance yet.
- **Planned lump sums** ($3,000 + $2,000, +7 months) — chart markers, cash-flow
  release, and the v1.24.2 monotonicity fix (more money must never mean a later
  payoff date).
- **Accrual + adjustment ledger** — `balance = original + accruals + adjustments − payments`
  reconciles exactly for all 9 debts.
- **Dial-a-Date** — a 24-month target is reachable.

---

## `test-minimal.json` — first-run / simple-state fixture

2 debts (one card, one installment loan), no payments, no lumps, no promos,
**$0 extra**, snowball. Use with **premium off**.

Covers: empty and simple states, the "no extra payment set" path, premium
teasers, True Cost on a clean card, and the general first-run experience.

---

## `kevin-real-2026-09.json` — Kevin's real data (standing real-data case)

Kevin's own export from **2026-09-02**, taken right after v1.38.1. This is the file that
surfaced every real bug from July through September — the lump-sum stale target, the
$20,000.01 rounding, the promo-aware minimum floor, the month-1 sawtooth, and the
rolled-minimum gap. Run it before every ship, alongside `test-primary.json`.

**Settings:** optimized · $1,000/mo extra · premium · light theme · interest accrual on

**What makes it hard:** 12 debts, 5 active. Four 0% promo cards with minimums well below
their post-promo interest (the M1 floor case). Five closed accounts, four of them
**balance transfers** (`closedAs: 'transferred'`, must never count as wins or roll a
minimum). A $15,000 lump in Dec 2026 and a $20,000 group split across four cards in
Mar 2027. Thirty-five accrual rows and seven manual adjustments — the ledger identity
must reconcile to the cent on all 12.

**`rolledMinimums`:** Disney Visa $200, Amazon $35, USAA AMEX $225 — all `keep: false`.
Kevin rolls these himself and they are **not** in his $1,000, so the plan runs on
**$1,460/mo extra**. The Monthly Payment Summary must read $1,165 minimums + $1,460 =
**$2,625/mo** with all three ticked.

### Expected results (v1.38.1, 2026-09-02)

| Reading | Value |
|---|---|
| Freedom Date | **Jul 2027 · 10 months away** — identical on Dashboard, Strategy bar, What-If at rest, Roadmap |
| Plan interest | ~$651 |
| Monthly total | $2,625 |
| Ledger identity | 0 drift, all 12 debts |
| Monotonicity | 0 violations, $0–$4,000 extra and $0–$40,000 lump sweeps |
| Restore on a fresh device | **no** celebration (the milestone baseline runs before render) |

Exact months drift as the calendar advances (it is anchored to the current month); the
cross-tab agreement and the invariants are the test, not the literal date.

---

## Pre-ship smoke test (5 minutes)

1. Export your real data.
2. Import `test-primary.json`. On the **Strategy** tab, click through all three
   strategies and confirm the numbers diverge per the table above.
3. Reorder Hybrid with the ↑↓ buttons — every card and the payoff table should
   update **immediately**, without switching tabs.
4. Check the debt named `Bob & Sue's <Home> Card` renders literally.
5. Confirm **Furniture 0% Plan** shows the promo time-bomb warning.
6. Open **Paid Off Debts** — Old Best Buy Card should be there, and gone from
   the active list.
7. Import `test-minimal.json` with premium off to check first-run states.
8. Import `kevin-real-2026-09.json` — confirm the Freedom Date reads the same on Dashboard,
   Strategy and What-If, and the Monthly Payment Summary shows the three rolled minimums ticked.
9. Restore your own backup.

---

## Maintenance

Dates inside these files are anchored to their creation date. As real time
passes, promo windows shrink and eventually expire — when the Balance Transfer
or Furniture promos fall into the past, re-anchor the `promoEnd`, payment, and
lump dates forward so those code paths stay covered.
