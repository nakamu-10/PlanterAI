-- ============================================================
-- processed_webhook_events: LINE Webhookイベントの重複排除
--
-- LINEはWebhookの応答が遅れると同じイベントを再送することがある。
-- 処理済みの webhookEventId をここに記録し、event_id を主キーにすることで
-- 後続マイグレーションで処理状態と再試行用のリースを追加する。
--
-- 注: 本番DBには手動作成済みのため if not exists で冪等にしてある。
-- ============================================================
create table if not exists processed_webhook_events (
  event_id   text primary key,               -- LINEの webhookEventId
  created_at timestamptz not null default now()
);

-- Edge Functions は service_role でアクセスするためRLSの影響を受けない。
-- 他テーブルと同様、anonキーによる直接アクセスを塞ぐため全拒否にする。
alter table processed_webhook_events enable row level security;
