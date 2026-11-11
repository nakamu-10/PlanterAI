// ホームの表示を決める計算。DOM と three.js に依存しないので、ここだけテストできる

// 植物の種類ごとの 3D モデル（app/public/models/ のファイル名）。
// モデルがまだ無い植物は、カラ美で表す
const MODELS = { cactus: "cactus", everfresh: "everfresh" };

export function modelFor(plantProfile) {
  return MODELS[plantProfile] ?? "karami";
}

// 3D を出せないときの画像（app/public/images/）。モデルと同じ名前にしてある
export function imageFor(model) {
  return `/images/${model}.png`;
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

export function daysTogether(createdIso, now = Date.now()) {
  return jstDay(now) - jstDay(Date.parse(createdIso)) + 1;
}

// 土が乾くまでの見込み（app-data の trends.moisture.forecast）を言葉にする
export function describeForecast(forecast) {
  switch (forecast?.status) {
    case "dry":
      return "今すぐ";
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
