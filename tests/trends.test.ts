// アプリの「数値」の画面の推移と先読み（supabase/functions/_shared/trends.ts）の検証
// 実行: npx tsx tests/trends.test.ts
import {
  buildTrends,
  forecastDrying,
  hourlyMeans,
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
const show = (value: unknown) => JSON.stringify(value);

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
    show(last),
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
{
  const f = forecastDrying(drying(70, 1, 10), 50, now, null);
  assert(
    "1時間に1%ずつ減り、今60%なら、50%まで約10時間",
    f.status === "drying" && f.hours === 10,
    show(f),
  );
}
assert(
  "もう下回っていれば dry",
  forecastDrying(drying(55, 1, 10), 50, now, null).status === "dry",
);
assert(
  "減っていなければ steady",
  forecastDrying(drying(70, 0, 10), 50, now, null).status === "steady",
);
assert(
  "2週間より先なら steady",
  forecastDrying(drying(90, 0.1, 10), 50, now, null).status === "steady",
);
assert(
  "データが3時間より短ければ unknown（乾く心配なし、とは言わない）",
  forecastDrying(drying(70, 1, 2), 50, now, null).status === "unknown",
);
assert(
  "鉢が送っていなければ unknown",
  forecastDrying([], 50, now, null).status === "unknown",
);
{
  // 今 50.2%、1時間に1%減る。30分未満でも「もう下回っている」と言わない
  const f = forecastDrying(drying(60.2, 1, 10), 50, now, null);
  assert(
    "30分未満の見込みは1時間",
    f.status === "drying" && f.hours === 1,
    show(f),
  );
}
{
  // 水やりの前は乾いていて、水やりで跳ね上がり、そのあとはゆっくり乾く
  const before = drying(40, 2, 20).map((s) => ({
    ...s,
    at: new Date(Date.parse(s.at) - 10.5 * 3_600_000).toISOString(),
  }));
  const after = drying(80, 0.5, 10);
  const f = forecastDrying([...before, ...after], 50, now, new Date(ago(10)));
  assert(
    "水やりの前の値は使わない（今75%、1時間に0.5%なら約50時間）",
    f.status === "drying" && f.hours === 50,
    show(f),
  );
}
{
  // 本物の流れ：生の値は 35% → 水やりで 80% → 1時間に 0.5% 乾く（10分おき）。
  // filtered は直近5点の中央値なので、水やりのあと2点は乾いた値のまま残る
  const wateredAt = now.getTime() - 12 * 3_600_000;
  const raw: { at: number; v: number }[] = [];
  for (let m = -60; m <= 12 * 60; m += 10) {
    raw.push({
      at: wateredAt + m * 60_000,
      v: m < 0 ? 35 : 80 - 0.5 * (m / 60),
    });
  }
  const filtered = raw.map((r, i) => {
    const window = raw.slice(Math.max(0, i - 4), i + 1).map((x) => x.v)
      .sort((a, b) => a - b);
    return {
      at: new Date(r.at).toISOString(),
      value: window[Math.floor(window.length / 2)],
    };
  });
  const f = forecastDrying(filtered, 50, now, new Date(wateredAt));
  assert(
    "水やりの直後の、中央値が追いつく前の乾いた値に引っぱられない（今74%、約48時間）",
    f.status === "drying" && Math.abs(f.hours - 48) <= 3,
    show(f),
  );
  const fourHoursLater = new Date(wateredAt + 4 * 3_600_000);
  const early = forecastDrying(
    filtered.filter((s) => Date.parse(s.at) <= fourHoursLater.getTime()),
    50,
    fourHoursLater,
    new Date(wateredAt),
  );
  assert(
    "水やりから4時間でも見込みを出す（今78%、約56時間）",
    early.status === "drying" && Math.abs(early.hours - 56) <= 4,
    show(early),
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
    "カラテアは、快適の下限（50%）までの見込みを出す",
    t !== null && t.moisture.comfort_low === 50 &&
      t.moisture.forecast.status === "drying",
    show(t?.moisture),
  );
  assert(
    "今日の日照の目標は、1日の目標積算光量",
    t?.light_today.target === PLANT_PROFILES.calathea.lightDaily.comfortLow,
  );
  assert("今日の日照を積算する", (t?.light_today.lux_hours ?? 0) > 0);
  const reversed = buildTrends(
    [...rows].reverse(),
    PLANT_PROFILES.calathea,
    null,
    now,
  );
  assert(
    "新しい順の行（DB から新しい順に取る）でも同じ結果",
    show(reversed) === show(t),
  );
  assert(
    "知らない植物の鉢でも落ちず、推移だけ null にする",
    buildTrends(rows, PLANT_PROFILES.unknown, null, now) === null,
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
