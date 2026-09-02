// ============================================================
// dailyLightJob.ts — 日照不足判定の実行（Supabase I/O + 通知）
//
// ingest-sensor から毎サイクル呼ばれるが、判定時刻（15時）より前は
// DBを一切叩かずに即returnする。実質的なコストは日に数回だけ。
// ============================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PLANT_PROFILES } from "./config.ts";
import { toScore } from "./normalize.ts";
import { decideEmotion, scoreToUrgency, Urgency } from "./emotionTable.ts";
import type { EmotionState } from "./emotionEngine.ts";
import {
  buildPrompt,
  ConversationEntry,
  describeLlmFailure,
  generateMessage,
} from "./llm.ts";
import { fallbackMessage } from "./fallback.ts";
import { pushLineMessage } from "./line.ts";
import {
  countConsecutiveShortDays, DAILY_LIGHT, dailyLightWindows,
  DailyLightVerdict, jstDateKey, jstHour, judgeDailyLight, LuxSample,
} from "./dailyLight.ts";

export interface DeviceRow {
  id: string;
  plant_name: string;
  plant_profile: string;
  character_id: string;
  line_user_id: string;
}

export async function runDailyLightCheck(
  supabase: SupabaseClient,
  device: DeviceRow,
  now: Date = new Date(),
): Promise<DailyLightVerdict | null> {
  // ---- 早期リターン: 判定時刻前はDBを叩かない ----
  if (jstHour(now) < DAILY_LIGHT.checkpointHour) return null;

  const profile = PLANT_PROFILES[device.plant_profile] ?? PLANT_PROFILES.calathea;
  const target = profile.lightDaily.comfortLow;
  const { dayStart, checkpointStart, deadlineStart } = dailyLightWindows(now);

  // ---- 1. 過去の日照不足通知を取得（重複判定 + 連続日数） ----
  const lookbackStart = new Date(dayStart.getTime() - 14 * 24 * 60 * 60 * 1000);
  const { data: pastLogs, error: logErr } = await supabase
    .from("emotion_logs")
    .select("emotion, scores, created_at")
    .eq("device_id", device.id)
    .eq("complaint", "日照不足")
    .eq("notified", true)
    .gte("created_at", lookbackStart.toISOString())
    .order("created_at", { ascending: false });
  if (logErr) throw logErr;

  const logs = pastLogs ?? [];
  const warnedToday = logs.some((l) => {
    const t = new Date(l.created_at).getTime();
    return t >= checkpointStart.getTime() && t < deadlineStart.getTime();
  });
  const closedToday = logs.some(
    (l) => new Date(l.created_at).getTime() >= deadlineStart.getTime(),
  );

  // ---- 2. 今日のluxサンプルを取得 ----
  const { data: sensorRows, error: sensorErr } = await supabase
    .from("sensor_logs")
    .select("raw, created_at")
    .eq("device_id", device.id)
    .gte("created_at", dayStart.toISOString())
    .order("created_at", { ascending: true });
  if (sensorErr) throw sensorErr;

  const samples: LuxSample[] = (sensorRows ?? [])
    .map((r) => ({ at: r.created_at, lux: Number((r.raw as any)?.lux) }))
    .filter((s) => Number.isFinite(s.lux));

  // ---- 3. 判定 ----
  const verdict = judgeDailyLight({
    now, samples, targetLuxHours: target, warnedToday, closedToday,
  });

  console.log(
    `[dailyLight] ${device.plant_name}: ${verdict.kind} (${verdict.reason}) ` +
    `${verdict.integral.luxHours}/${target} lux·h, coverage=${verdict.integral.coverage}`,
  );

  if (verdict.kind === "none") return verdict;

  // ---- 4. 感情状態の組み立て ----
  const shortDayKeys = logs
    .filter((l) => (l.scores as any)?.daily_light?.kind === "shortfall")
    .map((l) => jstDateKey(new Date(l.created_at)));
  const consecutiveDays = countConsecutiveShortDays(shortDayKeys, now);

  const state = buildState(verdict, profile.lightDaily, consecutiveDays);

  // ---- 5. セリフ生成 ----
  const { data: convo } = await supabase
    .from("conversation_logs")
    .select("role, message, created_at")
    .eq("device_id", device.id)
    .order("created_at", { ascending: false })
    .limit(7);

  const { data: summary } = await supabase
    .from("relationship_summaries")
    .select("summary")
    .eq("device_id", device.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const prompt = buildPrompt({
    plantName: device.plant_name,
    characterId: device.character_id,
    state,
    recentConversation: (convo ?? []) as ConversationEntry[],
    relationshipSummary: summary?.[0]?.summary ?? null,
  }) + `\n\n# 今回だけの追加指示（最優先）\n${SITUATION[verdict.kind]}`;

  // 日次ジョブは誰も待っていないので batch プロファイル（予算厚め）。
  // 打ち切りでリトライも失敗したら、半端な文を出さずテンプレに逃がす。
  let message: string;
  let source: "llm" | "fallback" = "llm";
  let finishReason = "STOP";
  try {
    message = await generateMessage(prompt, "batch");
  } catch (e) {
    console.error("[dailyLight] セリフ生成に失敗、テンプレにフォールバック:", e);
    source = "fallback";
    finishReason = describeLlmFailure(e);
    message = fallbackMessage(state.complaint, state.emotion);
  }

  // ---- 6. 送信 & 記録 ----
  await pushLineMessage(device.line_user_id, message);

  await supabase.from("emotion_logs").insert({
    device_id: device.id,
    emotion: state.emotion,
    // 回復時も complaint は "日照不足" で記録する。
    // これが「今日この枠で通知済みか」の重複判定キーを兼ねるため。
    complaint: "日照不足",
    urgency: state.urgency,
    duration_hours: state.duration_hours,
    scores: {
      daily_light: {
        kind: verdict.kind,
        lux_hours: verdict.integral.luxHours,
        target,
        ratio: verdict.achievedRatio,
        coverage: verdict.integral.coverage,
        consecutive_days: consecutiveDays,
      },
    },
    notified: true,
  });

  await supabase.from("conversation_logs").insert({
    device_id: device.id,
    role: "plant",
    message,
    emotion: state.emotion,
    complaint: "日照不足",
    source,
    finish_reason: finishReason,
  });

  return verdict;
}

// ------------------------------------------------------------
// 判定結果 → EmotionState
// ------------------------------------------------------------
function buildState(
  verdict: DailyLightVerdict,
  thresholds: typeof PLANT_PROFILES.calathea.lightDaily,
  consecutiveDays: number,
): EmotionState {
  if (verdict.kind === "recovered") {
    return {
      emotion: "満足", complaint: null, urgency: "none",
      duration_hours: 0, duration_label: "",
    };
  }

  if (verdict.kind === "warning") {
    // 予告であって確定ではないので、常に最も弱い段階に固定する
    return {
      emotion: "軽い不満", complaint: "日照不足", urgency: "low",
      duration_hours: 0, duration_label: "今日",
    };
  }

  // shortfall: 積算値をスコア化して既存のエスカレーション表に載せる
  const score = toScore(verdict.integral.luxHours, thresholds);
  const raw = scoreToUrgency(score);
  // 目標を下回っている以上、"none" にはしない（境界直下の救済）
  const urgency = (raw === "none" ? "low" : raw) as Exclude<Urgency, "none">;

  const totalDays = consecutiveDays + 1;
  const hours = totalDays * 24;

  return {
    emotion: decideEmotion("日照不足", urgency, hours),
    complaint: "日照不足",
    urgency,
    duration_hours: hours,
    duration_label: totalDays === 1 ? "今日" : `${totalDays}日`,
  };
}

// ------------------------------------------------------------
// LLMに渡す状況説明。同じ「日照不足」でも意味が全く違うので分ける
// ------------------------------------------------------------
const SITUATION: Record<string, string> = {
  warning:
    "まだ今日は終わっていません。今日浴びた光がこのままだと足りない見込み、という「予報」です。" +
    "今から明るい場所に移してもらえればまだ間に合います。責めずに、今すぐ動かしてほしいとお願いしてください。" +
    "「足りなかった」と過去形で断定してはいけません。",
  shortfall:
    "今日はもう日が暮れ、今日の光は確定しました。目標に届きませんでした。" +
    "今から動かしても今日は取り返せないので、明日の置き場所を考えてほしい、というお願いにしてください。",
  recovered:
    "さっきお願いしたあと、飼い主が場所を変えてくれたおかげで今日の目標を達成できました。" +
    "そのことに触れて、素直にお礼を言ってください。不調の話はしないでください。",
};
