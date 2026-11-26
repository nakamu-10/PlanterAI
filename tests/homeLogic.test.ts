// ホームの吹き出しと経過時間の表示（app/src/home.logic.js）の検証
// 実行: npx tsx tests/homeLogic.test.ts
import {
  chooseSpot,
  daysTogether,
  decideBubble,
  describeAgo,
  describeComfort,
  describeForecast,
  describeLightToday,
  imageFor,
  isLongAbsence,
  isOnHeadArea,
  isStaleMessage,
  modelFor,
  NEAR_WORDS,
  propPage,
  recallPlace,
  shouldShowLastMessage,
  TOUCH_HINT_2D,
  touchRoleOf,
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
assert(
  "エバーフレッシュの鉢はエバーフレッシュのモデル",
  modelFor("everfresh") === "everfresh",
);
assert("モデルがまだ無い植物はカラ美", modelFor("pothos") === "karami");
assert("植物が分からないときもカラ美", modelFor(undefined) === "karami");
assert(
  "2D の画像も植物に合わせる",
  imageFor(modelFor("cactus")) === "images/cactus.png" &&
    imageFor(modelFor("everfresh")) === "images/everfresh.png" &&
    imageFor(modelFor("calathea")) === "images/karami.png",
);

console.log("--- 今日浴びた光 ---");
{
  const light = describeLightToday({ lux_hours: 1744, target: 8000 });
  assert("目標に対する割合で出す", light.percent === 22);
  assert(
    "合計は小さな行に、区切りを入れて出す",
    light.detail === "1,744 / 8,000 lx·h",
  );
  assert("届くまでは足りていると言わない", !light.reached);
  assert("バーは割合のぶん", Math.abs(light.bar - 0.218) < 1e-9);
}
{
  const light = describeLightToday({ lux_hours: 12000, target: 8000 });
  assert("目標を超えたら足りている", light.reached && light.percent === 150);
  assert("バーは端で止める", light.bar === 1);
}
assert(
  "目標が0でも落ちない",
  describeLightToday({ lux_hours: 100, target: 0 }).percent === 0,
);

console.log("--- 頭をなでるか、体を回すか ---");
{
  // 画面上の頭が、横 100〜200、高さ 50〜150（中心 100）にあるとき
  const head = { left: 100, right: 200, bottom: 150, centerY: 100 };
  assert("顔の下半分も頭", isOnHeadArea(150, 140, head));
  assert("頭より上の葉も頭", isOnHeadArea(150, 20, head));
  assert("中心より上なら、横に広がる葉も頭", isOnHeadArea(240, 80, head));
  assert("中心より下で、頭の横は頭ではない", !isOnHeadArea(230, 130, head));
  assert("頭より下の体は頭ではない", !isOnHeadArea(150, 200, head));
}
assert(
  "2D 版の案内に、3D でしかできないことを書かない",
  !TOUCH_HINT_2D.includes("回す") && !TOUCH_HINT_2D.includes("持ち上げ"),
);

console.log("--- 部屋のどこにいるか ---");
{
  // 日本時間のその時刻（2026-11-25）
  const at = (hour: number) => Date.UTC(2026, 10, 25, hour - 9);
  const spot = (
    emotion: string,
    hour: number,
    complaint: string | null = null,
  ) => chooseSpot({ emotion, complaint, now: at(hour) });
  assert("不安なら、夜でも真ん中で訴える", spot("不安", 23) === "center");
  assert(
    "苛立ちなら、昼でも真ん中",
    spot("苛立ち", 12, "日照不足") === "center",
  );
  assert("夜22時からはベッド", spot("満足", 22) === "bed");
  assert("朝5時台もベッド", spot("不満", 5) === "bed");
  assert(
    "昼に光が足りなければ窓辺",
    spot("軽い不満", 10, "日照不足") === "window",
  );
  assert("昼に満足なら日だまり", spot("満足", 6) === "sunpatch");
  assert(
    "日照が回復した日（満足・日照不足）は日だまり",
    spot("満足", 9, "日照不足") === "sunpatch",
  );
  assert("昼の水の不満は真ん中", spot("不満", 14, "水不足") === "center");
  assert("夕方18時からはソファ", spot("満足", 18) === "sofa");
  assert("夕方は不満でもソファ", spot("不満", 21) === "sofa");
}

console.log("--- 最後のセリフのボタンの置き場 ---");
{
  const area = { left: 0, top: 100, width: 400 };
  const head = { left: 150, right: 250, top: 300, bottom: 400 };
  const place = recallPlace(head, area, 48);
  assert("頭の右端に置く", place.left === 250);
  assert("頭の上端にボタンの中心をそろえる", place.top === 176);
  const nearEdge = recallPlace({ ...head, right: 390 }, area, 48);
  assert("右にはみ出さない", nearEdge.left === 352);
  const high = recallPlace({ ...head, top: 90 }, area, 48);
  assert("上にはみ出さない", high.top === 0);
}

console.log("--- 部屋の家具を触る ---");
{
  const board = { userData: { touch: "calendar" }, parent: null };
  const pin = { userData: {}, parent: board };
  assert("家具そのものの役目を読む", touchRoleOf(board) === "calendar");
  assert("役目は親からも読む", touchRoleOf(pin) === "calendar");
  assert(
    "役目のない物は null",
    touchRoleOf({ userData: {}, parent: null }) === null,
  );
}
assert(
  "カレンダーは、鉢を保ったまま記録を開く",
  propPage("calendar", "?pot=sabotaro&demo") ===
    "records.html?pot=sabotaro&demo",
);
assert("ページのない家具は開かない", propPage("sofa", "") === null);
assert("何も触っていなければ開かない", propPage(null, "") === null);

console.log("--- 数値の画面の、快適かどうかの言葉 ---");
{
  // サボテンの土の水分（快適 10〜40%）
  const range = { comfort_low: 10, comfort_high: 40 };
  assert("帯の中は快適", describeComfort(25, range, 100)?.text === "快適");
  assert(
    "帯の上でも、気分が訴えない点数なら少し多め",
    describeComfort(45, range, 87)?.text === "少し多め",
  );
  assert(
    "帯の下でも、気分が訴えない点数なら少し少なめ",
    describeComfort(8, range, 90)?.text === "少し少なめ",
  );
  assert(
    "気分が訴える点数なら範囲外",
    describeComfort(55, range, 62)?.text === "範囲外",
  );
  assert(
    "点数が無いときは、帯の外を範囲外にする",
    describeComfort(45, range, undefined)?.text === "範囲外",
  );
  assert("値が無いときは出さない", describeComfort(null, range, 100) === null);
  assert(
    "下限ちょうどは快適",
    describeComfort(10, range, 100)?.tone === "ok",
  );
  assert(
    "上限ちょうどは快適",
    describeComfort(40, range, 50)?.tone === "ok",
  );
  assert(
    "点数がちょうど 80 なら、気分が訴えないので near",
    describeComfort(45, range, 80)?.tone === "near",
  );
  assert(
    "点数が 79 なら、気分が訴えるので warn",
    describeComfort(45, range, 79)?.tone === "warn",
  );
  const temp = { comfort_low: 15, comfort_high: 30 };
  assert(
    "温度は少し高め",
    describeComfort(32, temp, 90, NEAR_WORDS.temp)?.text === "少し高め",
  );
  assert(
    "温度は少し低め",
    describeComfort(13, temp, 90, NEAR_WORDS.temp)?.text === "少し低め",
  );
}
assert(
  "下限まで乾いても、気分が訴えない間は「そろそろ」",
  describeForecast({ status: "dry" }, 85) === "そろそろ",
);
assert(
  "気分が訴える点数なら「今すぐ」",
  describeForecast({ status: "dry" }, 79) === "今すぐ",
);

{
  const now = Date.parse("2026-11-26T12:00:00Z");
  assert(
    "6時間ぶりに開いたら迎える",
    isLongAbsence("2026-11-26T06:00:00Z", now),
  );
  assert(
    "6時間たっていなければ迎えない",
    !isLongAbsence("2026-11-26T06:00:01Z", now),
  );
  assert("初めて開いたときは迎えない", !isLongAbsence(null, now));
  assert("読めない時刻なら迎えない", !isLongAbsence("きのう", now));
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
