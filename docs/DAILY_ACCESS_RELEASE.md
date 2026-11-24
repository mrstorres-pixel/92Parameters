# Daily access and kitchen alerts

This release restores recipe names/units, adds kitchen arrival sounds, restricts cashier financial access to today's Philippine business date, displays Bank Transfer payment photos inline for owners/managers, and retires Milk / Waste from new POS entry. New checkout methods are Cash, Card, Bank Transfer and Grab. Historical payment methods and milk records stay intact.

## At the café

1. Refresh each tablet after deployment and sign in with the usual staff PIN.
2. On the kitchen tablet, open Kitchen tickets, tap **Enable sound**, then **Test sound**. Check the tablet volume. Enable sound again after reopening/reloading the page; browsers require a tap to activate audio.
3. Owners/managers can open a transaction or receipt preview to see its Bank Transfer photo. Card photos have a View photo control. Photos are excluded from printing/saving the receipt and retain their existing 90-day expiry.
4. Cashiers see today's receipts from all staff and payment methods, plus today's cash sales, cash in, cash out and drawer movement. Historical periods and cost/profit figures remain restricted at the server.

No SQL migration or new environment variables are required.

## Verification and release

- `npm test`: accounting, backend permissions, 1,105-receipt cashier pagination/export, Philippine midnight, payment validation, recipe single-object responses and audited/idempotent product retirement.
- `npm run test:secure-browser`: isolated PostgreSQL and real browser/API sessions for checkout, proof display, cashier screens, kitchen alerts, reconnect/mute, recipes and tablet orientations. Also run with `REPORT_TEST_BROWSER=webkit`.
- `npm run test:browser`: existing report, export, review, layout and touch-target regressions.
- `npm run build`.

The trusted release task `node scripts/checkDailyAccess.mjs` reads the fixed October 25–November 23 historical snapshot and today's sanitized report. It prints aggregate checks only. The default is read-only. An explicitly reviewed release can set `RETIRE_MILK=true` for that build task to set only matching milk products' `isAvailable` to false, with intent/completion events in `app_order_events`. It then asserts that the historical financial snapshot hash is unchanged. Do not run staff PIN preparation again.

Use the existing Vercel project. Preview builds require `VITE_SECURE_BACKEND=true` at build time and `SECURE_CUTOVER_ACTIVE=true` at runtime because the café database has already cut over. Keep service credentials exclusively in existing private server configuration. Do not publish protected preview access tokens.

Physical iPad speaker volume, silent output routing and background audio cannot be established by browser automation; use Test sound on the actual kitchen tablet. Arrival alerts suppress the initial backlog, repeated polls, revisions, completed/cancelled arrivals and reopened tickets. Multiple arrivals in one update share one chime.
