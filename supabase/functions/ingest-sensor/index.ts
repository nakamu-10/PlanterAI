// ============================================================
// ingest-sensor — ESP32からのセンサーPOSTを受けるメイン関数
//
// パイプライン:
//   1. x-device-key ヘッダーでデバイスを認証
//   2. Layer 1: 異常値・欠測の棄却 + 中央値フィルタ + 快適スコア化（normalize.ts）
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
import {
  applyMedianFilter,
  RawReading,
  toComfortScores,
} from "../_shared/normalize.ts";
import {
  evaluateEmotion,
  LastNotifiedState,
  PastEmotionLog,
  shouldNotify,
} from "../_shared/emotionEngine.ts";
import {
  buildPrompt,
  ConversationEntry,
  describeLlmFailure,
  generateMessage,
} from "../_shared/llm.ts";
import { fallbackMessage } from "../_shared/fallback.ts";
import { pushLineMessage } from "../_shared/line.ts";
import { runDailyLightCheck } from "../_shared/dailyLightJob.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("*")
      .eq("device_key", deviceKey)
      .maybeSingle();

    if (deviceError) throw deviceError;
    if (!device) {
      return json({ error: "デバイスが登録されていません" }, 401);
    }

    // ------------------------------------------------------
    // 2. リクエストボディの検証
    // ------------------------------------------------------
    let current: RawReading;
    try {
      current = await req.json();
    } catch {
      return json({ error: "JSONの解析に失敗しました" }, 400);
    }

    // 必須は土壌水分と照度だけ。気温・湿度（BME280）は欠測を許容する。
    // BME280は間欠的に読み取り失敗するが、そのたびにPOST全体を400で
    // 落とすと土壌水分・照度まで捨ててしまう（水切れを見逃す）。
    // 妥当性の判定は Layer 1（normalize.ts）に一本化してある。
    if (
      typeof current.soil_adc !== "number" ||
      typeof current.lux !== "number"
    ) {
      return json(
        { error: "soil_adc, lux は必須の数値です" },
        400,
      );
    }

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
    const { data: historyRows } = await supabase
      .from("sensor_logs")
      .select("raw")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(MEDIAN_WINDOW - 1);

    const history: RawReading[] = (historyRows ?? []).map((r) => r.raw as RawReading);
    const filtered = applyMedianFilter(history, current);

    // 欠測（センサー読み取り失敗）の記録。該当センサーの主訴は判定されず、
    // 残りのセンサーだけで判定が続行される（normalize.ts / emotionEngine.ts）。
    const degraded = filtered.missing.length > 0;
    if (degraded) {
      console.warn(
        `[${device.id}] センサー欠測: ${filtered.missing.join(", ")} ` +
        `— 該当項目の主訴は判定せず、残りのセンサーで続行します`,
      );
    }

    const comfortMid = {
      moisture: (profile.moisture.comfortLow + profile.moisture.comfortHigh) / 2,
      temp: (profile.temp.comfortLow + profile.temp.comfortHigh) / 2,
      light: (profile.light.comfortLow + profile.light.comfortHigh) / 2,
      humidity: (profile.humidity.comfortLow + profile.humidity.comfortHigh) / 2,
    };
    const scores = toComfortScores(filtered, profile);

    // ------------------------------------------------------
    // 4. Layer 2: 感情判定 + 状態遷移の検出
    // ------------------------------------------------------
    const { data: pastLogRows } = await supabase
      .from("emotion_logs")
      .select("emotion, complaint, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(500);

    const pastLogs = (pastLogRows ?? []) as PastEmotionLog[];

    // 最後に「実際に通知した」感情ログ（クールダウン判定の基準）。
    // 直前の記録行ではなく、ユーザーが最後に受け取った通知を基準にすることで、
    // 境界付近での状態の往復による LINE 乱発を頭打ちにする（shouldNotify参照）。
    const { data: lastNotifiedRows } = await supabase
      .from("emotion_logs")
      .select("emotion, complaint, created_at")
      .eq("device_id", device.id)
      .eq("notified", true)
      .order("created_at", { ascending: false })
      .limit(1);
    const lastNotified = (lastNotifiedRows?.[0] ?? null) as LastNotifiedState | null;

    const state = evaluateEmotion(scores, filtered, comfortMid, pastLogs);
    // 欠測センサーが原因だった主訴からの「回復しました」通知だけ抑止する
    // （水やりによる水分不足の回復など、読めているセンサーの回復は通知する）
    const willNotify = shouldNotify(
      state, lastNotified, NOTIFY_COOLDOWN_MINUTES, filtered.missing,
    );

    // ------------------------------------------------------
    // 5. sensor_logs へ記録（常に）
    // ------------------------------------------------------
    await supabase.from("sensor_logs").insert({
      device_id: device.id,
      raw: current,
      filtered,
      scores,
    });

    // ------------------------------------------------------
    // 6. 遷移時のみ Layer 3: LLM生成 → LINE通知
    // ------------------------------------------------------
    let message: string | null = null;
    let notified = false;

    if (willNotify) {
      try {
        const { data: convoRows } = await supabase
          .from("conversation_logs")
          .select("role, message, created_at")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false })
          .limit(CONVERSATION_WINDOW);

        const { data: summaryRows } = await supabase
          .from("relationship_summaries")
          .select("summary")
          .eq("device_id", device.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const prompt = buildPrompt({
          plantName: device.plant_name,
          characterId: device.character_id,
          state,
          recentConversation: (convoRows ?? []) as ConversationEntry[],
          relationshipSummary: summaryRows?.[0]?.summary ?? null,
        });

        // 遷移通知は即時性が高いので interactive（思考は minimal で最速寄り）。
        // 生成が失敗しても、遷移通知を落とさずテンプレで送る。
        // どちらで送ったかは conversation_logs に残す（Edge Functionのログは
        // 無料プランだと1日で消えるため、痕跡をDB側に持たせる）。
        let source: "llm" | "fallback" = "llm";
        let finishReason = "STOP";
        try {
          message = await generateMessage(prompt, "interactive");
        } catch (genErr) {
          console.error(`[${device.id}] セリフ生成に失敗、テンプレにフォールバック:`, genErr);
          source = "fallback";
          finishReason = describeLlmFailure(genErr);
          message = fallbackMessage(state.complaint, state.emotion);
        }
        await pushLineMessage(device.line_user_id, message);
        notified = true;

        await supabase.from("conversation_logs").insert({
          device_id: device.id,
          role: "plant",
          message,
          emotion: state.emotion,
          complaint: state.complaint,
          source,
          finish_reason: finishReason,
        });
      } catch (err) {
        // LLM/LINE側の失敗はここで吸収し、状態記録自体は続行する
        console.error(`[${device.id}] 通知生成エラー:`, err);
        message = null;
        notified = false;
      }
    }

    // ------------------------------------------------------
    // 7. emotion_logs へ記録（常に）
    // ------------------------------------------------------
    await supabase.from("emotion_logs").insert({
      device_id: device.id,
      emotion: state.emotion,
      complaint: state.complaint,
      urgency: state.urgency,
      duration_hours: state.duration_hours,
      scores,
      notified,
    });

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
      ok: true, scores, state,
      missing: filtered.missing, // 欠測センサー（空配列＝全センサー正常）
      will_notify: willNotify, notified, message,
    });
  } catch (err) {
    console.error("ingest-sensor 予期しないエラー:", err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
