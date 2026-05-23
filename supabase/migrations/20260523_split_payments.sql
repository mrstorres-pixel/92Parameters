alter table public.transactions
add column if not exists "paymentLines" jsonb not null default '[]'::jsonb;
