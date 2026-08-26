-- ============================================================
-- PlanterAI 初期スキーマ
-- 実行方法: supabase db push（README参照）
-- ============================================================

-- ------------------------------------------------------------
-- devices: デバイスとLINEユーザーの紐付け
-- ESP32は device_key をヘッダーに付けて送信し、認証を兼ねる
-- ------------------------------------------------------------
create table devices (
  id            uuid primary key default gen_random_uuid(),
  device_key    text unique not null,            -- ESP32側に書き込む秘密キー（長いランダム文字列にする）
  plant_name    text not null default 'ポトス',   -- 植物の名前（キャラクターの名前を兼ねる）
  plant_profile text not null default 'pothos',  -- 快適レンジ設定のキー（_shared/config.ts参照）
  character_id  text not null default 'amaenbo', -- 性格テンプレートのキー（_shared/llm.ts参照）
  line_user_id  text not null,                   -- LINE公式アカウントを友だち追加したユーザーのID
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- sensor_logs: センサーログ（生値 + フィルタ後 + 正規化スコア）
-- ESP32からのPOSTごとに1行追加される
-- ------------------------------------------------------------
create table sensor_logs (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references devices(id),
  raw        jsonb not null,  -- 例: {"soil_adc": 2400, "temp": 26.5, "humidity": 55, "pressure": 1012, "lux": 800}
  filtered   jsonb not null,  -- 中央値フィルタ適用後の値
  scores     jsonb not null,  -- 例: {"moisture": 45, "temp": 90, "light": 70} （0〜100の快適スコア）
  created_at timestamptz not null default now()
);
create index idx_sensor_logs_device_time on sensor_logs (device_id, created_at desc);

-- ------------------------------------------------------------
-- emotion_logs: 感情状態ログ（Layer 2の出力）
-- 「状態遷移の検出」はこのテーブルの直前行と比較して行う
-- ------------------------------------------------------------
create table emotion_logs (
  id             bigint generated always as identity primary key,
  device_id      uuid not null references devices(id),
  emotion        text not null,   -- 満足 / 軽い不満 / 不満 / 不安 / 苛立ち
  complaint      text,            -- 主訴（満足のときは null）
  urgency        text not null,   -- none / low / medium / high
  duration_hours numeric not null default 0,  -- 同じ主訴が続いている時間
  scores         jsonb not null,  -- 判定に使ったスコア（デバッグ用）
  notified       boolean not null default false,  -- この行でLINE通知を送ったか
  created_at     timestamptz not null default now()
);
create index idx_emotion_logs_device_time on emotion_logs (device_id, created_at desc);

-- ------------------------------------------------------------
-- conversation_logs: 会話履歴（直近スライディングウィンドウ用）
-- role='plant' は植物のセリフ。将来ユーザー返信を実装したら role='user' を追加
-- ------------------------------------------------------------
create table conversation_logs (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references devices(id),
  role       text not null check (role in ('plant', 'user')),
  message    text not null,
  emotion    text,   -- そのセリフを生成したときの感情（role='plant'のみ）
  complaint  text,
  created_at timestamptz not null default now()
);
create index idx_conversation_logs_device_time on conversation_logs (device_id, created_at desc);

-- ------------------------------------------------------------
-- relationship_summaries: 週次の関係性サマリー
-- 古い会話履歴をLLMで圧縮したもの。プロンプトには最新1件だけを使う
-- ------------------------------------------------------------
create table relationship_summaries (
  id           bigint generated always as identity primary key,
  device_id    uuid not null references devices(id),
  summary      text not null,   -- 例: 「最近ユーザーは水やりを忘れがちで、植物は少し拗ねている」
  period_start timestamptz not null,
  period_end   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index idx_summaries_device_time on relationship_summaries (device_id, created_at desc);

-- ------------------------------------------------------------
-- RLS（Row Level Security）
-- Edge Functionsは service_role キーでアクセスするためRLSの影響を受けない。
-- 外部からanonキーで直接読み書きされないよう、全テーブルでRLSを有効化する
-- （ポリシーを作らない＝全拒否）
-- ------------------------------------------------------------
alter table devices enable row level security;
alter table sensor_logs enable row level security;
alter table emotion_logs enable row level security;
alter table conversation_logs enable row level security;
alter table relationship_summaries enable row level security;

-- ------------------------------------------------------------
-- 動作確認用のテストデバイス登録（line_user_id は自分のものに書き換えること）
-- ------------------------------------------------------------
-- insert into devices (device_key, plant_name, line_user_id)
-- values ('dev-test-key-CHANGE-ME', 'ポト助', 'U0000000000000000000000000000000');
