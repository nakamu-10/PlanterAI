// アプリの「数値」の画面の推移と先読み（supabase/functions/_shared/trends.ts）の検証
// 実行: npx tsx tests/trends.test.ts
import {
  buildTrends,
  hourlyMeans,
  hoursUntilBelow,
} from "../supabase/functions/_shared/trends.ts";
import { PLANT_PROFILES } from "../supabase/functions/_shared/config.ts";

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

const now = new Date("2026-11-06T03:30:00Z"); // 日本時間 12:30
const ago = (hours: number) =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();

// 10分おきに、1時間に perHour ずつ減っていく土の水分
function drying(startValue: number, perHour: number, hours: number) {
  const out = [];
  for (let m = hours * 60; m >= 0; m -= 10) {
    out.push({
      at: ago(m / 60),
      value: startValue - perHour * (hours - m / 60),
    });
  }
  return out;
}

console.log("--- 1時間ごとの平均 ---");
{
  const rows = [
    { filtered: { moisture_pct: 60, temp: 20 }, created_at: ago(0.2) },
    { filtered: { moisture_pct: 62, temp: 22 }, created_at: ago(0.4) },
    { filtered: { moisture_pct: 70, temp: null }, created_at: ago(5) },
    { filtered: null, created_at: ago(5.1) },
    { filtered: { moisture_pct: 99, temp: 30 }, created_at: ago(80) },
  ];
  const hourly = hourlyMeans(rows, now);
  const last = hourly[hourly.length - 1];
  assert("72時間分の点を返す", hourly.length === 72);
  assert(
    "同じ1時間の値は平均する",
    last.moisture_pct === 61 && last.temp === 21,
    JSON.stringify(last),
  );
  assert(
    "温度が欠測の時間は null",
    hourly.some((h) => h.moisture_pct === 70 && h.temp === null),
  );
  assert(
    "データの無い時間は null",
    hourly[0].moisture_pct === null && hourly[0].temp === null,
  );
  assert(
    "72時間より前の行は入れない",
    !hourly.some((h) => h.moisture_pct === 99),
  );
}

console.log("--- 乾くまでの見込み ---");
assert(
  "1時間に1%ずつ減り、今60%なら、50%まで約10時間",
  hoursUntilBelow(drying(70, 1, 10), 50, now, null) === 10,
  String(hoursUntilBelow(drying(70, 1, 10), 50, now, null)),
);
assert(
  "もう下回っていれば 0",
  hoursUntilBelow(drying(55, 1, 10), 50, now, null) === 0,
);
assert(
  "減っていなければ出さない",
  hoursUntilBelow(drying(70, 0, 10), 50, now, null) === null,
);
assert(
  "データが3時間より短ければ出さない",
  hoursUntilBelow(drying(70, 1, 2), 50, now, null) === null,
);
assert(
  "2週間より先なら出さない",
  hoursUntilBelow(drying(90, 0.1, 10), 50, now, null) === null,
);
{
  // 水やりの前は乾いていて、水やりで跳ね上がり、そのあとはゆっくり乾く
  const before = drying(40, 2, 20).map((s) => ({
    ...s,
    at: new Date(Date.parse(s.at) - 10.5 * 3_600_000).toISOString(),
  }));
  const after = drying(80, 0.5, 10);
  const hours = hoursUntilBelow(
    [...before, ...after],
    50,
    now,
    new Date(ago(10)),
  );
  assert(
    "水やりの前の値は使わない（今75%、1時間に0.5%なら約50時間）",
    hours === 50,
    String(hours),
  );
}

console.log("--- まとめ ---");
{
  const rows = drying(70, 1, 10).map((s) => ({
    filtered: { moisture_pct: s.value, temp: 22, lux: 1000 },
    created_at: s.at,
  }));
  const t = buildTrends(rows, PLANT_PROFILES.calathea, null, now);
  assert(
    "カラテアは、快適の下限（50%）までの時間を出す",
    t.moisture.comfort_low === 50 && t.moisture.hours_to_dry === 10,
    JSON.stringify(t.moisture),
  );
  assert(
    "今日の日照の目標は、1日の目標積算光量",
    t.light_today.target === PLANT_PROFILES.calathea.lightDaily.comfortLow,
  );
  assert("今日の日照を積算する", t.light_today.lux_hours > 0);
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
