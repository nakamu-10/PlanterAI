// 展示用の鍵なしの API（supabase/functions/app-public/view.ts）の検証
// 実行: npx tsx tests/appPublic.test.ts
import {
  CONVERSATION_ROWS,
  type ConversationRow,
  lastPlantNotice,
  parsePot,
} from "../supabase/functions/app-public/view.ts";

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

console.log("--- pot ---");
assert("小文字・数字・ハイフンは通す", parsePot("karami-2") === "karami-2");
assert("無ければ通さない", parsePot(null) === null);
assert("空は通さない", parsePot("") === null);
assert("大文字は通さない", parsePot("Karami") === null);
assert("記号は通さない", parsePot("../karami") === null);
assert("33文字は通さない", parsePot("a".repeat(33)) === null);

// 新しい順に並べる。返事は line-webhook・app-chat と同じく、人の行の 1ms あと
const plant = (at: string, message: string): ConversationRow => ({
  role: "plant",
  message,
  emotion: "満足",
  created_at: at,
});
const user = (at: string): ConversationRow => ({
  role: "user",
  message: "人が書いた文",
  emotion: null,
  created_at: at,
});

console.log("--- 植物のセリフ ---");
{
  const notice = lastPlantNotice([
    plant("2026-11-05T09:00:00.001Z", "返事"),
    user("2026-11-05T09:00:00.000Z"),
    plant("2026-11-05T08:00:00.000Z", "お水ちょうだい"),
    plant("2026-11-05T07:00:00.000Z", "その前の通知"),
  ]);
  assert(
    "人への返事は飛ばし、その前の通知を返す",
    notice?.message === "お水ちょうだい",
    JSON.stringify(notice),
  );
}
{
  const notice = lastPlantNotice([
    plant("2026-11-05T10:00:00.000Z", "満足に戻った"),
    plant("2026-11-05T09:00:00.001Z", "返事"),
    user("2026-11-05T09:00:00.000Z"),
  ]);
  assert(
    "返事のあとの通知は返す",
    notice?.message === "満足に戻った",
    JSON.stringify(notice),
  );
}
{
  const notice = lastPlantNotice([
    plant("2026-11-05T09:00:30.000Z", "前の書き方の返事"),
    user("2026-11-05T09:00:00.000Z"),
    plant("2026-11-05T08:00:00.000Z", "通知"),
    plant("2026-11-05T07:00:00.000Z", "その前の通知"),
  ]);
  assert(
    "人の行の1分以内のセリフも返事とみなす",
    notice?.message === "通知",
    JSON.stringify(notice),
  );
}
{
  const notice = lastPlantNotice([
    plant("2026-11-05T09:05:00.000Z", "通知"),
    user("2026-11-05T09:00:00.000Z"),
    plant("2026-11-05T08:00:00.000Z", "その前の通知"),
  ]);
  assert(
    "人の行から1分より後のセリフは通知",
    notice?.message === "通知",
    JSON.stringify(notice),
  );
}
{
  const notice = lastPlantNotice([
    ...Array.from(
      { length: CONVERSATION_ROWS - 1 },
      () => user("2026-11-05T09:10:00.000Z"),
    ),
    plant("2026-11-05T09:00:00.001Z", "返事"),
  ]);
  assert(
    "取れる上限まで来ていて、直前の行が範囲の外にあるセリフは、返事かもしれないので返さない",
    notice === null,
    JSON.stringify(notice),
  );
}
{
  const notice = lastPlantNotice([
    plant("2026-11-05T08:00:00.000Z", "最初の通知"),
  ]);
  assert(
    "会話が1行だけ（新しい鉢の最初の通知）なら返す",
    notice?.message === "最初の通知",
    JSON.stringify(notice),
  );
}
{
  const notice = lastPlantNotice([
    user("2026-11-05T09:10:00.000Z"),
    plant("2026-11-05T08:00:00.000Z", "最初の通知"),
  ]);
  assert(
    "取れた行が上限より少なければ、一番古いセリフの前には何も無いので返す",
    notice?.message === "最初の通知",
    JSON.stringify(notice),
  );
}
assert("会話が無ければ返さない", lastPlantNotice([]) === null);
{
  const notice = lastPlantNotice([
    plant("2026-11-05T08:00:00.000Z", "通知"),
    plant("2026-11-05T07:00:00.000Z", "その前の通知"),
  ]);
  assert(
    "気分と時刻も返す（ホームの吹き出しで使う）",
    notice?.emotion === "満足" &&
      notice?.created_at === "2026-11-05T08:00:00.000Z" &&
      !("role" in notice),
    JSON.stringify(notice),
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
