// Run only in a trusted server/build environment. Never prints credentials,
// PINs, receipt rows, signed URLs or customer details. Financial rows are read-only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { getAdmin } from "../server/backend.js";
import { reportRange } from "../src/utils/reportDates.js";
import { verifyPin, pinLookup } from "../server/security.js";

const admin = getAdmin();
const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (savedKey.startsWith("eyJ")) {
  const claims = JSON.parse(
    Buffer.from(savedKey.split(".")[1], "base64url").toString(),
  );
  assert.equal(
    claims.role,
    "service_role",
    "The saved server key must be the service_role key.",
  );
  assert.equal(
    claims.ref,
    "glbrfvqdtwvwzxbumeac",
    "The saved server key belongs to a different project.",
  );
}
assert.equal(
  new URL(process.env.SUPABASE_URL).hostname,
  "glbrfvqdtwvwzxbumeac.supabase.co",
  "Unexpected database target.",
);
const check = (result, label) => {
  if (result.error)
    throw new Error(
      `${label}: ${result.error.code || result.error.statusCode || "request failed"}`,
    );
  return result.data;
};
const expected = {
  app_sessions: "token_hash,staff_id,auth_version,expires_at",
  staff: "id,name,pin,pin_hash,pin_lookup,role,auth_version,hourlyRate",
  products:
    "id,name,category,price,cost,reportingType,costZeroConfirmed,prepStation",
  app_orders:
    "id,items,sent_items,revision,order_discount,order_discount_amount,running_bill_id,transaction_id,status",
  kitchen_tickets:
    "id,order_id,dispatch_key,items,revision,status,change_notice,cancel_requested,created_at,updated_at,completed_at",
  payment_proofs:
    "id,checkout_key,method,amount_cents,staff_id,object_path,status,transaction_id,expires_at",
  app_stock_effects: "transaction_id,kind,target_id,delta",
  app_dispatch_requests: "key,order_id,actor_id,payload_hash,result",
  app_checkouts: "checkout_key,payload_hash,staff_id,transaction_id",
  running_bills:
    "id,items,tableName,orderType,orderDiscount,orderDiscountAmount,total,status,updatedAt,closedAt,transactionId",
  transactions:
    "id,receiptNo,checkoutKey,datetime,items,paymentLines,orderDiscount,orderDiscountAmount,subtotal,customerId,customerName,memberCode,loyaltyEarned,loyaltyRedeemed,loyaltyDiscount,birthdayRewardRedeemed,total,cashReceived,staffId,staffName,status",
  time_records: "id,staffId,date,timeIn,timeOut,photoIn,photoOut,salaryEarned",
};
let schemaErrors = 0;
for (const [table, select] of Object.entries(expected)) {
  const response = await admin.from(table).select(select).limit(0);
  if (response.error) {
    schemaErrors++;
    console.log(
      `Schema check ${table}: ${response.error.code} ${response.error.message}`,
    );
  }
}
assert.equal(
  schemaErrors,
  0,
  "Database migration/API schema checks must pass before preparation.",
);
console.log(
  "PASS: required database tables and columns are accessible to the server.",
);

const anonymous = createClient(
  process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const privateResult = await anonymous
  .from("app_sessions")
  .select("token_hash")
  .limit(1);
assert.ok(
  privateResult.error,
  "Anonymous access to private sessions must be denied.",
);
const noActor = await admin.rpc("app_kitchen_feed_v1", {
  p_actor: 0,
  p_since: null,
});
assert.match(
  noActor.error?.message || "",
  /Kitchen access required/,
  "Kitchen RPC must validate its actor.",
);
console.log(
  "PASS: private session data is denied to anonymous clients; kitchen actor enforcement works.",
);

const dates = reportRange({
  range: "custom",
  customStart: process.env.AUDIT_FROM || "2026-10-25",
  customEnd: process.env.AUDIT_TO || "2026-11-23",
});
const started = performance.now();
const report = check(
  await admin.rpc("report_business_v2", {
    p_start_ms: dates.startMs,
    p_end_exclusive_ms: dates.endExclusiveMs,
  }),
  "30-day report",
);
const elapsedMs = Math.round(performance.now() - started);
const completed = report.transactions.filter((tx) => tx.status === "completed");
const savedCents = completed.reduce(
  (sum, tx) => sum + Math.round(Number(tx.total) * 100),
  0,
);
const allocatedCents = completed.reduce(
  (sum, tx) =>
    sum +
    tx.report.unallocatedCents +
    tx.report.lines.reduce((n, line) => n + line.salesCents, 0),
  0,
);
const classified =
  report.totals.operatingCashOutCents +
  report.totals.stockPurchaseCents +
  report.totals.ownerWithdrawalCents +
  report.totals.unclassifiedCents;
assert.equal(
  savedCents,
  report.totals.salesCents,
  "Report sales differ from saved receipts.",
);
assert.equal(
  allocatedCents,
  report.totals.salesCents,
  "Receipt allocations differ from saved totals.",
);
assert.equal(
  classified,
  report.totals.cashOutCents,
  "Cash-out categories do not reconcile.",
);
const counted = await admin
  .from("transactions")
  .select("id", { head: true, count: "exact" })
  .gte("datetime", dates.startMs)
  .lt("datetime", dates.endExclusiveMs);
check(counted, "Receipt count");
assert.equal(
  report.transactions.length,
  counted.count,
  "Report omitted receipts.",
);
console.log(
  JSON.stringify({
    check: "30-day report",
    elapsedMs,
    receiptCount: report.transactions.length,
    allReceiptRowsReturned: true,
    savedSalesMatch: true,
    allocationsMatch: true,
    cashOutCategoriesMatch: true,
    issueCount: report.totals.issueCount,
    unclassifiedCashOutCount: report.totals.unclassifiedCount,
    profitInputsReviewed:
      report.totals.costReady &&
      report.totals.salesReady &&
      report.totals.cashReady &&
      report.totals.issueCount === 0 &&
      report.totals.unclassifiedCount === 0,
  }),
);

const bucket = check(
  await admin.storage.getBucket("payment-proofs"),
  "Private photo bucket",
);
assert.equal(bucket.public, false, "Payment photo bucket must be private.");
const path = `setup-probe/${randomUUID()}.jpg`;
const photo = await sharp({
  create: { width: 32, height: 32, channels: 3, background: "#fff" },
})
  .jpeg()
  .toBuffer();
let uploaded = false;
try {
  check(
    await admin.storage
      .from("payment-proofs")
      .upload(path, photo, { contentType: "image/jpeg", upsert: false }),
    "Private photo upload probe",
  );
  uploaded = true;
  const signed = check(
    await admin.storage.from("payment-proofs").createSignedUrl(path, 30),
    "Signed photo access probe",
  );
  const signedResponse = await fetch(signed.signedUrl);
  assert.equal(signedResponse.status, 200, "Signed photo access failed.");
  await signedResponse.arrayBuffer();
  const { data } = admin.storage.from("payment-proofs").getPublicUrl(path);
  const publicResponse = await fetch(data.publicUrl);
  assert.notEqual(
    publicResponse.status,
    200,
    "Payment photo is publicly readable.",
  );
  await publicResponse.arrayBuffer();
} finally {
  if (uploaded)
    check(
      await admin.storage.from("payment-proofs").remove([path]),
      "Photo probe cleanup",
    );
}
console.log(
  "PASS: private photo upload, short-lived signed access, public denial and probe deletion.",
);

if (process.env.PREPARE_STAFF_PINS === "true") {
  assert.notEqual(
    process.env.SECURE_CUTOVER_ACTIVE,
    "true",
    "Preparation must retain the existing login method.",
  );
  await import("./prepareStaffPins.mjs");
  let reviewed = 0;
  for (let offset = 0; ; offset += 500) {
    const rows = check(
      await admin
        .from("staff")
        .select("id,pin,pin_hash,pin_lookup")
        .order("id")
        .range(offset, offset + 499),
      "Prepared staff verification",
    );
    for (const row of rows) {
      assert.ok(row.pin, "The existing PIN must remain until cutover.");
      assert.ok(
        verifyPin(row.pin, row.pin_hash),
        "A prepared hash does not match the existing PIN.",
      );
      assert.equal(
        row.pin_lookup,
        pinLookup(row.pin, process.env.SESSION_PEPPER),
        "Prepared lookup mismatch.",
      );
      reviewed++;
    }
    if (rows.length < 500) break;
  }
  console.log(
    `PASS: ${reviewed} staff credential(s) prepared and verified; existing PINs retained. No cutover was run.`,
  );
}
