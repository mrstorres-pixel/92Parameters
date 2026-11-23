export const REPORT_TIMEZONE = "Asia/Manila";
const DAY = 86400000;
export function businessDate(value = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function midnight(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || ""))
    throw new Error("Select a valid report date.");
  const timestamp = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(timestamp) || businessDate(timestamp) !== date)
    throw new Error("Select a valid report date.");
  return timestamp;
}
function shiftMonths(timestamp, months) {
  const local = new Date(timestamp + 8 * 3600000);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
  ).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return local.getTime() - 8 * 3600000;
}
export function reportRange({
  range = "today",
  customStart = "",
  customEnd = "",
  lookbackAmount = 8,
  lookbackUnit = "months",
  monthValue,
  now = Date.now(),
} = {}) {
  const today = midnight(businessDate(now));
  let startMs = today,
    endExclusiveMs = today + DAY;
  if (range === "yesterday") {
    startMs -= DAY;
    endExclusiveMs -= DAY;
  } else if (range === "week") startMs -= 6 * DAY;
  else if (range === "month") startMs -= 29 * DAY;
  else if (range === "year") startMs -= 364 * DAY;
  else if (range === "all") startMs = 0;
  else if (range === "custom") {
    startMs = customStart ? midnight(customStart) : 0;
    endExclusiveMs = customEnd ? midnight(customEnd) + DAY : today + DAY;
  } else if (range === "lookback") {
    const amount = Number(lookbackAmount);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10000)
      throw new Error("Enter a whole look-back amount between 1 and 10,000.");
    startMs =
      lookbackUnit === "days"
        ? today - amount * DAY
        : shiftMonths(today, -amount * (lookbackUnit === "years" ? 12 : 1));
  } else if (range === "calendar-month") {
    startMs = midnight(`${monthValue}-01`);
    endExclusiveMs = shiftMonths(startMs, 1);
  }
  if (startMs >= endExclusiveMs)
    throw new Error("The end date must be on or after the start date.");
  return {
    startMs,
    endExclusiveMs,
    startDate: businessDate(startMs),
    endDate: businessDate(endExclusiveMs - 1),
    timezone: REPORT_TIMEZONE,
  };
}
export function reportDateTime(value) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: REPORT_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
