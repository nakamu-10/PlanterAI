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

    if (
      typeof current.soil_adc !== "number" ||
      typeof current.temp !== "number" ||
      typeof current.humidity !== "number" ||
      typeof current.lux !== "number"
    ) {
      return json(
        { error: "soil_adc, temp, humidity, lux は必須の数値です" },
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
    const willNotify = shouldNotify(state, lastNotified, NOTIFY_COOLDOWN_MINUTES);

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

        // 遷移通知は即時性が高いので interactive（思考オフで最速・打ち切りに強い）。
        // 生成が打ち切り等で失敗しても、遷移通知を落とさずテンプレで送る。
        try {
          message = await generateMessage(prompt, "interactive");
        } catch (genErr) {
          console.warn(`[${device.id}] セリフ生成に失敗、テンプレにフォールバック:`, genErr);
          message = fallbackMessage(state.complaint);
        }
        await pushLineMessage(device.line_user_id, message);
        notified = true;

        await supabase.from("conversation_logs").insert({
          device_id: device.id,
          role: "plant",
          message,
          emotion: state.emotion,
          complaint: state.complaint,
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

    return json({ ok: true, scores, state, will_notify: willNotify, notified, message });
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
