import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  COUNTER,
  KITCHEN,
  digest,
  newToken,
  pinLookup,
  hashPin,
  verifyPin,
  publicStaff,
  fail,
  requireRole,
  sessionCookie,
  readSession,
  authorizeData,
} from "./security.js";

const BUCKET = "payment-proofs";
let singleton;
export function getAdmin() {
  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.SESSION_PEPPER ||
    process.env.SESSION_PEPPER.length < 32
  )
    fail(503, "Secure backend needs private server settings.");
  return (singleton ||= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ));
}
const unwrap = ({ data, error }) => {
  if (error)
    throw Object.assign(new Error(error.message), {
      status: error.code === "40001" ? 409 : error.code === "23505" ? 409 : 400,
    });
  return data;
};
const actorHeaders = (actor) => ({ "x-app-actor-id": String(actor.id) });
export async function findPin(admin, pin, secret) {
  if (!/^\d{4}$/.test(pin || "")) return null;
  let staff = unwrap(
    await admin
      .from("staff")
      .select("*")
      .eq("pin_lookup", pinLookup(pin, secret))
      .maybeSingle(),
  );
  if (staff) return verifyPin(pin, staff.pin_hash) ? staff : null;
  staff = unwrap(
    await admin.from("staff").select("*").eq("pin", pin).maybeSingle(),
  );
  if (!staff) return null;
  if (staff.pin_hash && !verifyPin(pin, staff.pin_hash)) return null;
  unwrap(
    await admin
      .from("staff")
      .update({
        pin_hash: hashPin(pin),
        pin_lookup: pinLookup(pin, secret),
        ...(process.env.SECURE_CUTOVER_ACTIVE === "true" ? { pin: null } : {}),
      })
      .eq("id", staff.id),
  );
  return staff;
}
async function actorFor(admin, req) {
  const token = readSession(req.headers.cookie);
  if (!token) fail(401, "Sign in with your staff PIN.");
  const session = unwrap(
    await admin
      .from("app_sessions")
      .select("*")
      .eq("token_hash", digest(token))
      .maybeSingle(),
  );
  if (!session || Date.parse(session.expires_at) <= Date.now())
    fail(401, "Your session expired. Sign in again.");
  const actor = unwrap(
    await admin
      .from("staff")
      .select("*")
      .eq("id", session.staff_id)
      .maybeSingle(),
  );
  if (!actor || actor.auth_version !== session.auth_version)
    fail(401, "Your account changed. Sign in again.");
  return actor;
}
async function jsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    if (JSON.stringify(req.body).length > 1_500_000)
      fail(413, "Request is too large.");
    return req.body;
  }
  let buffer = Buffer.alloc(0);
  for await (const part of req) {
    buffer = Buffer.concat([buffer, Buffer.from(part)]);
    if (buffer.length > 1_500_000)
      fail(413, "The image or request is too large.");
  }
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString());
  } catch {
    fail(400, "Invalid request body.");
  }
}
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
export function validateCheckout(body) {
  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > 200
  )
    fail(400, "Add valid order items.");
  if (!Array.isArray(body.paymentLines) || body.paymentLines.length > 6)
    fail(400, "Invalid payment lines.");
  const methods = new Set();
  for (const line of body.paymentLines) {
    if (
      !["Cash", "GCash", "Card", "Bank Transfer", "Grab", "Foodpanda"].includes(
        line.method,
      ) ||
      methods.has(line.method) ||
      !Number.isFinite(line.amount) ||
      line.amount < 0
    )
      fail(400, "Invalid or duplicate payment portion.");
    methods.add(line.method);
  }
  for (const item of body.items) {
    if (!Number.isFinite(item.price))
      fail(400, "A saved selling price is required.");
    for (const field of [
      "quantity",
      "price",
      "discount",
      "markup",
      "customPrice",
      "discountAmount",
      "markupAmount",
    ])
      if (
        item[field] != null &&
        (!Number.isFinite(item[field]) || item[field] < 0)
      )
        fail(400, "Invalid item amount.");
    if (!(item.quantity > 0)) fail(400, "Invalid item quantity.");
  }
  for (const field of [
    "orderDiscount",
    "orderDiscountAmount",
    "loyaltyDiscount",
  ])
    if (
      body[field] != null &&
      (!Number.isFinite(body[field]) || body[field] < 0)
    )
      fail(400, "Invalid order amount.");
}
export function createHandler({
  adminFactory = getAdmin,
  secret = () => process.env.SESSION_PEPPER,
  fetcher = fetch,
} = {}) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const path = (
        url.searchParams.get("path") || url.pathname.replace(/^\/api\/?/, "")
      ).replace(/^\/+|\/+$/g, "");
      url.searchParams.delete("path");
      if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(req.method))
        fail(405, "Unsupported method.");
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        fail(403, "Cross-site request rejected.");
      const admin = adminFactory();
      const pepper = secret();
      if (!pepper) fail(503, "Session settings are missing.");
      const body = ["GET", "HEAD"].includes(req.method)
        ? {}
        : await jsonBody(req);
      const postOnly = new Set([
        "verify-pin",
        "checkout",
        "transactions/reverse",
        "orders/dispatch",
        "bills/save",
        "orders/link-bill",
        "orders/cancel",
        "kitchen/action",
      ]);
      if (postOnly.has(path) && req.method !== "POST")
        fail(405, "This action requires POST.");
      if (/^proofs\//.test(path) && !["GET", "DELETE"].includes(req.method))
        fail(405, "Unsupported photo operation.");
      const checkedPin = async (pin) => {
        const ip =
          req.headers["x-forwarded-for"]?.split(",")[0] ||
          req.socket?.remoteAddress ||
          "unknown";
        const device = String(req.headers["x-device-id"] || "unknown").slice(
          0,
          100,
        );
        const limits = [
          ["ip:" + pinLookup(ip, pepper), 30],
          ["device:" + pinLookup(ip + device, pepper), 5],
        ];
        for (const [key, limit] of limits) {
          const row = unwrap(
            await admin
              .from("app_login_limits")
              .select("*")
              .eq("key", key)
              .maybeSingle(),
          );
          if (
            row &&
            Date.parse(row.window_at) > Date.now() - 900000 &&
            row.attempts >= limit
          )
            fail(429, "Too many PIN attempts. Try again in 15 minutes.");
        }
        const found = await findPin(admin, pin, pepper);
        if (!found) {
          for (const [key, limit] of limits)
            unwrap(
              await admin.rpc("app_login_limit_v1", {
                p_key: key,
                p_limit: limit,
              }),
            );
        } else
          unwrap(
            await admin
              .from("app_login_limits")
              .delete()
              .eq("key", limits[1][0]),
          );
        return found;
      };
      if (path === "health") {
        unwrap(
          await admin
            .from("app_sessions")
            .select("token_hash", { head: true, count: "exact" }),
        );
        return send(res, 200, { ready: true });
      }
      if (path === "session" && req.method === "POST") {
        const actor = await checkedPin(body.pin);
        if (!actor || actor.role === "staff")
          fail(401, "Invalid PIN or time-tracking-only profile.");
        const token = newToken();
        unwrap(
          await admin.from("app_sessions").insert({
            token_hash: digest(token),
            staff_id: actor.id,
            auth_version: actor.auth_version,
            expires_at: new Date(Date.now() + 43200000).toISOString(),
          }),
        );
        res.setHeader("Set-Cookie", sessionCookie(token));
        return send(res, 200, publicStaff(actor));
      }
      if (path === "member" && req.method === "GET") {
        const code = url.searchParams.get("code") || "";
        if (!/^[A-Z0-9-]{10,80}$/.test(code)) fail(404, "Card not found.");
        const card = unwrap(
          await admin
            .from("membership_cards")
            .select("cardCode,status,customerId,expiresAt,activatedAt")
            .eq("cardCode", code)
            .maybeSingle(),
        );
        if (!card)
          return send(res, 200, { card: null, customer: null, history: [] });
        const customer = card.customerId
          ? unwrap(
              await admin
                .from("customers")
                .select(
                  "name,pointsBalance,status,expiresAt,activatedAt,birthdayRewardYear,birthday",
                )
                .eq("id", card.customerId)
                .maybeSingle(),
            )
          : null;
        const history = card.customerId
          ? unwrap(
              await admin
                .from("loyalty_transactions")
                .select("id,type,points,amount,datetime")
                .eq("customerId", card.customerId)
                .order("datetime", { ascending: false })
                .limit(10),
            )
          : [];
        const today = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }),
        );
        const birthdayEligible =
          customer?.birthday &&
          Number(String(customer.birthday).slice(5, 7)) ===
            today.getMonth() + 1 &&
          customer.birthdayRewardYear !== today.getFullYear();
        return send(res, 200, {
          card: {
            cardCode: card.cardCode,
            status: card.status,
            expiresAt: card.expiresAt,
            activatedAt: card.activatedAt,
          },
          customer: customer
            ? {
                name: customer.name?.split(" ")[0],
                pointsBalance: customer.pointsBalance,
                status: customer.status,
                expiresAt: customer.expiresAt,
                activatedAt: customer.activatedAt,
                birthdayStatus: { eligible: Boolean(birthdayEligible) },
              }
            : null,
          history,
        });
      }
      if (path === "session" && req.method === "DELETE") {
        const token = readSession(req.headers.cookie);
        if (token)
          unwrap(
            await admin
              .from("app_sessions")
              .delete()
              .eq("token_hash", digest(token)),
          );
        res.setHeader("Set-Cookie", sessionCookie("", 0));
        return send(res, 200, { ok: true });
      }
      const actor = await actorFor(admin, req);
      if (path === "session") {
        if (req.method === "DELETE") {
          unwrap(
            await admin
              .from("app_sessions")
              .delete()
              .eq("token_hash", digest(readSession(req.headers.cookie))),
          );
          res.setHeader("Set-Cookie", sessionCookie("", 0));
          return send(res, 200, { ok: true });
        }
        return send(res, 200, publicStaff(actor));
      }
      if (path === "verify-pin") {
        requireRole(actor, COUNTER);
        const found = await checkedPin(body.pin);
        if (
          !found ||
          (body.staffId != null && String(found.id) !== String(body.staffId))
        )
          fail(403, "Incorrect staff PIN.");
        const approval = newToken();
        unwrap(
          await admin.from("app_pin_approvals").insert({
            token_hash: digest(approval),
            session_hash: digest(readSession(req.headers.cookie)),
            staff_id: found.id,
            expires_at: new Date(Date.now() + 300000).toISOString(),
          }),
        );
        return send(res, 200, { ...publicStaff(found), approval });
      }
      if (path === "proofs" && req.method === "POST") {
        requireRole(actor, COUNTER);
        if (
          !["Card", "Bank Transfer"].includes(body.method) ||
          !Number.isSafeInteger(body.amountCents) ||
          body.amountCents <= 0 ||
          !/^[-a-zA-Z0-9]{10,100}$/.test(body.checkoutKey || "")
        )
          fail(400, "Invalid proof details.");
        const input = Buffer.from(body.image || "", "base64");
        if (!input.length || input.length > 1_048_576)
          fail(400, "Photo must be 1 MB or less.");
        const info = await sharp(input, {
          limitInputPixels: 12_000_000,
        }).metadata();
        if (info.format !== "jpeg") fail(400, "Capture a JPEG photo.");
        let image = await sharp(input, { limitInputPixels: 12_000_000 })
          .rotate()
          .resize({
            width: 1600,
            height: 1600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 78 })
          .toBuffer();
        if (image.length > 1_048_576)
          image = await sharp(image).jpeg({ quality: 55 }).toBuffer();
        if (image.length > 1_048_576)
          fail(400, "Photo is too large; retake it.");
        const id = randomUUID(),
          object_path = `${actor.id}/${body.checkoutKey}/${id}.jpg`;
        unwrap(
          await admin.from("payment_proofs").insert({
            id,
            checkout_key: body.checkoutKey,
            method: body.method,
            amount_cents: body.amountCents,
            staff_id: actor.id,
            object_path,
          }),
        );
        unwrap(
          await admin.storage.from(BUCKET).upload(object_path, image, {
            contentType: "image/jpeg",
            upsert: false,
          }),
        );
        unwrap(
          await admin
            .from("payment_proofs")
            .update({
              status: "uploaded",
              sha256: digest(image),
              bytes: image.length,
            })
            .eq("id", id),
        );
        return send(res, 201, {
          id,
          method: body.method,
          amountCents: body.amountCents,
        });
      }
      if (path === "proofs" && req.method === "GET") {
        requireRole(actor, ["owner", "manager"]);
        const records = unwrap(
          await admin
            .from("payment_proofs")
            .select("id,method,amount_cents,status,captured_at,expires_at")
            .eq("transaction_id", url.searchParams.get("transactionId")),
        );
        return send(res, 200, records);
      }
      if (/^proofs\/[a-f0-9-]+$/.test(path)) {
        requireRole(
          actor,
          req.method === "DELETE" ? ["owner"] : ["owner", "manager"],
        );
        const proof = unwrap(
          await admin
            .from("payment_proofs")
            .select("*")
            .eq("id", path.split("/")[1])
            .single(),
        );
        if (req.method === "DELETE") {
          if (!body.reason?.trim()) fail(400, "Deletion reason required.");
          unwrap(await admin.storage.from(BUCKET).remove([proof.object_path]));
          unwrap(
            await admin
              .from("payment_proofs")
              .update({ status: "deleted" })
              .eq("id", proof.id),
          );
          unwrap(
            await admin.from("app_order_events").insert({
              actor_id: actor.id,
              action: "DELETE_PROOF",
              data: { proofId: proof.id, reason: body.reason },
            }),
          );
          return send(res, 200, { ok: true });
        }
        if (
          proof.status !== "attached" ||
          Date.parse(proof.expires_at) <= Date.now()
        )
          fail(410, "This payment photo has expired or was deleted.");
        return send(
          res,
          200,
          unwrap(
            await admin.storage
              .from(BUCKET)
              .createSignedUrl(proof.object_path, 60),
          ),
        );
      }
      if (path === "checkout") {
        requireRole(actor, COUNTER);
        validateCheckout(body);
        const payload = {
          ...body,
          receiptNo: `92P-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        };
        const result = unwrap(
          await admin.rpc("app_checkout_v1", {
            p_actor: actor.id,
            p_payload: payload,
            // These two client fields are regenerated when retrying a lost response.
            p_hash: digest(
              JSON.stringify(
                Object.fromEntries(
                  Object.entries(body).filter(
                    ([key]) => !["datetime", "receiptNo"].includes(key),
                  ),
                ),
              ),
            ),
          }),
        );
        return send(res, 200, result);
      }
      if (path === "transactions/reverse") {
        requireRole(actor, COUNTER);
        const authorizer = body.delete ? actor : await checkedPin(body.pin);
        requireRole(authorizer, body.delete ? ["owner"] : ["owner", "manager"]);
        unwrap(
          await admin.rpc("app_reverse_transaction_v1", {
            p_actor: authorizer.id,
            p_id: body.id,
            p_reason: body.reason,
            p_delete: Boolean(body.delete),
          }),
        );
        return send(res, 200, { ok: true });
      }
      if (path === "orders" && req.method === "GET") {
        requireRole(actor, COUNTER);
        let q = admin.from("app_orders").select("*");
        q = url.searchParams.has("billId")
          ? q.eq("running_bill_id", url.searchParams.get("billId"))
          : q.eq("status", "open");
        return send(
          res,
          200,
          unwrap(await q.order("updated_at", { ascending: false }).limit(100)),
        );
      }
      if (path === "orders/dispatch") {
        requireRole(actor, COUNTER);
        return send(
          res,
          200,
          unwrap(
            await admin.rpc("app_dispatch_v1", {
              p_actor: actor.id,
              p_order: body.orderId,
              p_revision: body.revision,
              p_payload: body.order,
              p_key: body.dispatchKey,
            }),
          ),
        );
      }
      if (path === "bills/save") {
        requireRole(actor, COUNTER);
        return send(
          res,
          200,
          unwrap(
            await admin.rpc("app_save_bill_v1", {
              p_actor: actor.id,
              p_id: body.billId || null,
              p_expected: body.expectedUpdatedAt || null,
              p_data: body,
            }),
          ),
        );
      }
      if (path === "orders/link-bill") {
        requireRole(actor, COUNTER);
        return send(
          res,
          200,
          unwrap(
            await admin.rpc("app_link_bill_v1", {
              p_actor: actor.id,
              p_order: body.orderId,
              p_bill: body.billId,
              p_revision: body.revision,
            }),
          ),
        );
      }
      if (path === "orders/cancel") {
        requireRole(actor, COUNTER);
        unwrap(
          await admin.rpc("app_cancel_order_v1", {
            p_actor: actor.id,
            p_order: body.orderId,
            p_reason: body.reason,
          }),
        );
        return send(res, 200, { ok: true });
      }
      if (path === "kitchen" && req.method === "GET") {
        requireRole(actor, KITCHEN);
        const since = url.searchParams.get("since");
        if (since && !Number.isFinite(Date.parse(since)))
          fail(400, "Invalid sync time.");
        return send(
          res,
          200,
          unwrap(
            await admin.rpc("app_kitchen_feed_v1", {
              p_actor: actor.id,
              p_since: since || null,
            }),
          ),
        );
      }
      if (path === "kitchen/action") {
        requireRole(actor, KITCHEN);
        return send(
          res,
          200,
          unwrap(
            await admin.rpc("app_ticket_action_v1", {
              p_actor: actor.id,
              p_ticket: body.ticketId,
              p_revision: body.revision,
              p_action: body.action,
              p_line: body.lineId || null,
            }),
          ),
        );
      }
      if (path.startsWith("data/")) {
        const resource = path.slice(5);
        authorizeData(actor, resource, req.method);
        if (
          resource === "staff" &&
          req.method === "POST" &&
          (req.headers.prefer || "").includes("resolution=")
        )
          fail(
            403,
            "Use a single staff edit so existing sessions are revoked correctly.",
          );
        if (
          ["staff", "time_records", "running_bills"].includes(resource) &&
          ["PATCH", "DELETE"].includes(req.method)
        ) {
          const exactId = url.searchParams.get("id");
          if (
            !/^eq\.\d+$/.test(exactId || "") ||
            [...url.searchParams.keys()].some(
              (key) =>
                ![
                  "id",
                  "select",
                  ...(resource === "time_records" ? ["timeOut"] : []),
                ].includes(key),
            )
          )
            fail(400, "Select one record by its ID.");
          if (resource === "staff") {
            const target = unwrap(
              await admin
                .from("staff")
                .select("id,role")
                .eq("id", exactId.slice(3))
                .single(),
            );
            if (req.method === "DELETE" && target.id === actor.id)
              fail(400, "You cannot delete the account you are using.");
            if (
              target.role === "owner" &&
              (req.method === "DELETE" || (body.role && body.role !== "owner"))
            ) {
              const owners = unwrap(
                await admin.from("staff").select("id").eq("role", "owner"),
              );
              if (owners.length <= 1)
                fail(400, "Keep at least one owner account.");
            }
          }
          if (resource === "running_bills") {
            const orders = unwrap(
              await admin
                .from("app_orders")
                .select("id,status")
                .eq("running_bill_id", exactId.slice(3)),
            );
            if (orders.some((order) => order.status !== "cancelled"))
              fail(409, "Cancel the sent order before removing this tab.");
          }
        }
        if (
          resource === "running_bills" &&
          ["POST", "PATCH"].includes(req.method)
        )
          fail(403, "Use the version-checked tab workflow.");
        if (/[():!]/.test(url.searchParams.get("select") || ""))
          fail(400, "Embedded data queries are not permitted.");
        if (
          req.method === "POST" &&
          actor.role !== "owner" &&
          (req.headers.prefer || "").includes("resolution=")
        )
          fail(403, "This account cannot overwrite records by upsert.");
        if (resource === "staff" && url.searchParams.has("pin")) {
          const entered = url.searchParams.get("pin").replace(/^eq\./, "");
          const found =
            actor.role === "owner"
              ? await findPin(admin, entered, pepper)
              : await checkedPin(entered);
          return send(res, 200, found ? [publicStaff(found)] : []);
        }
        let attendanceTarget, attendanceRecord;
        if (
          resource === "time_records" &&
          Array.isArray(body) &&
          body.length !== 1 &&
          !["GET", "HEAD", "DELETE"].includes(req.method)
        )
          fail(400, "Save one attendance record at a time.");
        if (
          resource === "time_records" &&
          !["GET", "HEAD"].includes(req.method) &&
          actor.role !== "owner"
        ) {
          const approval = unwrap(
            await admin
              .from("app_pin_approvals")
              .select("*")
              .eq("token_hash", digest(req.headers["x-staff-approval"] || ""))
              .maybeSingle(),
          );
          if (
            !approval ||
            approval.session_hash !== digest(readSession(req.headers.cookie)) ||
            Date.parse(approval.expires_at) <= Date.now()
          )
            fail(403, "Confirm the staff PIN before saving attendance.");
          attendanceTarget = unwrap(
            await admin
              .from("staff")
              .select("*")
              .eq("id", approval.staff_id)
              .single(),
          );
          if (
            req.method === "POST" &&
            String((Array.isArray(body) ? body[0] : body).staffId) !==
              String(attendanceTarget.id)
          )
            fail(403, "Staff approval does not match this record.");
          if (req.method === "PATCH") {
            const record = unwrap(
              await admin
                .from("time_records")
                .select("*")
                .eq("id", url.searchParams.get("id")?.replace(/^eq\./, ""))
                .single(),
            );
            attendanceRecord = record;
            if (record.staffId !== attendanceTarget.id)
              fail(403, "Staff approval does not match this record.");
          }
          const claimed = unwrap(
            await admin
              .from("app_pin_approvals")
              .delete()
              .eq("token_hash", approval.token_hash)
              .select("token_hash"),
          );
          if (!claimed?.length) fail(403, "Staff approval already used.");
        }
        let mutation = body;
        if (!["GET", "HEAD"].includes(req.method)) {
          if (resource.startsWith("rpc/report_review_")) {
            const owner = await checkedPin(body.p_owner_pin);
            if (owner?.role !== "owner") fail(403, "Incorrect owner PIN.");
          } else if (!resource.startsWith("rpc/")) {
            const scrub = async (row) => {
              const clean = { ...row };
              delete clean.auth_version;
              delete clean.pin_hash;
              delete clean.pin_lookup;
              if (resource === "staff") {
                if (req.method === "POST" && !clean.pin)
                  fail(400, "A four-digit staff PIN is required.");
                if (
                  clean.role &&
                  !["owner", "manager", "cashier", "staff", "kitchen"].includes(
                    clean.role,
                  )
                )
                  fail(400, "Invalid staff role.");
                const changedPin = Boolean(clean.pin);
                if (clean.pin) {
                  if (!/^\d{4}$/.test(clean.pin))
                    fail(400, "PIN must be four digits.");
                  clean.pin_hash = hashPin(clean.pin);
                  clean.pin_lookup = pinLookup(clean.pin, pepper);
                  clean.pin =
                    process.env.SECURE_CUTOVER_ACTIVE === "true"
                      ? null
                      : clean.pin;
                } else delete clean.pin;
                if (req.method === "PATCH") {
                  const ids = unwrap(
                    await admin
                      .from("staff")
                      .select("id,role,auth_version")
                      .eq(
                        "id",
                        url.searchParams.get("id")?.replace(/^eq\./, ""),
                      ),
                  );
                  if (
                    ids[0] &&
                    (changedPin || (clean.role && clean.role !== ids[0].role))
                  )
                    clean.auth_version = ids[0].auth_version + 1;
                }
              }
              if (resource === "time_records") {
                if (attendanceTarget) {
                  const now = Date.now();
                  // Attendance stays bound to the approved staff member. Payroll
                  // rate and timestamps come from the server, never the counter.
                  if (req.method === "POST")
                    return {
                      staffId: attendanceTarget.id,
                      date: new Date(now + 28800000).toISOString().slice(0, 10),
                      timeIn: now,
                      photoIn: clean.photoIn || null,
                      timeOut: null,
                      photoOut: null,
                      salaryEarned: 0,
                    };
                  if (attendanceRecord?.timeOut)
                    fail(409, "This shift has already been closed.");
                  return {
                    timeOut: now,
                    photoOut: clean.photoOut || null,
                    salaryEarned:
                      Math.round(
                        (Math.max(0, now - Number(attendanceRecord.timeIn)) /
                          3600000) *
                          Number(attendanceTarget.hourlyRate || 0) *
                          100,
                      ) / 100,
                  };
                }
              } else {
                if ("staffId" in clean) clean.staffId = actor.id;
                if ("staffName" in clean) clean.staffName = actor.name;
              }
              return clean;
            };
            mutation = Array.isArray(body)
              ? await Promise.all(body.map(scrub))
              : await scrub(body);
          }
        }
        // Fixed Supabase origin + allowlisted resources; caller cannot choose a destination.
        const target = new URL(
          `/rest/v1/${resource}`,
          process.env.SUPABASE_URL,
        );
        target.search = url.searchParams.toString();
        const response = await fetcher(target, {
          method: req.method,
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: req.headers.prefer || "return=representation",
            Range: req.headers.range || "",
            ...actorHeaders(actor),
          },
          body: ["GET", "HEAD", "DELETE"].includes(req.method)
            ? undefined
            : JSON.stringify(mutation),
        });
        res.statusCode = response.status;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json");
        for (const header of ["content-range", "preference-applied"])
          if (response.headers.has(header))
            res.setHeader(header, response.headers.get(header));
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        if (response.status === 204) {
          res.end();
          return;
        }
        const result = await response.json();
        if (resource === "staff" && response.ok) {
          const redact = (row) => {
            const safe = publicStaff(row);
            if (actor.role !== "owner") delete safe.hourlyRate;
            return safe;
          };
          return res.end(
            JSON.stringify(
              Array.isArray(result) ? result.map(redact) : redact(result),
            ),
          );
        }
        return res.end(JSON.stringify(result));
      }
      fail(404, "Unknown API route.");
    } catch (error) {
      return send(res, error.status || 500, {
        message: error.status
          ? error.message
          : "The server could not complete this request.",
      });
    }
  };
}

export async function cleanupProofs(admin) {
  const due = unwrap(
    await admin
      .from("payment_proofs")
      .select("*")
      .lte("expires_at", new Date().toISOString())
      .in("status", ["pending", "uploaded", "attached"])
      .limit(200),
  );
  for (const proof of due) {
    unwrap(await admin.storage.from(BUCKET).remove([proof.object_path]));
    unwrap(
      await admin
        .from("payment_proofs")
        .update({ status: "expired" })
        .eq("id", proof.id),
    );
    unwrap(
      await admin.from("app_order_events").insert({
        action: "EXPIRE_PROOF",
        data: { proofId: proof.id, receiptNo: proof.receipt_no || null },
      }),
    );
  }
  const now = new Date().toISOString();
  unwrap(await admin.from("app_sessions").delete().lt("expires_at", now));
  unwrap(await admin.from("app_pin_approvals").delete().lt("expires_at", now));
  unwrap(
    await admin
      .from("app_login_limits")
      .delete()
      .lt("window_at", new Date(Date.now() - 900000).toISOString()),
  );
  return due.length;
}
