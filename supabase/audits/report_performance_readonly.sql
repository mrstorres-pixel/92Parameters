-- Run and save output BEFORE and AFTER the performance migration, while no
-- records are changing. Adjust both dates together; the end date is inclusive.
begin isolation level repeatable read read only;
set local statement_timeout='60s';
with dates as (select date '2026-10-25' first_day,date '2026-11-23' last_day),
period as (select (extract(epoch from first_day::timestamp at time zone 'Asia/Manila')*1000)::bigint lo,
  (extract(epoch from (last_day+1)::timestamp at time zone 'Asia/Manila')*1000)::bigint hi from dates),
snapshot as materialized(select public.report_business_v2(lo,hi) data from period)
select jsonb_pretty(jsonb_build_object('totalsInCents',data->'totals',
 'receiptCount',jsonb_array_length(data->'transactions'),
 'period',jsonb_build_array((select first_day from dates),(select last_day from dates)),
 'originalReceiptTotalCents',(select coalesce(sum(round(t.total*100)),0) from public.transactions t,period where t.datetime>=lo and t.datetime<hi and t.status='completed'),
 'generationTime',data->'generatedAt')) as audit from snapshot;
explain (analyze,buffers,timing off)
select public.report_business_v2(
 (extract(epoch from timestamp '2026-10-25' at time zone 'Asia/Manila')*1000)::bigint,
 (extract(epoch from timestamp '2026-11-24' at time zone 'Asia/Manila')*1000)::bigint);
rollback;

-- Activation checks. Run AFTER the core/cutover migrations, using SQL Editor.
-- select count(*) filter(where pin is not null) plaintext_pins,
--        count(*) filter(where pin_hash is null) missing_hashes from public.staff;
-- select id,public,file_size_limit from storage.buckets where id='payment-proofs';
-- select has_table_privilege('anon','public.transactions','SELECT') anonymous_receipt_access,
--        has_table_privilege('anon','public.staff','SELECT') anonymous_staff_access,
--        has_table_privilege('anon','public.kitchen_tickets','SELECT') anonymous_kitchen_access;
-- Expected: 0 plaintext/missing hashes; private bucket; all three access values false.
