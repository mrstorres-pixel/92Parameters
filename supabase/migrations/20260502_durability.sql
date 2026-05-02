-- 92Parameters durability upgrade
-- Run this in Supabase SQL Editor or through Supabase migrations.

create table if not exists public.daily_sales_summary (
  id bigserial primary key,
  "businessDate" date not null unique,
  "transactionCount" integer not null default 0 check ("transactionCount" >= 0),
  revenue numeric(12,2) not null default 0 check (revenue >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  profit numeric(12,2) not null default 0,
  "itemCount" integer not null default 0 check ("itemCount" >= 0),
  "updatedAt" bigint not null
);

create table if not exists public.ingredient_movements (
  id bigserial primary key,
  "ingredientId" bigint not null,
  "ingredientName" text,
  "transactionId" bigint,
  "receiptNo" text,
  type text not null check (type in ('DEDUCT', 'RESTOCK', 'ADJUST')),
  quantity numeric(12,3) not null check (quantity >= 0),
  unit text,
  "beforeStock" numeric(12,3) not null,
  "afterStock" numeric(12,3) not null,
  "staffId" bigint,
  "staffName" text,
  "productName" text,
  datetime bigint not null
);

create index if not exists idx_transactions_datetime on public.transactions (datetime);
create unique index if not exists idx_transactions_receipt_no on public.transactions ("receiptNo");
create index if not exists idx_transactions_status_datetime on public.transactions (status, datetime);
create index if not exists idx_audit_log_datetime on public.audit_log (datetime);
create index if not exists idx_audit_log_entity_datetime on public.audit_log (entity, datetime);
create index if not exists idx_void_log_datetime on public.void_log (datetime);
create index if not exists idx_ingredient_movements_ingredient_datetime on public.ingredient_movements ("ingredientId", datetime);
create index if not exists idx_daily_sales_summary_business_date on public.daily_sales_summary ("businessDate");

grant select, insert, update, delete on public.daily_sales_summary to anon, authenticated;
grant select, insert, update, delete on public.ingredient_movements to anon, authenticated;
grant usage, select on sequence public.daily_sales_summary_id_seq to anon, authenticated;
grant usage, select on sequence public.ingredient_movements_id_seq to anon, authenticated;

alter table public.daily_sales_summary enable row level security;
alter table public.ingredient_movements enable row level security;

drop policy if exists "Allow app access to daily sales summary" on public.daily_sales_summary;
create policy "Allow app access to daily sales summary"
on public.daily_sales_summary
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Allow app access to ingredient movements" on public.ingredient_movements;
create policy "Allow app access to ingredient movements"
on public.ingredient_movements
for all
to anon, authenticated
using (true)
with check (true);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'price') then
    alter table public.products add constraint products_price_nonnegative check (price >= 0);
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'cost') then
    alter table public.products add constraint products_cost_nonnegative check (cost >= 0);
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ingredients' and column_name = 'inStock') then
    alter table public.ingredients add constraint ingredients_stock_nonnegative check ("inStock" >= 0);
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory' and column_name = 'inStock') then
    alter table public.inventory add constraint inventory_stock_nonnegative check ("inStock" >= 0);
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'pin') then
    alter table public.staff add constraint staff_pin_four_digits check (pin ~ '^[0-9]{4}$');
  end if;
exception when duplicate_object then null;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'pin') then
    create unique index if not exists idx_staff_pin_unique on public.staff (pin);
  end if;
end $$;
