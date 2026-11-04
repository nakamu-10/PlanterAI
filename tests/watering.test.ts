// 水やりの検出（detectWatering）の検証
// 実行: npx tsx tests/watering.test.ts
import { soilAdcToPercent } from "../supabase/functions/_shared/config.ts";
import type { RawReading } from "../supabase/functions/_shared/normalize.ts";
import { detectWatering } from "../supabase/functions/_shared/watering.ts";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

// 土の水分%から、その値になる ADC 生値の読み取りを作る（空気中 2845 / 水中 1490）
const reading = (pct: number): RawReading =>
  ({
    soil_adc: Math.round(2845 - (2845 - 1490) * pct / 100),
    lux: 500,
  }) as RawReading;
const dry = [reading(20), reading(21), reading(19), reading(20)];

{
  const w = detectWatering(dry, reading(60));
  assert("20% → 60% は水やり", w !== null);
  assert(
    "前後の水分を返す",
    w !== null && Math.abs(w.before - 20) < 1 && Math.abs(w.after - 60) < 1,
  );
}
assert("20% → 25% は水やりではない", detectWatering(dry, reading(25)) === null);
assert(
  "乾いていく途中は水やりではない",
  detectWatering(dry, reading(15)) === null,
);
assert(
  "比べる点がなければ判定しない",
  detectWatering([], reading(60)) === null,
);
assert(
  "1点だけの外れ値に引っぱられない（直前の点は中央値で見る）",
  detectWatering([reading(20), reading(70), reading(20)], reading(30)) === null,
);
assert(
  "接触不良で一瞬 0 が届いても、水やりとみなさない",
  detectWatering(dry, { soil_adc: 0, lux: 500 } as RawReading) === null,
);
assert(
  "水中に近い値（水をたっぷりやった）は水やりとみなす",
  detectWatering(dry, { soil_adc: 1450, lux: 500 } as RawReading) !== null,
);
assert("換算の前提（ADC 1490 で 100%）", soilAdcToPercent(1490) === 100);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
