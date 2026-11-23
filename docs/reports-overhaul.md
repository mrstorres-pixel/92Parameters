# Reports v2 rollout and definitions

## Activate after database setup

This release changes reporting only after its additive database functions are installed. Apply `supabase/migrations/20261123021642_reports_v2.sql` in the **cafe project** (`glbrfvqdtwvwzxbumeac`), not another connected project. Existing receipt amounts, costs, quantities and cash notes are not rewritten.

Before switching production to this release, run `supabase/audits/reports_v2_readonly.sql` for the desired business period. The audit is read-only and uses one statement snapshot. Confirm sales allocation, recorded payment portions and preserved total costs, then inspect the listed issues. Unclassified withdrawals and unresolved costs deliberately keep operating profit hidden.

The migration adds explicit product reporting types, separate receipt-item/receipt-payment review records, an append-only review history, and `SECURITY INVOKER` report functions. It retains the existing app's underlying table permissions. Historical review writes require an owner PIN and review reason; direct anonymous writes to the new review tables are denied by RLS. This is compatible with the existing PIN-profile app, not a replacement for its authentication model.

No environment-variable changes are needed. A preview without the migration shows a setup message rather than partial or legacy totals. Keep production on the previous commit until the migration and audit are complete, then deploy the reports branch through the existing GitHub/Vercel integration.

## Definitions

All report dates use **Asia/Manila**; the final selected date is inclusive. Database requests use `[start, next-day-start)` boundaries. Seven days includes today plus six preceding days; thirty days includes today plus twenty-nine preceding days. The 365-day preset is labeled explicitly. Look-back month/year arithmetic clamps to the final valid day of the destination month.

- **Sales:** saved completed receipt totals after discounts and loyalty. Unknown statuses and invalid totals are flagged. Waste-only zero-amount records are not customer transactions; genuine free customer sales are included.
- **COGS:** historical saved costs for sold merchandise and packaging. Today's product prices/costs never replace past receipt costs.
- **Gross profit:** sales minus verified COGS.
- **Operating expenses:** reviewed operating-expense drawer withdrawals plus verified waste costs. Milk / Waste Full Cream is waste, not customer merchandise; confirm its legacy product classification once in Products > Reporting or Business Report > Data Review.
- **Operating profit:** sales minus COGS, operating-expense withdrawals, and waste. No amount is shown until relevant classification, cost, receipt and payment issues are resolved. This is a recorded result before tax and financing costs, not full accounting net profit. Expenses paid outside the drawer, unpaid expenses and depreciation are not automatically recorded.
- **Total cash out:** all physical drawer withdrawals, including stock purchases and owner drawings. These categories reconcile to total cash out but are not all operating expenses.
- **Recorded drawer movement:** recorded cash payment portions plus manual cash in minus cash out. It is neither profit nor a counted drawer balance; opening balances are not inferred.

## Reconciliation and review

PostgreSQL numeric arithmetic produces integer cents. Item-level adjustments are applied first. Receipt-level discounts and loyalty are allocated proportionally across eligible item amounts with deterministic largest-remainder rounding. Packaging appears in category reconciliation so category sales sum to receipt sales. Waste has no allocated customer revenue. Unexplained differences are flagged; acknowledging a verified legacy adjustment requires an owner PIN and audit reason.

Product reporting changes apply to future receipts and legacy items without an explicit snapshot type. An individual receipt-item review takes precedence over its snapshot type, then the explicit product type, then conservative legacy classification. Known milk/waste names are provisionally separated from customer rankings but block verified costs until confirmed. Zero/missing costs require review; an owner may confirm an intentional zero or enter the actual historical cost for that item. Every correction is stored separately and source-hashed; edits to originals invalidate stale reviews.

Transaction search, status, staff and payment filters apply before pagination. Summaries and payment totals cover the full matching dataset. A selected payment method's amount is separate from the full value of matching receipts. Exports request the full matching dataset in one snapshot, independent of the visible page. A split receipt may appear in several method counts; those counts are not additive. Zero-payment customer receipts are counted separately from payment collections. Delivery/platform methods describe POS-recorded payments, not actual payout settlement or commissions.

Cash report search/review filters change the list, while clearly labeled cash-period totals retain the full selected period. Notes suggest categories only; a saved category determines expense treatment. Reviewed category changes retain notes/amounts and add an owner-verified history entry.

## Local checks and live audit

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

The browser tests route all financial calls into an isolated PostgreSQL database running the actual migration. They cover profit gates, reviews, permissions, full-period pagination/export, stale requests, errors, Philippine dates under another browser timezone, mobile layout and tooltip readability. No live data is mutated.

`node scripts/auditReports.mjs 2026-11-17 2026-11-23` performs a read-only comparison using only the public browser configuration already used by the cafe site. It verifies stability across two reads, evaluates the new SQL against the downloaded records in an isolated database, and writes aggregate-only results to ignored `.tmp/reports-live-audit.json`. It never prints keys, owner PINs, or original financial records. Live records may change after the audit timestamp; the SQL audit after migration is the authoritative one-statement comparison.
