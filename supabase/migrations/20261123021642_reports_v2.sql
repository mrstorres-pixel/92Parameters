-- Additive reporting release. No receipt amounts, costs or notes are rewritten.
begin;
set local lock_timeout = '5s';

alter table public.products add column if not exists "reportingType" text;
alter table public.products add column if not exists "costZeroConfirmed" boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_reporting_type_check') then
    alter table public.products add constraint products_reporting_type_check
      check ("reportingType" is null or "reportingType" in ('sale', 'packaging', 'waste'));
  end if;
end $$;

create table if not exists public.reporting_reviews (
  transaction_id bigint not null,
  item_index integer not null check (item_index >= -1),
  source_hash text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  reason text not null check (length(trim(reason)) >= 5),
  reviewer_id bigint not null,
  reviewed_at timestamptz not null default now(),
  primary key (transaction_id, item_index)
);
create table if not exists public.reporting_review_history (
  id bigserial primary key,
  entity text not null,
  entity_id text not null,
  previous_data jsonb,
  reviewed_data jsonb not null,
  reason text not null,
  reviewer_id bigint not null,
  reviewed_at timestamptz not null default now()
);
alter table public.reporting_reviews enable row level security;
alter table public.reporting_review_history enable row level security;
-- Existing app uses PIN profiles, not Supabase Auth sessions. Writes require a
-- verified owner PIN in an invoker RPC; direct REST writes cannot set this flag.
drop policy if exists reporting_reviews_read on public.reporting_reviews;
create policy reporting_reviews_read on public.reporting_reviews for select to anon, authenticated using (true);
drop policy if exists reporting_reviews_write on public.reporting_reviews;
create policy reporting_reviews_write on public.reporting_reviews for all to anon, authenticated
  using (current_setting('app.reporting_owner', true) is not null and current_setting('app.reporting_owner', true) <> '')
  with check (reviewer_id::text = current_setting('app.reporting_owner', true));
drop policy if exists reporting_history_read on public.reporting_review_history;
create policy reporting_history_read on public.reporting_review_history for select to anon, authenticated using (true);
drop policy if exists reporting_history_append on public.reporting_review_history;
create policy reporting_history_append on public.reporting_review_history for insert to anon, authenticated
  with check (reviewer_id::text = current_setting('app.reporting_owner', true));
grant select, insert, update on public.reporting_reviews to anon, authenticated;
grant select, insert on public.reporting_review_history to anon, authenticated;
grant usage, select on sequence public.reporting_review_history_id_seq to anon, authenticated;

create or replace function public.report_number_v2(value text) returns numeric
language plpgsql immutable security invoker set search_path = public, pg_temp as $$
begin
  if value is null or trim(value) = '' or lower(value) in ('nan','infinity','-infinity') then return null; end if;
  return value::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end $$;

create or replace function public.report_normalize_transaction_v2(tx jsonb, products_map jsonb, reviews_map jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  item jsonb; product jsonb; review jsonb; header_review jsonb; line jsonb;
  lines jsonb := '[]'; payments jsonb := '[]'; issues jsonb := '[]';
  idx integer := 0; kind text; source text; hash text; qty numeric; unit_cost numeric; unit_price numeric;
  raw_amount numeric; line_base bigint; line_cost bigint; base_sum bigint := 0; eligible_sum bigint := 0;
  total_cents bigint; expected_cents bigint; paid_cents bigint := 0; allocated bigint := 0;
  cogs bigint := 0; waste bigint := 0; customer_items numeric := 0; has_customer boolean := false;
  cost_ready boolean := true; sales_ready boolean := true; confirmed_zero boolean;
  weights numeric[] := '{}'; floors bigint[] := '{}'; fractions numeric[] := '{}';
  n integer; best integer; remaining bigint; order_discount numeric; order_amount numeric; loyalty numeric;
  method text; amount bigint; payment_source jsonb; review_valid boolean; field text;
begin
  total_cents := round(public.report_number_v2(tx->>'total') * 100)::bigint;
  if total_cents is null or total_cents < 0 then
    sales_ready := false; issues := issues || jsonb_build_array(jsonb_build_object('code','invalid_total','message','Receipt total is missing or invalid.','itemIndex',-1));
  end if;
  if coalesce(tx->>'status','') not in ('completed','void') then
    sales_ready := false; issues := issues || jsonb_build_array(jsonb_build_object('code','unknown_status','message','Receipt status needs review.','itemIndex',-1));
  end if;
  header_review := reviews_map -> ((tx->>'id') || ':-1');
  if header_review->>'source_hash' is distinct from md5(tx::text) then header_review := null; end if;
  if (case when jsonb_typeof(tx->'items')='array' then jsonb_array_length(tx->'items')=0 else true end) then
    sales_ready := false; cost_ready := false;
    issues := issues || jsonb_build_array(jsonb_build_object('code','missing_items','message','Receipt items are missing.','itemIndex',-1));
  else
    for item in select value from jsonb_array_elements(tx->'items') loop
      hash := md5(item::text);
      product := products_map -> (item->>'productId');
      review := reviews_map -> ((tx->>'id') || ':' || idx);
      review_valid := review->>'source_hash' = hash;
      if review is not null and not coalesce(review_valid,false) then
        cost_ready := false;
        issues := issues || jsonb_build_array(jsonb_build_object('code','stale_review','message','Item changed after its previous review.','itemIndex',idx));
        review := null;
      end if;
      kind := coalesce(review->'data'->>'reportingType', item->>'reportingType', product->>'reportingType');
      source := case when review->'data'->>'reportingType' is not null then 'review' when item->>'reportingType' is not null then 'receipt' when product->>'reportingType' is not null then 'product' else 'legacy' end;
      if kind is null then
        if regexp_replace(lower(coalesce(item->>'name','')), '[^a-z0-9]', '', 'g') in ('milkwastefullcream','milkwastefullcreammilk') then
          kind := 'waste';
          cost_ready := false;
          issues := issues || jsonb_build_array(jsonb_build_object('code','classification_review','message','Confirm this legacy milk/waste product as waste.','itemIndex',idx));
        elsif lower(coalesce(item->>'category','')) in ('takeout box','packaging') then kind := 'packaging';
        elsif lower(coalesce(item->>'category','')) in ('food','drinks') then kind := 'sale';
        else kind := 'sale'; cost_ready := false; issues := issues || jsonb_build_array(jsonb_build_object('code','classification_review','message','Confirm this legacy item reporting type.','itemIndex',idx));
        end if;
      end if;
      if kind not in ('sale','packaging','waste') then
        cost_ready := false;
        kind := 'sale'; issues := issues || jsonb_build_array(jsonb_build_object('code','classification_review','message','Invalid reporting type.','itemIndex',idx));
      end if;
      qty := public.report_number_v2(item->>'quantity');
      for field in select unnest(array['discount','markup','discountAmount','markupAmount','customPrice']) loop
        if item->>field is not null and (public.report_number_v2(item->>field) is null or public.report_number_v2(item->>field)<0 or (field='discount' and public.report_number_v2(item->>field)>100)) then
          sales_ready := false;
          issues := issues || jsonb_build_array(jsonb_build_object('code','invalid_adjustment','message','Item price adjustment is invalid.','itemIndex',idx));
        end if;
      end loop;
      unit_cost := coalesce(public.report_number_v2(review->'data'->>'unitCost'), public.report_number_v2(item->>'cost'));
      confirmed_zero := coalesce((review->'data'->>'confirmZero')::boolean, false)
        or coalesce((item->>'costZeroConfirmed')::boolean,false)
        or (coalesce((product->>'costZeroConfirmed')::boolean,false) and public.report_number_v2(product->>'cost') = unit_cost);
      if qty is null or qty <= 0 then
        cost_ready := false; sales_ready := false;
        issues := issues || jsonb_build_array(jsonb_build_object('code','invalid_quantity','message','Item quantity is missing or invalid.','itemIndex',idx));
      end if;
      line_cost := round(unit_cost * qty * 100)::bigint;
      if unit_cost is null or unit_cost < 0 or (unit_cost = 0 and not coalesce(confirmed_zero,false)) then
        cost_ready := false;
        issues := issues || jsonb_build_array(jsonb_build_object('code','cost_review','message','Confirm the historical unit cost; zero cost needs explicit confirmation.','itemIndex',idx));
      end if;
      unit_price := public.report_number_v2(item->>'price');
      if coalesce(public.report_number_v2(item->>'customPrice'),0) > 0 then unit_price := public.report_number_v2(item->>'customPrice');
      else
        unit_price := greatest(0, unit_price * (1 - coalesce(public.report_number_v2(item->>'discount'),0)/100)
          * (1 + coalesce(public.report_number_v2(item->>'markup'),0)/100)
          - coalesce(public.report_number_v2(item->>'discountAmount'),0) + coalesce(public.report_number_v2(item->>'markupAmount'),0));
      end if;
      if public.report_number_v2(item->>'price') is null or public.report_number_v2(item->>'price') < 0 then
        sales_ready := false;
        issues := issues || jsonb_build_array(jsonb_build_object('code','invalid_price','message','Historical item price is missing or invalid.','itemIndex',idx));
      end if;
      line_base := round(unit_price * qty * 100)::bigint;
      base_sum := base_sum + coalesce(line_base,0);
      if kind = 'waste' then
        waste := waste + coalesce(line_cost,0);
        if coalesce(line_base,0) <> 0 then
          sales_ready := false; issues := issues || jsonb_build_array(jsonb_build_object('code','waste_charge','message','Waste has a selling amount; verify the recorded transaction.','itemIndex',idx));
        end if;
      else
        cogs := cogs + coalesce(line_cost,0);
        eligible_sum := eligible_sum + coalesce(line_base,0);
        has_customer := true;
        if kind = 'sale' then customer_items := customer_items + coalesce(qty,0); end if;
      end if;
      weights := array_append(weights, case when kind = 'waste' then 0 else coalesce(line_base,0) end);
      lines := lines || jsonb_build_array(jsonb_build_object('index',idx,'sourceHash',hash,'name',item->>'name','productId',item->'productId',
        'category',case when kind='packaging' then 'Packaging' when kind='waste' then 'Waste' else coalesce(nullif(item->>'category',''),'Other') end,
        'kind',kind,'classificationSource',source,'costSource',case when review->'data' ? 'unitCost' then 'review' else 'receipt' end,
        'quantity',qty,'unitCost',unit_cost,'costCents',line_cost,'baseCents',line_base,'salesCents',0));
      idx := idx + 1;
    end loop;
  end if;
  order_discount := coalesce(public.report_number_v2(tx->>'orderDiscount'),0);
  for field in select unnest(array['orderDiscount','orderDiscountAmount','loyaltyDiscount']) loop
    if tx->>field is not null and (public.report_number_v2(tx->>field) is null or public.report_number_v2(tx->>field)<0 or (field='orderDiscount' and public.report_number_v2(tx->>field)>100)) then
      sales_ready := false;
      issues := issues || jsonb_build_array(jsonb_build_object('code','invalid_adjustment','message','Receipt adjustment is invalid.','itemIndex',-1));
    end if;
  end loop;
  order_amount := coalesce(public.report_number_v2(tx->>'orderDiscountAmount'),0);
  loyalty := coalesce(public.report_number_v2(tx->>'loyaltyDiscount'),0);
  expected_cents := round(greatest(0, base_sum * (1-order_discount/100) - (order_amount+loyalty)*100))::bigint;
  if expected_cents is distinct from total_cents and not coalesce((header_review->'data'->>'confirmAdjustment')::boolean,false) then
    issues := issues || jsonb_build_array(jsonb_build_object('code','receipt_adjustment','message','Item amounts and recorded adjustments do not explain the saved receipt total.','itemIndex',-1,'differenceCents',total_cents-expected_cents));
  end if;
  n := coalesce(array_length(weights,1),0);
  if eligible_sum > 0 and coalesce(total_cents,0) >= 0 then
    for idx in 1..n loop
      raw_amount := total_cents::numeric * weights[idx] / eligible_sum;
      floors := array_append(floors, floor(raw_amount)::bigint);
      fractions := array_append(fractions, raw_amount-floor(raw_amount));
      allocated := allocated + floor(raw_amount)::bigint;
    end loop;
    remaining := total_cents - allocated;
    while remaining > 0 loop
      best := 1;
      for idx in 1..n loop if fractions[idx] > fractions[best] then best := idx; end if; end loop;
      floors[best] := floors[best]+1; fractions[best] := -1; remaining := remaining-1;
    end loop;
    for idx in 1..n loop lines := jsonb_set(lines, array[(idx-1)::text,'salesCents'], to_jsonb(floors[idx])); end loop;
    allocated := total_cents;
  elsif coalesce(total_cents,0) <> 0 then
    sales_ready := false;
    issues := issues || jsonb_build_array(jsonb_build_object('code','unallocated_sales','message','Sales have no eligible item amounts for allocation.','itemIndex',-1));
  end if;
  payment_source := coalesce(header_review->'data'->'paymentLines', tx->'paymentLines');
  if jsonb_typeof(payment_source) = 'array' and jsonb_array_length(payment_source) > 0 then
    for line in select value from jsonb_array_elements(payment_source) loop
      method := nullif(trim(line->>'method'),''); amount := round(public.report_number_v2(line->>'amount')*100)::bigint;
      if method is null or amount is null or amount < 0 then
        issues := issues || jsonb_build_array(jsonb_build_object('code','payment_mismatch','message','Payment line is missing or invalid.','itemIndex',-1));
      elsif amount > 0 then
        payments := payments || jsonb_build_array(jsonb_build_object('method',method,'amountCents',amount)); paid_cents := paid_cents+amount;
      end if;
    end loop;
  elsif coalesce(total_cents,0) > 0 then
    method := tx->>'paymentMethod';
    if method is null or method in ('Loyalty','Split') or position('+' in method)>0 then
      issues := issues || jsonb_build_array(jsonb_build_object('code','payment_mismatch','message','Payment method or split amounts are missing.','itemIndex',-1));
    else payments := jsonb_build_array(jsonb_build_object('method',method,'amountCents',total_cents)); paid_cents := total_cents;
    end if;
  end if;
  if paid_cents is distinct from total_cents then
    issues := issues || jsonb_build_array(jsonb_build_object('code','payment_mismatch','message','Recorded payment portions do not equal the receipt total.','itemIndex',-1,'differenceCents',paid_cents-total_cents));
  end if;
  return tx || jsonb_build_object('report', jsonb_build_object('sourceHash',md5(tx::text),'totalCents',total_cents,'baseCents',base_sum,
    'adjustmentCents',base_sum-total_cents,'unallocatedCents',coalesce(total_cents,0)-allocated,'cogsCents',cogs,'wasteCents',waste,
    'hasCustomer',has_customer,'customerItems',customer_items,'salesReady',sales_ready,'costReady',cost_ready,
    'lines',lines,'payments',payments,'paymentSource',case when header_review->'data' ? 'paymentLines' then 'review' else 'receipt' end,'issues',issues));
end $$;

create or replace function public.report_period_v2(p_start_ms bigint, p_end_exclusive_ms bigint) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with p as (select coalesce(jsonb_object_agg(id::text,to_jsonb(products)),'{}') as map from public.products),
  r as (select coalesce(jsonb_object_agg(transaction_id::text||':'||item_index::text,to_jsonb(reporting_reviews)),'{}') as map from public.reporting_reviews),
  t as (select public.report_normalize_transaction_v2(to_jsonb(transactions),p.map,r.map) as row
    from public.transactions cross join p cross join r where datetime >= p_start_ms and datetime < p_end_exclusive_ms),
  c as (select to_jsonb(cash_drawer) || jsonb_build_object('amountCents',round(public.report_number_v2(amount::text)*100)::bigint) as row
    from public.cash_drawer where datetime >= p_start_ms and datetime < p_end_exclusive_ms)
  select jsonb_build_object('version',2,'generatedAt',statement_timestamp(),'startMs',p_start_ms,'endExclusiveMs',p_end_exclusive_ms,
    'timezone','Asia/Manila','currency','PHP','transactions',coalesce((select jsonb_agg(row order by (row->>'datetime')::bigint desc,(row->>'id')::bigint desc) from t),'[]'),
    'cashEntries',coalesce((select jsonb_agg(row order by (row->>'datetime')::bigint desc,(row->>'id')::bigint desc) from c),'[]'));
$$;

create or replace function public.report_totals_v2(snapshot jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with t as (select value as tx from jsonb_array_elements(snapshot->'transactions')),
  completed as (select tx,tx->'report' as r from t where tx->>'status'='completed'),
  cash as (select value as c from jsonb_array_elements(snapshot->'cashEntries')),
  payments as (select p from completed cross join lateral jsonb_array_elements(r->'payments') as p)
  select jsonb_build_object(
    'salesCents',coalesce((select sum((r->>'totalCents')::bigint) from completed),0),
    'cogsCents',coalesce((select sum((r->>'cogsCents')::bigint) from completed),0),
    'wasteCents',coalesce((select sum((r->>'wasteCents')::bigint) from completed),0),
    'transactionCount',(select count(*) from completed where (r->>'hasCustomer')::boolean),
    'wasteRecordCount',(select count(*) from completed where not (r->>'hasCustomer')::boolean),
    'customerItems',coalesce((select sum((r->>'customerItems')::numeric) from completed),0),
    'voidCount',(select count(*) from t where tx->>'status'='void'),
    'freeCustomerCount',(select count(*) from completed where (r->>'hasCustomer')::boolean and (r->>'totalCents')::bigint=0),
    'cashSalesCents',coalesce((select sum((p->>'amountCents')::bigint) from payments where p->>'method'='Cash'),0),
    'cashInCents',coalesce((select sum((c->>'amountCents')::bigint) from cash where c->>'type'='in'),0),
    'cashOutCents',coalesce((select sum((c->>'amountCents')::bigint) from cash where c->>'type'='out'),0),
    'operatingCashOutCents',coalesce((select sum((c->>'amountCents')::bigint) from cash where c->>'type'='out' and c->>'category'='operating_expense'),0),
    'stockPurchaseCents',coalesce((select sum((c->>'amountCents')::bigint) from cash where c->>'type'='out' and c->>'category'='stock_purchase'),0),
    'ownerWithdrawalCents',coalesce((select sum((c->>'amountCents')::bigint) from cash where c->>'type'='out' and c->>'category'='owner_withdrawal'),0),
    'unclassifiedCents',coalesce((select sum((c->>'amountCents')::bigint) from cash where c->>'type'='out' and coalesce(c->>'category','') not in ('operating_expense','stock_purchase','owner_withdrawal')),0),
    'unclassifiedCount',(select count(*) from cash where c->>'type'='out' and coalesce(c->>'category','') not in ('operating_expense','stock_purchase','owner_withdrawal')),
    'salesReady',not exists(select 1 from t where coalesce(tx->>'status','') <> 'void' and not coalesce((tx->'report'->>'salesReady')::boolean,false)),
    'costReady',not exists(select 1 from completed where not (r->>'costReady')::boolean),
    'issueCount',coalesce((select sum(jsonb_array_length(tx->'report'->'issues')) from t where coalesce(tx->>'status','') <> 'void'),0)
      +(select count(*) from cash where c->>'amountCents' is null or (c->>'amountCents')::bigint <= 0 or coalesce(c->>'type','') not in ('in','out')),
    'cashReady',not exists(select 1 from cash where c->>'amountCents' is null or (c->>'amountCents')::bigint <= 0 or coalesce(c->>'type','') not in ('in','out'))
      and not exists(select 1 from t where coalesce(tx->>'status','') not in ('completed','void'))
      and not exists(select 1 from completed where r->>'totalCents' is null or (r->>'totalCents')::bigint<0)
      and not exists(select 1 from completed cross join lateral jsonb_array_elements(r->'issues') i where i->>'code'='payment_mismatch')
  );
$$;

create or replace function public.report_business_v2(p_start_ms bigint, p_end_exclusive_ms bigint) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (select public.report_period_v2(p_start_ms,p_end_exclusive_ms) as data)
  select data || jsonb_build_object('totals',public.report_totals_v2(data)) from s;
$$;

create or replace function public.report_transactions_v2(p_start_ms bigint, p_end_exclusive_ms bigint, p_search text default '', p_payment text default 'All', p_status text default 'All', p_staff text default 'All', p_offset integer default 0, p_limit integer default 50) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (select public.report_period_v2(p_start_ms,p_end_exclusive_ms) as data),
  filtered as (select tx from s cross join lateral jsonb_array_elements(data->'transactions') tx
    where (p_status='All' or tx->>'status'=p_status) and (p_staff='All' or tx->>'staffId'=p_staff)
      and (p_payment='All' or exists(select 1 from jsonb_array_elements(tx->'report'->'payments') p where p->>'method'=p_payment))
      and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',tx->>'receiptNo',tx->>'staffName',tx->>'paymentMethod',tx->'items'::text)))>0)),
  full_set as (select coalesce(jsonb_agg(tx order by (tx->>'datetime')::bigint desc,(tx->>'id')::bigint desc),'[]') as rows from filtered),
  page as (select tx from filtered order by (tx->>'datetime')::bigint desc,(tx->>'id')::bigint desc offset greatest(p_offset,0) limit case when p_limit=0 then null else least(greatest(p_limit,1),200) end)
  select (s.data-'transactions') || jsonb_build_object('transactions',coalesce((select jsonb_agg(tx) from page),'[]'),
    'matchingCount',(select count(*) from filtered),'totals',public.report_totals_v2(jsonb_set(s.data,'{transactions}',full_set.rows)),
    'paymentBreakdown',coalesce((select jsonb_agg(jsonb_build_object('name',method,'amountCents',amount)) from (
      select p->>'method' as method,sum((p->>'amountCents')::bigint) as amount from filtered
      cross join lateral jsonb_array_elements(tx->'report'->'payments') p where tx->>'status'='completed' group by p->>'method') grouped),'[]'),
    'selectedPaymentCents',coalesce((select sum((p->>'amountCents')::bigint) from filtered cross join lateral jsonb_array_elements(tx->'report'->'payments') p where tx->>'status'='completed' and (p_payment='All' or p->>'method'=p_payment)),0)) from s cross join full_set;
$$;

create or replace function public.report_cash_v2(p_start_ms bigint, p_end_exclusive_ms bigint, p_search text default '', p_review_only boolean default false) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with s as (select public.report_period_v2(p_start_ms,p_end_exclusive_ms) as data)
  select data || jsonb_build_object('totals',public.report_totals_v2(data), 'matchingEntries',coalesce((select jsonb_agg(c)
    from jsonb_array_elements(data->'cashEntries') c where
      (not p_review_only or (c->>'type'='out' and coalesce(c->>'category','') not in ('operating_expense','stock_purchase','owner_withdrawal')))
      and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',c->>'notes',c->>'staffName',replace(c->>'category','_',' '),case when c->>'type'='in' then 'cash in' else 'cash out' end,c->>'amount')))>0)),'[]')) from s;
$$;

create or replace function public.report_owner_v2(p_owner_pin text) returns bigint
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare owner_id bigint;
begin
  select id into owner_id from public.staff where pin=p_owner_pin and role='owner' order by id limit 1;
  if owner_id is null then raise exception 'A valid owner PIN is required.' using errcode='42501'; end if;
  perform set_config('app.reporting_owner',owner_id::text,true);
  return owner_id;
end $$;

create or replace function public.report_review_item_v2(p_transaction_id bigint,p_item_index integer,p_source_hash text,p_data jsonb,p_reason text,p_owner_pin text) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare owner_id bigint; tx jsonb; original jsonb; old_review jsonb; saved jsonb;
begin
  owner_id := public.report_owner_v2(p_owner_pin);
  if length(trim(p_reason))<5 then raise exception 'Enter a reason of at least 5 characters.'; end if;
  select to_jsonb(t) into tx from public.transactions t where id=p_transaction_id for update;
  if tx is null or p_item_index < -1 then raise exception 'Receipt not found.'; end if;
  original := case when p_item_index=-1 then tx else tx->'items'->p_item_index end;
  if original is null or md5(original::text)<>p_source_hash then raise exception 'Receipt changed. Refresh before reviewing.'; end if;
  if p_data->>'reportingType' is not null and p_data->>'reportingType' not in ('sale','packaging','waste') then raise exception 'Invalid reporting type.'; end if;
  if p_data ? 'unitCost' and (public.report_number_v2(p_data->>'unitCost') is null or public.report_number_v2(p_data->>'unitCost')<0) then raise exception 'Invalid cost.'; end if;
  if p_data ? 'paymentLines' and (p_item_index<>-1 or jsonb_typeof(p_data->'paymentLines')<>'array') then raise exception 'Invalid payment review.'; end if;
  select to_jsonb(r) into old_review from public.reporting_reviews r where transaction_id=p_transaction_id and item_index=p_item_index;
  insert into public.reporting_reviews(transaction_id,item_index,source_hash,data,reason,reviewer_id) values(p_transaction_id,p_item_index,p_source_hash,p_data,trim(p_reason),owner_id)
    on conflict(transaction_id,item_index) do update set source_hash=excluded.source_hash,data=excluded.data,reason=excluded.reason,reviewer_id=excluded.reviewer_id,reviewed_at=now();
  select to_jsonb(r) into saved from public.reporting_reviews r where transaction_id=p_transaction_id and item_index=p_item_index;
  insert into public.reporting_review_history(entity,entity_id,previous_data,reviewed_data,reason,reviewer_id)
    values('receipt_item',p_transaction_id::text||':'||p_item_index,old_review,saved,trim(p_reason),owner_id);
  return saved;
end $$;

create or replace function public.report_review_product_v2(p_product_id bigint,p_reporting_type text,p_confirm_zero boolean,p_reason text,p_owner_pin text) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare owner_id bigint; old_product jsonb; saved jsonb;
begin
  owner_id := public.report_owner_v2(p_owner_pin);
  if p_reporting_type not in ('sale','packaging','waste') or length(trim(p_reason))<5 then raise exception 'Choose a reporting type and enter a review reason.'; end if;
  select to_jsonb(p) into old_product from public.products p where id=p_product_id for update;
  if old_product is null then raise exception 'Product not found.'; end if;
  update public.products set "reportingType"=p_reporting_type,"costZeroConfirmed"=p_confirm_zero where id=p_product_id;
  select to_jsonb(p) into saved from public.products p where id=p_product_id;
  insert into public.reporting_review_history(entity,entity_id,previous_data,reviewed_data,reason,reviewer_id)
    values('product_reporting',p_product_id::text,old_product,saved,trim(p_reason),owner_id);
  return saved;
end $$;

-- Grants preserve the same caller privileges and RLS as the underlying tables.
create or replace function public.report_review_cash_v2(p_id bigint,p_category text,p_reason text,p_owner_pin text) returns jsonb
language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare owner_id bigint; original jsonb; saved jsonb;
begin
  owner_id := public.report_owner_v2(p_owner_pin);
  if (p_category is not null and p_category not in ('operating_expense','stock_purchase','owner_withdrawal')) or length(trim(p_reason))<5 then raise exception 'Choose a valid category and enter a review reason.'; end if;
  select to_jsonb(c) into original from public.cash_drawer c where id=p_id and type='out' for update;
  if original is null then raise exception 'Cash-out not found.'; end if;
  update public.cash_drawer set category=p_category where id=p_id and type='out';
  select to_jsonb(c) into saved from public.cash_drawer c where id=p_id;
  insert into public.reporting_review_history(entity,entity_id,previous_data,reviewed_data,reason,reviewer_id)
    values('cash_out_category',p_id::text,original,saved,trim(p_reason),owner_id);
  return saved;
end $$;
grant execute on function public.report_review_cash_v2(bigint,text,text,text) to anon,authenticated;
grant execute on function public.report_business_v2(bigint,bigint), public.report_transactions_v2(bigint,bigint,text,text,text,text,integer,integer), public.report_cash_v2(bigint,bigint,text,boolean),
  public.report_review_item_v2(bigint,integer,text,jsonb,text,text), public.report_review_product_v2(bigint,text,boolean,text,text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
