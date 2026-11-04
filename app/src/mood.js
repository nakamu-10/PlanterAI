// カラ美の見た目を決める計算。three.js に依存しないので、ここだけテストできる

// 気分ごとの元気のなさ（0=元気、1=ぐったり）。顔・頭・体の動きに使う
export const DROOP_BY_EMOTION = {
  "満足": 0,
  "軽い不満": 0.25,
  "不満": 0.5,
  "不安": 0.7,
  "苛立ち": 0.85,
};

// 土の水分の快適度（0〜100）から、葉のしおれ具合（0〜1）を出す。
// 80 以上は快適（通知の判定 scoreToUrgency と同じ区切り）で、0 で最大までしおれる
export function wiltFromMoistureScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.min(Math.max((80 - score) / 80, 0), 1);
}

// 葉は土の水分、体（顔・頭）は気分で決める。水分が分からないときは、葉も気分に合わせる
export function moodLevels({ emotion, moistureScore = null }) {
  const body = DROOP_BY_EMOTION[emotion] ?? 0;
  const leaves = wiltFromMoistureScore(moistureScore) ?? body;
  return { leaves, body };
}
