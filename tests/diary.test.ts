// カラ美の日記（supabase/functions/_shared/diary.ts）の検証
// 実行: npx tsx tests/diary.test.ts
import { existsSync, readFileSync } from "node:fs";
import { PLANT_PROFILES } from "../supabase/functions/_shared/config.ts";
import {
  buildDayStats,
  buildDiaryPrompt,
  choosePicture,
  describeMoodChanges,
  DIARY_PICTURES,
  type DiaryStats,
  fallbackDiaryBody,
  isAnniversary,
  isSundayJst,
  moodShares,
  wateringByDay,
  weeklyDiaryFlex,
  weeklyDiaryMessage,
} from "../supabase/functions/_shared/diary.ts";
import { endsSentence } from "../supabase/functions/_shared/llm.ts";

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

const stats = (overrides: Partial<DiaryStats> = {}): DiaryStats => ({
  day_number: 12,
  watering_count: 0,
  talk_count: 0,
  light_ratio: 0.7,
  moods: [{ emotion: "満足", share: 1 }],
  top_complaint: null,
  ...overrides,
});

console.log("--- 絵の選び方 ---");
assert("何もない日はおだやかな日", choosePicture(stats()) === "kumori");
assert(
  "節目の日は記念日（水やりより先）",
  choosePicture(stats({ day_number: 100, watering_count: 1 })) === "kinenbi",
);
assert(
  "水をもらえたら、困っていた日でも水の絵",
  choosePicture(stats({
    watering_count: 1,
    top_complaint: { complaint: "水分不足", share: 0.8 },
  })) === "mizumoratta",
);
for (
  const [complaint, picture] of [
    ["水分不足", "nodokarakara"],
    ["水分過多", "onakaippai"],
    ["温度高すぎ", "atui"],
    ["日照過剰", "atui"],
    ["温度低すぎ", "samui"],
    ["湿度高すぎ", "kumori"],
  ]
) {
  assert(
    `長く続いた${complaint}は ${picture}`,
    choosePicture(stats({
      light_ratio: 2,
      top_complaint: { complaint, share: 0.5 },
    })) === picture,
  );
}
assert(
  "短い不調は絵にしない",
  choosePicture(stats({
    light_ratio: 2,
    top_complaint: { complaint: "水分不足", share: 0.1 },
  })) === "hinatabokko",
);
assert(
  "空気の乾燥は「のど」の絵にしない（土の水やりと混同するため）",
  choosePicture(stats({
    light_ratio: 2,
    top_complaint: { complaint: "湿度低すぎ", share: 0.9 },
  })) === "hinatabokko",
);
assert(
  "たくさん話しかけられた日はおしゃべり（日当たりより先）",
  choosePicture(stats({ talk_count: 3, light_ratio: 2 })) === "osyaberi",
);
assert(
  "不調はおしゃべりより先",
  choosePicture(stats({
    talk_count: 5,
    top_complaint: { complaint: "温度低すぎ", share: 0.5 },
  })) === "samui",
);
assert(
  "2回ならおしゃべりにしない",
  choosePicture(stats({ talk_count: 2 })) === "kumori",
);
assert(
  "日照が目標以上はひなたぼっこ",
  choosePicture(stats({ light_ratio: 1 })) === "hinatabokko",
);
assert(
  "日照が目標の半分未満は暗い日",
  choosePicture(stats({ light_ratio: 0.49 })) === "kurai",
);
assert(
  "日照が分からない日は、暗いと決めつけない",
  choosePicture(stats({ light_ratio: null })) === "kumori",
);

console.log("--- 記念日 ---");
for (const day of [1, 7, 30, 50, 100, 150]) {
  assert(`${day}日目は記念日`, isAnniversary(day));
}
for (const day of [2, 8, 31, 51, 99]) {
  assert(`${day}日目は記念日ではない`, !isAnniversary(day));
}

console.log("--- 気分の割合 ---");
const dayEnd = new Date("2026-11-05T15:00:00Z");
{
  const { moods } = moodShares(
    [
      { emotion: "満足", complaint: null, created_at: "2026-11-05T00:00:00Z" },
      {
        emotion: "不満",
        complaint: "水分不足",
        created_at: "2026-11-05T00:10:00Z",
      },
      // 5秒おきの行が続いても、時間で測るので増えない
      ...Array.from({ length: 100 }, (_, i) => ({
        emotion: "軽い不満",
        complaint: "温度低すぎ",
        created_at: new Date(
          Date.parse("2026-11-05T00:20:00Z") + i * 1000,
        ).toISOString(),
      })),
    ],
    new Date("2026-11-05T00:21:40Z"),
  );
  assert(
    "行の数ではなく時間で割る",
    moods[0].share === moods[1].share && moods[0].share > 0.4 &&
      moods[2].emotion === "軽い不満" && moods[2].share < 0.2,
    JSON.stringify(moods),
  );
}
{
  const { moods } = moodShares(
    [
      { emotion: "満足", complaint: null, created_at: "2026-11-05T00:00:00Z" },
      {
        emotion: "軽い不満",
        complaint: "日照不足",
        created_at: "2026-11-05T00:05:00Z",
        daily_light: { kind: "warning" },
      },
    ],
    new Date("2026-11-05T00:10:00Z"),
  );
  assert(
    "日照の日次判定の行は、その時刻の気分に入れない",
    moods.length === 1 && moods[0].emotion === "満足",
    JSON.stringify(moods),
  );
}
{
  const { moods } = moodShares(
    [
      {
        emotion: "不安",
        complaint: "水分不足",
        created_at: "2026-11-05T00:00:00Z",
      },
      { emotion: "満足", complaint: null, created_at: "2026-11-05T05:00:00Z" },
      { emotion: "満足", complaint: null, created_at: "2026-11-05T05:20:00Z" },
    ],
    new Date("2026-11-05T05:40:00Z"),
  );
  assert(
    "送信が抜けた時間を、前の気分が続いたと数えない",
    moods[0].emotion === "満足" && moods[0].share > 0.6,
    JSON.stringify(moods),
  );
}
assert(
  "行が無ければ空",
  moodShares([], dayEnd).moods.length === 0,
);

console.log("--- その日の集計 ---");
const profile = PLANT_PROFILES.calathea;
const dayStart = new Date("2026-11-04T15:00:00Z"); // 11/5 0:00 JST
const luxEvery10Min = (lux: number) =>
  Array.from({ length: 144 }, (_, i) => ({
    at: new Date(dayStart.getTime() + i * 600_000).toISOString(),
    lux,
  }));
{
  const result = buildDayStats({
    dayStart,
    dayEnd,
    deviceCreatedAt: "2026-11-04T14:59:00Z", // 11/4 23:59 JST
    profile,
    luxSamples: luxEvery10Min(1000),
    moodRows: [{
      emotion: "不満",
      complaint: "水分不足",
      created_at: "2026-11-05T00:00:00Z",
    }],
    wateringCount: 2,
    talkCount: 4,
  });
  assert(
    "日本時間の日付で何日目かを数える",
    result.day_number === 2,
    String(result.day_number),
  );
  assert(
    "水やりと話しかけられた回数を入れる",
    result.watering_count === 2 && result.talk_count === 4,
  );
  assert(
    "日照は目標に対する割合",
    result.light_ratio !== null && result.light_ratio > 2,
    String(result.light_ratio),
  );
  assert(
    "一番長い不調を入れる",
    result.top_complaint?.complaint === "水分不足",
  );
}
{
  const result = buildDayStats({
    dayStart,
    dayEnd,
    deviceCreatedAt: "2026-11-01T00:00:00Z",
    profile,
    luxSamples: [{ at: "2026-11-05T01:00:00Z", lux: 100 }],
    moodRows: [],
    wateringCount: 0,
    talkCount: 0,
  });
  assert(
    "送信が抜けて足りたか分からない日は null",
    result.light_ratio === null,
    String(result.light_ratio),
  );
}

console.log("--- プロンプト ---");
{
  const prompt = buildDiaryPrompt({
    plantName: "カラ美",
    plantKind: "カラテア",
    characterId: "tsundere",
    picture: "mizumoratta",
    stats: stats({
      watering_count: 1,
      talk_count: 4,
      top_complaint: { complaint: "水分不足", share: 0.4 },
    }),
    recentBodies: ["きのうの日記の文。"],
  });
  assert("名前を渡す", prompt.includes("カラ美"));
  assert("植物の種類を渡す", prompt.includes("植物の種類はカラテア"));
  assert("絵のできごとを渡す", prompt.includes("飼い主に水をもらった"));
  assert("長く続いた不調を渡す", prompt.includes("長く続いた不調: 水分不足"));
  assert(
    "話しかけられた回数を渡す",
    prompt.includes("話しかけられた回数: 4回"),
  );
  assert("最近の日記を渡す", prompt.includes("きのうの日記の文。"));
  assert(
    "記録に無いことを書かないよう指示する",
    prompt.includes("記録に書かれていないこと"),
  );
  assert("文末の指示がある", prompt.includes("「。」「！」「？」"));
}
{
  const prompt = buildDiaryPrompt({
    plantName: "カラ美",
    plantKind: "カラテア",
    characterId: "amaenbo",
    picture: "kumori",
    stats: stats({
      light_ratio: null,
      top_complaint: { complaint: "水分不足", share: 0.1 },
    }),
    recentBodies: [],
  });
  assert("短い不調は書かせない", !prompt.includes("長く続いた不調"));
  assert("分からない日照は書かせない", !prompt.includes("日当たり:"));
}
{
  const prompt = buildDiaryPrompt({
    plantName: "カラ美",
    plantKind: "カラテア",
    characterId: "未知の性格",
    picture: "kumori",
    stats: stats(),
    recentBodies: [],
  });
  assert("未知の性格は甘えん坊にする", prompt.includes("一人称は「ボク」"));
}

console.log("--- 定型文 ---");
for (const picture of DIARY_PICTURES) {
  const body = fallbackDiaryBody(picture);
  assert(
    `${picture} の定型文は文の形で、70文字以内`,
    Boolean(body) && endsSentence(body) && [...body].length <= 70,
    body,
  );
  assert(
    `${picture} の定型文は、葉のない鉢でも読める`,
    !body.includes("葉"),
    body,
  );
}

console.log("--- 週の LINE ---");
{
  const message = weeklyDiaryMessage({
    pictures: [
      "hinatabokko",
      "hinatabokko",
      "hinatabokko",
      "mizumoratta",
      "kumori",
      "kumori",
      "atui",
    ],
    recordsUrl: "https://example.test/app/records.html?pot=karami",
  });
  assert(
    "多い順に3つ数える",
    message.includes("ひなたぼっこの日が3日、おだやかな日が2日"),
  );
  assert(
    "4つ目は入れない",
    !message.includes("暑かった日") ||
      !message.includes("お水をもらった日"),
  );
  assert("記録のページへのリンクを付ける", message.includes("?pot=karami"));
}
{
  const message = weeklyDiaryMessage({
    pictures: ["kumori"],
    recordsUrl: null,
  });
  assert("公開していない鉢にはリンクを付けない", !message.includes("http"));
}

console.log("--- 週の LINE のカード ---");
{
  const entries = [
    { day: "2026-11-02", picture: "hinatabokko", body: "ぽかぽかだったの。" },
    { day: "2026-11-03", picture: "mizumoratta", body: "お水がおいしかった。" },
    { day: "2026-11-08", picture: "kumori", body: "しずかな一日だったよ。" },
  ];
  const message = weeklyDiaryFlex({
    entries,
    imageBaseUrl: "https://example.test/app/images/diary",
    recordsUrl: "https://example.test/app/records.html?pot=karami",
  });
  // deno-lint-ignore no-explicit-any
  const bubbles = (message.contents as any).contents;
  assert("1日1枚のカードを、古い順に並べる", bubbles.length === 3);
  assert(
    "カードに日付と曜日、絵、文が入る",
    bubbles[0].body.contents[0].text === "11/2（月）" &&
      bubbles[0].hero.url ===
        "https://example.test/app/images/diary/hinatabokko.jpg" &&
      bubbles[0].body.contents[1].text === "ぽかぽかだったの。" &&
      bubbles[0].body.contents[1].wrap === true,
    JSON.stringify(bubbles[0]),
  );
  assert(
    "最後のカードが最後の日になる",
    bubbles[2].body.contents[0].text === "11/8（日）",
  );
  assert(
    "記録のページへのボタンが付く",
    bubbles[0].footer.contents[0].action.uri ===
      "https://example.test/app/records.html?pot=karami",
  );
  assert(
    "カードの幅をそろえる（LINE は幅の違うカードを並べられない）",
    bubbles.every((bubble: { size: string }) => bubble.size === "kilo"),
  );
  assert(
    "通知に出る文は絵の数え方で、URL を入れない",
    message.altText.includes("今週の日記がそろったよ。") &&
      !message.altText.includes("http"),
    message.altText,
  );

  const withoutLink = weeklyDiaryFlex({
    entries,
    imageBaseUrl: "https://example.test",
    recordsUrl: null,
  });
  // deno-lint-ignore no-explicit-any
  const plainBubbles = (withoutLink.contents as any).contents;
  assert(
    "公開していない鉢のカードにはボタンを付けない",
    plainBubbles[0].footer === undefined,
  );

  const fullWeek = weeklyDiaryFlex({
    entries: Array.from({ length: 7 }, (_, i) => ({
      day: `2026-11-0${i + 2}`,
      picture: "kumori",
      body: "あ".repeat(90),
    })),
    imageBaseUrl: "https://planterai.vercel.app/app/images/diary",
    recordsUrl: "https://planterai.vercel.app/app/records.html?pot=karami",
  });
  assert(
    "7日分でも LINE の上限（カルーセル 50KB、代替文 1500字）に収まる",
    JSON.stringify(fullWeek.contents).length < 50_000 &&
      fullWeek.altText.length <= 1500,
    String(JSON.stringify(fullWeek.contents).length),
  );

  for (const picture of DIARY_PICTURES) {
    const jpeg = readFileSync(`app/public/images/diary/${picture}.jpg`);
    assert(
      `${picture}.jpg は JPEG で、LINE の勧める 1MB 以下`,
      jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg.length <= 1_000_000,
    );
    assert(
      `${picture}.webp が記録のページ用にある`,
      existsSync(`app/public/images/diary/${picture}.webp`),
    );
  }
}

console.log("--- 曜日・水やり・変化 ---");
assert(
  "日本時間の日曜を見分ける（UTC は土曜）",
  isSundayJst(new Date("2026-11-07T15:00:00Z")),
);
assert(
  "日本時間の土曜は日曜ではない",
  !isSundayJst(new Date("2026-11-07T14:59:00Z")),
);
{
  const days = wateringByDay([
    { created_at: "2026-11-05T15:30:00Z" },
    { created_at: "2026-11-05T14:30:00Z" },
    { created_at: "2026-11-05T01:00:00Z" },
  ]);
  assert(
    "水やりを日本時間の日付で数える",
    days.length === 2 && days[0].day === "2026-11-05" && days[0].count === 2 &&
      days[1].day === "2026-11-06" && days[1].count === 1,
    JSON.stringify(days),
  );
}
{
  const [recovered, warning] = describeMoodChanges([
    {
      emotion: "満足",
      complaint: "日照不足",
      created_at: "2026-11-05T11:00:00Z",
    },
    {
      emotion: "軽い不満",
      complaint: "日照不足",
      created_at: "2026-11-05T06:00:00Z",
    },
  ]);
  assert("満足の行に主訴を出さない", recovered.complaint === null);
  assert("不調の行は主訴を出す", warning.complaint === "日照不足");
}
{
  const changes = describeMoodChanges([
    { emotion: "満足", complaint: null, created_at: "2026-11-05T12:00:00Z" },
    {
      emotion: "満足",
      complaint: "日照不足",
      created_at: "2026-11-05T11:00:00Z",
    },
    {
      emotion: "不満",
      complaint: "水分不足",
      created_at: "2026-11-05T09:00:00Z",
    },
  ]);
  assert(
    "同じ状態が続く行はまとめ、変わった時刻を残す",
    changes.length === 2 && changes[0].created_at === "2026-11-05T11:00:00Z" &&
      changes[1].emotion === "不満",
    JSON.stringify(changes),
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
