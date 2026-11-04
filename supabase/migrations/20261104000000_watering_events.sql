-- ------------------------------------------------------------
-- 水やりの記録。土の水分が急に上がったときに ingest-sensor が1行入れる。
--
-- 使い道:
--   - アプリで、水やりにすぐ喜ぶ（満足に戻るのを待たない）
--   - LINE のお礼で「水をもらった」と分かるようにする
--   - 会話で、前の水やりを覚えておく
--
-- moisture_before : 直前の数点の土の水分%（中央値）
-- moisture_after  : 水やりを検出した点の土の水分%
-- ------------------------------------------------------------
create table if not exists watering_events (
  id              bigint generated always as identity primary key,
  device_id       uuid not null references devices(id) on delete cascade,
  moisture_before real not null,
  moisture_after  real not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_watering_events_device_created
  on watering_events (device_id, created_at desc);

-- Edge Functions（service_role）からだけ読み書きする
alter table watering_events enable row level security;
