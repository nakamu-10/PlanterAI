import {
  SOIL_CALIBRATION,
  soilAdcToPercent,
  WATERING_RISE_PCT,
} from "./config.ts";
import { median } from "./normalize.ts";
import type { RawReading } from "./normalize.ts";

export interface Watering {
  before: number; // 直前の数点の土の水分%（中央値）
  after: number; // 今回の土の水分%
}

// 水中の値より大きく低い読み取りは、接触不良などの異常値とみなす。
// 一瞬 0 が届いただけで「100% に上がった」と誤検出すると、その後10分は
// 本物の水やりも数えられなくなるため
const SOIL_ADC_FLOOR = SOIL_CALIBRATION.waterValue - 300;

// 直前の数点より土の水分が大きく上がったら、水やりとみなす。
// 中央値フィルタを通すと数点遅れるので、今回の生の値で比べる
export function detectWatering(
  history: RawReading[],
  current: RawReading,
): Watering | null {
  if (history.length === 0 || current.soil_adc < SOIL_ADC_FLOOR) return null;
  const before = soilAdcToPercent(median(history.map((r) => r.soil_adc)));
  const after = soilAdcToPercent(current.soil_adc);
  return after - before >= WATERING_RISE_PCT ? { before, after } : null;
}
