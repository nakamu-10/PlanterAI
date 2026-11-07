// 記録のページの表示の計算（app/src/records.logic.js）の検証
// 実行: npx tsx tests/recordsLogic.test.ts
import { existsSync } from "node:fs";
import {
  addDays,
  calendarWeeks,
  conversationByDay,
  DIARY_LABELS,
  diaryWeeks,
  formatDay,
  jstDay,
  jstTime,
  moodRows,
  weekSummary,
} from "../app/src/records.logic.js";
import { DIARY_PICTURES } from "../supabase/functions/_shared/diary.ts";

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

console.log("--- 絵 ---");
for (const picture of DIARY_PICTURES) {
  assert(
    `${picture} の絵のファイルがある`,
    existsSync(`app/public/images/diary/${picture}.webp`),
  );
  assert(`${picture} の説明がある`, picture in DIARY_LABELS);
}

console.log("--- 日付 ---");
assert("月またぎで足せる", addDays("2026-10-31", 1) === "2026-11-01");
assert("曜日を付ける", formatDay("2026-11-05") === "11月5日（木）");
assert("日本時間の日付", jstDay("2026-11-05T15:30:00Z") === "2026-11-06");
assert("日本時間の時刻", jstTime("2026-11-05T15:30:00Z") === "00:30");

const entry = (day: string, stats: Record<string, unknown> = {}) => ({
  day,
  picture: "kumori",
  body: "おだやかな一日。",
  stats,
});

console.log("--- 週のふりかえり ---");
{
  // 2026-11-05 は木曜
  const weeks = diaryWeeks(
    [
      entry("2026-11-02"),
      entry("2026-10-26"),
      entry("2026-10-01"),
    ],
    "2026-11-05",
  );
  assert("新しい週から並ぶ", weeks[0].start === "2026-11-02");
  assert(
    "今週と先週の名前",
    weeks[0].label === "今週" && weeks[1].label === "先週",
  );
  assert(
    "月曜始まりの7日",
    weeks[0].days.length === 7 &&
      weeks[0].days[0].weekday === "月" && weeks[0].days[6].weekday === "日",
  );
  assert(
    "今日と未来を見分ける",
    weeks[0].days[3].isToday &&
      weeks[0].days[4].isFuture && !weeks[0].days[2].isFuture,
  );
  assert(
    "日記の無い古い週と、5週より前は出さない",
    weeks.length === 2,
    JSON.stringify(weeks.map((w) => w.start)),
  );
}
{
  const weeks = diaryWeeks([], "2026-11-05");
  assert(
    "日記が無くても今週は出す",
    weeks.length === 1 && weeks[0].label === "今週",
  );
}
{
  const [week] = diaryWeeks(
    [
      entry("2026-11-02", {
        watering_count: 1,
        talk_count: 2,
        moods: [{ emotion: "満足", share: 0.5 }, {
          emotion: "不満",
          share: 0.5,
        }],
      }),
      entry("2026-11-03", {
        watering_count: 2,
        talk_count: 0,
        moods: [{ emotion: "不満", share: 1 }],
      }),
    ],
    "2026-11-05",
  );
  const summary = weekSummary(week);
  assert(
    "週の水やり・おしゃべり・多かった気分を足し合わせる",
    summary.days === 2 && summary.watering === 3 && summary.talk === 2 &&
      summary.topMood === "不満",
    JSON.stringify(summary),
  );
}
{
  const [week] = diaryWeeks([], "2026-11-05");
  assert("日記が無い週は気分なし", weekSummary(week).topMood === null);
}

console.log("--- 気分の移り変わり ---");
{
  const rows = moodRows(
    [
      entry("2026-11-04", {
        moods: [{ emotion: "不満", share: 0.3 }, {
          emotion: "満足",
          share: 0.7,
        }, { emotion: "未知", share: 0.1 }],
      }),
    ],
    [{ emotion: "軽い不満", share: 1 }],
    "2026-11-05",
  );
  assert(
    "7日分を古い順に、最後が今日",
    rows.length === 7 && rows[0].day === "2026-10-30" &&
      rows[6].label === "今日",
  );
  assert(
    "今日は途中までの割合を使う",
    rows[6].top?.emotion === "軽い不満",
  );
  assert(
    "棒は軽い順に並べ、未知の気分は入れない",
    rows[5].segments.map((s: { emotion: string }) => s.emotion).join() ===
      "満足,不満",
    JSON.stringify(rows[5].segments),
  );
  assert("一番多い気分を文字で出す", rows[5].top?.emotion === "満足");
  assert(
    "記録の無い日は空",
    rows[0].segments.length === 0 && rows[0].top === null,
  );
}

console.log("--- カレンダー ---");
{
  const weeks = calendarWeeks(
    [{ day: "2026-11-02", count: 2 }],
    "2026-11-05",
  );
  const cells = weeks.flat();
  assert(
    "5週・月曜始まりで、今週が一番下",
    weeks.length === 5 &&
      weeks[4][0].day === "2026-11-02" && weeks[0][0].day === "2026-10-05",
  );
  assert("水やりの回数が入る", weeks[4][0].count === 2);
  assert(
    "月の初日と左上には月も書く",
    weeks[0][0].label === "10/5" &&
      cells.find((c) => c.day === "2026-11-01")?.label === "11/1" &&
      cells.find((c) => c.day === "2026-11-03")?.label === "3",
  );
  assert(
    "今日と未来を見分ける",
    cells.find((c) => c.isToday)?.day === "2026-11-05" &&
      cells.find((c) => c.day === "2026-11-06")?.isFuture === true,
  );
}

console.log("--- 会話ログ ---");
{
  const groups = conversationByDay([
    {
      role: "plant",
      message: "新",
      created_at: "2026-11-05T15:30:00Z",
    },
    {
      role: "plant",
      message: "同じ日の後",
      created_at: "2026-11-05T10:00:00Z",
    },
    {
      role: "user",
      message: "同じ日の前",
      created_at: "2026-11-05T09:00:00Z",
    },
  ]);
  assert(
    "日本時間の日付で分け、新しい日から並べる",
    groups.length === 2 && groups[0].day === "2026-11-06" &&
      groups[1].day === "2026-11-05",
  );
  assert(
    "1日の中は古い順",
    groups[1].rows[0].message === "同じ日の前" &&
      groups[1].rows[1].message === "同じ日の後",
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
