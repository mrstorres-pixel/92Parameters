create or replace function public.adjust_ingredient_stock(
  p_ingredient_id bigint,
  p_delta numeric
)
returns table(before_stock numeric, after_stock numeric)
language plpgsql
as $$
declare
  current_stock numeric;
begin
  select "inStock"
  into current_stock
  from public.ingredients
  where id = p_ingredient_id
  for update;

  if current_stock is null then
    return;
  end if;

  before_stock := current_stock;
  after_stock := greatest(0, current_stock + p_delta);

  update public.ingredients
  set "inStock" = after_stock
  where id = p_ingredient_id;

  return next;
end;
$$;

grant execute on function public.adjust_ingredient_stock(bigint, numeric) to anon, authenticated;
