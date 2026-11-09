// 飼い主に話しかけられたときの返事（line-webhook と app-chat が使う）

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CONVERSATION_WINDOW } from "./config.ts";
import { type EmotionState, stateFromLog } from "./emotionEngine.ts";
import { fallbackMessage } from "./fallback.ts";
import {
  buildReplyPrompt,
  type ConversationEntry,
  describeLlmFailure,
  enforceMessageLength,
  generateMessage,
  REPLY_TIMEOUT_MS,
} from "./llm.ts";
import { describeTouches, TOUCH_MEMORY_HOURS } from "./touches.ts";

export interface ConversationDevice {
  id: string;
  plant_name: string;
  plant_profile: string;
  character_id: string;
}

export interface Reply {
  text: string;
  state: EmotionState;
  source: "llm" | "fallback";
  finishReason: string;
  // Gemini にかかった時間。定型文のときは、あきらめるまでの時間
  llmMs: number;
}

export async function createReply(
  supabase: SupabaseClient,
  device: ConversationDevice,
  userText: string,
): Promise<Reply> {
  // 現在の発言を履歴へ二重に含めないよう、直近履歴は保存前に取得する。
  const now = new Date();
  const touchSince = new Date(now.getTime() - TOUCH_MEMORY_HOURS * 3_600_000);
  const [emotionResult, convoResult, summaryResult, touchResult] = await Promise
    .all([
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
      supabase
        .from("touch_logs")
        .select("kind, created_at")
        .eq("device_id", device.id)
        .gte("created_at", touchSince.toISOString())
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

  if (emotionResult.error) throw emotionResult.error;
  if (convoResult.error) throw convoResult.error;
  if (summaryResult.error) throw summaryResult.error;
  // 触った記憶は無くても返事はできるので、読めなくても止めない
  if (touchResult.error) {
    console.error(
      `[${device.id}] 触った記録を読めませんでした:`,
      touchResult.error,
    );
  }

  const state = stateFromLog(emotionResult.data);
  const replyPrompt = buildReplyPrompt({
    plantName: device.plant_name,
    plantProfile: device.plant_profile,
    characterId: device.character_id,
    state,
    recentConversation: (convoResult.data ?? []) as ConversationEntry[],
    relationshipSummary: summaryResult.data?.summary ?? null,
    touchMemory: touchResult.error
      ? null
      : describeTouches(touchResult.data ?? [], now),
    userMessage: userText,
  });

  // 返信は飼い主が待っているので interactive（思考は minimal）。
  // それでも失敗したら黙って落とさず、テンプレを返して会話を途切れさせない。
  // どちらで返したかは conversation_logs に残す（フォールバック率の集計用）。
  const startedAt = Date.now();
  try {
    const text = enforceMessageLength(
      await generateMessage(replyPrompt, "interactive", {
        timeoutMs: REPLY_TIMEOUT_MS,
      }),
      40,
    );
    return {
      text,
      state,
      source: "llm",
      finishReason: "STOP",
      llmMs: Date.now() - startedAt,
    };
  } catch (err) {
    console.error("Gemini生成エラー。テンプレへ切り替えます:", err);
    return {
      text: fallbackMessage(state.complaint, state.emotion),
      state,
      source: "fallback",
      finishReason: describeLlmFailure(err),
      llmMs: Date.now() - startedAt,
    };
  }
}

// 飼い主の発言と返事を、まとめて保存する。失敗しても返事は届いているので、ログに残すだけ
export async function saveExchange(
  supabase: SupabaseClient,
  deviceId: string,
  userText: string,
  reply: Reply,
): Promise<void> {
  const userCreatedAt = new Date();
  const plantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const { error } = await supabase.from("conversation_logs").insert([
    {
      device_id: deviceId,
      role: "user",
      message: userText,
      // 飼い主の発言。source を入れておかないと、記録開始前の古い行（source=null）と
      // 区別がつかず、フォールバック率の集計にノイズが乗る。
      source: "user",
      created_at: userCreatedAt.toISOString(),
    },
    {
      device_id: deviceId,
      role: "plant",
      message: reply.text,
      emotion: reply.state.emotion,
      complaint: reply.state.complaint,
      source: reply.source,
      finish_reason: reply.finishReason,
      llm_ms: reply.llmMs,
      created_at: plantCreatedAt.toISOString(),
    },
  ]);
  if (error) console.error(`[${deviceId}] 会話ログの保存に失敗:`, error);
}
