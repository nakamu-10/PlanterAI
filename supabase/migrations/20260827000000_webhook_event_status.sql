-- LINE Webhookを「受信した」時点ではなく「処理を完了した」時点まで追跡する。
-- 一時障害時は failed に戻し、LINEからの再送で安全に再実行できるようにする。

alter table processed_webhook_events
  add column if not exists status text,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

update processed_webhook_events
set status = 'completed'
where status is null;

alter table processed_webhook_events
  alter column status set default 'completed',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'processed_webhook_events_status_check'
  ) then
    alter table processed_webhook_events
      add constraint processed_webhook_events_status_check
      check (status in ('processing', 'completed', 'failed'));
  end if;
end
$$;

create index if not exists idx_processed_webhook_events_created_at
  on processed_webhook_events (created_at);

create or replace function public.claim_webhook_event(p_event_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  if p_event_id is null or length(p_event_id) = 0 then
    return false;
  end if;

  insert into public.processed_webhook_events (
    event_id,
    status,
    last_error,
    updated_at
  )
  values (p_event_id, 'processing', null, now())
  on conflict (event_id) do update
    set status = 'processing',
        last_error = null,
        updated_at = now()
    where public.processed_webhook_events.status = 'failed'
       or (
         public.processed_webhook_events.status = 'processing'
         and public.processed_webhook_events.updated_at < now() - interval '2 minutes'
       )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_webhook_event(text) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(text) to service_role;
