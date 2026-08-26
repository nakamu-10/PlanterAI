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
import { buildSummaryPrompt, ConversationEntry, generateMessage } from "../_shared/llm.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  try {
    // 外部から勝手に叩かれないよう簡易認証
    const cronKey = req.headers.get("x-cron-key");
    if (cronKey !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "認証エラー" }, 401);
    }

    const { data: devices, error } = await supabase.from("devices").select("*");
    if (error) throw error;

    const results: Record<string, string> = {};
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const device of devices ?? []) {
      try {
        // 直近1週間の会話ログを古い順で取得
        const { data: convo } = await supabase
          .from("conversation_logs")
          .select("role, message, created_at")
          .eq("device_id", device.id)
          .gte("created_at", oneWeekAgo)
          .order("created_at", { ascending: true });

        // 前回のサマリー（積み重ねて更新していく）
        const { data: prev } = await supabase
          .from("relationship_summaries")
          .select("summary")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false })
          .limit(1);

        // 会話も前回サマリーもない場合はスキップ（生成する意味がない）
        if ((convo ?? []).length === 0 && !prev?.[0]) {
          results[device.plant_name] = "スキップ（会話なし）";
          continue;
        }

        const prompt = buildSummaryPrompt(
          device.plant_name,
          (convo ?? []) as ConversationEntry[],
          prev?.[0]?.summary ?? null,
        );
        const summary = await generateMessage(prompt);

        await supabase.from("relationship_summaries").insert({
          device_id: device.id,
          summary,
          period_start: oneWeekAgo,
          period_end: new Date().toISOString(),
        });
        results[device.plant_name] = summary;
      } catch (err) {
        // 1台失敗しても他のデバイスの処理は続ける
        console.error(`[${device.id}] サマリー生成エラー:`, err);
        results[device.plant_name] = `エラー: ${err}`;
      }
    }

    return json({ ok: true, results });
  } catch (err) {
    console.error("weekly-summary 予期しないエラー:", err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
