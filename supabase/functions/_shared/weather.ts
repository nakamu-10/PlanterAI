// 今日の天気（Open-Meteo）。日照不足が天気のせいかを見分けるのに使う。
// 鍵が要らず無料。場所は環境変数で渡し、設定がなければ天気を見ずにこれまでどおり判定する。

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 5_000;

// 晴れの日は日の出から日の入りの9割以上に日が差す。半分に届かなければ曇りか雨の日とみなす
const SUNNY_RATIO = 0.5;

export interface Place {
  latitude: number;
  longitude: number;
}

export interface TodayWeather {
  sunshineHours: number;
  daylightHours: number;
  /** WMO の天気コード（61〜67 は雨、71〜77 は雪など） */
  code: number;
}

export function placeFrom(
  latitude: string | undefined,
  longitude: string | undefined,
): Place | null {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (
    !latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lon)
  ) {
    return null;
  }
  return { latitude: lat, longitude: lon };
}

export function parseTodayWeather(body: unknown): TodayWeather | null {
  const daily = (body as {
    daily?: {
      sunshine_duration?: unknown[];
      daylight_duration?: unknown[];
      weather_code?: unknown[];
    };
  } | null)?.daily;
  const sunshine = Number(daily?.sunshine_duration?.[0]);
  const daylight = Number(daily?.daylight_duration?.[0]);
  const code = Number(daily?.weather_code?.[0]);
  if (![sunshine, daylight, code].every(Number.isFinite) || daylight <= 0) {
    return null;
  }
  return {
    sunshineHours: sunshine / 3600,
    daylightHours: daylight / 3600,
    code,
  };
}

/** 日が差した時間が、日の出から日の入りの半分に届かない日 */
export function isDimDay(weather: TodayWeather): boolean {
  return weather.sunshineHours < weather.daylightHours * SUNNY_RATIO;
}

/** セリフに渡す天気の言い方 */
export function describeWeather(weather: TodayWeather): string {
  if (weather.code >= 71 && weather.code <= 77) return "雪";
  if (weather.code >= 51) return "雨";
  return "くもり";
}

/** 取れなかったときは null。天気が分からなくても、日照の判定は止めない */
export async function fetchTodayWeather(
  place: Place,
  fetchFn: typeof fetch = fetch,
): Promise<TodayWeather | null> {
  const url = `${FORECAST_URL}?latitude=${place.latitude}` +
    `&longitude=${place.longitude}` +
    "&daily=sunshine_duration,daylight_duration,weather_code" +
    "&timezone=Asia%2FTokyo&forecast_days=1";
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[weather] HTTP ${res.status}`);
      return null;
    }
    return parseTodayWeather(await res.json());
  } catch (error) {
    console.error("[weather] 天気を取れませんでした:", error);
    return null;
  }
}
