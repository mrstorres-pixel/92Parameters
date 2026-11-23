# Tablet reports

Reports use the café's espresso, brown, cream, and gold palette. The shared report surface owns these styles; the only app-wide change enables browser zoom.

## Layout and interaction

- Business, Transactions, and Cash are report destinations. Business sections remain keyboard-accessible tabs.
- The date toolbar shows Today, 7 Days, 30 Days, Custom, and a native More periods selector. It shares space with refresh and the generation timestamp.
- Tablet portrait uses two metric columns. Four columns require 928px of content width; paired panels require 860px. Narrow phones use one metric column to keep amounts readable.
- Body and input text is 16px; supporting text is at least 14px. Primary controls are at least 48px high, and other targets at least 44px. Checkbox labels provide the full touch target.
- Exact chart labels and values are always visible. Supplemental calculation explanations and value tables use native disclosures instead of hover-only tooltips.
- Transaction details preserve receipt, void, and owner-delete actions. Cash record disclosures preserve notes, staff, and category review. Secondary fields leave the narrow table, not the record.
- Dialog bodies scroll within the visible viewport. Headers, close buttons, and footers remain outside that scroll area.

## Financial behavior

No database migration or query changes are required. Saved receipt values, rounding, review rules, full-period totals, exports, and permissions remain unchanged. Operating expenses combine reviewed operating cash-outs and verified waste. Profit stays hidden while required inputs need review.

## Verification

`npm test` covers accounting and reconciliation. `npm run test:browser` runs the application against an isolated PostgreSQL fixture, with external traffic intercepted.

The browser workflow covers 820×1180 and 1180×820 layouts plus 768px, 1024px, and phone widths; active tabs and filters survive rotation. It checks 44px touch targets, 14px supporting text, 4.5:1 text contrast, permanent chart values, pending and negative profit, empty periods, record actions, complete exports, modal focus, and failed requests.

Use `REPORT_TEST_BROWSER=webkit` to run the same workflow in WebKit. Optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH` select locally installed browser binaries. Browser automation supplements a real-iPad check; it does not reproduce the iPad onscreen keyboard.

Screenshots are written under ignored `.tmp/reports-tablet-*` paths for Overview, Profit, Transactions, daily Cash, and Monthly Cash in both orientations. Review the preview on a tablet before publishing to production.
