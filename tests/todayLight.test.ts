// 返事のプロンプトに渡す「今日の日照」の検証（#89）
// 実行: npx tsx tests/todayLight.test.ts
import { describeTodayLight } from "../supabase/functions/_shared/todayLight.ts";
import { buildReplyPrompt } from "../supabase/functions/_shared/llm.ts";
import { stateFromLog } from "../supabase/functions/_shared/emotionEngine.ts";

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

// 日本時間の 11/9 hh:mm
const at = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 10, 9, h - 9, m)).toISOString();
const light = (daily_light: Record<string, unknown>) => ({ daily_light });

console.log("--- 今日の日照を言葉にする ---");
{
  const text = describeTodayLight(
    light({ kind: "warning", ratio: 0.18 }),
    at(14, 10),
  );
  assert(
    "予告は、時刻と割合と、まだ終わっていないことを書く",
    text !== null && text.includes("14時") && text.includes("18%") &&
      text.includes("まだ今日は終わっていない"),
    String(text),
  );
}
{
  const text = describeTodayLight(
    light({ kind: "shortfall", ratio: 0.174 }),
    at(20, 10),
  );
  assert(
    "不足は、足りなかったと書く",
    text !== null && text.includes("17%") && text.includes("足りなかった"),
    String(text),
  );
}
{
  const text = describeTodayLight(
    light({
      kind: "dim_day",
      ratio: 0.22,
      weather: { sunshineHours: 0.02, daylightHours: 10.4, code: 61 },
    }),
    at(20),
  );
  assert(
    "雨の日は、天気のせいで飼い主のせいではないと書く",
    text !== null && text.includes("雨") && text.includes("0.0時間") &&
      text.includes("飼い主のせいではない"),
    String(text),
  );
}
{
  const text = describeTodayLight(
    light({ kind: "recovered", ratio: 0.95 }),
    at(20),
  );
  assert(
    "回復は、目標に届いたと書く",
    text !== null && text.includes("目標に届いた"),
    String(text),
  );
}
assert("日照の判定でない行は null", describeTodayLight({}, at(20)) === null);
assert(
  "scores が null でも落ちない",
  describeTodayLight(null, at(20)) === null,
);
assert(
  "知らない kind は null",
  describeTodayLight(light({ kind: "none", ratio: 0.5 }), at(20)) === null,
);

console.log("--- 返事のプロンプト ---");
const base = {
  plantName: "カラ美",
  plantProfile: "calathea",
  characterId: "amaenbo",
  state: stateFromLog(null),
  recentConversation: [],
  relationshipSummary: null,
  touchMemory: null,
  userMessage: "でもお日様足りなかったんだよね？",
};
{
  const prompt = buildReplyPrompt({
    ...base,
    todayLight: "今日浴びた光は目標の17%で、足りなかった。",
  });
  assert(
    "今日の日照をプロンプトに入れる",
    prompt.includes("# 今日の日照") && prompt.includes("目標の17%"),
  );
  assert(
    "自分からは持ち出さないよう指示する",
    prompt.includes("自分からは持ち出さないでください"),
  );
}
{
  const prompt = buildReplyPrompt({ ...base, todayLight: null });
  assert(
    "判定がまだなら、見出しも指示も入れない",
    !prompt.includes("今日の日照"),
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
