// ホームの表示を決める計算。DOM と three.js に依存しないので、ここだけテストできる

// 開いたときに、植物の最後のセリフを吹き出しで出すか。
// message: { message, emotion, created_at } | null
// seenAt: この端末で最後に見たセリフの時刻（ISO 文字列） | null
// latestEmotion: いちばん新しい気分の記録 { emotion } | null
export function shouldShowLastMessage(message, seenAt, latestEmotion) {
  if (!message) return false;
  if (seenAt && Date.parse(message.created_at) <= Date.parse(seenAt)) {
    return false;
  }
  // セリフのあとに気分が変わっていたら、今と食い違う古いセリフなので出さない
  // （「お水ちょうだい」のあとに水をもらって満足になった、など）
  if (message.emotion && latestEmotion?.emotion !== message.emotion) {
    return false;
  }
  return true;
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
