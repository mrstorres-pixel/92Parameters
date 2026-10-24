# Cash-out categories and operating profit

## One-time database setup

1. Open the cafe's Supabase project, `glbrfvqdtwvwzxbumeac`.
2. Open **SQL Editor** and create a new query.
3. Paste the complete contents of [`20261024111716_cash_out_categories.sql`](../supabase/migrations/20261024111716_cash_out_categories.sql) and run it.
4. Refresh the POS website. No environment-variable changes are required.

The migration adds one nullable category column and a constraint. It leaves all notes, amounts, staff records and dates intact. Existing cash-outs remain unclassified. It does not change database access policies or infer categories automatically.

## Daily use

- **Cash Drawer > Cash Out:** type notes and check the suggested category before saving. Category selection is optional, and a manual selection is retained while notes change.
- **Cash Drawer > Monthly Reports:** choose a month and enable **Only cash-outs needing category review**. The owner can review each record and save just its category. Notes and amounts stay unchanged.
- Mixed-purpose and unclear records should remain unclassified until their amounts can be assigned correctly.
- **Business Report:** select a date range to see **Estimated Operating Profit** and the cash-out category breakdown. The operating-profit section always uses all payment methods; the payment dropdown controls the existing sales breakdowns.

Estimated Operating Profit = Total Sales - recorded Cost of Goods Sold - categorized Operating Expenses.

Stock purchases are represented by the cost of products sold, and owner withdrawals are separate. Unclassified amounts are displayed in a provisional-estimate warning and are not deducted as operating expenses until classified. This estimate can omit unpaid expenses, expenses paid elsewhere and depreciation, and is before income tax and financing costs. Product costs and expense classification need to be complete for a useful result.

If the database migration has not been applied, existing cash-in/out recording and report reading still work. Saving a selected category displays an actionable setup error until the column exists.

## Verification

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Browser tests intercept all database traffic and use sample transactions. Migration tests run in a temporary in-memory PostgreSQL database; neither test suite changes live financial records.
