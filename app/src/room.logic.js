// 部屋の窓・日だまり・ランプ・時計・棚の小物の見た目を、時刻と鉢のデータから決める計算。
// three.js に依存しないので、ここだけテストできる
import { describeLightToday, JST_MS, jstDay, jstHour } from "./home.logic.js";

// 鉢の照度[lx]で、窓の明るさを決める区切り（仮の値）。本番の鉢は、昼の明るい時間で 1000〜2800 lx、
// 曇りや朝夕は 100 lx を下回る。DIM_LUX 以下で一番暗く、BRIGHT_LUX 以上で一番明るい
export const DIM_LUX = 100;
export const BRIGHT_LUX = 1500;

// 照度がこれより古ければ使わない。鉢は約10分おきに送るので、1時間届かなければ止まっている
export const LUX_FRESH_MINUTES = 60;

// 最新のセンサー値の照度。古いとき（ESP32 が止まった夜の 0 lx が翌日も残るなど）と、無いときは null
export function freshLux(sensor, now = Date.now()) {
  const lux = sensor?.filtered?.lux;
  const age = now - Date.parse(sensor?.created_at ?? "");
  if (typeof lux !== "number" || !(age < LUX_FRESH_MINUTES * 60_000)) {
    return null;
  }
  return lux;
}

// 昼・夕方（朝も）・夜を、日本時間の時刻で分ける。区切りは冬（日の入りが16時半ごろ）に合わせた仮の値で、
// 季節では変えない。夏に合わないときは、日の出・日の入りを月ごとに持つ
function phaseOf(hour) {
  if (hour >= 18 || hour < 6) return "night";
  if (hour < 7 || hour >= 16) return "twilight";
  return "day";
}

// lux が分からない（センサーの値が無い、気分を固定した練習など）ときは、明るい日として見せる
export function roomLook({ now = Date.now(), lux = null }) {
  const hour = jstHour(now);
  const phase = phaseOf(hour);
  const daylight = typeof lux === "number" && Number.isFinite(lux)
    ? Math.min(Math.max((lux - DIM_LUX) / (BRIGHT_LUX - DIM_LUX), 0), 1)
    : 1;
  return {
    phase,
    daylight,
    // 日だまりは昼だけ、窓から入る光の強さで濃くする
    sunpatch: phase === "day" ? daylight : 0,
    // ソファでくつろぐ時間（18〜22時）だけ点ける。ベッドで寝る時間は消す
    lamp: hour >= 18 && hour < 22,
  };
}

// 時計の針の角度[rad]。12時の向きから時計回り
export function clockAngles(now = Date.now()) {
  const minutes = ((now + JST_MS) % 86_400_000) / 60_000;
  return {
    hour: ((minutes / 60) % 12) / 12 * Math.PI * 2,
    minute: (minutes % 60) / 60 * Math.PI * 2,
  };
}

// じょうろは、水やりからこの時間だけ棚に出す
export const WATERING_CAN_HOURS = 24;

// 鉢のデータを、毎フレームの判定で使う形にする。読んだときに1回だけ呼ぶ。
// 日照が目標に届いたことは、読んだ日（日本時間）として持つ。読み直せないまま日付が変わったら、
// 前の日のタオルを残さないため
export function roomDataFrom(
  { lux = null, lastWateringAt = null, lightToday = null } = {},
  readAt = Date.now(),
) {
  const wateredAt = Date.parse(lastWateringAt ?? "");
  const reached = lightToday !== null && describeLightToday(lightToday).reached;
  return {
    lux,
    wateredAt: Number.isFinite(wateredAt) ? wateredAt : null,
    lightReachedDay: reached ? jstDay(readAt) : null,
  };
}

// 棚の小物。じょうろは水やりのあと、タオルは今日の日照が目標に届いた日に出す。毎フレーム呼ぶ
export function propsShown({
  now = Date.now(),
  wateredAt = null,
  lightReachedDay = null,
}) {
  const since = wateredAt === null ? NaN : now - wateredAt;
  return {
    wateringCan: since >= 0 && since < WATERING_CAN_HOURS * 3_600_000,
    towel: lightReachedDay === jstDay(now),
  };
}
