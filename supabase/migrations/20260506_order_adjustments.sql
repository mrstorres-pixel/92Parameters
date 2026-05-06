alter table public.running_bills
add column if not exists "orderDiscount" numeric(6,2) not null default 0,
add column if not exists "orderMarkup" numeric(6,2) not null default 0,
add column if not exists "orderDiscountAmount" numeric(12,2) not null default 0,
add column if not exists "orderMarkupAmount" numeric(12,2) not null default 0;

alter table public.transactions
add column if not exists "orderDiscount" numeric(6,2) not null default 0,
add column if not exists "orderMarkup" numeric(6,2) not null default 0,
add column if not exists "orderDiscountAmount" numeric(12,2) not null default 0,
add column if not exists "orderMarkupAmount" numeric(12,2) not null default 0,
add column if not exists subtotal numeric(12,2);
