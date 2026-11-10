// dailyLightJob.ts — 日照不足判定の実行（Supabase I/O + 通知）
//
// ingest-sensor から毎サイクル呼ばれるが、予告の14時台と20時以降の締め以外は
// DBを一切叩かずに即returnする。実質的なコストは日に数回だけ。

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CONVERSATION_WINDOW, PLANT_PROFILES } from "./config.ts";
import { toScore } from "./normalize.ts";
import { decideEmotion, scoreToUrgency, Urgency } from "./emotionTable.ts";
import type { EmotionState } from "./emotionEngine.ts";
import {
  buildPrompt,
  ConversationEntry,
  describeLlmFailure,
  enforceMessageLength,
  generateMessage,
} from "./llm.ts";
import { DIM_DAY_FALLBACK, fallbackMessage } from "./fallback.ts";
import { pushIfLinked } from "./line.ts";
import {
  countConsecutiveShortDays,
  DAILY_LIGHT,
  DailyLightVerdict,
  dailyLightWindows,
  jstDateKey,
  jstHour,
  judgeDailyLight,
  LuxSample,
} from "./dailyLight.ts";
import {
  describeWeather,
  isDimDay,
  keepWaitingForWeather,
  TodayWeather,
} from "./weather.ts";
import type { WeatherLookup } from "./dailyWeather.ts";

export interface DeviceRow {
  id: string;
  plant_name: string;
  plant_profile: string;
  character_id: string;
  line_user_id: string | null;
}

export async function runDailyLightCheck(
  supabase: SupabaseClient,
  device: DeviceRow,
  todayWeather: WeatherLookup,
  now: Date = new Date(),
): Promise<DailyLightVerdict | null> {
  // 早期リターン: 予告の時間でも締めの時間でもなければDBを叩かない
  const hour = jstHour(now);
  if (hour < DAILY_LIGHT.checkpointHour) return null;
  if (
    hour >= DAILY_LIGHT.checkpointEndHour && hour < DAILY_LIGHT.deadlineHour
  ) {
    return null;
  }

  const profile = PLANT_PROFILES[device.plant_profile];
  if (!profile) {
    throw new Error(`未知のplant_profileです: ${device.plant_profile}`);
  }
  const target = profile.lightDaily.comfortLow;
  const { dayStart, checkpointStart, deadlineStart } = dailyLightWindows(now);

  // 1. 過去の日照不足通知を取得（重複判定 + 連続日数）
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

  // 2. 今日のluxサンプルを取得
  const { data: sensorRows, error: sensorErr } = await supabase
    .from("sensor_logs")
    .select("raw, created_at")
    .eq("device_id", device.id)
    .gte("created_at", dayStart.toISOString())
    .order("created_at", { ascending: true });
  if (sensorErr) throw sensorErr;

  const samples: LuxSample[] = (sensorRows ?? [])
    .map((r) => ({
      at: r.created_at,
      lux: Number((r.raw as { lux?: unknown } | null)?.lux),
    }))
    .filter((s) => Number.isFinite(s.lux));

  // 3. 判定
  const verdict = judgeDailyLight({
    now,
    samples,
    targetLuxHours: target,
    warnedToday,
    closedToday,
  });

  console.log(
    `[dailyLight] ${device.plant_name}: ${verdict.kind} (${verdict.reason}) ` +
      `${verdict.integral.luxHours}/${target} lux·h, coverage=${verdict.integral.coverage}`,
  );

  if (verdict.kind === "none") return verdict;

  // 曇りや雨の日は、置き場所を変えても光はあまり増えない。予告はせず、締めでも責めない
  const localDate = jstDateKey(now);
  const lookup = verdict.kind === "recovered" ? null : todayWeather;
  if (
    lookup === "unavailable" && verdict.kind !== "recovered" &&
    keepWaitingForWeather(verdict.kind, hour)
  ) {
    return {
      ...verdict,
      kind: "none",
      reason: "天気が取れないので次の回に回す",
    };
  }
  const weather = lookup === "unavailable" ? null : lookup;
  const dimDay = weather !== null && isDimDay(weather);
  if (dimDay && verdict.kind === "warning") {
    return { ...verdict, kind: "none", reason: "曇りや雨の日なので予告しない" };
  }

  // 同時POSTでも同じ判定枠から二重送信しないよう、DBで先に枠を確保する。
  const notificationSlot = verdict.kind === "warning"
    ? "checkpoint"
    : "deadline";
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_daily_light_notification",
    {
      p_device_id: device.id,
      p_local_date: localDate,
      p_slot: notificationSlot,
    },
  );
  if (claimError) throw claimError;
  if (claimed !== true) {
    return {
      ...verdict,
      kind: "none",
      reason: "同じ判定枠は処理済み、または処理中",
    };
  }

  // 4. 感情状態の組み立て
  const shortDayKeys = logs
    .filter((l) =>
      (l.scores as { daily_light?: { kind?: string } } | null)?.daily_light
        ?.kind === "shortfall"
    )
    .map((l) => jstDateKey(new Date(l.created_at)));
  const consecutiveDays = countConsecutiveShortDays(shortDayKeys, now);

  const state = dimDay
    ? DIM_DAY_STATE
    : buildState(verdict, profile.lightDaily, consecutiveDays);
  const situation = dimDay && weather
    ? dimDaySituation(weather)
    : SITUATION[verdict.kind];

  // 5. セリフ生成
  const { data: convo, error: convoError } = await supabase
    .from("conversation_logs")
    .select("role, message, created_at")
    .eq("device_id", device.id)
    .order("created_at", { ascending: false })
    .limit(CONVERSATION_WINDOW);
  if (convoError) throw convoError;

  const { data: summary, error: summaryError } = await supabase
    .from("relationship_summaries")
    .select("summary")
    .eq("device_id", device.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (summaryError) throw summaryError;

  const prompt = buildPrompt({
    plantName: device.plant_name,
    plantProfile: device.plant_profile,
    characterId: device.character_id,
    state,
    recentConversation: (convo ?? []) as ConversationEntry[],
    relationshipSummary: summary?.[0]?.summary ?? null,
  }) + `\n\n# 今回だけの追加指示（最優先）\n${situation}`;

  // 日次ジョブは誰も待っていないので batch プロファイル（予算厚め）。
  // 打ち切りでリトライも失敗したら、半端な文を出さずテンプレに逃がす。
  let message: string;
  let source: "llm" | "fallback" = "llm";
  let finishReason = "STOP";
  const startedAt = Date.now();
  try {
    message = enforceMessageLength(await generateMessage(prompt, "batch"), 60);
  } catch (e) {
    console.error(
      "[dailyLight] セリフ生成に失敗、テンプレにフォールバック:",
      e,
    );
    source = "fallback";
    finishReason = describeLlmFailure(e);
    message = dimDay
      ? DIM_DAY_FALLBACK
      : fallbackMessage(state.complaint, state.emotion);
  }
  const llmMs = Date.now() - startedAt;

  // 6. 送信 & 記録
  // LINE に届かなくても、セリフは下で記録し、アプリの吹き出しに出す
  const lineError = await pushIfLinked(device.line_user_id, message);

  // 送った時点で完了扱いにし、その後のログ保存失敗による再送を防ぐ。
  // LINE に届かなかった理由は残す（関数のログは1日で消えるため）
  const { error: completeError } = await supabase
    .from("daily_light_notification_slots")
    .update({
      status: "completed",
      last_error: lineError,
      updated_at: new Date().toISOString(),
    })
    .eq("device_id", device.id)
    .eq("local_date", localDate)
    .eq("slot", notificationSlot);
  if (completeError) throw completeError;

  const { error: emotionInsertError } = await supabase.from("emotion_logs")
    .insert({
      device_id: device.id,
      emotion: state.emotion,
      // 回復時も complaint は "日照不足" で記録する。
      // これが「今日この枠で通知済みか」の重複判定キーを兼ねるため。
      complaint: "日照不足",
      urgency: state.urgency,
      duration_hours: state.duration_hours,
      scores: {
        daily_light: {
          // 天気のせいの日は "dim_day" にして、不足が続いた日数に数えない
          kind: dimDay ? "dim_day" : verdict.kind,
          lux_hours: verdict.integral.luxHours,
          target,
          ratio: verdict.achievedRatio,
          coverage: verdict.integral.coverage,
          consecutive_days: consecutiveDays,
          weather,
        },
      },
      notified: true,
    });
  if (emotionInsertError) throw emotionInsertError;

  const { error: convoInsertError } = await supabase.from("conversation_logs")
    .insert({
      device_id: device.id,
      role: "plant",
      message,
      emotion: state.emotion,
      complaint: "日照不足",
      source,
      finish_reason: finishReason,
      llm_ms: llmMs,
    });
  if (convoInsertError) {
    console.error("[dailyLight] 会話ログの保存に失敗:", convoInsertError);
  }

  return verdict;
}

// 判定結果 → EmotionState
function buildState(
  verdict: DailyLightVerdict,
  thresholds: typeof PLANT_PROFILES.calathea.lightDaily,
  consecutiveDays: number,
): EmotionState {
  if (verdict.kind === "recovered") {
    return {
      emotion: "満足",
      complaint: null,
      urgency: "none",
      duration_hours: 0,
      duration_label: "",
    };
  }

  if (verdict.kind === "warning") {
    // 予告であって確定ではないので、常に最も弱い段階に固定する
    return {
      emotion: "軽い不満",
      complaint: "日照不足",
      urgency: "low",
      duration_hours: 0,
      duration_label: "今日",
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

const DIM_DAY_STATE: EmotionState = {
  emotion: "軽い不満",
  complaint: "日照不足",
  urgency: "low",
  duration_hours: 0,
  duration_label: "今日",
};

function dimDaySituation(weather: TodayWeather): string {
  return `今日は${describeWeather(weather)}で、日が差したのは${
    weather.sunshineHours.toFixed(1)
  }時間だけでした。光は目標に届きませんでしたが、天気のせいで、置き場所のせいではありません。` +
    "飼い主を責めたり、場所を変えてとお願いしたりしてはいけません。" +
    "お日様が少なかったね、明日は晴れるといいな、くらいの軽い話にしてください。";
}

// LLMに渡す状況説明。同じ「日照不足」でも意味が全く違うので分ける
const SITUATION: Record<string, string> = {
  warning:
    "まだ今日は終わっていません。今日浴びた光がこのままだと足りない見込み、という「予報」です。" +
    "今から明るい場所に移してもらえればまだ間に合います。責めずに、今すぐ動かしてほしいとお願いしてください。" +
    "「足りなかった」と過去形で断定してはいけません。",
  shortfall:
    "今日はもう日が暮れ、今日の光は確定しました。目標に届きませんでした。" +
    "今から動かしても今日は取り返せないので、明日の置き場所を考えてほしい、というお願いにしてください。",
  recovered: "さっきお願いしたあと、今日の光が目標に届きました。" +
    "飼い主が場所を変えてくれたのか、日が差しただけなのかは分かりません。" +
    "「足りたよ」と素直に喜んでください。場所を変えてくれたと決めつけてお礼を言ってはいけません。不調の話はしないでください。",
};
