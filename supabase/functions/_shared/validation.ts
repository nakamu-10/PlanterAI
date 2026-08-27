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

export function validateRawReading(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: "リクエストボディはJSONオブジェクトである必要があります",
    };
  }

  const record = input as Record<string, unknown>;
  for (const key of ["soil_adc", "temp", "humidity", "lux"] as const) {
    const error = validateNumber(record, key, true);
    if (error) return { ok: false, error };
  }
  for (const key of ["pressure", "soil_temp"] as const) {
    const error = validateNumber(record, key, false);
    if (error) return { ok: false, error };
  }

  return {
    ok: true,
    reading: {
      soil_adc: record.soil_adc as number,
      temp: record.temp as number,
      humidity: record.humidity as number,
      lux: record.lux as number,
      ...(record.pressure === undefined
        ? {}
        : { pressure: record.pressure as number }),
      ...(record.soil_temp === undefined
        ? {}
        : { soil_temp: record.soil_temp as number }),
    },
  };
}
