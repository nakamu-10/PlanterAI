// 日照不足が天気のせいかを見分ける処理の検証
// 実行: npx tsx tests/weather.test.ts
import {
  describeWeather,
  fetchTodayWeather,
  isDimDay,
  keepWaitingForWeather,
  needsNewForecast,
  parseTodayWeather,
  placeFrom,
  weatherFromRow,
  weatherToRow,
} from "../supabase/functions/_shared/weather.ts";
import { DIM_DAY_FALLBACK } from "../supabase/functions/_shared/fallback.ts";

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean, detail = "") {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

// 2026-11-10 の調布の予報（Open-Meteo の返り値の形）
const rainyBody = {
  daily: {
    time: ["2026-11-10"],
    sunshine_duration: [2916.08],
    daylight_duration: [37599.72],
    weather_code: [61],
  },
};
const day = (sunshineHours: number, code = 3) => ({
  sunshineHours,
  daylightHours: 10.4,
  code,
});

console.log("--- 場所 ---");
assert(
  "緯度と経度があれば場所になる",
  JSON.stringify(placeFrom("35.66", "139.54")) ===
    JSON.stringify({ latitude: 35.66, longitude: 139.54 }),
);
assert("設定がなければ天気を見ない", placeFrom(undefined, undefined) === null);
assert("数字でなければ天気を見ない", placeFrom("調布", "139.54") === null);

console.log("--- 返り値を読む ---");
{
  const weather = parseTodayWeather(rainyBody);
  assert(
    "日が差した時間と日の長さを時間で読む",
    weather !== null && Math.abs(weather.sunshineHours - 0.81) < 0.01 &&
      Math.abs(weather.daylightHours - 10.44) < 0.01 && weather.code === 61,
    JSON.stringify(weather),
  );
}
assert("形が違えば null", parseTodayWeather({ error: true }) === null);
assert(
  "日の長さが 0 なら null",
  parseTodayWeather({
    daily: {
      sunshine_duration: [0],
      daylight_duration: [0],
      weather_code: [0],
    },
  }) === null,
);

console.log("--- 曇りや雨の日 ---");
// 10/1〜11/9 の調布：晴れの日は日の長さの9割以上に日が差していた
assert("ほぼずっと晴れなら、天気のせいにしない", !isDimDay(day(10.0)));
assert("日が差したのが半分に届かなければ、天気のせい", isDimDay(day(4.1)));
assert("ちょうど半分なら天気のせいにしない", !isDimDay(day(5.2)));
assert("雨のコードは雨", describeWeather(day(0, 61)) === "雨");
assert("霧雨も雨", describeWeather(day(0, 51)) === "雨");
assert("雪のコードは雪", describeWeather(day(0, 73)) === "雪");
assert("くもりのコードはくもり", describeWeather(day(1, 3)) === "くもり");

console.log("--- 天気の取得 ---");
const place = { latitude: 35.66, longitude: 139.54 };
{
  let requested = "";
  const weather = await fetchTodayWeather(
    place,
    ((url: string) => {
      requested = url;
      return Promise.resolve(new Response(JSON.stringify(rainyBody)));
    }) as typeof fetch,
  );
  assert("今日の予報を読む", weather?.code === 61);
  assert(
    "日本時間の今日1日分を頼む",
    requested.includes("timezone=Asia%2FTokyo") &&
      requested.includes("forecast_days=1"),
    requested,
  );
}
{
  const originalError = console.error;
  console.error = () => {};
  const failed = await fetchTodayWeather(
    place,
    (() => Promise.reject(new Error("offline"))) as typeof fetch,
  );
  const serverError = await fetchTodayWeather(
    place,
    (() =>
      Promise.resolve(
        new Response("busy", { status: 503 }),
      )) as typeof fetch,
  );
  console.error = originalError;
  assert("つながらなければ null（判定は止めない）", failed === null);
  assert("サーバーのエラーでも null", serverError === null);
}

console.log("--- 天気のせいの日のセリフ ---");
assert(
  "場所を変えてと頼まない",
  !/置いて|移して|場所/.test(DIM_DAY_FALLBACK),
  DIM_DAY_FALLBACK,
);

console.log("--- その日の天気を覚える ---");
{
  const rainy = { sunshineHours: 0.02, daylightHours: 10.4, code: 61 };
  const back = weatherFromRow(weatherToRow(rainy));
  assert(
    "覚えた天気を読み戻すと同じ",
    JSON.stringify(back) === JSON.stringify(rainy),
    JSON.stringify(back),
  );
  assert("読み戻した天気でも雨の日になる", isDimDay(back));
}

console.log("--- 0時と12時に取り直す ---");
{
  // 日本時間の 11/10 hh:mm
  const jst = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h - 9, m));
  assert(
    "同じ午前のうちは取り直さない",
    !needsNewForecast(jst(0, 5), jst(11, 50)),
  );
  assert("12時を過ぎたら取り直す", needsNewForecast(jst(0, 5), jst(12, 0)));
  assert("12時に取ったら夜まで使う", !needsNewForecast(jst(12, 0), jst(20, 0)));
  assert("日が変わったら取り直す", needsNewForecast(jst(23, 50), jst(24, 0)));
}

console.log("--- 天気が取れなかったとき ---");
assert("予告は天気が取れるまで送らない", keepWaitingForWeather("warning", 14));
assert(
  "締めは20時台なら次の回まで待つ",
  keepWaitingForWeather("shortfall", 20),
);
assert(
  "締めは21時になったら晴れ扱いで送る",
  !keepWaitingForWeather("shortfall", 21),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
