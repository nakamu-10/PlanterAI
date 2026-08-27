-- 同じデバイス・同じ日・同じ判定枠からの二重通知を防ぐ。

create table if not exists daily_light_notification_slots (
  device_id   uuid not null references devices(id) on delete cascade,
  local_date  date not null,
  slot        text not null check (slot in ('checkpoint', 'deadline')),
  status      text not null check (status in ('processing', 'completed', 'failed')),
  last_error  text,
  updated_at  timestamptz not null default now(),
  primary key (device_id, local_date, slot)
);

alter table daily_light_notification_slots enable row level security;

create or replace function public.claim_daily_light_notification(
  p_device_id uuid,
  p_local_date date,
  p_slot text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  if p_slot not in ('checkpoint', 'deadline') then
    return false;
  end if;

  insert into public.daily_light_notification_slots (
    device_id,
    local_date,
    slot,
    status,
    last_error,
    updated_at
  )
  values (p_device_id, p_local_date, p_slot, 'processing', null, now())
  on conflict (device_id, local_date, slot) do update
    set status = 'processing',
        last_error = null,
        updated_at = now()
    where public.daily_light_notification_slots.status = 'failed'
       or (
         public.daily_light_notification_slots.status = 'processing'
         and public.daily_light_notification_slots.updated_at < now() - interval '2 minutes'
       )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_daily_light_notification(uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.claim_daily_light_notification(uuid, date, text)
  to service_role;
