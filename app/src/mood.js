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

// 快適度（0〜100）がこれ以上なら、気分は訴えない（emotionTable.ts の scoreToUrgency と同じ区切り）
export const COMFORT_SCORE = 80;

// 土の水分の快適度から、葉のしおれ具合（0〜1）を出す。
// COMFORT_SCORE 以上は快適で、0 で最大までしおれる
export function wiltFromMoistureScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.min(
    Math.max((COMFORT_SCORE - score) / COMFORT_SCORE, 0),
    1,
  );
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

// 流している動きの重み。wilt: しおれ具合、pose: 座る・寝るの度合い、shot: 1回だけの動きの度合い（どれも 0〜1）。
// shot まで足した合計をいつも 1 にする。足りない分は three.js が初期ポーズで埋めるので、
// 隠している顔のパーツや布団が全部出てしまう
export function layerWeights({ wilt, pose, shot }) {
  const loop = (1 - pose) * (1 - shot);
  return {
    idle: (1 - wilt) * loop,
    wilt: wilt * loop,
    pose: pose * (1 - shot),
  };
}

// 寝る・座るの居場所で、1フレーム進める。awake: 触って起きている残りの秒数、posed: ポーズの度合い
// （0=立つ、1=ポーズ）、pending: 起き上がってから流す1回だけの動き。
// 戻り値の play は、このフレームで流し始める動き（無ければ null）
export const LIE_DOWN_RATE = 3;
export function restStep({ hasPose, awake, posed, pending, held, dt }) {
  // 持ち上げている間は数えない。長く持ってから離すと、落ちている途中で横になってしまう
  const nextAwake = held ? awake : Math.max(awake - dt, 0);
  const lying = hasPose && nextAwake === 0 && !held;
  // 横になる・起き上がるは、約0.5秒で8割
  const nextPosed = posed +
    ((lying ? 1 : 0) - posed) * (1 - Math.exp(-dt * LIE_DOWN_RATE));
  // 持ち上げている間はジタバタを続ける（ほかの動きで止めると、そのまま動かなくなる）
  const play = pending && nextPosed < 0.05 && !held ? pending : null;
  return {
    awake: nextAwake,
    posed: nextPosed,
    pending: play ? null : pending,
    play,
  };
}

// 部位ごとの、ポーズに入れ替える度合い。座るは根元と脚（seat）だけを入れ替え、顔・頭・葉は
// 気分のまま動かす。寝るは布団をかぶるので体ごと入れ替える。seatOnly が null ならポーズの無い所。
// stepping は歩く度合いで、座ると同じく根元と脚だけを入れ替える（しおれたまま歩けるように）。
// 目は混ぜずに半分で切り替える。閉じた目は笑い目を 180° 回して動かしたものなので、
// 混ぜると途中で横を向いた笑い目が開いた目の横に出る
export function partPoses({ seatOnly, posed, stepping = 0 }) {
  const whole = seatOnly === false ? posed : 0;
  const seat = Math.min((seatOnly === null ? 0 : posed) + stepping, 1);
  const eyes = whole >= 0.5 ? 1 : 0;
  return { leaves: whole, body: whole, mouth: whole, eyes, seat };
}
