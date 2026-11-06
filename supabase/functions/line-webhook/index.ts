import { createClient } from "jsr:@supabase/supabase-js@2";
import { createReply, saveExchange } from "../_shared/conversation.ts";
import { replyLineMessage } from "../_shared/line.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

interface LineEvent {
  webhookEventId?: string;
  type?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

async function verifySignature(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(body),
  );
}

async function claimEvent(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_webhook_event", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data === true;
}

async function setEventStatus(
  eventId: string,
  status: "completed" | "failed",
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from("processed_webhook_events")
    .update({
      status,
      last_error: errorMessage?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);
  if (error) throw error;
}

async function processEvent(event: LineEvent): Promise<void> {
  if (event.type !== "message" || event.message?.type !== "text") {
    console.log("非対応のイベント種別をスキップ:", event.type ?? "unknown");
    return;
  }

  const lineUserId = event.source?.userId;
  const userText = event.message.text;
  const replyToken = event.replyToken;
  if (!lineUserId || typeof userText !== "string" || !replyToken) {
    throw new Error("LINEイベントの必須項目が不足しています");
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, plant_name, character_id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (deviceError) throw deviceError;
  if (!device) {
    console.warn("該当デバイスのないLINEイベントをスキップしました");
    return;
  }

  const reply = await createReply(supabase, device, userText);
  await replyLineMessage(replyToken, reply.text);
  // LINE送信後に2発言をまとめて保存する。送信前にユーザー発言だけを保存すると、
  // LINE側の一時障害でWebhookが再送された際に同じ発言が重複してしまう。
  await saveExchange(supabase, device.id, userText, reply);

  console.log(`[${device.id}] LINE返信を送信しました`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "POST" },
    });
  }

  const body = await req.text();
  const validSignature = await verifySignature(
    body,
    req.headers.get("x-line-signature"),
    requiredEnv("LINE_CHANNEL_SECRET"),
  );
  if (!validSignature) {
    console.error("LINE署名検証に失敗しました");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  let failed = false;
  for (const event of Array.isArray(payload.events) ? payload.events : []) {
    const eventId = event.webhookEventId;
    if (!eventId) {
      console.error("webhookEventIdのないイベントを受信しました");
      failed = true;
      continue;
    }

    let claimed = false;
    try {
      claimed = await claimEvent(eventId);
      if (!claimed) {
        console.log("処理済み、または処理中のイベントをスキップ:", eventId);
        continue;
      }

      await processEvent(event);
      try {
        await setEventStatus(eventId, "completed");
      } catch (statusErr) {
        // 返信が成功した後に500を返すと、LINEの再送で二重返信になりうる。
        // processing のリース中は再送を抑止できるため、ここでは成功応答を返す。
        console.error(
          "Webhookイベントの完了状態を保存できませんでした:",
          statusErr,
        );
      }
    } catch (err) {
      failed = true;
      console.error(`Webhookイベント ${eventId} の処理に失敗:`, err);
      if (claimed) {
        try {
          await setEventStatus(eventId, "failed", String(err));
        } catch (statusErr) {
          console.error(
            "Webhookイベントの失敗状態を保存できませんでした:",
            statusErr,
          );
        }
      }
    }
  }

  // 一部だけ失敗した場合も500を返す。LINEの再送では完了済みイベントを
  // スキップし、failedになったイベントだけを再取得する。
  return new Response(failed ? "Retry" : "OK", { status: failed ? 500 : 200 });
});
