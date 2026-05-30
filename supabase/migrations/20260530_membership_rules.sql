alter table public.customers
add column if not exists "expiresAt" bigint,
add column if not exists "birthdayRewardYear" integer;

alter table public.membership_cards
add column if not exists "expiresAt" bigint;

alter table public.transactions
add column if not exists "birthdayRewardRedeemed" boolean not null default false;

create index if not exists idx_customers_expires_at on public.customers ("expiresAt");
create index if not exists idx_membership_cards_expires_at on public.membership_cards ("expiresAt");
