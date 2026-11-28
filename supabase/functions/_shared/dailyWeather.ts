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
  WindowWeather,
  windowWeather,
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

/**
 * アプリの部屋の窓に出す、今日の天気。ingest-sensor が覚えた予報を読むだけで、Open-Meteo には
 * 問い合わせない（開くたびに取りに行かない）。場所が未設定・まだ取れていない・読めないときは null
 */
export async function readWindowWeather(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<WindowWeather | null> {
  const place = placeFrom(
    Deno.env.get("WEATHER_LATITUDE"),
    Deno.env.get("WEATHER_LONGITUDE"),
  );
  if (!place) return null;
  const { data, error } = await supabase
    .from("daily_weather")
    .select("sunshine_hours, daylight_hours, weather_code")
    .match({ local_date: jstDateKey(now), ...place })
    .maybeSingle();
  // 窓の飾りなので、読めなくてもホームは出す
  if (error) {
    console.error("[weather] 窓の天気の読み込みに失敗:", error);
    return null;
  }
  return data ? windowWeather(weatherFromRow(data)) : null;
}
