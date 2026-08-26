import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildReplyPrompt, ConversationEntry, generateMessage } from "../_shared/llm.ts";
import { fallbackMessage } from "../_shared/fallback.ts";
import { replyLineMessage } from "../_shared/line.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function computeSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

async function markEventProcessed(eventId: string): Promise<boolean> {
  const { error } = await supabase
    .from("processed_webhook_events")
    .insert({ event_id: eventId });
  if (error) {
    if (error.code === "23505") return false; // 重複 → 既に処理済み
    throw error;
  }
  return true;
}

Deno.serve(async (req: Request) => {
  const body = await req.text();
  const signature = req.headers.get("x-line-signature");
  const secret = Deno.env.get("LINE_CHANNEL_SECRET")!;

  const computed = await computeSignature(body, secret);
  if (computed !== signature) {
    console.error("署名検証失敗");
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(body);

  for (const event of payload.events ?? []) {
    const isNew = await markEventProcessed(event.webhookEventId);
    if (!isNew) {
      console.log("重複イベント、スキップ:", event.webhookEventId);
      continue;
    }

    // テキストメッセージ以外(スタンプ、画像など)は今回スキップ
    if (event.type !== "message" || event.message?.type !== "text") {
      console.log("非対応のイベント種別、スキップ:", event.type);
      continue;
    }

    const lineUserId = event.source?.userId;
    const userText = event.message.text;

    // どの植物宛かを特定
    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, plant_name, character_id")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (deviceError) {
      console.error("デバイス検索エラー:", deviceError);
      continue;
    }
    if (!device) {
      console.warn("該当デバイスなし、LINEユーザー:", lineUserId);
      continue;
    }

    // ユーザーの発言を会話履歴に保存
    const { error: insertError } = await supabase.from("conversation_logs").insert({
      device_id: device.id,
      role: "user",
      message: userText,
    });
    if (insertError) {
      console.error("会話ログ保存エラー:", insertError);
      continue;
    }

    console.log(`[${device.plant_name}] ユーザー発言を保存:`, userText);

    // ここから先(Gemini生成・返信送信)はステップ5
    // ここから: ステップ5（返信生成・送信）

    // 1. 最新の感情状態を取得
    const { data: latestEmotion } = await supabase
      .from("emotion_logs")
      .select("emotion, complaint, urgency, duration_hours")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. 直近の会話履歴を取得(新しい順で7件)
    const { data: recentConvo } = await supabase
      .from("conversation_logs")
      .select("role, message, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(7);

    // 3. 関係性サマリー(最新1件)を取得
    const { data: summaryRow } = await supabase
      .from("relationship_summaries")
      .select("summary")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

// 4. 返信プロンプトを組み立てる
    const replyPrompt = buildReplyPrompt({
      plantName: device.plant_name,
      characterId: device.character_id,
      state: {
        emotion: latestEmotion?.emotion ?? "満足",
        complaint: latestEmotion?.complaint ?? null,
        urgency: latestEmotion?.urgency ?? "none",
        duration_hours: latestEmotion?.duration_hours ?? 0,
        duration_label: latestEmotion?.duration_hours
          ? `${Math.round(latestEmotion.duration_hours / 24)}日`
          : "",
      },
      recentConversation: (recentConvo ?? []) as ConversationEntry[],
      relationshipSummary: summaryRow?.summary ?? null,
      userMessage: userText,
    });

    // 返信経路は Webhook 応答窓があるので interactive（思考オフで最速・打ち切りに強い）。
    // それでも失敗したら黙って落とさず、テンプレを返して会話を途切れさせない。
    let replyText: string;
    try {
      replyText = await generateMessage(replyPrompt, "interactive");
    } catch (err) {
      console.error("Gemini生成エラー、テンプレにフォールバック:", err);
      replyText = fallbackMessage(latestEmotion?.complaint ?? null);
    }

    // 5. LINEに返信
    try {
      await replyLineMessage(event.replyToken, replyText);
    } catch (err) {
      console.error("LINE返信エラー:", err);
      continue;
    }

    // 6. 植物の返事も会話履歴に保存(次回の文脈に使うため)
    await supabase.from("conversation_logs").insert({
      device_id: device.id,
      role: "plant",
      message: replyText,
      emotion: latestEmotion?.emotion ?? null,
      complaint: latestEmotion?.complaint ?? null,
    });

    console.log(`[${device.plant_name}] 返信送信:`, replyText);
  }

  return new Response("OK", { status: 200 });
});