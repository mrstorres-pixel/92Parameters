# Payment photos, kitchen tablet and report performance

**For the café operator:** run the first two SQL files below in project `glbrfvqdtwvwzxbumeac`, then save its `service_role` key in Vercel as `SUPABASE_SERVICE_ROLE_KEY` for Preview and Production. I can configure the remaining settings and run server-side preparation checks. Wait for a verified preview before the final cutover SQL and production release. The rest of this document is the technical reference for that work.

If a check says the new tables are missing, open the café's SQL Editor using the project ID above, paste the **entire** preparation file and run it. Check for an SQL error instead of assuming that an empty result means every statement ran. The server health check now verifies the table and required columns with GET, avoiding PostgREST's empty-HEAD-404 behavior.

This release is prepared on `pos-proof-kitchen`. It does not activate the new payment or login rules until `VITE_SECURE_BACKEND=true` is built into the frontend. The existing café database is not available through the connected Supabase accounts, so its migrations and live audit must be run in the café's SQL Editor.

## 1. Fix the 30-day report independently

Run [the read-only audit](../supabase/audits/report_performance_readonly.sql), saving its totals and timing. Then run [20261123123549_report_snapshot_performance.sql](../supabase/migrations/20261123123549_report_snapshot_performance.sql) in project **glbrfvqdtwvwzxbumeac**. Run the audit again for the same dates. All totals must match. This migration changes how often receipts are normalized, without changing formulas or saved receipts. It can be applied while the current app is running.

The isolated 2,000-receipt test deep-compares the old and new complete snapshots (excluding generation time), filtered exports and cash totals. It measured approximately 1.6 seconds versus 0.27 seconds locally; live performance still needs the café audit.

## 2. Prepare the secure backend

Run [20261123123552_secure_pos_kitchen.sql](../supabase/migrations/20261123123552_secure_pos_kitchen.sql). This is additive preparation: new private tables/functions, a private `payment-proofs` bucket, optional product preparation routing, and staff credential fields. Original transactions are untouched. Do **not** run the cutover file yet.

Configure these in the existing **92-parameters** Vercel project, for the environment being tested:

| Variable                    | Value / purpose                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Café project's URL                                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY` | Private server service-role key from that project                                                           |
| `SESSION_PEPPER`            | Random secret of at least 32 bytes; keep the same value across deployments/environments using this database |
| `CRON_SECRET`               | Separate random secret for retention cleanup                                                                |
| `VITE_SECURE_BACKEND`       | `true` to build the new frontend                                                                            |
| `SECURE_CUTOVER_ACTIVE`     | Leave unset during staging; set `true` for cutover                                                          |

Keep the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put service-role keys, the pepper or cron secret in `VITE_` variables, Git, screenshots or chat. Back up `SESSION_PEPPER` securely: replacing it requires a credential migration/reset. The browser receives a Secure, HttpOnly session cookie; the server checks staff role and credential version for every protected request.

Deploy a preview from this branch with those settings. `/api/health` should return `{"ready":true}`. Sign in as the owner and verify the current data, report totals, attendance and membership workflows. During staging, existing plaintext PINs remain for old clients; hashes are added on successful server login. Financial test sales should use an isolated copy of the database, not the operating café's records.

For local development, use `vercel dev` with private variables in your shell or an ignored `.env` file. Plain `npm run dev` runs only the Vite frontend. The automated browser fixture starts both layers against isolated PostgreSQL and requires no real credentials.

For a working local sample preview with temporary records, run `npm run preview:secure`, then open `http://127.0.0.1:5185/#/pos`. Owner PIN: **2468**; kitchen PIN: **9753**. Use different browser profiles for counter and kitchen. This preview is loopback-only, never contacts the café database, and discards its records when stopped. A desktop camera can be used on localhost; real tablet camera acceptance requires the HTTPS deployment.

## 3. Activate together during a quiet period

1. Save a database backup and keep a Supabase SQL Editor/admin session open. Finish pending checkouts and close every old tablet session. Existing open tabs remain available, but any previously prepared food must be handled carefully: historical orders have no kitchen dispatch history and must not be resent accidentally.
2. Confirm backend health and owner login on the secure preview. Configure the **production** Vercel variables above, including `VITE_SECURE_BACKEND=true` and `SECURE_CUTOVER_ACTIVE=true`, for the upcoming deployment. Existing deployments retain their previous environment until redeployed. Keep the preview's cutover flag unset while old clients are still in use.
3. Hash the remaining staff PINs with `node scripts/prepareStaffPins.mjs` in a trusted shell containing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the same `SESSION_PEPPER`. This script prints counts only, preserves the legacy PIN temporarily, and rejects missing/duplicate PINs. Do not paste credentials into the command or commit an environment file.
4. Run [20261123123554_secure_pos_cutover.sql](../supabase/migrations/20261123123554_secure_pos_cutover.sql). This intentionally revokes old anonymous table/RPC access and clears plaintext PINs with prepared hashes. Existing old clients will fail closed.
5. Merge the tested branch into the existing GitHub production branch. Its Vercel integration builds with the production variables from step 2. Wait for the new deployment's API health, then reload all tablets. Do not merge with the secure frontend flag disabled after cutover, or promote an older deployment built with the staging settings. Allow a short maintenance window between SQL cutover and the new deployment becoming ready.
6. Run the read-only activation checks below. Test the owner's normal workflows and kitchen permissions before reopening counter operations.

After cutover, a frontend rollback to the old app alone will **not** restore service because old anonymous access is deliberately revoked. Prefer rolling forward to the last working secure build, retaining the same secret and schema. A full legacy rollback requires a reviewed grant/credential restoration from the backup; do not broadly grant all tables or expose the private bucket.

## 4. Set up the kitchen iPad

As owner, create a staff profile with role **Kitchen** and a unique PIN. Open the same HTTPS café URL on the kitchen tablet and sign in with that PIN. It opens **Kitchen tickets** and has no financial, customer, staff, report or payment-photo access, including direct API calls.

Food routes to the kitchen automatically. In Products, **Preparation routing** can override this to Kitchen or None. Packaging and waste never become kitchen tickets. Drinks stay off the kitchen screen unless explicitly routed there.

At the counter, enter the food and notes, choose a table/order label and tap **Send to Kitchen**. Payment can happen later. After loading an unpaid kitchen order or tab, send additions/changes with **Send kitchen updates**. Checkout sends any remaining food in the same database transaction as payment; already-sent quantities are not resent. Close/cancel sent orders with a reason; the kitchen must acknowledge the cancellation. Voiding a paid receipt uses the existing manager/owner authorization workflow and sends a cancellation notice.

Kitchen staff check each item, then **Complete ticket**. Changes/removals require acknowledgement before preparation continues. Completed tickets can be reopened. The screen polls every two seconds while visible, fully syncs on return/reconnect and every 30 seconds, and retains its last confirmed data with actions disabled during connection failures. Keep Safari awake; background tablets do not receive reliable live browser updates. No audible/background notification is promised.

## 5. Payment photos and retention

Every positive **Card** or **Bank Transfer** portion needs its own fresh camera photo before completion, including split payments. Changing a method or amount invalidates its photo. No gallery picker is provided. Camera/upload failure keeps checkout blocked; allow camera access for the café site and retry. Use the actual rear camera on each iPad during acceptance testing.

Photograph the terminal approval slip or transfer confirmation, keeping full card numbers/security codes out of view. The server checks JPEG content, strips metadata and compresses it to at most 1 MB. Photos remain in a private bucket. Only owner/manager receipt details can generate a 60-second viewing link. Owners can delete evidence with an audited reason. Historical receipts without photos remain valid.

Attached photos become inaccessible after **90 days**, and the daily Vercel cron removes their objects at **02:00 Philippine time** (`0 18 * * *` UTC). Unattached drafts expire after 24 hours. Cron runs only in production; check its Vercel logs after activation. Failures are retried by the next run; expired photos remain inaccessible even if physical deletion is delayed. Very large cleanup backlogs are removed over successive runs (1,000/run). Metadata and audit events remain after image removal.

## Acceptance / evidence

- `npm test`: financial reconciliation, permissions, PIN hashing, session revocation, private proof lifecycle, attendance approval, SQL atomicity, split photos, stale versions, stock reversal and report performance.
- `npm run test:browser`: existing report/tablet/export workflows.
- `npm run test:secure-browser`: actual frontend → API → isolated PostgreSQL with two tablet sessions and a synthetic camera. Set `REPORT_TEST_BROWSER=webkit` for WebKit; optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` / `PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH` select installed browsers. The Windows WebKit fixture supplies a synthetic frame because that build lacks canvas streaming. This does not replace a real iPad camera check.
- Check 820×1180 and 1180×820: food-only tickets, long names/notes, no duplicate sends, changes/cancellation, completion/reopen, network loss/recovery, and reachable dialog actions. Verify both Card and Bank Transfer and a split before use.
- Live migration, Storage permissions, real iPad capture, cron execution and production report timing remain deployment acceptance steps; isolated test success does not claim these have run against the café.

The unrelated original startup edits in `src/App.jsx` and `src/utils/seedData.js` remain in the main checkout, outside this isolated worktree.

Compatible dependency fixes removed the four high-severity advisories found during implementation. Two existing moderate React Router advisories remain; the suggested remediation requires a separate major-version upgrade. The app uses fixed internal navigation and no server-rendered router hydration. Do not run `npm audit fix --force` as part of activation.
