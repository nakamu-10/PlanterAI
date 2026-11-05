// app-chat — 専用Webアプリ用のチャットAPI
//
// line-webhook と同じプロンプト組み立て・生成ロジックを再利用する。
// 認証: ingest-sensor と同じ x-device-key ヘッダー方式
//       （--no-verify-jwt でデプロイ）

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildReplyPrompt,
  describeLlmFailure,
  enforceMessageLength,
  generateMessage,
} from "../_shared/llm.ts";
import type { ConversationEntry } from "../_shared/llm.ts";
import { stateFromLog } from "../_shared/emotionEngine.ts";
import { CONVERSATION_WINDOW } from "../_shared/config.ts";
import { fallbackMessage } from "../_shared/fallback.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-device-key",
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface Device {
  id: string;
  plant_name: string;
  character_id: string;
}

async function authenticate(req: Request): Promise<Device | null> {
  const deviceKey = req.headers.get("x-device-key");
  if (!deviceKey || deviceKey.length > 256) return null;

  const { data, error } = await supabase
    .from("devices")
    .select("id, plant_name, character_id")
    .eq("device_key", deviceKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "POSTメソッドのみ対応しています" }, 405);
  }

  try {
    const device = await authenticate(req);
    if (!device) return json({ error: "デバイスが認証できません" }, 401);

    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 4_096) {
      return json({ error: "リクエストボディが大きすぎます" }, 413);
    }

    let body: { message?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "JSONの解析に失敗しました" }, 400);
    }

    const userText = typeof body.message === "string"
      ? body.message.trim()
      : "";
    if (!userText || userText.length > 500) {
      return json({ error: "message は1〜500文字にしてください" }, 400);
    }

    // 現在の発言を履歴へ二重に含めないよう、直近履歴は保存前に取得する。
    const [emotionResult, convoResult, summaryResult] = await Promise.all([
      supabase
        .from("emotion_logs")
        .select("emotion, complaint, urgency, duration_hours")
        .eq("device_id", device.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("conversation_logs")
        .select("role, message, created_at")
        .eq("device_id", device.id)
        .order("created_at", { ascending: false })
        .limit(CONVERSATION_WINDOW),
      supabase
        .from("relationship_summaries")
        .select("summary")
        .eq("device_id", device.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (emotionResult.error) throw emotionResult.error;
    if (convoResult.error) throw convoResult.error;
    if (summaryResult.error) throw summaryResult.error;

    const state = stateFromLog(emotionResult.data);
    const replyPrompt = buildReplyPrompt({
      plantName: device.plant_name,
      characterId: device.character_id,
      state,
      recentConversation: (convoResult.data ?? []) as ConversationEntry[],
      relationshipSummary: summaryResult.data?.summary ?? null,
      userMessage: userText,
    });

    // どちらで返したかは conversation_logs に残す（フォールバック率の集計用）
    let replyText: string;
    let replySource: "llm" | "fallback" = "llm";
    let replyFinishReason = "STOP";
    try {
      replyText = enforceMessageLength(
        await generateMessage(replyPrompt, "interactive"),
        40,
      );
    } catch (err) {
      console.error("Gemini生成エラー。テンプレへ切り替えます:", err);
      replySource = "fallback";
      replyFinishReason = describeLlmFailure(err);
      replyText = fallbackMessage(state.complaint, state.emotion);
    }

    const userCreatedAt = new Date();
    const plantCreatedAt = new Date(userCreatedAt.getTime() + 1);
    const { error: insertError } = await supabase.from("conversation_logs")
      .insert([
        {
          device_id: device.id,
          role: "user",
          message: userText,
          source: "user",
          created_at: userCreatedAt.toISOString(),
        },
        {
          device_id: device.id,
          role: "plant",
          message: replyText,
          emotion: state.emotion,
          complaint: state.complaint,
          source: replySource,
          finish_reason: replyFinishReason,
          created_at: plantCreatedAt.toISOString(),
        },
      ]);
    if (insertError) {
      console.error(`[${device.id}] 会話ログの保存に失敗:`, insertError);
    }

    return json({
      reply: replyText,
      emotion: state.emotion,
      complaint: state.complaint,
    });
  } catch (err) {
    console.error("app-chat 予期しないエラー:", err);
    return json({ error: "処理に失敗しました" }, 500);
  }
});
