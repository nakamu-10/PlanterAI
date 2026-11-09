// daily-diary — カラ美の日記を作るバッチ（ADR 0009）
//
// 全デバイスについて、今日の記録から絵を1枚選び、文を Gemini に書かせて diary_entries に入れる。
// 日曜日は、その週の日記の絵と文を LINE に送る（ADR 0010）。
//
// 起動方法: pg_cron で毎晩21時（README参照）。手動で curl してもよい。
//   {"backfill_days": 7} を付けると、今日は書かず、過去7日の分をさかのぼって作る（もうある日は飛ばす）。
//   今日を入れないのは、昼に書くと途中までの記録で日記ができ、夜の分が飛ばされてしまうため
//   {"send_weekly": true} を付けると、日記は書かず、週の LINE だけを今すぐ送る（確かめるときとデモ用）
// 認証: x-cron-key ヘッダーが CRON_SECRET と一致した場合のみ実行

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PLANT_PROFILES } from "../_shared/config.ts";
import { jstDateKey, jstDayStart } from "../_shared/dailyLight.ts";
import {
  buildDayStats,
  buildDiaryPrompt,
  choosePicture,
  fallbackDiaryBody,
  isSundayJst,
  type MoodLogRow,
  weeklyDiaryFlex,
  weeklyDiaryMessage,
} from "../_shared/diary.ts";
import {
  isRejectedByLine,
  pushLineMessage,
  pushLineMessages,
} from "../_shared/line.ts";
import { enforceMessageLength, generateMessage } from "../_shared/llm.ts";

const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 31;
// プロンプトでは70文字と頼み、少しの超過は許す。これより長ければ定型文にする
const DIARY_MAX_CHARS = 90;
const RECENT_BODIES = 3;
const APP_URL = "https://planterai.vercel.app";

// Supabase は1回に1000行までしか返さない。DEMO_MODE の日は1日で1.7万行になるので分けて読む
const PAGE_ROWS = 1000;
const MAX_PAGES = 20;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Device {
  id: string;
  plant_name: string;
  plant_profile: string;
  character_id: string;
  created_at: string;
  line_user_id: string | null;
  public_slug: string | null;
}

async function readPages<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_ROWS;
    const { data, error } = await readPage(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_ROWS) break;
  }
  return rows;
}

type DiaryResult = "written" | "exists" | "no-data";

async function writeDiary(
  device: Device,
  dayStart: Date,
  now: Date,
): Promise<DiaryResult> {
  const day = jstDateKey(dayStart);
  const { data: existing, error: existingError } = await supabase
    .from("diary_entries")
    .select("id")
    .eq("device_id", device.id)
    .eq("day", day)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return "exists";

  const profile = PLANT_PROFILES[device.plant_profile];
  if (!profile) {
    throw new Error(`未知の plant_profile: ${device.plant_profile}`);
  }

  const dayEnd = new Date(Math.min(dayStart.getTime() + DAY_MS, now.getTime()));
  const from = dayStart.toISOString();
  const to = dayEnd.toISOString();

  const [sensorRows, moodRows, watering, talks, recent] = await Promise.all([
    readPages<{ created_at: string; lux: number | null }>((start, end) =>
      supabase
        .from("sensor_logs")
        .select("created_at, lux:filtered->lux")
        .eq("device_id", device.id)
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true })
        .range(start, end)
    ),
    readPages<MoodLogRow>((start, end) =>
      supabase
        .from("emotion_logs")
        .select(
          "emotion, complaint, created_at, daily_light:scores->daily_light",
        )
        .eq("device_id", device.id)
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true })
        .range(start, end)
    ),
    supabase
      .from("watering_events")
      .select("id", { count: "exact", head: true })
      .eq("device_id", device.id)
      .gte("created_at", from)
      .lt("created_at", to),
    supabase
      .from("conversation_logs")
      .select("id", { count: "exact", head: true })
      .eq("device_id", device.id)
      .eq("role", "user")
      .gte("created_at", from)
      .lt("created_at", to),
    supabase
      .from("diary_entries")
      .select("body")
      .eq("device_id", device.id)
      .lt("day", day)
      .order("day", { ascending: false })
      .limit(RECENT_BODIES),
  ]);
  if (watering.error) throw watering.error;
  if (talks.error) throw talks.error;
  if (recent.error) throw recent.error;

  // 鉢が動いていなかった日は、書くことが無い
  if (sensorRows.length === 0) return "no-data";

  const stats = buildDayStats({
    dayStart,
    dayEnd,
    deviceCreatedAt: device.created_at,
    profile,
    luxSamples: sensorRows.flatMap((row) =>
      typeof row.lux === "number" ? [{ at: row.created_at, lux: row.lux }] : []
    ),
    moodRows,
    wateringCount: watering.count ?? 0,
    talkCount: talks.count ?? 0,
  });
  const picture = choosePicture(stats);

  let body: string;
  let source: "llm" | "fallback" = "llm";
  try {
    body = enforceMessageLength(
      await generateMessage(
        buildDiaryPrompt({
          plantName: device.plant_name,
          plantKind: profile.displayName,
          characterId: device.character_id,
          picture,
          stats,
          recentBodies: (recent.data ?? []).map((row) => row.body),
        }),
        "batch",
      ),
      DIARY_MAX_CHARS,
    );
  } catch (err) {
    console.error(`[${device.id}] 日記の生成に失敗。定型文にします:`, err);
    body = fallbackDiaryBody(picture, stats);
    source = "fallback";
  }

  // 同時に動いても1日1行に収める。入らなかったら、もう誰かが書いている
  const { data: inserted, error: insertError } = await supabase
    .from("diary_entries")
    .upsert(
      { device_id: device.id, day, picture, body, stats, source },
      { onConflict: "device_id,day", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) throw insertError;
  return (inserted ?? []).length > 0 ? "written" : "exists";
}

type WeeklyLineResult = "sent" | "sent-text" | "no-line" | "no-entries";

// 会話の履歴（conversation_logs）には入れない。入れると、カードの文が吹き出しに出て、
// 次のセリフの言い回しの参考にもされてしまう
async function pushWeeklyMessage(
  device: Device,
  today: Date,
): Promise<WeeklyLineResult> {
  if (!device.line_user_id) return "no-line";
  const { data, error } = await supabase
    .from("diary_entries")
    .select("day, picture, body")
    .eq("device_id", device.id)
    .gte("day", jstDateKey(new Date(today.getTime() - 6 * DAY_MS)))
    .lte("day", jstDateKey(today))
    .order("day", { ascending: true });
  if (error) throw error;
  const entries = data ?? [];
  if (entries.length === 0) return "no-entries";

  const recordsUrl = device.public_slug
    ? `${APP_URL}/app/records.html?pot=${device.public_slug}`
    : null;
  try {
    await pushLineMessages(device.line_user_id, [
      weeklyDiaryFlex({
        entries,
        imageBaseUrl: `${APP_URL}/app/images/diary`,
        recordsUrl,
      }),
    ]);
    return "sent";
  } catch (err) {
    // カードを LINE に断られても、その週の知らせは届ける。待ちきれなかったときなどは
    // 届いているかもしれず、送り直すとカードと文字の両方が届くので、送り直さない
    if (!isRejectedByLine(err)) throw err;
    console.error(`[${device.id}] 週の日記のカードを送れません:`, err);
    await pushLineMessage(
      device.line_user_id,
      weeklyDiaryMessage({
        pictures: entries.map((entry) => entry.picture),
        recordsUrl,
      }),
    );
    return "sent-text";
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "POSTメソッドのみ対応しています" }, 405);
    }
    if (req.headers.get("x-cron-key") !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "認証エラー" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const backfillDays = Math.min(
      Math.max(0, Math.floor(Number(body?.backfill_days) || 0)),
      MAX_BACKFILL_DAYS,
    );
    const sendWeeklyOnly = body?.send_weekly === true;

    const { data: devices, error } = await supabase
      .from("devices")
      .select(
        "id, plant_name, plant_profile, character_id, created_at, line_user_id, public_slug",
      );
    if (error) throw error;

    const now = new Date();
    const today = jstDayStart(now);
    const results: Record<string, Record<string, DiaryResult | string>> = {};

    for (const device of (devices ?? []) as Device[]) {
      const deviceResults: Record<string, DiaryResult | string> = {};
      results[device.plant_name] = deviceResults;
      if (!sendWeeklyOnly) {
        // 古い日から書くと、新しい日の文が前の日の文と重ならないように書ける
        const newestBack = backfillDays > 0 ? 1 : 0;
        for (let back = backfillDays; back >= newestBack; back--) {
          const dayStart = new Date(today.getTime() - back * DAY_MS);
          const day = jstDateKey(dayStart);
          try {
            deviceResults[day] = await writeDiary(device, dayStart, now);
          } catch (err) {
            // 1日・1台失敗しても、ほかは続ける
            console.error(`[${device.id}] ${day} の日記でエラー:`, err);
            deviceResults[day] = `エラー: ${err}`;
          }
        }
      }

      const wroteTodayOnSunday =
        deviceResults[jstDateKey(today)] === "written" &&
        isSundayJst(now);
      if (sendWeeklyOnly || wroteTodayOnSunday) {
        try {
          deviceResults.weekly_line = await pushWeeklyMessage(device, today);
        } catch (err) {
          console.error(`[${device.id}] 週の日記の LINE に失敗:`, err);
          deviceResults.weekly_line = `エラー: ${err}`;
        }
      }
    }

    return json({ ok: true, results });
  } catch (err) {
    console.error("daily-diary 予期しないエラー:", err);
    return json({ error: "日記の作成に失敗しました" }, 500);
  }
});
