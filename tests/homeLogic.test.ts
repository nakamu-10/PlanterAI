// ホームの吹き出しと経過時間の表示（app/src/home.logic.js）の検証
// 実行: npx tsx tests/homeLogic.test.ts
import {
  daysTogether,
  decideBubble,
  describeAgo,
  describeForecast,
  isStaleMessage,
  modelFor,
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

console.log("--- 乾くまでの見込み ---");
assert("推移を出せない鉢は —", describeForecast(null) === "—");
assert(
  "データが足りなければ —（乾く心配なし、とは言わない）",
  describeForecast({ status: "unknown" }) === "—",
);
assert(
  "もう乾いていれば今すぐ",
  describeForecast({ status: "dry" }) === "今すぐ",
);
assert(
  "乾いていなければしばらく先",
  describeForecast({ status: "steady" }) === "しばらく先",
);
assert(
  "2日より前は時間",
  describeForecast({ status: "drying", hours: 18 }) === "あと約18時間",
);
assert(
  "2日より先は日",
  describeForecast({ status: "drying", hours: 60 }) === "あと約3日",
);

console.log("--- 取得をくり返したときの吹き出し ---");
const satisfied = { emotion: "満足" };
// 開いたとき、セリフのあとに水をもらって満足になっている
const first = decideBubble({
  known: null,
  message,
  latestEmotion: satisfied,
  firstLoad: true,
  seenAt: null,
});
assert("開いたとき、古いセリフは出さない", !first.show);
assert("古いセリフはアイコンからも出せない", first.recallable === null);
const second = decideBubble({
  known: first.known,
  message,
  latestEmotion: satisfied,
  firstLoad: false,
  seenAt: null,
});
assert("1分後の取得でも、古いセリフは出さない", !second.show);
assert("1分後もアイコンから出せない", second.recallable === null);

const fresh = decideBubble({
  known: null,
  message,
  latestEmotion: anxious,
  firstLoad: true,
  seenAt: null,
});
assert("今のセリフは開いたときに出す", fresh.show);
const again = decideBubble({
  known: fresh.known,
  message,
  latestEmotion: anxious,
  firstLoad: false,
  seenAt: message.created_at,
});
assert("同じセリフを2回は出さない", !again.show);
assert("同じセリフはアイコンから出せる", again.recallable === message);
const watered = decideBubble({
  known: again.known,
  message,
  latestEmotion: satisfied,
  firstLoad: false,
  seenAt: message.created_at,
});
assert(
  "開いている間に満足になったら、アイコンからも出せなくなる",
  !watered.show && watered.recallable === null,
);
const notice = {
  message: "ありがとう、生き返ったよ。",
  emotion: "満足",
  created_at: "2026-11-05T10:00:00Z",
};
assert(
  "開いている間に届いたセリフは出す",
  decideBubble({
    known: watered.known,
    message: notice,
    latestEmotion: satisfied,
    firstLoad: false,
    seenAt: message.created_at,
  }).show,
);
const reply = {
  message: "うん、元気だよ。",
  emotion: "満足",
  created_at: "2026-11-05T10:05:00.100Z",
};
assert(
  "送った直後に出したチャットの返事は、取得で出し直さない",
  !decideBubble({
    known: reply,
    message: { ...reply, created_at: "2026-11-05T10:05:00.001Z" },
    latestEmotion: satisfied,
    firstLoad: false,
    seenAt: reply.created_at,
  }).show,
);

console.log("--- 3D モデル ---");
assert("サボテンの鉢はサボテンのモデル", modelFor("cactus") === "cactus");
assert("カラテアの鉢はカラ美", modelFor("calathea") === "karami");
assert("モデルがまだ無い植物はカラ美", modelFor("everfresh") === "karami");
assert("植物が分からないときもカラ美", modelFor(undefined) === "karami");

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
