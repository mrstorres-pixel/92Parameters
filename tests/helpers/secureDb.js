import { readFile } from "node:fs/promises";
import { createReportingDb } from "./reportingDb.js";
import { hashPin, pinLookup } from "../../server/security.js";
export async function prepareTestPins(db) {
  for (const row of (await db.query("select id,pin from staff")).rows)
    await db.query("update staff set pin_hash=$1,pin_lookup=$2 where id=$3", [
      hashPin(row.pin),
      pinLookup(row.pin, "test-pepper"),
      row.id,
    ]);
}
export const sql = async (name) =>
  readFile(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
export async function createSecureDb() {
  const db = await createReportingDb();
  try {
    await db.exec(`create role service_role bypassrls;
      grant usage on schema public to service_role;
      alter table staff add column "hourlyRate" numeric default 0, add column "profileImage" text;
      create sequence transaction_ids start 1;alter table transactions alter column id set default nextval('transaction_ids');
      create table inventory(id bigserial primary key,name text,"inStock" numeric);
      create table ingredients(id bigserial primary key,name text,unit text,"inStock" numeric);
      create table product_ingredients(id bigserial primary key,"productId" bigint,"ingredientId" bigint,quantity numeric);
      create table product_inventory(id bigserial primary key,"productId" bigint,"inventoryId" bigint,quantity numeric);
      create table audit_log(id bigserial primary key,datetime bigint,entity text,action text,"staffId" bigint,"staffName" text,details text);
      create table void_log(id bigserial primary key,"transactionId" bigint,"receiptNo" text,reason text,"staffId" bigint,"staffName" text,datetime bigint,"originalData" jsonb);
      create table time_records(id bigserial primary key,"staffId" bigint,date text,"timeIn" bigint,"timeOut" bigint,"photoIn" text,"photoOut" text,"salaryEarned" numeric);
      alter table transactions add column "cashReceived" numeric;
    `);
    for (const name of [
      "20260502_running_bills.sql",
      "20260502_durability.sql",
      "20260506_order_adjustments.sql",
      "20260506_transaction_checkout_key.sql",
      "20260528_loyalty_membership.sql",
      "20260530_membership_cards.sql",
      "20260530_membership_rules.sql",
      "20261123123549_report_snapshot_performance.sql",
      "20261123123552_secure_pos_kitchen.sql",
    ])
      await db.exec(await sql(name));
    await db.exec(`grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;
      insert into staff(id,name,pin,role) values(3,'Kitchen','9753','kitchen');
      insert into products(id,name,category,price,cost,"reportingType","prepStation") values(10,'Food with a long preparation note','Food',150,60,'sale','kitchen'),(11,'Coffee','Drinks',100,40,'sale','none');
      insert into ingredients(id,name,unit,"inStock") values(1,'Ingredient','g',1000);insert into product_ingredients("productId","ingredientId",quantity) values(10,1,10);
      insert into inventory(id,name,"inStock") values(1,'Box',100);insert into product_inventory("productId","inventoryId",quantity) values(10,1,1);
    `);
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
