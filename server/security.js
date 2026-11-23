import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";

export const COUNTER = ["owner", "manager", "cashier"];
export const KITCHEN = [...COUNTER, "kitchen"];
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function pinLookup(pin, secret) {
  return createHmac("sha256", secret).update(pin).digest("hex");
}
export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}
export function verifyPin(pin, hash) {
  if (!/^\d{4}$/.test(pin || "") || !hash) return false;
  const [salt, expected] = hash.split(":");
  if (!salt || !/^[a-f0-9]{64}$/.test(expected || "")) return false;
  return timingSafeEqual(
    scryptSync(pin, salt, 32),
    Buffer.from(expected, "hex"),
  );
}
export function publicStaff(staff) {
  if (!staff) return null;
  const { pin, pin_hash, pin_lookup, ...safe } = staff;
  return { ...safe, hasPin: Boolean(pin || pin_hash) };
}
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export function requireRole(actor, roles) {
  if (!actor || !roles.includes(actor.role))
    fail(403, "This account cannot perform that action.");
}
export function sessionCookie(token, maxAge = 43200) {
  return `cafe_session=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function readSession(cookie = "") {
  return cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("cafe_session="))
    ?.slice(13);
}
export function requiredProofs(lines) {
  return lines.filter(
    (line) =>
      ["Card", "Bank Transfer"].includes(line.method) && line.amount > 0,
  );
}
export const TABLES = {
  staff: { read: COUNTER, write: ["owner"] },
  products: { read: COUNTER, write: ["owner"] },
  inventory: { read: COUNTER, write: ["owner", "manager"] },
  ingredients: { read: COUNTER, write: ["owner", "manager"] },
  product_ingredients: { read: COUNTER, write: ["owner"] },
  product_inventory: { read: COUNTER, write: ["owner"] },
  transactions: { read: COUNTER, write: [] },
  running_bills: { read: COUNTER, write: COUNTER },
  daily_sales_summary: { read: COUNTER, write: [] },
  ingredient_movements: { read: ["owner", "manager"], write: [] },
  cash_drawer: { read: COUNTER, write: COUNTER },
  time_records: { read: COUNTER, write: COUNTER },
  void_log: { read: ["owner", "manager"], write: [] },
  audit_log: { read: ["owner"], write: COUNTER },
  customers: { read: COUNTER, write: ["owner"] },
  membership_cards: { read: COUNTER, write: ["owner"] },
  loyalty_transactions: { read: COUNTER, write: ["owner"] },
};
export const RPCS = {
  report_business_v2: ["owner"],
  report_transactions_v2: COUNTER,
  report_cash_v2: COUNTER,
  report_review_item_v2: ["owner"],
  report_review_product_v2: ["owner"],
  report_review_cash_v2: ["owner"],
  // Legacy stock adjustments remain manager/owner only; checkout performs them atomically.
  adjust_ingredient_stock: ["owner", "manager"],
};
export function authorizeData(actor, path, method) {
  if (path.startsWith("rpc/")) {
    if (method !== "POST") fail(405, "RPC requires POST.");
    requireRole(actor, RPCS[path.slice(4)] || []);
    return;
  }
  if (!TABLES[path]) fail(404, "Unknown data resource.");
  if (path === "cash_drawer" && ["PATCH", "DELETE"].includes(method))
    requireRole(actor, ["owner"]);
  if (path === "time_records" && method === "DELETE")
    requireRole(actor, ["owner"]);
  if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method))
    fail(405, "Unsupported data operation.");
  requireRole(
    actor,
    ["GET", "HEAD"].includes(method) ? TABLES[path].read : TABLES[path].write,
  );
}
