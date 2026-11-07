-- カラ美の日記。daily-diary が毎晩、鉢ごとに1日1行入れる（ADR 0009）。
--
-- day     : 日本時間の日付。同じ鉢の同じ日は1行だけ
-- picture : その日の記録からルールで選んだ絵（_shared/diary.ts の DIARY_PICTURES）
-- body    : 日記の文（1〜2文）。材料は記録の数字だけで、会話の中身は使わない
-- stats   : 絵と文の材料（気分の割合・水やりの回数・日照・話しかけられた回数など）
-- source  : 'llm' = Gemini が書いた / 'fallback' = 定型文
create table if not exists diary_entries (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references devices(id) on delete cascade,
  day        date not null,
  picture    text not null,
  body       text not null,
  stats      jsonb not null,
  source     text not null check (source in ('llm', 'fallback')),
  created_at timestamptz not null default now(),
  unique (device_id, day)
);

-- Edge Functions（service_role）からだけ読み書きする
alter table diary_entries enable row level security;
