// ============================================================
// ingest-sensor — ESP32からのセンサーPOSTを受けるメイン関数
//
// パイプライン:
//   1. x-device-key ヘッダーでデバイスを認証
//   2. Layer 1: 中央値フィルタ + 快適スコア化（normalize.ts）
//   3. Layer 2: ルールベース感情判定（emotionEngine.ts）
//   4. 前回の状態と比較し、遷移していれば通知対象とする
//   5. 遷移時のみ Layer 3: Gemini Flash でセリフ生成 → LINE通知
//   6. sensor_logs / emotion_logs / conversation_logs に記録
//
// 認証: ESP32はSupabaseのJWTを持たないため、x-device-key で
//       devices テーブルを照合する自前認証（--no-verify-jwt でデプロイ）
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  CONVERSATION_WINDOW,
  MEDIAN_WINDOW,
  NOTIFY_COOLDOWN_MINUTES,
  PLANT_PROFILES,
} from "../_shared/config.ts";
import { applyMedianFilter, toComfortScores } from "../_shared/normalize.ts";
import type { RawReading } from "../_shared/normalize.ts";
import {
  evaluateEmotion,
  LastNotifiedState,
  PastEmotionLog,
  shouldNotify,
} from "../_shared/emotionEngine.ts";
import {
  buildPrompt,
  ConversationEntry,
  enforceMessageLength,
  generateMessage,
} from "../_shared/llm.ts";
import { fallbackMessage } from "../_shared/fallback.ts";
import { pushLineMessage } from "../_shared/line.ts";
import { runDailyLightCheck } from "../_shared/dailyLightJob.ts";
import { validateRawReading } from "../_shared/validation.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

async function setNotificationClaimStatus(
  deviceId: string,
  signature: string,
  status: "completed" | "failed",
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from("state_notification_slots")
    .update({
      status,
      last_error: errorMessage?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("device_id", deviceId)
    .eq("signature", signature);
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "POSTメソッドのみ対応しています" }, 405);
    }

    // ------------------------------------------------------
    // 1. デバイス認証
    // ------------------------------------------------------
    const deviceKey = req.headers.get("x-device-key");
    if (!deviceKey) {
      return json({ error: "x-device-key ヘッダーがありません" }, 401);
    }
    if (deviceKey.length > 256) {
      return json({ error: "x-device-key が長すぎます" }, 401);
    }

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, plant_name, plant_profile, character_id, line_user_id")
      .eq("device_key", deviceKey)
      .maybeSingle();

    if (deviceError) throw deviceError;
    if (!device) {
      return json({ error: "デバイスが登録されていません" }, 401);
    }

    // ------------------------------------------------------
    // 2. リクエストボディの検証
    // ------------------------------------------------------
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return json({ error: "リクエストボディが大きすぎます" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return json({ error: "JSONの解析に失敗しました" }, 400);
    }

    const validation = validateRawReading(parsed);
    if (!validation.ok) return json({ error: validation.error }, 400);
    const current: RawReading = validation.reading;

    const profile = PLANT_PROFILES[device.plant_profile];
    if (!profile) {
      return json(
        { error: `未知の plant_profile です: ${device.plant_profile}` },
        400,
      );
    }

    // ------------------------------------------------------
    // 3. Layer 1: 中央値フィルタ + 快適スコア
    // ------------------------------------------------------
    const { data: historyRows, error: historyError } = await supabase
      .from("sensor_logs")
      .select("raw")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(MEDIAN_WINDOW - 1);
    if (historyError) throw historyError;

    const history: RawReading[] = (historyRows ?? []).map((r) =>
      r.raw as RawReading
    );
    const filtered = applyMedianFilter(history, current);

    const comfortMid = {
      moisture: (profile.moisture.comfortLow + profile.moisture.comfortHigh) /
        2,
      temp: (profile.temp.comfortLow + profile.temp.comfortHigh) / 2,
      light: (profile.light.comfortLow + profile.light.comfortHigh) / 2,
      humidity: (profile.humidity.comfortLow + profile.humidity.comfortHigh) /
        2,
    };
    const scores = toComfortScores(filtered, profile);

    // ------------------------------------------------------
    // 4. Layer 2: 感情判定 + 状態遷移の検出
    // ------------------------------------------------------
    const { data: pastLogRows, error: pastLogError } = await supabase
      .from("emotion_logs")
      .select("emotion, complaint, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (pastLogError) throw pastLogError;

    const pastLogs = (pastLogRows ?? []) as PastEmotionLog[];

    // 最後に「実際に通知した」感情ログ（クールダウン判定の基準）。
    // 直前の記録行ではなく、ユーザーが最後に受け取った通知を基準にすることで、
    // 境界付近での状態の往復による LINE 乱発を頭打ちにする（shouldNotify参照）。
    const { data: lastNotifiedRows, error: lastNotifiedError } = await supabase
      .from("emotion_logs")
      .select("emotion, complaint, created_at")
      .eq("device_id", device.id)
      .eq("notified", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (lastNotifiedError) throw lastNotifiedError;
    const lastNotified = (lastNotifiedRows?.[0] ?? null) as
      | LastNotifiedState
      | null;

    const state = evaluateEmotion(scores, filtered, comfortMid, pastLogs);
    let willNotify = shouldNotify(
      state,
      lastNotified,
      NOTIFY_COOLDOWN_MINUTES,
    );

    // ------------------------------------------------------
    // 5. sensor_logs へ記録（常に）
    // ------------------------------------------------------
    const { error: sensorInsertError } = await supabase.from("sensor_logs")
      .insert({
        device_id: device.id,
        raw: current,
        filtered,
        scores,
      });
    if (sensorInsertError) throw sensorInsertError;

    // ------------------------------------------------------
    // 6. 遷移時のみ Layer 3: LLM生成 → LINE通知
    // ------------------------------------------------------
    let message: string | null = null;
    let notified = false;
    const notificationSignature = JSON.stringify([
      state.emotion,
      state.complaint,
    ]);

    if (willNotify) {
      const { data: claimed, error: claimError } = await supabase.rpc(
        "claim_state_notification",
        {
          p_device_id: device.id,
          p_signature: notificationSignature,
          p_urgency: state.urgency,
          p_cooldown_minutes: NOTIFY_COOLDOWN_MINUTES,
        },
      );
      if (claimError) throw claimError;
      if (claimed !== true) willNotify = false;
    }

    if (willNotify) {
      try {
        const { data: convoRows, error: convoError } = await supabase
          .from("conversation_logs")
          .select("role, message, created_at")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false })
          .limit(CONVERSATION_WINDOW);
        if (convoError) throw convoError;

        const { data: summaryRows, error: summaryError } = await supabase
          .from("relationship_summaries")
          .select("summary")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false })
          .limit(1);
        if (summaryError) throw summaryError;

        const prompt = buildPrompt({
          plantName: device.plant_name,
          characterId: device.character_id,
          state,
          recentConversation: (convoRows ?? []) as ConversationEntry[],
          relationshipSummary: summaryRows?.[0]?.summary ?? null,
        });

        // 遷移通知は即時性が高いので interactive（思考オフで最速・打ち切りに強い）。
        // 生成が打ち切り等で失敗しても、遷移通知を落とさずテンプレで送る。
        try {
          message = enforceMessageLength(
            await generateMessage(prompt, "interactive"),
            60,
          );
        } catch (genErr) {
          console.warn(
            `[${device.id}] セリフ生成に失敗、テンプレにフォールバック:`,
            genErr,
          );
          message = fallbackMessage(state.complaint);
        }
        await pushLineMessage(device.line_user_id, message);
        notified = true;

        try {
          await setNotificationClaimStatus(
            device.id,
            notificationSignature,
            "completed",
          );
        } catch (statusError) {
          // LINE送信後の保存失敗を再送扱いにすると二重通知になるため継続する。
          console.error(
            `[${device.id}] 通知完了状態の保存に失敗:`,
            statusError,
          );
        }

        const { error: convoInsertError } = await supabase.from(
          "conversation_logs",
        ).insert({
          device_id: device.id,
          role: "plant",
          message,
          emotion: state.emotion,
          complaint: state.complaint,
        });
        if (convoInsertError) {
          // LINE送信済みなので再送はせず、状態ログの保存を優先する。
          console.error(
            `[${device.id}] 通知会話ログの保存に失敗:`,
            convoInsertError,
          );
        }
      } catch (err) {
        try {
          await setNotificationClaimStatus(
            device.id,
            notificationSignature,
            "failed",
            String(err),
          );
        } catch (statusError) {
          console.error(
            `[${device.id}] 通知失敗状態の保存に失敗:`,
            statusError,
          );
        }
        // LLM/LINE側の失敗はここで吸収し、状態記録自体は続行する
        console.error(`[${device.id}] 通知生成エラー:`, err);
        message = null;
        notified = false;
      }
    }

    // ------------------------------------------------------
    // 7. emotion_logs へ記録（常に）
    // ------------------------------------------------------
    const { error: emotionInsertError } = await supabase.from("emotion_logs")
      .insert({
        device_id: device.id,
        emotion: state.emotion,
        complaint: state.complaint,
        urgency: state.urgency,
        duration_hours: state.duration_hours,
        scores,
        notified,
      });
    if (emotionInsertError) throw emotionInsertError;

    // ------------------------------------------------------
    // 8. Layer 2b: 日照不足の日次判定（積算光量方式）
    // 毎サイクル呼ぶが、15時より前はDBを叩かずに即returnする。
    // sensor_logs の insert より後に置くこと（今回のサンプルを積算に含めるため）。
    // 失敗しても通常の通知パイプラインは止めない。
    // ------------------------------------------------------
    try {
      await runDailyLightCheck(supabase, device);
    } catch (err) {
      console.error("[dailyLight] 判定エラー:", err);
    }

    return json({
      ok: true,
      scores,
      state,
      will_notify: willNotify,
      notified,
      message,
    });
  } catch (err) {
    console.error("ingest-sensor 予期しないエラー:", err);
    return json({ error: "センサー値の処理に失敗しました" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
