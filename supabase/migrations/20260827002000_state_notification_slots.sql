-- センサーPOSTが同時に届いても、同じ状態遷移を二重に通知しない。

create table if not exists state_notification_slots (
  device_id   uuid primary key references devices(id) on delete cascade,
  signature   text not null,
  status      text not null check (status in ('processing', 'completed', 'failed')),
  last_error  text,
  updated_at  timestamptz not null default now()
);

alter table state_notification_slots enable row level security;

create or replace function public.claim_state_notification(
  p_device_id uuid,
  p_signature text,
  p_urgency text,
  p_cooldown_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  if p_signature is null or length(p_signature) = 0 or length(p_signature) > 200 then
    return false;
  end if;

  insert into public.state_notification_slots (
    device_id,
    signature,
    status,
    last_error,
    updated_at
  )
  values (p_device_id, p_signature, 'processing', null, now())
  on conflict (device_id) do update
    set signature = excluded.signature,
        status = 'processing',
        last_error = null,
        updated_at = now()
    where public.state_notification_slots.status = 'failed'
       or (
         public.state_notification_slots.status = 'processing'
         and public.state_notification_slots.updated_at < now() - interval '2 minutes'
       )
       or (
         public.state_notification_slots.status = 'completed'
         and public.state_notification_slots.signature <> excluded.signature
         and (
           p_urgency = 'high'
           or public.state_notification_slots.updated_at
             < now() - greatest(p_cooldown_minutes, 0) * interval '1 minute'
         )
       )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_state_notification(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_state_notification(uuid, text, text, integer)
  to service_role;
