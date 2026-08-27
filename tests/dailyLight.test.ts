import {
  countConsecutiveShortDays,
  integrateLuxHours,
  jstDayStart,
  jstHour,
  judgeDailyLight,
  LuxSample,
} from "../supabase/functions/_shared/dailyLight.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

// JSTの指定日時（2026-08-23）のUTC Dateを作る
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 23, h - 9, m, 0));

// 10分間隔でluxサンプルを生成
function series(
  startH: number,
  endH: number,
  lux: (h: number) => number,
): LuxSample[] {
  const out: LuxSample[] = [];
  for (let t = startH * 60; t <= endH * 60; t += 10) {
    out.push({ at: at(0, t), lux: lux(t / 60) });
  }
  return out;
}

console.log("\n--- JSTユーティリティ ---");
ok("jstHour が9時間ずれを吸収する", jstHour(at(15)) === 15);
ok(
  "jstDayStart が JST 00:00 を返す",
  jstDayStart(at(15)).getTime() === at(0).getTime(),
);

console.log("\n--- 積算（台形則） ---");
{
  // 0〜24時ずっと1000lux → 24,000 lux·h
  const flat = series(0, 24, () => 1000);
  const r = integrateLuxHours(flat, at(0), at(24));
  ok("一定値の積算", Math.abs(r.luxHours - 24000) < 100, `→ ${r.luxHours}`);
  ok("カバレッジがほぼ1.0", r.coverage > 0.99, `→ ${r.coverage}`);
  ok("信頼できる", r.reliable);
  ok(
    "分母は日中12時間",
    Math.abs(r.windowHours - 12) < 0.1,
    `→ ${r.windowHours}`,
  );
}
{
  // 日中に6時間の欠測（6〜12時が抜ける）
  const gapped = [...series(0, 6, () => 1000), ...series(12, 24, () => 1000)];
  const r = integrateLuxHours(gapped, at(0), at(24));
  ok("欠測分が面積に水増しされない", r.luxHours < 20000, `→ ${r.luxHours}`);
  ok("日中の欠測でカバレッジが下がる", r.coverage < 0.8, `→ ${r.coverage}`);
  ok("日中が欠測した日は信頼できない", !r.reliable);
}
{
  // ★夜間だけ欠測（6〜18時は完全）→ 判定できるべき
  //   実測で 18〜5時のサンプルが半減していたが、光の測定には影響しない
  const nightGap = series(6, 18, () => 1000);
  const r = integrateLuxHours(nightGap, at(0), at(24));
  ok("夜間の欠測は判定を妨げない", r.reliable, `coverage=${r.coverage}`);
  ok(
    "夜間欠測でも積算は正しい",
    Math.abs(r.luxHours - 12000) < 100,
    `→ ${r.luxHours}`,
  );
}
{
  const r = integrateLuxHours([{ at: at(12), lux: 5000 }], at(0), at(24));
  ok("サンプル1件では判定不能", !r.reliable && r.luxHours === 0);
}
ok("空配列でも落ちない", integrateLuxHours([], at(0), at(24)).luxHours === 0);

console.log("\n--- 判定 ---");
const target = 10000; // config.ts の lightDaily.comfortLow と一致させること
const base = { targetLuxHours: target, warnedToday: false, closedToday: false };
{
  const v = judgeDailyLight({
    now: at(10),
    samples: series(0, 10, () => 100),
    ...base,
  });
  ok("15時前は判定しない", v.kind === "none");
}
{
  // 15時までずっと暗い（100lux）→ 1,500 lux·h、目標の15%
  const v = judgeDailyLight({
    now: at(15),
    samples: series(0, 15, () => 100),
    ...base,
  });
  ok("15時に不足見込みなら警告", v.kind === "warning", `→ ${v.kind}`);
}
{
  // 15時までに2000lux×15h = 30,000 lux·h → 十分
  const v = judgeDailyLight({
    now: at(15),
    samples: series(0, 15, () => 2000),
    ...base,
  });
  ok("15時に順調なら黙る", v.kind === "none", `→ ${v.kind}`);
}
{
  const v = judgeDailyLight({
    now: at(15),
    samples: series(0, 15, () => 100),
    ...base,
    warnedToday: true,
  });
  ok("同じ枠で二重に警告しない", v.kind === "none");
}
{
  const v = judgeDailyLight({
    now: at(20),
    samples: series(0, 20, () => 100),
    ...base,
    warnedToday: true,
  });
  ok("20時に未達なら確定通知", v.kind === "shortfall", `→ ${v.kind}`);
}
{
  // 15時まで暗く、その後明るい場所へ移動 → 目標達成
  const moved = [...series(0, 15, () => 100), ...series(15, 20, () => 4000)];
  const v = judgeDailyLight({
    now: at(20),
    samples: moved,
    ...base,
    warnedToday: true,
  });
  ok("警告後に達成したら回復通知", v.kind === "recovered", `→ ${v.kind}`);
}
{
  const v = judgeDailyLight({
    now: at(20),
    samples: series(0, 20, () => 2000),
    ...base,
  });
  ok("警告していない達成日は黙る", v.kind === "none", `→ ${v.kind}`);
}
{
  const v = judgeDailyLight({
    now: at(20),
    samples: series(0, 20, () => 100),
    ...base,
    closedToday: true,
  });
  ok("締め切り枠も二重通知しない", v.kind === "none");
}

console.log("\n--- 連続日数 ---");
ok(
  "昨日・一昨日が不足なら2",
  countConsecutiveShortDays(["2026-08-22", "2026-08-21"], at(20)) === 2,
);
ok(
  "間が空いたら途切れる",
  countConsecutiveShortDays(["2026-08-22", "2026-08-20"], at(20)) === 1,
);
ok("履歴なしなら0", countConsecutiveShortDays([], at(20)) === 0);

console.log(`\n${pass} passed / ${fail} failed`);
if (fail > 0) process.exit(1);
