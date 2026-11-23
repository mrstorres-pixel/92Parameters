-- READ ONLY: run after the reports-v2 migration. Adjust these two business dates
-- to audit another period. The end business date is inclusive.
with dates as (
  select date '2026-11-17' as first_day, date '2026-11-23' as last_day
), snapshot as (
  select public.report_business_v2(
    (extract(epoch from (first_day::timestamp at time zone 'Asia/Manila'))*1000)::bigint,
    (extract(epoch from ((last_day+1)::timestamp at time zone 'Asia/Manila'))*1000)::bigint
  ) as data from dates
), receipts as (
  select tx from snapshot cross join lateral jsonb_array_elements(data->'transactions') tx
  where tx->>'status'='completed'
), allocations as (
  select coalesce(sum((line->>'salesCents')::bigint),0) as cents from receipts
  cross join lateral jsonb_array_elements(tx->'report'->'lines') line
), payments as (
  select coalesce(sum((payment->>'amountCents')::bigint),0) as cents from receipts
  cross join lateral jsonb_array_elements(tx->'report'->'payments') payment
), issues as (
  select issue->>'code' as code,count(*) as count from receipts
  cross join lateral jsonb_array_elements(tx->'report'->'issues') issue group by issue->>'code'
), original_cost as (
  select coalesce(sum(round(public.report_number_v2(item->>'cost') * public.report_number_v2(item->>'quantity') * 100)),0) as cents
  from receipts cross join lateral jsonb_array_elements(case when jsonb_typeof(tx->'items')='array' then tx->'items' else '[]' end) item
)
select jsonb_pretty(jsonb_build_object(
  'generatedAt',data->'generatedAt','timezone',data->'timezone',
  'firstBusinessDate',(select first_day from dates),'lastBusinessDate',(select last_day from dates),
  'totalsInCents',data->'totals',
  'originalAllItemCostCents',(select cents from original_cost),
  'categoryAllocationCents',(select cents from allocations),
  'unallocatedReceiptCents',coalesce((select sum((tx->'report'->>'unallocatedCents')::bigint) from receipts),0),
  'recordedPaymentCents',(select cents from payments),
  'costPlusWastePreservesOriginalCost',
    (data->'totals'->>'cogsCents')::bigint+(data->'totals'->>'wasteCents')::bigint=(select cents from original_cost),
  'receiptIssueCounts',coalesce((select jsonb_object_agg(code,count) from issues),'{}')
)) as audit from snapshot;
