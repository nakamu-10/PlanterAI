-- ------------------------------------------------------------
-- conversation_logs に「そのセリフをどう作ったか」を記録する列を追加する。
--
-- 背景:
--   thinkingLevel に無効値 "none" を送っていたため interactive 経由の
--   Gemini 呼び出しが常に HTTP 400 で失敗し、全通がテンプレ（fallback）に
--   落ちていた。しかしテンプレは「それらしい文」を送るので LINE 上は
--   正常に見え、Edge Function のログは無料プランだと1日で消えるため、
--   100%失敗している事実に外から気づけなかった。
--
--   そこで生成経路の結果を DB 側に残し、
--     select source, finish_reason, count(*)
--       from conversation_logs
--      where created_at > now() - interval '1 day'
--      group by 1, 2;
--   のように「フォールバック率」を後から数えられるようにする。
--
-- source        : 'llm' = LLM生成 / 'fallback' = 定型文 / 'user' = 飼い主の発言
-- finish_reason : 成功時は 'STOP'。失敗時は HTTP_400 / MAX_TOKENS / SAFETY /
--                 EMPTY など、フォールバックに落ちた理由。
-- 既存行は NULL（＝記録開始前）のままにする。
-- ------------------------------------------------------------
alter table conversation_logs
  add column if not exists source text
    check (source in ('llm', 'fallback', 'user')),
  add column if not exists finish_reason text;

-- フォールバック率の集計を軽くする（source が入っている行だけ見れば足りる）
create index if not exists idx_conversation_logs_source
  on conversation_logs (device_id, source, created_at desc)
  where source is not null;
