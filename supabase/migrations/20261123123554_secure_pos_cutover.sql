-- ACTIVATION ONLY: deploy/test the backend and set VITE_SECURE_BACKEND=true first.
-- Old anonymous clients deliberately fail closed. Keep an admin SQL session open.
begin;
do $$ begin
  if not exists(select 1 from public.staff where role='owner' and pin_hash is not null and pin_lookup is not null)
    or exists(select 1 from public.staff where pin_hash is null or pin_lookup is null) then
    raise exception 'Prepare all staff PIN hashes with scripts/prepareStaffPins.mjs before cutover';
  end if;
end $$;
do $$ declare t text; f record; begin
  foreach t in array array['staff','products','inventory','ingredients','product_ingredients','product_inventory','transactions','running_bills','daily_sales_summary','ingredient_movements','cash_drawer','time_records','void_log','audit_log','customers','membership_cards','loyalty_transactions','reporting_reviews','reporting_review_history'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'report_%' or proname='adjust_ingredient_stock') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
grant usage,select on all sequences in schema public to service_role;
create or replace function public.report_owner_v2(p_owner_pin text) returns bigint
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor bigint; begin
  if current_user <> 'service_role' then raise exception 'Secure server session required'; end if;
  actor:=(current_setting('request.headers',true)::jsonb->>'x-app-actor-id')::bigint;
  if actor is null or not exists(select 1 from staff where id=actor and role='owner') then raise exception 'Owner account required'; end if;
  return actor;
end $$;
revoke all on function public.report_owner_v2(text) from public,anon,authenticated;
grant execute on function public.report_owner_v2(text) to service_role;
update public.staff set pin=null where pin_hash is not null;
notify pgrst,'reload schema';
commit;
