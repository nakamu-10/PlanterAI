// カラ美の見た目を決める計算。three.js に依存しないので、ここだけテストできる

// 気分ごとの元気のなさ（0=元気、1=ぐったり）。顔・頭・体の動きに使う
export const DROOP_BY_EMOTION = {
  "満足": 0,
  "軽い不満": 0.25,
  "不満": 0.5,
  "不安": 0.7,
  "苛立ち": 0.85,
};

// この元気のなさから涙を流す（不安・苛立ち）
export const TEARS_FROM = 0.7;

// この元気のなさから、口をへの字にする（不満・不安・苛立ち）
export const FROWN_FROM = 0.5;

// 土の水分の快適度（0〜100）から、葉のしおれ具合（0〜1）を出す。
// 80 以上は快適（通知の判定 scoreToUrgency と同じ区切り）で、0 で最大までしおれる
export function wiltFromMoistureScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.min(Math.max((80 - score) / 80, 0), 1);
}

// 葉は土の水分、体（顔・頭）と涙と口は気分で決める。水分が分からないときは、葉も気分に合わせる
export function moodLevels({ emotion, moistureScore = null }) {
  // constructor などの、どのオブジェクトにもあるキーを拾わないように hasOwn で引く
  const body = Object.hasOwn(DROOP_BY_EMOTION, emotion)
    ? DROOP_BY_EMOTION[emotion]
    : 0;
  const leaves = wiltFromMoistureScore(moistureScore) ?? body;
  const tears = body >= TEARS_FROM ? 1 : 0;
  const frown = body >= FROWN_FROM ? 1 : 0;
  return { leaves, body, tears, frown };
}
