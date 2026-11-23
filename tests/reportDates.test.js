import test from "node:test";
import assert from "node:assert/strict";
import { reportRange, businessDate } from "../src/utils/reportDates.js";
import { reportProductSnapshot } from "../src/utils/reportProductSnapshot.js";
test("business periods use Philippine midnight independently of host timezone", () => {
  assert.equal(businessDate("2026-11-22T16:00:00Z"), "2026-11-23");
  const day = reportRange({ now: Date.parse("2026-11-22T17:00:00Z") });
  assert.equal(day.startMs, Date.parse("2026-11-22T16:00:00Z"));
  assert.equal(day.endExclusiveMs, Date.parse("2026-11-23T16:00:00Z"));
  assert.equal(
    reportRange({ range: "week", now: day.startMs }).startDate,
    "2026-11-17",
  );
  assert.equal(
    reportRange({ range: "month", now: day.startMs }).startDate,
    "2026-10-25",
  );
});
test("custom dates, leap months, years and calendar lookback clamp correctly", () => {
  const leap = reportRange({ range: "calendar-month", monthValue: "2024-02" });
  assert.equal(leap.endDate, "2024-02-29");
  const lookback = reportRange({
    range: "lookback",
    lookbackAmount: 1,
    lookbackUnit: "months",
    now: Date.parse("2024-03-31T10:00:00+08:00"),
  });
  assert.equal(lookback.startDate, "2024-02-29");
  assert.throws(
    () =>
      reportRange({
        range: "custom",
        customStart: "2026-11-24",
        customEnd: "2026-11-23",
      }),
    /end date/,
  );
  assert.throws(
    () => reportRange({ range: "custom", customStart: "2026-02-30" }),
    /valid report date/,
  );
  assert.throws(
    () => reportRange({ range: "lookback", lookbackAmount: 1.5 }),
    /whole look-back/,
  );
});
test("future product snapshots distinguish waste and preserve explicit classifications", () => {
  assert.deepEqual(reportProductSnapshot({ category: "Drinks" }), {
    reportingType: "sale",
    costZeroConfirmed: false,
  });
  assert.equal(
    reportProductSnapshot({
      name: "Milk / Waste Full Cream",
      category: "Drinks",
    }).reportingType,
    undefined,
  );
  assert.deepEqual(
    reportProductSnapshot({
      name: "Milk / Waste Full Cream",
      reportingType: "waste",
      costZeroConfirmed: true,
    }),
    { reportingType: "waste", costZeroConfirmed: true },
  );
  assert.equal(
    reportProductSnapshot({ category: "Takeout Box" }).reportingType,
    "packaging",
  );
});
