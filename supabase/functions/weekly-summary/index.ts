// ============================================================
// weekly-summary — 週次の関係性サマリー生成バッチ
//
// 全デバイスについて、直近1週間の会話ログをGemini Flashで
// 2〜3文のサマリーに圧縮し、relationship_summaries に保存する。
//
// 起動方法: pg_cron でのスケジュール実行（README参照）、
//           または手動で curl 実行してもよい。
// 認証: x-cron-key ヘッダーが CRON_SECRET と一致した場合のみ実行
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildSummaryPrompt,
  ConversationEntry,
  generateMessage,
} from "../_shared/llm.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "POSTメソッドのみ対応しています" }, 405);
    }

    // 外部から勝手に叩かれないよう簡易認証
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "認証エラー" }, 401);
    }

    const { data: devices, error } = await supabase.from("devices").select("*");
    if (error) throw error;

    const results: Record<string, string> = {};
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString();

    for (const device of devices ?? []) {
      try {
        // 直近1週間の会話ログを古い順で取得
        const { data: convo, error: convoError } = await supabase
          .from("conversation_logs")
          .select("role, message, created_at")
          .eq("device_id", device.id)
          .gte("created_at", oneWeekAgo)
          .order("created_at", { ascending: false })
          .limit(200);
        if (convoError) throw convoError;

        // 前回のサマリー（積み重ねて更新していく）
        const { data: prev, error: prevError } = await supabase
          .from("relationship_summaries")
          .select("summary")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false })
          .limit(1);
        if (prevError) throw prevError;

        // 会話も前回サマリーもない場合はスキップ（生成する意味がない）
        if ((convo ?? []).length === 0 && !prev?.[0]) {
          results[device.plant_name] = "スキップ（会話なし）";
          continue;
        }

        const prompt = buildSummaryPrompt(
          device.plant_name,
          ([...(convo ?? [])].reverse()) as ConversationEntry[],
          prev?.[0]?.summary ?? null,
        );
        const summary = await generateMessage(prompt);

        const { error: insertError } = await supabase.from(
          "relationship_summaries",
        ).insert({
          device_id: device.id,
          summary,
          period_start: oneWeekAgo,
          period_end: new Date().toISOString(),
        });
        if (insertError) throw insertError;
        results[device.plant_name] = summary;
      } catch (err) {
        // 1台失敗しても他のデバイスの処理は続ける
        console.error(`[${device.id}] サマリー生成エラー:`, err);
        results[device.plant_name] = `エラー: ${err}`;
      }
    }

    // 重複排除・通知枠の管理行は長期保存する必要がない。
    const retentionBoundary = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [webhookCleanup, lightCleanup, stateCleanup] = await Promise.all([
      supabase
        .from("processed_webhook_events")
        .delete()
        .lt("created_at", retentionBoundary),
      supabase
        .from("daily_light_notification_slots")
        .delete()
        .lt("updated_at", retentionBoundary),
      supabase
        .from("state_notification_slots")
        .delete()
        .lt("updated_at", retentionBoundary),
    ]);
    if (webhookCleanup.error) {
      console.error("Webhook重複排除ログの削除に失敗:", webhookCleanup.error);
    }
    if (lightCleanup.error) {
      console.error("日照通知枠ログの削除に失敗:", lightCleanup.error);
    }
    if (stateCleanup.error) {
      console.error("状態通知枠ログの削除に失敗:", stateCleanup.error);
    }

    return json({ ok: true, results });
  } catch (err) {
    console.error("weekly-summary 予期しないエラー:", err);
    return json({ error: "週次サマリーの生成に失敗しました" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
