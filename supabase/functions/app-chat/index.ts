// app-chat — 専用Webアプリ用のチャットAPI
//
// 返事の作り方は line-webhook と同じ（_shared/conversation.ts）。
// 認証: ingest-sensor と同じ x-device-key ヘッダー方式
//       （--no-verify-jwt でデプロイ）

import { createClient } from "jsr:@supabase/supabase-js@2";
import { createReply, saveExchange } from "../_shared/conversation.ts";

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

    const reply = await createReply(supabase, device, userText);
    await saveExchange(supabase, device.id, userText, reply);

    return json({
      reply: reply.text,
      emotion: reply.state.emotion,
      complaint: reply.state.complaint,
    });
  } catch (err) {
    console.error("app-chat 予期しないエラー:", err);
    return json({ error: "処理に失敗しました" }, 500);
  }
});
