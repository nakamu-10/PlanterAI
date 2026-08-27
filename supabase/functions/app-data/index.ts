// ============================================================
// app-data — 専用Webアプリ用のダッシュボード取得・設定更新API
//
// 認証: ingest-sensor と同じ x-device-key ヘッダー方式
//       （--no-verify-jwt でデプロイ）
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PLANT_PROFILES } from "../_shared/config.ts";
import { CHARACTERS } from "../_shared/llm.ts";

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
  plant_profile: string;
  character_id: string;
}

async function authenticate(req: Request): Promise<Device | null> {
  const deviceKey = req.headers.get("x-device-key");
  if (!deviceKey || deviceKey.length > 256) return null;

  const { data, error } = await supabase
    .from("devices")
    .select("id, plant_name, plant_profile, character_id")
    .eq("device_key", deviceKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function handleDashboard(device: Device): Promise<Response> {
  const [sensorResult, emotionResult, summaryResult] = await Promise.all([
    supabase
      .from("sensor_logs")
      .select("raw, filtered, scores, created_at")
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
      .from("relationship_summaries")
      .select("summary")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (sensorResult.error) throw sensorResult.error;
  if (emotionResult.error) throw emotionResult.error;
  if (summaryResult.error) throw summaryResult.error;

  const sensorHistory = sensorResult.data ?? [];
  const emotionHistory = emotionResult.data ?? [];

  return json({
    device: {
      plant_name: device.plant_name,
      plant_profile: device.plant_profile,
      character_id: device.character_id,
    },
    latest_sensor: sensorHistory[0] ?? null,
    sensor_history: sensorHistory,
    emotion_history: emotionHistory,
    relationship_summary: summaryResult.data?.summary ?? null,
  });
}

async function handleUpdateSettings(
  device: Device,
  body: Record<string, unknown>,
): Promise<Response> {
  const updates: Record<string, string> = {};

  if (typeof body.plant_name === "string") {
    const name = body.plant_name.trim();
    if (!name || name.length > 40) {
      return json({ error: "plant_name は1〜40文字にしてください" }, 400);
    }
    updates.plant_name = name;
  }

  if (typeof body.plant_profile === "string") {
    if (!PLANT_PROFILES[body.plant_profile]) {
      return json(
        { error: `未知の plant_profile です: ${body.plant_profile}` },
        400,
      );
    }
    updates.plant_profile = body.plant_profile;
  }

  if (typeof body.character_id === "string") {
    if (!CHARACTERS[body.character_id]) {
      return json(
        { error: `未知の character_id です: ${body.character_id}` },
        400,
      );
    }
    updates.character_id = body.character_id;
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: "更新する項目がありません" }, 400);
  }

  const { data, error } = await supabase
    .from("devices")
    .update(updates)
    .eq("id", device.id)
    .select("plant_name, plant_profile, character_id")
    .single();
  if (error) throw error;

  return json({ device: data });
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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "JSONの解析に失敗しました" }, 400);
    }

    switch (body.action) {
      case "dashboard":
        return await handleDashboard(device);
      case "update_settings":
        return await handleUpdateSettings(device, body);
      default:
        return json({ error: `未知の action です: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error("app-data 予期しないエラー:", err);
    return json({ error: "処理に失敗しました" }, 500);
  }
});
