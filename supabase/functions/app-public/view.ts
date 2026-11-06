// 鍵なしで返してよいものを選ぶ計算。DB と Deno に依存しないので、ここだけテストできる

// devices.public_slug の check と同じ形
const POT_PATTERN = /^[a-z0-9-]{1,32}$/;

export function parsePot(value: string | null): string | null {
  if (value === null || !POT_PATTERN.test(value)) return null;
  return value;
}

export interface ConversationRow {
  role: "plant" | "user";
  message: string;
  emotion: string | null;
  created_at: string;
}

// line-webhook と app-chat は、人の行の 1ms あとに返事を書く。前の書き方の行も拾えるよう幅を持たせる
const REPLY_WINDOW_MS = 60_000;

// 返事かどうかを、直前の行で見分けるのに足りる数
export const CONVERSATION_ROWS = 20;

// 新しい順の会話（最大 CONVERSATION_ROWS 行）から、植物が自分から送った最後のセリフを選ぶ。
// 人への返事は、その人が書いた内容に触れていることがあるので、鍵なしでは見せない。
// 直前の行が範囲の外にあって返事かどうか分からないセリフも、見せない。
// 取れた行が上限より少なければ、一番古い行の前には何も無いので、返事ではない（新しい鉢の最初の通知など）
export function lastPlantNotice(rows: ConversationRow[]) {
  const end = rows.length < CONVERSATION_ROWS ? rows.length : rows.length - 1;
  for (let i = 0; i < end; i++) {
    const row = rows[i];
    if (row.role !== "plant") continue;
    const before = rows[i + 1];
    const isReply = before?.role === "user" &&
      Date.parse(row.created_at) - Date.parse(before.created_at) <=
        REPLY_WINDOW_MS;
    if (!isReply) {
      return {
        message: row.message,
        emotion: row.emotion,
        created_at: row.created_at,
      };
    }
  }
  return null;
}
