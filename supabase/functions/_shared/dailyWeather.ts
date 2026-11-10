// 今日の天気を daily_weather に覚えておく（Open-Meteo の予報）。
// ingest-sensor から毎サイクル呼び、0時と12時の枠ごとに1回だけ取り直す。
// 取りそこねても、前の枠の予報が残っていればそれを使う。

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jstDateKey } from "./dailyLight.ts";
import {
  fetchTodayWeather,
  needsNewForecast,
  placeFrom,
  TodayWeather,
  weatherFromRow,
  weatherToRow,
} from "./weather.ts";

/** 場所が未設定なら null（天気を見ずに判定する）。設定してあって今日の分が1度も取れていなければ "unavailable" */
export type WeatherLookup = TodayWeather | null | "unavailable";

export async function loadTodayWeather(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<WeatherLookup> {
  const place = placeFrom(
    Deno.env.get("WEATHER_LATITUDE"),
    Deno.env.get("WEATHER_LONGITUDE"),
  );
  if (!place) return null;

  const key = { local_date: jstDateKey(now), ...place };
  const { data: saved, error: readError } = await supabase
    .from("daily_weather")
    .select("sunshine_hours, daylight_hours, weather_code, fetched_at")
    .match(key)
    .maybeSingle();
  if (readError) throw readError;
  if (saved && !needsNewForecast(new Date(saved.fetched_at), now)) {
    return weatherFromRow(saved);
  }

  const fetched = await fetchTodayWeather(place);
  if (!fetched) return saved ? weatherFromRow(saved) : "unavailable";

  const { error: saveError } = await supabase
    .from("daily_weather")
    .upsert({
      ...key,
      ...weatherToRow(fetched),
      fetched_at: now.toISOString(),
    }, { onConflict: "local_date,latitude,longitude" });
  if (saveError) console.error("[weather] 天気の保存に失敗:", saveError);
  return fetched;
}
