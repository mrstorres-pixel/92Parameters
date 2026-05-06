alter table public.transactions
add column if not exists "checkoutKey" text;

create unique index if not exists idx_transactions_checkout_key
on public.transactions ("checkoutKey")
where "checkoutKey" is not null;
