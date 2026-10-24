-- Classification is explicitly saved by the user; existing notes and amounts are unchanged.
begin;
set local lock_timeout = '5s';

alter table public.cash_drawer
  add column if not exists category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cash_drawer'::regclass
      and conname = 'cash_drawer_category_check'
  ) then
    alter table public.cash_drawer add constraint cash_drawer_category_check
      check (category is null or (
        type is not null and type = 'out' and category in ('operating_expense', 'stock_purchase', 'owner_withdrawal')
      ));
  end if;
end;
$$;

comment on column public.cash_drawer.category is
  'User-reviewed cash-out classification. NULL means unclassified; note-based suggestions are not stored until explicitly saved.';

notify pgrst, 'reload schema';
commit;
