import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSecureDb, prepareTestPins, sql } from "./helpers/secureDb.js";
import {
  hashPin,
  verifyPin,
  publicStaff,
  authorizeData,
  readSession,
  sessionCookie,
} from "../server/security.js";

test("server PIN hashes, cookies and kitchen permissions do not trust client roles", () => {
  const hash = hashPin("1234");
  assert.ok(verifyPin("1234", hash));
  assert.equal(verifyPin("1235", hash), false);
  assert.equal(readSession(sessionCookie("example")), "example");
  assert.match(sessionCookie("x"), /HttpOnly; Secure; SameSite=Strict/);
  assert.deepEqual(
    publicStaff({
      id: 1,
      pin: "1234",
      pin_hash: hash,
      pin_lookup: "lookup",
      role: "owner",
    }),
    { id: 1, role: "owner", hasPin: true },
  );
  for (const path of [
    "staff",
    "transactions",
    "rpc/report_business_v2",
    "payment_proofs",
  ])
    assert.throws(() => authorizeData({ role: "kitchen" }, path, "GET"));
  assert.throws(() =>
    authorizeData({ role: "cashier" }, "transactions", "POST"),
  );
  assert.throws(() =>
    authorizeData({ role: "cashier" }, "cash_drawer", "DELETE"),
  );
  authorizeData({ role: "owner" }, "rpc/report_business_v2", "POST");
});

test("private payment bucket stays inaccessible under existing permissive client policies", async () => {
  const db = await createSecureDb();
  try {
    await db.exec(`create schema storage;grant usage on schema storage to anon,authenticated,service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id text,bucket_id text);alter table storage.objects enable row level security;
      grant all on storage.objects to anon,authenticated,service_role;
      create policy legacy_broad_access on storage.objects for all to anon,authenticated using(true) with check(true);
      insert into storage.objects values('proof','payment-proofs'),('other','other-bucket');`);
    await db.exec(await sql("20261123123552_secure_pos_kitchen.sql"));
    assert.equal(
      (
        await db.query(
          "select public from storage.buckets where id='payment-proofs'",
        )
      ).rows[0].public,
      false,
    );
    await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      assert.deepEqual(
        (await tx.query("select id from storage.objects")).rows,
        [{ id: "other" }],
      );
      await assert.rejects(() =>
        tx.query("insert into storage.objects values('bad','payment-proofs')"),
      );
    });
    assert.equal(
      (
        await db.query(
          "select count(*) n from pg_proc where pronamespace='public'::regnamespace and proname like 'app_%' and prosecdef",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("loyalty-only customer sales and birthday eligibility remain atomic", async () => {
  const db = await createSecureDb();
  const call = async (name, args) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  try {
    await db.exec(
      `insert into customers(id,"memberCode",name,"pointsBalance",status,"expiresAt") values(1,'TEST-MEMBER-ONE','Member',1000,'active',9999999999999)`,
    );
    const base = {
      checkoutKey: randomUUID(),
      receiptNo: "FREE",
      customerId: 1,
      orderType: "Takeaway",
      items: [
        {
          lineId: randomUUID(),
          productId: 11,
          name: "Coffee",
          category: "Drinks",
          quantity: 1,
          price: 100,
          discount: 0,
          markup: 0,
        },
      ],
      paymentLines: [],
      proofs: {},
      loyaltyDiscount: 100,
    };
    const free = await call("app_checkout_v1", [1, base, "free"]);
    assert.equal(free.total, 0);
    assert.equal(free.loyaltyRedeemed, 1000);
    assert.equal(free.paymentMethod, "Loyalty");
    assert.equal(
      (await db.query('select "pointsBalance" from customers')).rows[0]
        .pointsBalance,
      0,
    );
    await call("app_reverse_transaction_v1", [
      1,
      free.id,
      "Wrong member",
      false,
    ]);
    assert.equal(
      (await db.query('select "pointsBalance" from customers')).rows[0]
        .pointsBalance,
      1000,
    );
    const birthday = {
      ...base,
      checkoutKey: randomUUID(),
      receiptNo: "BIRTHDAY",
      loyaltyDiscount: 0,
      paymentLines: [{ method: "Cash", amount: 100 }],
      birthdayRewardRedeemed: true,
    };
    await assert.rejects(
      () => call("app_checkout_v1", [1, birthday, "birthday"]),
      /not eligible/,
    );
    await db.exec(
      `update customers set birthday=(date_trunc('month',now() at time zone 'Asia/Manila')+interval '1 day')::date`,
    );
    const paid = await call("app_checkout_v1", [1, birthday, "birthday"]);
    assert.equal(paid.loyaltyEarned, 1);
    await assert.rejects(
      () =>
        call("app_checkout_v1", [
          1,
          { ...birthday, checkoutKey: randomUUID(), receiptNo: "BIRTHDAY-2" },
          "again",
        ]),
      /not eligible/,
    );
    await db.exec(
      `update customers set "birthdayRewardYear"=extract(year from now() at time zone 'Asia/Manila')::integer+1`,
    );
    await call("app_reverse_transaction_v1", [
      1,
      paid.id,
      "Wrong birthday sale",
      false,
    ]);
    assert.equal(
      (await db.query('select "pointsBalance" from customers')).rows[0]
        .pointsBalance,
      1000,
    );
    assert.equal(
      (
        await db.query(
          'select "birthdayRewardYear" > extract(year from now()) from customers',
        )
      ).rows[0]["?column?"],
      true,
    );
  } finally {
    await db.close();
  }
});

test("split proofs, tab versions, exact stock reversal and kitchen change acknowledgement", async () => {
  const db = await createSecureDb();
  const call = async (name, args) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  const line = {
    lineId: randomUUID(),
    productId: 10,
    name: "Food",
    category: "Food",
    quantity: 1,
    price: 150,
    discount: 0,
    markup: 0,
    note: "Original",
    reportingType: "sale",
  };
  try {
    const bill = await call("app_save_bill_v1", [
      1,
      null,
      null,
      { tableName: "Table 8", items: [line], orderType: "Dine In", total: 150 },
    ]);
    await assert.rejects(
      () =>
        call("app_save_bill_v1", [
          1,
          bill.id,
          bill.updatedAt - 1,
          { items: [line] },
        ]),
      /changed/,
    );
    const id = randomUUID();
    let order = await call("app_dispatch_v1", [
      1,
      id,
      0,
      {
        label: "Table 8",
        orderType: "Dine In",
        items: [line],
        billId: bill.id,
      },
      randomUUID(),
    ]);
    line.quantity = 2;
    order = await call("app_dispatch_v1", [
      1,
      id,
      order.revision,
      { label: "Table 8", items: [line] },
      randomUUID(),
    ]);
    assert.equal(
      (await db.query("select count(*) n from kitchen_tickets")).rows[0].n,
      2,
    );
    line.quantity = 1;
    line.note = "No onions";
    order = await call("app_dispatch_v1", [
      1,
      id,
      order.revision,
      { label: "Table 8", items: [line] },
      randomUUID(),
    ]);
    let feed = await call("app_kitchen_feed_v1", [3, null]);
    assert.ok(feed.tickets.every((t) => t.change_notice));
    await assert.rejects(
      () =>
        call("app_ticket_action_v1", [
          3,
          feed.tickets[0].id,
          feed.tickets[0].revision,
          "toggle",
          line.lineId,
        ]),
      /Acknowledge/,
    );
    for (const t of feed.tickets)
      await call("app_ticket_action_v1", [
        3,
        t.id,
        t.revision,
        "acknowledge",
        null,
      ]);
    const key = randomUUID(),
      card = randomUUID(),
      bank = randomUUID();
    const payload = {
      checkoutKey: key,
      receiptNo: "SPLIT",
      orderId: id,
      orderRevision: order.revision,
      orderLabel: "Table 8",
      orderType: "Dine In",
      dispatchKey: randomUUID(),
      billId: bill.id,
      expectedBillUpdatedAt: bill.updatedAt - 1,
      items: [line],
      paymentLines: [
        { method: "Card", amount: 75 },
        { method: "Bank Transfer", amount: 75 },
      ],
      proofs: { Card: card, "Bank Transfer": bank },
    };
    await assert.rejects(
      () => call("app_checkout_v1", [1, payload, "split"]),
      /closed/,
    );
    payload.expectedBillUpdatedAt = (
      await db.query('select "updatedAt" from running_bills where id=$1', [
        bill.id,
      ])
    ).rows[0].updatedAt;
    await db.query(
      `insert into payment_proofs(id,checkout_key,method,amount_cents,staff_id,object_path,status) values($1,$2,'Card',7500,1,'card.jpg','uploaded')`,
      [card, key],
    );
    await assert.rejects(
      () => call("app_checkout_v1", [1, payload, "split"]),
      /Bank Transfer/,
    );
    await db.query(
      `insert into payment_proofs(id,checkout_key,method,amount_cents,staff_id,object_path,status) values($1,$2,'Bank Transfer',7400,1,'bank.jpg','uploaded')`,
      [bank, key],
    );
    await assert.rejects(
      () => call("app_checkout_v1", [1, payload, "split"]),
      /Bank Transfer/,
    );
    await db.query("update payment_proofs set amount_cents=7500 where id=$1", [
      bank,
    ]);
    await db.exec('update ingredients set "inStock"=4 where id=1');
    const tx = await call("app_checkout_v1", [1, payload, "split"]);
    assert.equal(tx.total, 150);
    assert.equal(
      (
        await db.query(
          "select count(*) n from payment_proofs where status='attached'",
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      () => call("app_cancel_order_v1", [1, id, "Too late"]),
      /unpaid/,
    );
    await db.exec("update product_ingredients set quantity=90");
    await call("app_reverse_transaction_v1", [1, tx.id, "Wrong order", false]);
    assert.equal(
      (await db.query('select "inStock" from ingredients where id=1')).rows[0]
        .inStock,
      "4",
      "Restores the actual original deduction, despite a recipe change and stock clamp",
    );
    const cash = {
      checkoutKey: randomUUID(),
      receiptNo: "CHANGE",
      orderType: "Takeaway",
      items: [line],
      paymentLines: [{ method: "Cash", amount: 200 }],
      proofs: {},
      orderId: randomUUID(),
      orderLabel: "Takeaway 2",
      orderRevision: 0,
      dispatchKey: randomUUID(),
    };
    const paid = await call("app_checkout_v1", [1, cash, "cash"]);
    assert.equal(paid.cashReceived, 200);
    assert.equal(paid.paymentLines[0].amount, 150);
  } finally {
    await db.close();
  }
});

test("secure SQL: dispatch idempotency, updates, checkout photos, inventory and reversal", async () => {
  const db = await createSecureDb();
  const call = async (name, params) =>
    (
      await db.query(
        `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        params,
      )
    ).rows[0].result;
  const food = {
    lineId: randomUUID(),
    productId: 10,
    name: "Food with a long preparation note",
    category: "Food",
    quantity: 1,
    price: 150,
    cost: 60,
    discount: 0,
    markup: 0,
    note: "No onions",
    reportingType: "sale",
  };
  const coffee = {
    ...food,
    lineId: randomUUID(),
    productId: 11,
    name: "Coffee",
    category: "Drinks",
    price: 100,
    cost: 40,
  };
  const orderId = randomUUID(),
    dispatchKey = randomUUID();
  try {
    const payload = {
      label: "Table 7",
      orderType: "Dine In",
      items: [food, coffee],
    };
    const order = await call("app_dispatch_v1", [
      1,
      orderId,
      0,
      payload,
      dispatchKey,
    ]);
    assert.equal(order.revision, 1);
    assert.deepEqual(
      await call("app_dispatch_v1", [1, orderId, 0, payload, dispatchKey]),
      order,
    );
    let feed = await call("app_kitchen_feed_v1", [3, null]);
    assert.equal(feed.tickets.length, 1);
    assert.equal(feed.tickets[0].items.length, 1);
    assert.equal(feed.tickets[0].app_orders.label, "Table 7");
    assert.ok(!JSON.stringify(feed).includes("price"));
    await assert.rejects(() =>
      call("app_ticket_action_v1", [
        3,
        feed.tickets[0].id,
        0,
        "complete",
        null,
      ]),
    );
    let ticket = await call("app_ticket_action_v1", [
      3,
      feed.tickets[0].id,
      0,
      "toggle",
      food.lineId,
    ]);
    ticket = await call("app_ticket_action_v1", [
      3,
      ticket.id,
      ticket.revision,
      "complete",
      null,
    ]);
    assert.equal(ticket.status, "completed");
    await assert.rejects(
      () => call("app_ticket_action_v1", [3, ticket.id, 0, "reopen", null]),
      /changed/,
    );
    const paymentKey = randomUUID(),
      proofId = randomUUID();
    const checkout = {
      checkoutKey: paymentKey,
      receiptNo: "SECURE-1",
      orderId,
      orderRevision: 1,
      orderLabel: "Table 7",
      orderType: "Dine In",
      dispatchKey: randomUUID(),
      items: [food, coffee],
      paymentLines: [{ method: "Card", amount: 250 }],
      proofs: {},
      orderDiscount: 0,
      orderDiscountAmount: 0,
    };
    await assert.rejects(
      () => call("app_checkout_v1", [1, checkout, "hash"]),
      /photo/,
    );
    assert.equal(
      (await db.query("select count(*) as n from transactions")).rows[0].n,
      0,
    );
    await db.query(
      `insert into payment_proofs(id,checkout_key,method,amount_cents,staff_id,object_path,status) values($1,$2,'Card',25000,1,'test.jpg','uploaded')`,
      [proofId, paymentKey],
    );
    checkout.proofs.Card = proofId;
    const transaction = await call("app_checkout_v1", [1, checkout, "hash"]);
    assert.equal(transaction.total, 250);
    assert.deepEqual(
      await call("app_checkout_v1", [1, checkout, "hash"]),
      transaction,
    );
    assert.equal(
      (await db.query('select "inStock" from ingredients where id=1')).rows[0]
        .inStock,
      "990",
    );
    assert.equal(
      (await db.query("select count(*) as n from kitchen_tickets")).rows[0].n,
      1,
    );
    const proof = (await db.query("select * from payment_proofs")).rows[0];
    assert.equal(proof.status, "attached");
    assert.ok(
      Date.parse(proof.expires_at) - Date.parse(proof.attached_at) >
        89 * 86400000,
    );
    await call("app_reverse_transaction_v1", [
      1,
      transaction.id,
      "Customer cancellation",
      false,
    ]);
    await call("app_reverse_transaction_v1", [
      1,
      transaction.id,
      "Retry cancellation",
      false,
    ]);
    assert.equal(
      (await db.query('select "inStock" from ingredients where id=1')).rows[0]
        .inStock,
      "1000",
    );
    feed = await call("app_kitchen_feed_v1", [3, feed.cursor]);
    assert.equal(feed.tickets[0].cancel_requested, true);
    await prepareTestPins(db);
    await db.exec(await sql("20261123123554_secure_pos_cutover.sql"));
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select * from transactions");
      }),
    );
  } finally {
    await db.close();
  }
});
