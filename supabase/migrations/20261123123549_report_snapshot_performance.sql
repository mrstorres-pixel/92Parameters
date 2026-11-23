-- Evaluate the period once. SQL-function inlining previously expanded the
-- normalization work through both the returned snapshot and its totals.
create or replace function public.report_period_v2(p_start_ms bigint, p_end_exclusive_ms bigint) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  with tx as materialized (
    select id, datetime, to_jsonb(t) as original from public.transactions t
    where datetime >= p_start_ms and datetime < p_end_exclusive_ms
  ), ids as materialized (
    select distinct i->>'productId' as id from tx cross join lateral jsonb_array_elements(
      case when jsonb_typeof(original->'items')='array' then original->'items' else '[]'::jsonb end) i
  ), products_map as materialized (
    select coalesce(jsonb_object_agg(p.id::text,jsonb_build_object('reportingType',p."reportingType",'costZeroConfirmed',p."costZeroConfirmed",'cost',p.cost)),'{}') as data
    from public.products p where p.id::text in (select id from ids)
  ), reviews_map as materialized (
    select coalesce(jsonb_object_agg(r.transaction_id::text||':'||r.item_index::text,to_jsonb(r)),'{}') as data
    from public.reporting_reviews r where r.transaction_id in (select id from tx)
  ), normalized as materialized (
    select id,datetime,public.report_normalize_transaction_v2(original,p.data,r.data) as row
    from tx cross join products_map p cross join reviews_map r
  ) select jsonb_build_object('version',2,'generatedAt',statement_timestamp(),
    'startMs',p_start_ms,'endExclusiveMs',p_end_exclusive_ms,'timezone','Asia/Manila','currency','PHP',
    'transactions',coalesce((select jsonb_agg(row order by datetime desc,id desc) from normalized),'[]'),
    'cashEntries',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('amountCents',round(public.report_number_v2(c.amount::text)*100)::bigint) order by c.datetime desc,c.id desc)
      from public.cash_drawer c where c.datetime>=p_start_ms and c.datetime<p_end_exclusive_ms),'[]')) into result;
  return result;
end $$;

create or replace function public.report_business_v2(p_start_ms bigint,p_end_exclusive_ms bigint) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare snapshot jsonb := public.report_period_v2(p_start_ms,p_end_exclusive_ms);
begin return snapshot||jsonb_build_object('totals',public.report_totals_v2(snapshot)); end $$;

create or replace function public.report_transactions_v2(p_start_ms bigint,p_end_exclusive_ms bigint,p_search text default '',p_payment text default 'All',p_status text default 'All',p_staff text default 'All',p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare snapshot jsonb := public.report_period_v2(p_start_ms,p_end_exclusive_ms); selected jsonb; result jsonb;
begin
  select coalesce(jsonb_agg(tx order by (tx->>'datetime')::bigint desc,(tx->>'id')::bigint desc),'[]') into selected
  from jsonb_array_elements(snapshot->'transactions') tx
  where (p_status='All' or tx->>'status'=p_status) and (p_staff='All' or tx->>'staffId'=p_staff)
    and (p_payment='All' or exists(select 1 from jsonb_array_elements(tx->'report'->'payments') p where p->>'method'=p_payment))
    and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',tx->>'receiptNo',tx->>'staffName',tx->>'paymentMethod',tx->'items'::text)))>0);
  select (snapshot-'transactions')||jsonb_build_object(
    'transactions',coalesce((select jsonb_agg(tx) from (select tx from jsonb_array_elements(selected) tx offset greatest(p_offset,0) limit case when p_limit=0 then null else least(greatest(p_limit,1),200) end) page),'[]'),
    'matchingCount',jsonb_array_length(selected),'totals',public.report_totals_v2(jsonb_set(snapshot,'{transactions}',selected)),
    'paymentBreakdown',coalesce((select jsonb_agg(jsonb_build_object('name',method,'amountCents',amount)) from (
      select p->>'method' as method,sum((p->>'amountCents')::bigint) as amount from jsonb_array_elements(selected) tx cross join lateral jsonb_array_elements(tx->'report'->'payments') p
      where tx->>'status'='completed' group by p->>'method') grouped),'[]'),
    'selectedPaymentCents',coalesce((select sum((p->>'amountCents')::bigint) from jsonb_array_elements(selected) tx cross join lateral jsonb_array_elements(tx->'report'->'payments') p where tx->>'status'='completed' and (p_payment='All' or p->>'method'=p_payment)),0)) into result;
  return result;
end $$;

create or replace function public.report_cash_v2(p_start_ms bigint,p_end_exclusive_ms bigint,p_search text default '',p_review_only boolean default false) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare snapshot jsonb := public.report_period_v2(p_start_ms,p_end_exclusive_ms); selected jsonb;
begin
  select coalesce(jsonb_agg(c),'[]') into selected from jsonb_array_elements(snapshot->'cashEntries') c where
    (not p_review_only or (c->>'type'='out' and coalesce(c->>'category','') not in ('operating_expense','stock_purchase','owner_withdrawal')))
    and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',c->>'notes',c->>'staffName',replace(c->>'category','_',' '),case when c->>'type'='in' then 'cash in' else 'cash out' end,c->>'amount')))>0);
  return snapshot||jsonb_build_object('totals',public.report_totals_v2(snapshot),'matchingEntries',selected);
end $$;

create index if not exists idx_transactions_datetime on public.transactions(datetime);
create index if not exists idx_cash_drawer_datetime on public.cash_drawer(datetime);
-- No financial rows, receipt hashes, access grants or timeout limits change.
