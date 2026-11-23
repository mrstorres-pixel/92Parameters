import { createClient } from "@supabase/supabase-js";
import { hashPin, pinLookup, verifyPin } from "../server/security.js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_PEPPER } = process.env;
if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !SESSION_PEPPER ||
  SESSION_PEPPER.length < 32
)
  throw new Error(
    "Set private server settings and a stable SESSION_PEPPER of at least 32 characters in your trusted shell.",
  );
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rows = [];
for (let offset = 0; ; offset += 500) {
  const { data, error } = await admin
    .from("staff")
    .select("id,role,pin,pin_hash,pin_lookup")
    .order("id")
    .range(offset, offset + 499);
  if (error) throw new Error("Could not read staff preparation state.");
  rows.push(...data);
  if (data.length < 500) break;
}
if (!rows.some((row) => row.role === "owner"))
  throw new Error("At least one owner account is required.");
const lookups = new Set();
for (const row of rows) {
  if (!row.pin_hash && !/^\d{4}$/.test(row.pin || ""))
    throw new Error(
      `Staff ID ${row.id} needs a four-digit PIN before cutover.`,
    );
  if (row.pin_hash && row.pin && !verifyPin(row.pin, row.pin_hash))
    throw new Error(
      `Staff ID ${row.id} has inconsistent credentials; resolve before cutover.`,
    );
  const lookup = row.pin ? pinLookup(row.pin, SESSION_PEPPER) : row.pin_lookup;
  if (!lookup || lookups.has(lookup))
    throw new Error(
      "Missing or duplicate staff credential. Resolve in Staff Management first.",
    );
  lookups.add(lookup);
  if (row.pin_hash && row.pin && row.pin_lookup !== lookup)
    throw new Error(
      "SESSION_PEPPER differs from the existing prepared credentials. Use the original secret.",
    );
}
let prepared = 0;
for (const row of rows) {
  if (row.pin_hash) continue;
  const { error } = await admin
    .from("staff")
    .update({
      pin_hash: hashPin(row.pin),
      pin_lookup: pinLookup(row.pin, SESSION_PEPPER),
    })
    .eq("id", row.id)
    .eq("pin", row.pin);
  if (error)
    throw new Error(
      `Preparation failed at staff ID ${row.id}; safe to rerun after resolving it.`,
    );
  prepared++;
}
console.log(
  `Prepared ${prepared} credential(s); ${rows.length} staff records checked. Legacy PINs are retained until the cutover SQL.`,
);
