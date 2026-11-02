import type { RawReading } from "./normalize.ts";

type ValidationResult =
  | { ok: true; reading: RawReading }
  | { ok: false; error: string };

const SENSOR_RANGES = {
  soil_adc: { min: 0, max: 4095 },
  temp: { min: -40, max: 85 },
  humidity: { min: 0, max: 100 },
  lux: { min: 0, max: 200_000 },
  pressure: { min: 300, max: 1100 },
  soil_temp: { min: -55, max: 125 },
} as const;

function validateNumber(
  input: Record<string, unknown>,
  key: keyof typeof SENSOR_RANGES,
  required: boolean,
): string | null {
  const value = input[key];
  if (value === undefined && !required) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${key} は有限の数値である必要があります`;
  }

  const { min, max } = SENSOR_RANGES[key];
  if (value < min || value > max) {
    return `${key} が物理範囲外です（${min}〜${max}）`;
  }
  return null;
}

// BME280（気温・湿度・気圧）は間欠的に読み取りに失敗する。そのたびに
// POST 全体を拒否すると、土壌水分・照度まで捨てて水切れを見逃すので、
// 欠落・null・数値でない・物理範囲外の値は 400 にせず null（欠測）として受け取る。
// 故障時の固定値（全項目0、h=100.0 など）の判定は normalize.ts の isBme280Ok が担う。
function bme280Value(
  input: Record<string, unknown>,
  key: "temp" | "humidity" | "pressure",
): number | null {
  return validateNumber(input, key, true) === null
    ? input[key] as number
    : null;
}

export function validateRawReading(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: "リクエストボディはJSONオブジェクトである必要があります",
    };
  }

  const record = input as Record<string, unknown>;
  for (const key of ["soil_adc", "lux"] as const) {
    const error = validateNumber(record, key, true);
    if (error) return { ok: false, error };
  }
  const soilTempError = validateNumber(record, "soil_temp", false);
  if (soilTempError) return { ok: false, error: soilTempError };

  return {
    ok: true,
    reading: {
      soil_adc: record.soil_adc as number,
      temp: bme280Value(record, "temp"),
      humidity: bme280Value(record, "humidity"),
      lux: record.lux as number,
      ...(record.pressure === undefined
        ? {}
        : { pressure: bme280Value(record, "pressure") }),
      ...(record.soil_temp === undefined
        ? {}
        : { soil_temp: record.soil_temp as number }),
    },
  };
}
