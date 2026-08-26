// ============================================================
// line.ts — LINE Messaging API プッシュ通知
//
// 失敗時は1回だけリトライする（429/5xx系のみ）。
// それでも失敗した場合は例外を投げ、呼び出し側でログに残す。
// ============================================================

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export async function pushLineMessage(
  lineUserId: string,
  text: string,
): Promise<void> {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) throw new Error("環境変数 LINE_CHANNEL_ACCESS_TOKEN が設定されていません");

  const send = async (): Promise<Response> =>
    await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "text", text }],
      }),
    });

  let res = await send();

  // レート制限(429)やLINE側の一時エラー(5xx)なら2秒待って1回だけリトライ
  if (res.status === 429 || res.status >= 500) {
    console.warn(`LINE送信失敗(HTTP ${res.status})。2秒後にリトライします`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await send();
  }

  if (!res.ok) {
    const body = await res.text();
    // 400系（ユーザーIDが不正など）はリトライしても無駄なのでそのままエラーに
    throw new Error(`LINE送信エラー: HTTP ${res.status} — ${body}`);
  }
}
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

export async function replyLineMessage(
  replyToken: string,
  text: string,
): Promise<void> {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) throw new Error("環境変数 LINE_CHANNEL_ACCESS_TOKEN が設定されていません");

  const res = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // replyTokenは1回しか使えず失効もするので、リトライはしない
    throw new Error(`LINE返信エラー: HTTP ${res.status} — ${body}`);
  }
}
