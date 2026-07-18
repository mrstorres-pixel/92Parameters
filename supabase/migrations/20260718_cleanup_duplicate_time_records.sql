-- Consolidate old duplicate attendance rows so payroll counts only one shift per employee per day.
-- For each duplicated staff/date group, this keeps the lowest id, preserves the earliest Time In,
-- uses the latest completed Time Out, recalculates labor cost, then deletes the extra rows.

with duplicate_groups as (
  select
    "staffId",
    "date"
  from public.time_records
  group by "staffId", "date"
  having count(*) > 1
),
ranked_records as (
  select
    tr.*,
    row_number() over (
      partition by tr."staffId", tr."date"
      order by tr.id
    ) as keep_rank,
    first_value(tr."timeIn") over (
      partition by tr."staffId", tr."date"
      order by tr."timeIn" asc nulls last, tr.id asc
    ) as kept_time_in,
    first_value(tr."photoIn") over (
      partition by tr."staffId", tr."date"
      order by tr."timeIn" asc nulls last, tr.id asc
    ) as kept_photo_in,
    first_value(tr."timeOut") over (
      partition by tr."staffId", tr."date"
      order by tr."timeOut" desc nulls last, tr.id desc
    ) as kept_time_out,
    first_value(tr."photoOut") over (
      partition by tr."staffId", tr."date"
      order by tr."timeOut" desc nulls last, tr.id desc
    ) as kept_photo_out
  from public.time_records tr
  join duplicate_groups dg
    on dg."staffId" = tr."staffId"
   and dg."date" = tr."date"
),
kept_records as (
  update public.time_records tr
  set
    "timeIn" = rr.kept_time_in,
    "photoIn" = rr.kept_photo_in,
    "timeOut" = rr.kept_time_out,
    "photoOut" = case when rr.kept_time_out is null then null else rr.kept_photo_out end,
    "salaryEarned" = case
      when rr.kept_time_in is not null and rr.kept_time_out is not null then
        greatest(0, (rr.kept_time_out - rr.kept_time_in) / 3600000.0) * coalesce(s."hourlyRate", 0)
      else 0
    end
  from ranked_records rr
  left join public.staff s on s.id = rr."staffId"
  where tr.id = rr.id
    and rr.keep_rank = 1
  returning tr.id
)
delete from public.time_records tr
using ranked_records rr
where tr.id = rr.id
  and rr.keep_rank > 1;
