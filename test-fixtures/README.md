# DebtFree Dashboard — Test Fixtures

Two JSON backups for regression testing. Load via **Backup & Restore → Import
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
8. Restore your own backup.

---

## Maintenance

Dates inside these files are anchored to their creation date. As real time
passes, promo windows shrink and eventually expire — when the Balance Transfer
or Furniture promos fall into the past, re-anchor the `promoEnd`, payment, and
lump dates forward so those code paths stay covered.
