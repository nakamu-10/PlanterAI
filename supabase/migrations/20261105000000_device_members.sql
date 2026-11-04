-- ============================================================
-- device_members: ログインしたユーザーと鉢（devices）の紐付け
--
-- 鉢が2〜3個になると、/app/ は「誰がどの鉢を見てよいか」を確かめる必要がある。
-- 11/20 のあと、Supabase Auth でログインさせ、このテーブルに組があるときだけ
-- 鉢のデータを返す（docs/adr/0003-app-auth.md）。
--
-- 1人が複数の鉢を持ち、1つの鉢を家族など複数人で見られるよう、多対多にする。
-- ESP32 の認証（devices.device_key）と LINE の紐付け（devices.line_user_id）は
-- このテーブルとは別のまま変えない。
-- ============================================================
create table if not exists device_members (
  device_id  uuid not null references devices(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, user_id)
);

-- /app/ は「ログインしたユーザーの鉢の一覧」を引くので、user_id からも引けるようにする
create index if not exists idx_device_members_user on device_members (user_id);

-- 他のテーブルと同じく、Edge Functions（service_role）からだけ読み書きする。
-- ポリシーを作らない＝anon・authenticated は全拒否。
alter table device_members enable row level security;

-- Supabase は、新しいテーブルを Data API のロールへ自動では公開しない設定に
-- 移っている（config.toml の auto_expose_new_tables）。本番がどちらの設定でも
-- Edge Functions が読めるよう、service_role への権限は明示する。
grant select, insert, update, delete on table device_members to service_role;
