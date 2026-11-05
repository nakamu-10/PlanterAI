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

// 土の水分が、このペースだと何時間後に threshold を下回るか。
// 水やりのあと（最大24時間）の値に直線を当てはめ、その傾きで先を読む。
// 乾いていない・データが足りない・遠すぎるときは null、もう下回っていれば 0
export function hoursUntilBelow(
  samples: { at: string; value: number }[],
  threshold: number,
  now: Date,
  since: Date | null,
): number | null {
  const from = Math.max(
    now.getTime() - FORECAST_WINDOW_HOURS * HOUR_MS,
    since?.getTime() ?? -Infinity,
  );
  const pts = samples
    .map((s) => ({
      t: (Date.parse(s.at) - now.getTime()) / HOUR_MS,
      v: s.value,
    }))
    .filter((p) => p.t >= (from - now.getTime()) / HOUR_MS && p.t <= 0);
  if (pts.length < FORECAST_MIN_POINTS) return null;
  const span = Math.max(...pts.map((p) => p.t)) -
    Math.min(...pts.map((p) => p.t));
  if (span < FORECAST_MIN_SPAN_HOURS) return null;

  const mt = mean(pts.map((p) => p.t))!;
  const mv = mean(pts.map((p) => p.v))!;
  const slope = pts.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0) /
    pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
  // 今（t=0）の値は、当てはめた直線の上で見る（1点の揺れに引っぱられない）
  const current = mv - slope * mt;
  if (current <= threshold) return 0;
  if (slope > -FORECAST_MIN_DROP_PER_HOUR) return null;
  const hours = (current - threshold) / -slope;
  return hours > FORECAST_MAX_HOURS ? null : Math.round(hours);
}

export function buildTrends(
  rows: TrendSensorRow[],
  profile: PlantProfile,
  lastWateringAt: string | null,
  now: Date = new Date(),
) {
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
      // 快適の下限を割ると、カラ美がのどの渇きを訴え始める
      hours_to_dry: hoursUntilBelow(
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
    light_today: {
      lux_hours: Math.round(
        integrateLuxHours(luxSamples, dayStart, now).luxHours,
      ),
      target: profile.lightDaily.comfortLow,
    },
  };
}
