// app-public — 展示用の /app/ が、鍵なしで鉢の様子を読むための API（ADR 0006）
//
// GET ?pot=<devices.public_slug>。public_slug が入っている鉢だけを返す。
// 見られる鉢の一覧（pots）も一緒に返し、アプリで鉢を切り替えられるようにする。
// 読み取りだけで、設定の変更とチャットは鍵の要る app-data・app-chat が受ける。
// 鍵・id・LINE の ID、人が書いた文、人への返事は返さない

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  cacheHeaders,
  CONVERSATION_ROWS,
  lastPlantNotice,
  parsePot,
} from "./view.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...cacheHeaders(status),
    },
  });
}

interface Device {
  id: string;
  plant_name: string;
  plant_profile: string;
  character_id: string;
  created_at: string;
}

async function handleView(device: Device): Promise<Response> {
  const [
    sensorResult,
    emotionResult,
    wateringResult,
    conversationResult,
    potsResult,
  ] = await Promise.all([
    supabase
      .from("sensor_logs")
      .select("filtered, scores, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("emotion_logs")
      .select("emotion, complaint, urgency, duration_hours, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("watering_events")
      .select("moisture_before, moisture_after, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation_logs")
      .select("role, message, emotion, created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(CONVERSATION_ROWS),
    supabase
      .from("devices")
      .select("public_slug, plant_name")
      .not("public_slug", "is", null)
      .order("created_at", { ascending: true }),
  ]);

  if (sensorResult.error) throw sensorResult.error;
  if (emotionResult.error) throw emotionResult.error;
  if (wateringResult.error) throw wateringResult.error;
  if (conversationResult.error) throw conversationResult.error;
  if (potsResult.error) throw potsResult.error;

  const sensorHistory = sensorResult.data ?? [];

  // app-data の dashboard と同じ形にして、/app/ の表示をそのまま使えるようにする
  return json({
    device: {
      plant_name: device.plant_name,
      plant_profile: device.plant_profile,
      character_id: device.character_id,
      created_at: device.created_at,
    },
    latest_sensor: sensorHistory[0] ?? null,
    sensor_history: sensorHistory,
    emotion_history: emotionResult.data ?? [],
    latest_watering: wateringResult.data ?? null,
    last_plant_message: lastPlantNotice(conversationResult.data ?? []),
    pots: (potsResult.data ?? []).map((p) => ({
      slug: p.public_slug,
      name: p.plant_name,
    })),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return json({ error: "GETメソッドのみ対応しています" }, 405);
  }

  const pot = parsePot(new URL(req.url).searchParams.get("pot"));
  if (!pot) return json({ error: "pot の形が正しくありません" }, 400);

  try {
    const { data: device, error } = await supabase
      .from("devices")
      .select("id, plant_name, plant_profile, character_id, created_at")
      .eq("public_slug", pot)
      .maybeSingle();
    if (error) throw error;
    if (!device) return json({ error: "その鉢は見つかりません" }, 404);

    return await handleView(device);
  } catch (err) {
    console.error("app-public 予期しないエラー:", err);
    return json({ error: "処理に失敗しました" }, 500);
  }
});
