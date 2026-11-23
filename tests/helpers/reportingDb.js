import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const migrationPath = new URL(
  "../../supabase/migrations/20261123021642_reports_v2.sql",
  import.meta.url,
);
export async function createReportingDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.staff(id bigint primary key, name text, pin text, role text);
    create table public.products(id bigint primary key,name text,category text,"subCategory" text,price numeric,cost numeric);
    create table public.transactions(id bigint primary key,"receiptNo" text,datetime bigint,status text,total numeric,items jsonb,
      "staffId" bigint,"staffName" text,"paymentMethod" text,"paymentLines" jsonb,"orderDiscount" numeric,
      "orderDiscountAmount" numeric,"loyaltyDiscount" numeric,subtotal numeric,"orderType" text);
    create table public.cash_drawer(id bigint primary key,datetime bigint,type text,amount numeric,category text,notes text,"staffName" text);
    insert into public.staff values (1,'Test Owner','2468','owner'),(2,'Cashier','1357','cashier');
    grant usage on schema public to anon,authenticated;
    grant select,update on public.products,public.cash_drawer,public.transactions to anon,authenticated;
    grant select on public.staff,public.transactions,public.cash_drawer to anon,authenticated;
  `);
  const migration = await readFile(migrationPath, "utf8");
  try {
    await db.exec(migration);
  } catch (error) {
    await db.close();
    const line = migration
      .slice(0, Number(error.position) || 0)
      .split("\n").length;
    throw new Error(
      `Reports migration failed near line ${line}: ${error.message}`,
    );
  }
  return db;
}
export async function seedRows(db, table, rows) {
  if (!["transactions", "cash_drawer", "products"].includes(table))
    throw new Error("Unexpected fixture table");
  for (const row of rows)
    await db.query(
      `insert into public.${table} select * from jsonb_populate_record(null::public.${table}, $1::jsonb)`,
      [
        JSON.stringify(
          table === "products" ? { costZeroConfirmed: false, ...row } : row,
        ),
      ],
    );
}
export async function business(db, start = 0, end = 9999999999999) {
  return (
    await db.query("select public.report_business_v2($1,$2) as result", [
      start,
      end,
    ])
  ).rows[0].result;
}
