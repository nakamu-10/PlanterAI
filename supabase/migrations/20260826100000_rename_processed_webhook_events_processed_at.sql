-- ============================================================
-- processed_webhook_events の時刻の列名を created_at に揃える
--
-- 本番の processed_webhook_events は 20260826000000 より前に手で作られており、
-- 時刻の列が created_at ではなく processed_at になっていた。20260826000000 は
-- create table if not exists なので本番では何もせず、created_at を前提にする
-- 20260827000000（インデックス）と weekly-summary（古い記録の削除）が失敗する。
--
-- 新しいDBでは 20260826000000 が created_at で作るので、このマイグレーションは
-- 何もしない。
-- ============================================================

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'processed_webhook_events'
      and column_name = 'processed_at'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'processed_webhook_events'
      and column_name = 'created_at'
  ) then
    alter table processed_webhook_events
      rename column processed_at to created_at;
  end if;
end
$$;
