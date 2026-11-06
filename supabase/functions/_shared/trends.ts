// アプリの「数値」の画面に出す、推移と先読み。DB に依存しないので、ここだけテストできる
// （app-data と app-public が使う）

import type { PlantProfile } from "./config.ts";
import { integrateLuxHours, jstDayStart } from "./dailyLight.ts";

export interface TrendSensorRow {
  filtered: {
    moisture_pct?: number | null;
    temp?: number | null;
    lux?: number | null;
  } | null;
  created_at: string;
}

export interface HourPoint {
  at: string; // その1時間の始まり
  moisture_pct: number | null;
  temp: number | null;
}

const HOUR_MS = 3_600_000;
// 何時間分の推移を返すか（土の水分の3日間）
export const TREND_HOURS = 72;
// 1回に読む行の上限（Supabase の max_rows と同じ）。DEMO_MODE（5秒おき）だと72時間分は入らないので、
// 新しい順に取って古い方を切る
export const TREND_MAX_ROWS = 1000;
// 乾くペースは、水やりのあとの、この時間までの値から見る
const FORECAST_WINDOW_HOURS = 24;
// これより短い・少ないデータからは、ペースを出さない
const FORECAST_MIN_SPAN_HOURS = 3;
const FORECAST_MIN_POINTS = 6;
// 1時間にこれより減っていなければ、乾いていないとみなす（センサーの揺れを拾わない）
const FORECAST_MIN_DROP_PER_HOUR = 0.05;
// これより先の見込みは、当てにならないので出さない
const FORECAST_MAX_HOURS = 14 * 24;

const mean = (values: number[]) =>
  values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;

// 10分おきの行を全部返すと重いので、1時間ごとの平均にまとめる（古い順）
export function hourlyMeans(
  rows: TrendSensorRow[],
  now: Date,
  hours = TREND_HOURS,
): HourPoint[] {
  const end = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;
  const start = end - hours * HOUR_MS;
  const buckets = Array.from(
    { length: hours },
    () => ({ moisture: [] as number[], temp: [] as number[] }),
  );
  for (const row of rows) {
    const i = Math.floor((Date.parse(row.created_at) - start) / HOUR_MS);
    if (i < 0 || i >= hours) continue;
    const m = row.filtered?.moisture_pct;
    const t = row.filtered?.temp;
    if (typeof m === "number") buckets[i].moisture.push(m);
    if (typeof t === "number") buckets[i].temp.push(t);
  }
  return buckets.map((b, i) => ({
    at: new Date(start + i * HOUR_MS).toISOString(),
    moisture_pct: mean(b.moisture),
    temp: mean(b.temp),
  }));
}

// 乾くまでの見込み。
//   dry     : もう threshold を下回っている
//   drying  : このペースだと hours 時間後に下回る
//   steady  : 乾いていない（減り方が小さい、または2週間より先）
//   unknown : データが足りず、見込みを出せない（鉢が送っていない、水やりの直後など）
export type DryingForecast =
  | { status: "dry" }
  | { status: "drying"; hours: number }
  | { status: "steady" }
  | { status: "unknown" };

// 水やりの検出は生の値だが、filtered は直近5点の中央値なので、追いつくまで数点は
// 水やり前の乾いた値が残る。その行を混ぜると傾きが大きく狂うので、この時間は飛ばす
const WATERING_SETTLE_MINUTES = 40;

// 水やりのあと（最大24時間）の値に直線を当てはめ、その傾きで先を読む
export function forecastDrying(
  samples: { at: string; value: number }[],
  threshold: number,
  now: Date,
  lastWateringAt: Date | null,
): DryingForecast {
  const from = Math.max(
    now.getTime() - FORECAST_WINDOW_HOURS * HOUR_MS,
    lastWateringAt
      ? lastWateringAt.getTime() + WATERING_SETTLE_MINUTES * 60_000
      : -Infinity,
  );
  const pts = samples
    .map((s) => ({
      t: (Date.parse(s.at) - now.getTime()) / HOUR_MS,
      v: s.value,
    }))
    .filter((p) => p.t >= (from - now.getTime()) / HOUR_MS && p.t <= 0);
  if (pts.length < FORECAST_MIN_POINTS) return { status: "unknown" };
  const span = Math.max(...pts.map((p) => p.t)) -
    Math.min(...pts.map((p) => p.t));
  if (span < FORECAST_MIN_SPAN_HOURS) return { status: "unknown" };

  const mt = mean(pts.map((p) => p.t))!;
  const mv = mean(pts.map((p) => p.v))!;
  const slope = pts.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0) /
    pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
  // 今（t=0）の値は、当てはめた直線の上で見る（1点の揺れに引っぱられない）
  const current = mv - slope * mt;
  if (current <= threshold) return { status: "dry" };
  if (slope > -FORECAST_MIN_DROP_PER_HOUR) return { status: "steady" };
  const hours = (current - threshold) / -slope;
  if (hours > FORECAST_MAX_HOURS) return { status: "steady" };
  // 0 は「もう下回っている」と紛れるので、30分未満も1時間と言う
  return { status: "drying", hours: Math.max(1, Math.round(hours)) };
}

export function buildTrends(
  rows: TrendSensorRow[],
  profile: PlantProfile | undefined,
  lastWateringAt: string | null,
  now: Date = new Date(),
) {
  // 関数より先に新しい植物の鉢を作ったときなど。推移が無くても画面のほかは出せる
  if (!profile) return null;

  // 新しい順に取ってくるので、古い順に並べ直す（日照の積算は時刻の順に足す）
  rows = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const moistureSamples = rows
    .filter((r) => typeof r.filtered?.moisture_pct === "number")
    .map((r) => ({ at: r.created_at, value: r.filtered!.moisture_pct! }));
  const dayStart = jstDayStart(now);
  const luxSamples = rows
    .filter((r) => typeof r.filtered?.lux === "number")
    .map((r) => ({ at: r.created_at, lux: r.filtered!.lux! }));

  return {
    hourly: hourlyMeans(rows, now),
    moisture: {
      danger_low: profile.moisture.dangerLow,
      comfort_low: profile.moisture.comfortLow,
      comfort_high: profile.moisture.comfortHigh,
      // 数値の画面の帯と同じ「快適の下限」を基準にする
      forecast: forecastDrying(
        moistureSamples,
        profile.moisture.comfortLow,
        now,
        lastWateringAt ? new Date(lastWateringAt) : null,
      ),
    },
    temp: {
      comfort_low: profile.temp.comfortLow,
      comfort_high: profile.temp.comfortHigh,
    },
    humidity: {
      comfort_low: profile.humidity.comfortLow,
      comfort_high: profile.humidity.comfortHigh,
    },
    light_today: {
      lux_hours: Math.round(
        integrateLuxHours(luxSamples, dayStart, now).luxHours,
      ),
      target: profile.lightDaily.comfortLow,
    },
  };
}
