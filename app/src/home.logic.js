// ホームの表示を決める計算。DOM と three.js に依存しないので、ここだけテストできる
import { COMFORT_SCORE } from "./mood.js";

// 植物の種類ごとの 3D モデル（app/public/models/ のファイル名）。
// モデルがまだ無い植物は、カラ美で表す
const MODELS = { cactus: "cactus", everfresh: "everfresh" };

export function modelFor(plantProfile) {
  return MODELS[plantProfile] ?? "karami";
}

// 3D を出せないときの画像（app/public/images/）。モデルと同じ名前にしてある。
// アプリは /app/ の下で出すので、使う側で import.meta.env.BASE_URL を前に付ける
export function imageFor(model) {
  return `images/${model}.png`;
}

// 前に開いてからこの時間がたっていたら、キャラが歩いてきて迎える
export const WELCOME_AFTER_MS = 6 * 60 * 60 * 1000;

// lastOpenedIso: この端末で前に開いた時刻。初めて開いたとき（null）は迎えない
export function isLongAbsence(lastOpenedIso, now = Date.now()) {
  const last = Date.parse(lastOpenedIso ?? "");
  return Number.isFinite(last) && now - last >= WELCOME_AFTER_MS;
}

// セリフのあとに気分が変わっていたら、今と食い違う古いセリフ
// （「お水ちょうだい」のあとに水をもらって満足になった、など）
export function isStaleMessage(message, latestEmotion) {
  return Boolean(
    message.emotion && latestEmotion &&
      latestEmotion.emotion !== message.emotion,
  );
}

// 開いたときに、植物の最後のセリフを吹き出しで出すか。
// message: { message, emotion, created_at } | null
// seenAt: この端末で最後に見たセリフの時刻（ISO 文字列） | null
// latestEmotion: いちばん新しい気分の記録 { emotion } | null
export function shouldShowLastMessage(message, seenAt, latestEmotion) {
  if (!message) return false;
  if (seenAt && Date.parse(message.created_at) <= Date.parse(seenAt)) {
    return false;
  }
  return !isStaleMessage(message, latestEmotion);
}

// 取得のたびに、吹き出しをどうするかを決める。
// known: 前回までに受け取ったセリフ（新しいかどうかを比べる相手）
// firstLoad: 開いて最初の取得か。seenAt: この端末で最後に見たセリフの時刻
// 返す値: known は次の比べる相手、show は今出すか、recallable はアイコンから出し直せるセリフ。
// known と recallable を分けておかないと、古くなったセリフを recallable から外したときに
// 次の取得で「新しいセリフ」と見なされ、また出てしまう
export function decideBubble({
  known,
  message,
  latestEmotion,
  firstLoad,
  seenAt,
}) {
  // チャットの返事は送った直後に出しているので、同じ文なら新しいと見なさない
  const isNew = Boolean(message) &&
    message.created_at !== known?.created_at &&
    message.message !== known?.message;
  const current = isNew ? message : known;
  // 開いたときは、まだ見ていない今のセリフだけ出す。開いている間に届いたセリフ（LINE の通知など）はいつも出す
  const show = isNew &&
    (!firstLoad || shouldShowLastMessage(message, seenAt, latestEmotion));
  const recallable = current && !isStaleMessage(current, latestEmotion)
    ? current
    : null;
  return { known: current, show, recallable };
}

// 「3日前」「たった今」のような、ざっくりした経過時間
export function describeAgo(iso, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 5) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

// 鉢を登録した日を1日目として、日本時間の暦の日で数える
// （24時間ごとに数えると、23時に登録して翌朝開いたときに「1日目」のままになる）
const JST_MS = 9 * 3_600_000;
const jstDay = (ms) => Math.floor((ms + JST_MS) / 86_400_000);

const jstHour = (ms) => Math.floor(((ms + JST_MS) % 86_400_000) / 3_600_000);

// 部屋のどこにいるか（spot_* の名前）。上から順に見て、最初に当てはまった所。
// つらいときは、寝ていて気づけないことがないよう、一番目に入る真ん中で訴える
export function chooseSpot({ emotion, complaint, now = Date.now() }) {
  if (emotion === "不安" || emotion === "苛立ち") return "center";
  const hour = jstHour(now);
  if (hour >= 22 || hour < 6) return "bed";
  if (hour < 18) {
    // 日照が足りて回復した日も、complaint は「日照不足」のまま記録される
    if (complaint === "日照不足" && emotion !== "満足") return "window";
    if (emotion === "満足") return "sunpatch";
    return "center";
  }
  return "sofa";
}

export function daysTogether(createdIso, now = Date.now()) {
  return jstDay(now) - jstDay(Date.parse(createdIso)) + 1;
}

export const isComfortable = (score) =>
  typeof score === "number" && score >= COMFORT_SCORE;

// 帯の外でも気分が訴えない間の言葉。量（水分・湿度）と温度で言い方を変える
export const NEAR_WORDS = {
  amount: { high: "少し多め", low: "少し少なめ" },
  temp: { high: "少し高め", low: "少し低め" },
};

// 数値の画面の「快適」などの言葉。帯の外でも気分が訴えない間は「少し多め」と言い、
// 「範囲外」なのに満足している、と見えないようにする
export function describeComfort(
  value,
  range,
  score,
  words = NEAR_WORDS.amount,
) {
  if (typeof value !== "number" || !range) return null;
  if (value >= range.comfort_low && value <= range.comfort_high) {
    return { text: "快適", tone: "ok" };
  }
  if (isComfortable(score)) {
    return {
      text: value > range.comfort_high ? words.high : words.low,
      tone: "near",
    };
  }
  return { text: "範囲外", tone: "warn" };
}

// 土が乾くまでの見込み（app-data の trends.moisture.forecast）を言葉にする。
// 見込みは快適の下限で「乾いた」とするが、気分はまだ訴えない（score が COMFORT_SCORE 以上）
// 間は「そろそろ」と言い、数値の画面の「少し少なめ」と食い違わないようにする
export function describeForecast(forecast, score) {
  switch (forecast?.status) {
    case "dry":
      return isComfortable(score) ? "そろそろ" : "今すぐ";
    case "steady":
      return "しばらく先";
    case "drying":
      return forecast.hours < 48
        ? `あと約${forecast.hours}時間`
        : `あと約${Math.round(forecast.hours / 24)}日`;
    default:
      // データが足りない（unknown）か、推移を出せない鉢
      return "—";
  }
}

// 今日の日照を、目標に対する割合で言う。lx·h は見慣れない単位なので、
// 大きく出すのは割合にして、合計の数字は小さな行に回す（#93）
export function describeLightToday({ lux_hours, target }) {
  const ratio = target > 0 ? lux_hours / target : 0;
  const number = (v) => v.toLocaleString("ja-JP");
  return {
    percent: Math.round(ratio * 100),
    bar: Math.min(1, Math.max(0, ratio)),
    reached: target > 0 && lux_hours >= target,
    detail: `${number(lux_hours)} / ${number(target)} lx·h`,
  };
}

// 2D 版のカラ美の下の案内。3D 用の案内（index.html）と違い、つつくとなでるしかできない（#30）
export const TOUCH_HINT_2D = "タップでつつく・ドラッグでなでる";

// 押した点が頭の上か（ドラッグするとなでる。それ以外は回す）。
// head は画面上の頭を囲む四角と、頭の中心の高さ。
// 頭の中心より上は、左右に広がる葉も含めて頭（今までどおり）。
// 中心より下は、頭の四角の中だけを頭にする。顔の下半分は頭に入り、
// 頭の横の体は入らない（#30）
export function isOnHeadArea(clientX, clientY, head) {
  if (clientY < head.centerY) return true;
  return clientX >= head.left && clientX <= head.right &&
    clientY <= head.bottom;
}

// 最後のセリフのボタンを、頭の右上に置く。ボタンの置き場（area）からはみ出さない
export function recallPlace(head, area, size) {
  const left = Math.min(head.right - area.left, area.width - size);
  const top = head.top - size / 2 - area.top;
  return { left: Math.max(left, 0), top: Math.max(top, 0) };
}

// 部屋の家具は、Blender で付けた触ったときの役目（touch）を持つ。
// 役目は家具のまとまりの親に付くこともあるので、親をたどって探す
export function touchRoleOf(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData?.touch) return o.userData.touch;
  }
  return null;
}

// 触ると開くページ。鉢と ?demo などは、開いた先でも保つ
const PROP_PAGES = { calendar: "records.html" };
export function propPage(role, search) {
  const page = PROP_PAGES[role];
  return page ? `${page}${search}` : null;
}
