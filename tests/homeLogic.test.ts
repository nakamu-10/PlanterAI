// ホームの吹き出しと経過時間の表示（app/src/home.logic.js）の検証
// 実行: npx tsx tests/homeLogic.test.ts
import {
  daysTogether,
  describeAgo,
  isStaleMessage,
  shouldShowLastMessage,
} from "../app/src/home.logic.js";

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

const message = {
  message: "お水、もらえる？",
  emotion: "不安",
  created_at: "2026-11-05T09:00:00Z",
};
const anxious = { emotion: "不安" };

console.log("--- 吹き出し ---");
assert(
  "まだ見ていないセリフは出す",
  shouldShowLastMessage(message, null, anxious),
);
assert(
  "見たことのあるセリフは出さない",
  !shouldShowLastMessage(message, "2026-11-05T09:00:00Z", anxious),
);
assert(
  "前に見たセリフより新しければ出す",
  shouldShowLastMessage(message, "2026-11-05T08:00:00Z", anxious),
);
assert(
  "セリフのあとに気分が変わっていたら出さない（水をもらって満足になった）",
  !shouldShowLastMessage(message, null, { emotion: "満足" }),
);
assert(
  "気分の記録が無いセリフ（古いログ）は、気分を比べずに出す",
  shouldShowLastMessage({ ...message, emotion: null }, null, {
    emotion: "満足",
  }),
);
assert(
  "気分の記録がまだ無い鉢でも出す",
  shouldShowLastMessage({ ...message, emotion: "満足" }, null, null),
);
assert(
  "気分が変わったセリフは古い（アイコンからも出さない）",
  isStaleMessage(message, { emotion: "満足" }) &&
    !isStaleMessage(message, anxious),
);
assert(
  "チャットの返事（気分の記録なし）は古くならない",
  !isStaleMessage({ ...message, emotion: undefined }, { emotion: "満足" }),
);
assert("セリフが無ければ出さない", !shouldShowLastMessage(null, null, anxious));

console.log("--- 経過時間 ---");
const now = Date.parse("2026-11-05T12:00:00Z");
assert(
  "5分未満は「たった今」",
  describeAgo("2026-11-05T11:57:00Z", now) === "たった今",
);
assert("分", describeAgo("2026-11-05T11:20:00Z", now) === "40分前");
assert("時間", describeAgo("2026-11-05T07:00:00Z", now) === "5時間前");
assert("日", describeAgo("2026-11-02T11:00:00Z", now) === "3日前");
assert("登録した日は1日目", daysTogether("2026-11-05T01:00:00Z", now) === 1);
assert("翌日は2日目", daysTogether("2026-11-04T01:00:00Z", now) === 2);
assert(
  "日本時間の23時に登録して翌朝8時に開くと2日目",
  daysTogether("2026-11-04T14:00:00Z", Date.parse("2026-11-04T23:00:00Z")) ===
    2,
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
