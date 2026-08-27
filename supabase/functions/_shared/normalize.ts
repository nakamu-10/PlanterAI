// ============================================================
// normalize.ts — Layer 1: 正規化レイヤー
//
// 役割:
//   1. 中央値フィルタで瞬間的なノイズ・異常値を除去（ソフトウェア冗長化）
//   2. センサー値を植物プロファイルの閾値に基づき 0〜100 の快適スコアに変換
// ============================================================

import { PlantProfile, SensorThresholds, soilAdcToPercent } from "./config.ts";

// ESP32が送ってくる生値の形
export interface RawReading {
  soil_adc: number; // SEN0193のADC生値（GPIO34）
  temp: number; // BME280 気温（℃）
  humidity: number; // BME280 空気湿度（%）※v3でスコア化・主訴化に使用
  pressure?: number; // BME280 気圧（hPa）※ログ用
  lux: number; // BH1750 照度
  soil_temp?: number; // DS18B20 土壌温度（オプション）
}

// フィルタ・単位変換後の値
export interface FilteredReading {
  moisture_pct: number; // 土壌水分%
  temp: number;
  lux: number;
  humidity_pct: number; // 空気湿度%（BME280）
}

export interface ComfortScores {
  moisture: number; // 0〜100
  temp: number;
  light: number;
  humidity: number; // 空気湿度の快適スコア（0〜100）
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
export function applyMedianFilter(
  history: RawReading[], // 中央値なので順序不問
  current: RawReading,
): FilteredReading {
  const all = [...history, current];
  return {
    moisture_pct: soilAdcToPercent(median(all.map((r) => r.soil_adc))),
    temp: median(all.map((r) => r.temp)),
    lux: median(all.map((r) => r.lux)),
    humidity_pct: median(all.map((r) => r.humidity)),
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
    if (value >= t.cautionLow) {
      return lerp(value, t.cautionLow, t.comfortLow, 50, 100);
    }
    if (value >= t.dangerLow) {
      return lerp(value, t.dangerLow, t.cautionLow, 0, 50);
    }
    return 0;
  }

  // 高い側（対称）
  if (value <= t.cautionHigh) {
    return lerp(value, t.comfortHigh, t.cautionHigh, 100, 50);
  }
  if (value <= t.dangerHigh) {
    return lerp(value, t.cautionHigh, t.dangerHigh, 50, 0);
  }
  return 0;
}

// 線形補間: x が [x0, x1] のとき y を [y0, y1] で対応させる
function lerp(
  x: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  if (x1 === x0) return y0; // 閾値設定ミスでもゼロ除算しないよう保険
  const ratio = (x - x0) / (x1 - x0);
  return Math.round(y0 + ratio * (y1 - y0));
}

// フィルタ済みの値 → 各センサーの快適スコア
export function toComfortScores(
  f: FilteredReading,
  profile: PlantProfile,
): ComfortScores {
  return {
    moisture: toScore(f.moisture_pct, profile.moisture),
    temp: toScore(f.temp, profile.temp),
    light: toScore(f.lux, profile.light),
    humidity: toScore(f.humidity_pct, profile.humidity),
  };
}
