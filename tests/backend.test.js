import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import sharp from "sharp";
import { createSecureDb } from "./helpers/secureDb.js";
import { fixtureAdmin } from "./helpers/fixtureAdmin.js";
import { createHandler, cleanupProofs } from "../server/backend.js";
import { randomUUID } from "node:crypto";

test("real API sessions, private photos, expiry, and permissions through isolated PostgreSQL", async () => {
  const db = await createSecureDb();
  process.env.SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
  process.env.SECURE_CUTOVER_ACTIVE = "true";
  const { admin, fetcher, objects } = fixtureAdmin(db),
    handler = createHandler({
      adminFactory: () => admin,
      secret: () => "test-pepper",
      fetcher,
    });
  const request = async (
    path,
    {
      method = "GET",
      body,
      cookie,
      approval,
      origin = "https://cafe.test",
    } = {},
  ) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    req.url = `/api/${path}`;
    req.method = method;
    req.headers = {
      host: "cafe.test",
      origin,
      cookie,
      "x-device-id": "test-device",
      "x-staff-approval": approval,
    };
    const headers = {};
    let response;
    await handler(req, {
      setHeader: (key, value) => (headers[key.toLowerCase()] = value),
      set statusCode(value) {
        this.status = value;
      },
      get statusCode() {
        return this.status;
      },
      end(value) {
        response = {
          status: this.status,
          headers,
          data: value ? JSON.parse(value) : null,
        };
      },
    });
    return response;
  };
  try {
    let result = await request("session", {
      method: "POST",
      body: { pin: "2468" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.pin, undefined);
    const owner = result.headers["set-cookie"];
    assert.equal(
      (await request("session", { cookie: owner })).data.role,
      "owner",
    );
    assert.equal((await request("checkout", { cookie: owner })).status, 405);
    assert.equal(
      (await request("data/staff", { method: "DELETE", cookie: owner })).status,
      400,
    );
    assert.equal(
      (await request("data/staff?id=eq.1", { method: "DELETE", cookie: owner }))
        .status,
      400,
    );
    const cashier = (
      await request("session", { method: "POST", body: { pin: "1357" } })
    ).headers["set-cookie"];
    await db.exec(`update staff set "hourlyRate"=100 where id=2`);
    const confirmed = await request("verify-pin", {
      method: "POST",
      cookie: cashier,
      body: { pin: "1357", staffId: 2 },
    });
    const attendance = await request("data/time_records", {
      method: "POST",
      cookie: cashier,
      approval: confirmed.data.approval,
      body: [
        { staffId: 2, date: "1900-01-01", timeIn: 0, salaryEarned: 99999 },
      ],
    });
    assert.equal(attendance.status, 200, JSON.stringify(attendance.data));
    assert.ok(Number(attendance.data[0].timeIn) > Date.now() - 10000);
    assert.equal(Number(attendance.data[0].salaryEarned), 0);
    assert.equal(
      (
        await request("data/time_records", {
          method: "POST",
          cookie: cashier,
          approval: confirmed.data.approval,
          body: [{ staffId: 2 }],
        })
      ).status,
      403,
    );
    const recordId = attendance.data[0].id;
    await db.query('update time_records set "timeIn"=$1 where id=$2', [
      Date.now() - 3600000,
      recordId,
    ]);
    const outPin = await request("verify-pin", {
      method: "POST",
      cookie: cashier,
      body: { pin: "1357", staffId: 2 },
    });
    const clockOut = await request(
      `data/time_records?id=eq.${recordId}&timeOut=is.null&select=id,salaryEarned`,
      {
        method: "PATCH",
        cookie: cashier,
        approval: outPin.data.approval,
        body: { timeOut: 1, salaryEarned: 99999 },
      },
    );
    assert.equal(clockOut.status, 200, JSON.stringify(clockOut.data));
    assert.ok(Math.abs(Number(clockOut.data[0].salaryEarned) - 100) < 0.1);
    result = await request("session", {
      method: "POST",
      body: { pin: "9753" },
    });
    const kitchen = result.headers["set-cookie"];
    assert.equal(
      (await request("data/transactions", { cookie: kitchen })).status,
      403,
    );
    assert.equal(
      (await request("proofs?transactionId=1", { cookie: kitchen })).status,
      403,
    );
    assert.equal(
      (await request("data/staff?select=*,app_sessions(*)", { cookie: owner }))
        .status,
      400,
    );
    const photo = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    result = await request("proofs", {
      method: "POST",
      cookie: owner,
      body: {
        method: "Card",
        amountCents: 10000,
        checkoutKey: randomUUID(),
        image: photo.toString("base64"),
      },
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(objects.size, 1);
    const proofId = result.data.id;
    assert.equal(
      (await request(`proofs/${proofId}`, { cookie: owner })).status,
      410,
      "Unattached drafts are not receipt evidence",
    );
    await db.query(
      "update payment_proofs set status='attached',expires_at=now()+interval '90 days' where id=$1",
      [proofId],
    );
    result = await request(`proofs/${proofId}`, { cookie: owner });
    assert.equal(result.status, 200);
    assert.ok(result.data.signedUrl);
    await db.query(
      "update payment_proofs set expires_at=now()-interval '1 second' where id=$1",
      [proofId],
    );
    assert.equal(
      (await request(`proofs/${proofId}`, { cookie: owner })).status,
      410,
    );
    assert.equal(await cleanupProofs(admin), 1);
    assert.equal(objects.size, 0);
    assert.equal(
      (await db.query("select status from payment_proofs")).rows[0].status,
      "expired",
    );
    assert.equal(
      (
        await request("session", {
          method: "DELETE",
          cookie: owner,
          origin: "https://evil.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("session", { method: "DELETE", cookie: owner })).status,
      200,
    );
    assert.equal((await request("session", { cookie: owner })).status, 401);
    assert.equal(
      (await db.query("select pin from staff where id=1")).rows[0].pin,
      null,
    );
  } finally {
    await db.close();
  }
});
