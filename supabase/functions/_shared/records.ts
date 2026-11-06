// アプリの「記録」のページに返すもの（app-data と app-public が使う）。
// 会話は人が書いた文も含めて返すので、鍵なしで返すときは呼ぶ側で絞ること（app-public/view.ts）

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jstDateKey, jstDayStart } from "./dailyLight.ts";
import { describeMoodChanges, moodShares, wateringByDay } from "./diary.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
// 週のふりかえりとカレンダーで、5週間分を見られるようにする
const RECORD_DAYS = 35;
const MOOD_CHANGES = 20;
// 鍵なしでは人への返事を飛ばすので、見せる数より多めに読む
export const RECORD_CONVERSATION_ROWS = 60;

export async function fetchRecords(
  supabase: SupabaseClient,
  deviceId: string,
  now: Date = new Date(),
) {
  const todayStart = jstDayStart(now);
  const since = new Date(todayStart.getTime() - (RECORD_DAYS - 1) * DAY_MS);

  const [
    diaryResult,
    wateringResult,
    changesResult,
    todayMoodResult,
    conversationResult,
  ] = await Promise.all([
    supabase
      .from("diary_entries")
      .select("day, picture, body, stats")
      .eq("device_id", deviceId)
      .gte("day", jstDateKey(since))
      .order("day", { ascending: false }),
    supabase
      .from("watering_events")
      .select("created_at")
      .eq("device_id", deviceId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
    // 通知した行が、気分が変わったところ
    supabase
      .from("emotion_logs")
      .select("emotion, complaint, created_at")
      .eq("device_id", deviceId)
      .eq("notified", true)
      .order("created_at", { ascending: false })
      .limit(MOOD_CHANGES),
    supabase
      .from("emotion_logs")
      .select("emotion, complaint, created_at, daily_light:scores->daily_light")
      .eq("device_id", deviceId)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("conversation_logs")
      .select("role, message, emotion, created_at")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(RECORD_CONVERSATION_ROWS),
  ]);

  if (diaryResult.error) throw diaryResult.error;
  if (wateringResult.error) throw wateringResult.error;
  if (changesResult.error) throw changesResult.error;
  if (todayMoodResult.error) throw todayMoodResult.error;
  if (conversationResult.error) throw conversationResult.error;

  return {
    today: jstDateKey(now),
    diary: diaryResult.data ?? [],
    watering_days: wateringByDay(wateringResult.data ?? []),
    mood_changes: describeMoodChanges(changesResult.data ?? []),
    today_moods: moodShares(todayMoodResult.data ?? [], now).moods,
    conversation: conversationResult.data ?? [],
  };
}
