create index if not exists idx_time_records_staff_date
  on public.time_records ("staffId", "date");

create or replace function public.prevent_duplicate_time_record_day()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new."staffId"::text || ':' || new."date"::text));

  if exists (
    select 1
    from public.time_records
    where "staffId" = new."staffId"
      and "date" = new."date"
      and id <> coalesce(new.id, -1)
  ) then
    raise exception 'A time record already exists for this staff member on this date.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_time_record_day on public.time_records;

create trigger trg_prevent_duplicate_time_record_day
  before insert or update of "staffId", "date"
  on public.time_records
  for each row
  execute function public.prevent_duplicate_time_record_day();
