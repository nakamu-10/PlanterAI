// 部屋の窓に出す今日の天気を読む処理（supabase/functions/_shared/dailyWeather.ts）の検証
// 実行: npx tsx tests/windowWeather.test.ts

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

// Edge Functions の外で動かすので、Deno.env を差し替える
let env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (key: string) => env[key] },
};
console.error = () => {};
const { readWindowWeather } = await import(
  "../supabase/functions/_shared/dailyWeather.ts"
);

// daily_weather を1行だけ返す、supabase の形だけ真似たもの
function fakeClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    match: () => query,
    maybeSingle: () => Promise.resolve(result),
  };
  return { from: () => query } as never;
}
const rainyRow = { sunshine_hours: 0.5, daylight_hours: 10, weather_code: 61 };

env = {};
assert(
  "場所が無ければ、天気は出さない",
  (await readWindowWeather(fakeClient({ data: rainyRow, error: null }))) ===
    null,
);

env = { WEATHER_LATITUDE: "35.65", WEATHER_LONGITUDE: "139.54" };
assert(
  "今日の予報があれば、窓の天気にする",
  (await readWindowWeather(fakeClient({ data: rainyRow, error: null }))) ===
    "rain",
);
assert(
  "今日の予報がまだ無ければ、天気は出さない",
  (await readWindowWeather(fakeClient({ data: null, error: null }))) === null,
);
assert(
  "読めなくても、例外にせず天気を出さない",
  (await readWindowWeather(
    fakeClient({ data: null, error: { message: "down" } }),
  )) === null,
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
