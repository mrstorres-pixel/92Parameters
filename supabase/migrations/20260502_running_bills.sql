create table if not exists public.running_bills (
  id bigserial primary key,
  "tableName" text not null,
  items jsonb not null default '[]'::jsonb,
  "orderType" text not null default 'Dine In',
  total numeric(12,2) not null default 0,
  status text not null default 'open' check (status in ('open', 'closed')),
  "staffId" bigint,
  "staffName" text,
  "openedAt" bigint not null,
  "updatedAt" bigint not null,
  "closedAt" bigint,
  "transactionId" bigint
);

create index if not exists idx_running_bills_status_updated on public.running_bills (status, "updatedAt");

grant select, insert, update, delete on public.running_bills to anon, authenticated;
grant usage, select on sequence public.running_bills_id_seq to anon, authenticated;

alter table public.running_bills enable row level security;

drop policy if exists "Allow app access to running bills" on public.running_bills;
create policy "Allow app access to running bills"
on public.running_bills
for all
to anon, authenticated
using (true)
with check (true);
