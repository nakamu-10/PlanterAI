-- ------------------------------------------------------------
-- アプリでカラ美に触った記録。app-data（鍵があるときだけ）が1回ごとに1行入れる。
--
-- 使い道:
--   - 会話の返事で、さっき触られたことに触れる（「さっきつついたでしょ」）
--
-- kind : poke（つつく）/ pet（なでる）/ lift（持ち上げる）
-- ------------------------------------------------------------
create table if not exists touch_logs (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references devices(id) on delete cascade,
  kind       text not null check (kind in ('poke', 'pet', 'lift')),
  created_at timestamptz not null default now()
);

create index if not exists idx_touch_logs_device_created
  on touch_logs (device_id, created_at desc);

-- Edge Functions（service_role）からだけ読み書きする
alter table touch_logs enable row level security;
