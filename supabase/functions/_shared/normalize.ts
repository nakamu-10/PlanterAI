// ============================================================
// normalize.ts — Layer 1: 正規化レイヤー
//
// 役割:
//   1. 物理的にあり得ない値・欠測の棄却（センサー読み取り失敗の検知）
//   2. 中央値フィルタで瞬間的なノイズ・異常値を除去（ソフトウェア冗長化）
//   3. センサー値を植物プロファイルの閾値に基づき 0〜100 の快適スコアに変換
//
// ★v4: BME280（気温・空気湿度）の読み取り失敗に対応した。
//   実機のBME280は電源・I2Cの不安定で間欠的にリセットし、レジスタ初期値の
//   固定ゴミ（t=180.1 / h=100.0 / p=-154.x）を返すことが確認されている。
//   さらに2026-08-27時点の実機はBME280が未接続で【全項目0を返し続けている】。
//   ESP32側にもガードはあるが、サーバーは端末を信用せずここでも棄却する。
//
//   棄却された項目は null（＝欠測）として下流に渡る。Layer 2 はその
//   センサーの主訴を出さず、土壌水分・照度だけで判定を続行する。
//   「壊れたセンサーの値で誤った主訴を出す」より「見えないものは黙る」を選ぶ。
// ============================================================

import { PlantProfile, SensorThresholds, soilAdcToPercent } from "./config.ts";

// 欠測しうるセンサー項目（BME280由来の2つ）
export type MissingSensor = "temp" | "humidity";

// ESP32が送ってくる生値の形。
// BME280が読めなかった場合、temp / humidity は null（またはキー欠落、
// あるいはガードをすり抜けた異常値）で届きうる。
export interface RawReading {
  soil_adc: number;             // SEN0193のADC生値（GPIO34）
  temp: number | null;          // BME280 気温（℃）※読み取り失敗時 null
  humidity: number | null;      // BME280 空気湿度（%）※読み取り失敗時 null
  pressure?: number | null;     // BME280 気圧（hPa）※ログ用
  lux: number;                  // BH1750 照度
  soil_temp?: number | null;    // DS18B20 土壌温度（オプション）
}

// フィルタ・単位変換後の値
export interface FilteredReading {
  moisture_pct: number;         // 土壌水分%
  temp: number | null;          // 欠測時 null
  lux: number;
  humidity_pct: number | null;  // 空気湿度%（BME280）※欠測時 null
  missing: MissingSensor[];     // 欠測した項目（空配列＝全センサー正常）
}

export interface ComfortScores {
  moisture: number;             // 0〜100
  temp: number | null;          // 欠測時 null
  light: number;
  humidity: number | null;      // 空気湿度の快適スコア ※欠測時 null
}

// ------------------------------------------------------------
// 物理的な妥当範囲（センサー故障の検知）
//
// 「植物にとって快適か」の閾値（config.ts）とは目的が違う。ここは
// 「そもそもセンサーが読めているか」を判定するための範囲であり、
// 屋内では到底あり得ない値だけを弾く。ESP32ファーム側のガードと
// 同じ基準に揃えてあるので、どちらが先に弾いても結果は変わらない。
// ------------------------------------------------------------
export const PLAUSIBLE_RANGE = {
  temp: { min: -20, max: 60 },      // これを外れる室温はあり得ない（故障ゴミは 180.1）
  humidity: { min: 0, max: 100 },   // 下記の通り両端は「ちょうど」でも棄却する
  pressure: { min: 300, max: 1100 }, // hPa（故障ゴミは -154.x）
} as const;

export function isValidTemp(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) &&
    v >= PLAUSIBLE_RANGE.temp.min && v <= PLAUSIBLE_RANGE.temp.max;
}

// 湿度は 0.0 / 100.0 ちょうどを棄却する（両端は開区間）。
// 実環境で厳密に 0% や 100% が出ることはまずなく、BME280が
// スリープに落ちたときの固定ゴミがまさに h=100.0 だったため。
export function isValidHumidity(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) &&
    v > PLAUSIBLE_RANGE.humidity.min && v < PLAUSIBLE_RANGE.humidity.max;
}

export function isValidPressure(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) &&
    v >= PLAUSIBLE_RANGE.pressure.min && v <= PLAUSIBLE_RANGE.pressure.max;
}

// ------------------------------------------------------------
// BME280が読めているか（★チップ単位の判定★）
//
// 気温・湿度・気圧は同一チップの同一読み取りから来る。1項目でも壊れて
// いれば残りも信用できないので、項目ごとに拾わず「読めた / 読めなかった」
// をチップ単位で決める（all-or-nothing）。
//
// なぜ値ごとの範囲判定では足りないか:
//   未接続のBME280は【全項目0】を返す。気温 0℃ は妥当範囲(-20〜60)に
//   入ってしまうため、値ごとの判定だと「0℃の実測値」として通過する。
//   0℃ は危険域（urgency=high）なので、Layer 2 の緊急度ソートで常に
//   最優先となり、本命の「水分不足」が主訴として出てこなくなる。
//   ＝センサー故障が植物の不調を隠す。チップ単位の判定はこれを防ぐ。
// ------------------------------------------------------------
export function isBme280Ok(r: Partial<RawReading> | null | undefined): boolean {
  if (!r) return false;

  const isZero = (v: unknown) => typeof v === "number" && v === 0;
  const pressureAbsent = r.pressure === undefined || r.pressure === null;

  // 全ゼロ = 未接続、またはチップがリセットしたまま初期値を返している
  if (isZero(r.temp) && isZero(r.humidity) && (pressureAbsent || isZero(r.pressure))) {
    return false;
  }
  // 個々の値の物理妥当性（固定ゴミ t=180.1 / h=100.0 / p=-154.x を弾く）
  if (!isValidTemp(r.temp) || !isValidHumidity(r.humidity)) return false;
  if (!pressureAbsent && !isValidPressure(r.pressure)) return false;

  return true;
}

// ------------------------------------------------------------
// 中央値フィルタ
// 直近の値（DBから取得した過去分 + 今回の値）の中央値を返す。
// センサーの瞬間的なバグ値（例: 接触不良で一瞬0になる）を1回で反映させない。
// ------------------------------------------------------------
export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median: 空配列です");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// 過去の生値ログ配列 + 今回の生値 → フィルタ済みの値
//
// 重要: 異常値は「中央値に混ぜてから薄める」のではなく、その手前で捨てる。
// 混ぜる方式だと、過去ログに残ったゴミを追い出すのに窓5件中3件のきれいな値が
// 必要になり、BME280が復旧しても数サイクル誤判定が続く（実機で発生した事象）。
// 先に捨てておけば、正常値が1件届いた時点で即座に正しい判定へ復帰する。
export function applyMedianFilter(
  history: RawReading[], // 中央値なので順序不問
  current: RawReading,
): FilteredReading {
  const all = [...history, current];

  // BME280は読めた回のサンプルだけを使う（気温だけ拾う、はしない）
  const bmeOk = all.filter((r) => isBme280Ok(r));
  const temp = bmeOk.length === 0 ? null : median(bmeOk.map((r) => r.temp as number));
  const humidity_pct = bmeOk.length === 0
    ? null
    : median(bmeOk.map((r) => r.humidity as number));

  const missing: MissingSensor[] = [];
  if (temp === null) missing.push("temp");
  if (humidity_pct === null) missing.push("humidity");

  return {
    moisture_pct: soilAdcToPercent(median(all.map((r) => r.soil_adc))),
    temp,
    lux: median(all.map((r) => r.lux)),
    humidity_pct,
    missing,
  };
}

// ------------------------------------------------------------
// 快適スコア変換
// 閾値6点に対する区分線形（piecewise linear）変換:
//   快適レンジ内            → 100
//   快適境界〜注意境界の間  → 100 → 50 に線形減少
//   注意境界〜危険境界の間  → 50 → 0 に線形減少
//   危険境界の外            → 0
// ------------------------------------------------------------
export function toScore(value: number, t: SensorThresholds): number {
  if (value >= t.comfortLow && value <= t.comfortHigh) return 100;

  // 低い側
  if (value < t.comfortLow) {
    if (value >= t.cautionLow) return lerp(value, t.cautionLow, t.comfortLow, 50, 100);
    if (value >= t.dangerLow) return lerp(value, t.dangerLow, t.cautionLow, 0, 50);
    return 0;
  }

  // 高い側（対称）
  if (value <= t.cautionHigh) return lerp(value, t.comfortHigh, t.cautionHigh, 100, 50);
  if (value <= t.dangerHigh) return lerp(value, t.cautionHigh, t.dangerHigh, 50, 0);
  return 0;
}

// 線形補間: x が [x0, x1] のとき y を [y0, y1] で対応させる
function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0; // 閾値設定ミスでもゼロ除算しないよう保険
  const ratio = (x - x0) / (x1 - x0);
  return Math.round(y0 + ratio * (y1 - y0));
}

// フィルタ済みの値 → 各センサーの快適スコア
// 欠測（null）の項目はスコアも null にする。0 にしてはいけない:
// 0 は「危険域」を意味してしまい、故障が最悪の主訴として発火する。
export function toComfortScores(f: FilteredReading, profile: PlantProfile): ComfortScores {
  return {
    moisture: toScore(f.moisture_pct, profile.moisture),
    temp: f.temp === null ? null : toScore(f.temp, profile.temp),
    light: toScore(f.lux, profile.light),
    humidity: f.humidity_pct === null ? null : toScore(f.humidity_pct, profile.humidity),
  };
}
