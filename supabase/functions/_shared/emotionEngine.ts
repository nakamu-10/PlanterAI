// ============================================================
// emotionEngine.ts — Layer 2: ルールベース感情エンジン
//
// 役割:
//   快適スコア（Layer 1の出力）と過去の感情ログから、
//   構造化された感情状態JSONを決定論的に生成する。
//
// ここがハルシネーション対策の要:
//   LLM（Layer 3）は「この構造化状態をセリフにする」ことしかできず、
//   状態そのものを判断しない。センサーのバグ値で「溺れる！」と
//   騒ぐような事故は、Layer 1のフィルタ + このレイヤーで防ぐ。
// ============================================================

import { ComfortScores, FilteredReading } from "./normalize.ts";
import {
  Complaint, COMPLAINT_PRIORITY, COMPLAINT_SOURCE, decideEmotion, Emotion,
  scoreToUrgency, Urgency,
} from "./emotionTable.ts";

// Layer 2の出力（構造化JSON）
export interface EmotionState {
  emotion: Emotion;
  complaint: Complaint | null; // 満足のときはnull
  urgency: Urgency;
  duration_hours: number;
  duration_label: string; // LLMプロンプト用の人間可読な継続時間（例: "2日"）
}

// 過去の感情ログ1行分（継続時間の計算・遷移検出に使う）
export interface PastEmotionLog {
  emotion: string;
  complaint: string | null;
  created_at: string; // ISO文字列
}

// ------------------------------------------------------------
// スコア + フィルタ済み値 → 主訴の候補リスト
// スコアが80未満（=快適でない）のセンサーごとに、
// 値が快適レンジの「下側」か「上側」かで主訴を決める
//
// ★欠測（Layer 1 が null を返したセンサー）はスキップする。
//   BME280が壊れて気温・湿度が読めなくても、土壌水分・照度だけで
//   判定を続行する。読めていない項目について主訴を出さないのが要点で、
//   「センサー故障を植物の不調として誤って訴える」事故を構造的に防ぐ。
// ------------------------------------------------------------
function detectComplaints(
  scores: ComfortScores,
  f: FilteredReading,
  comfortMid: { moisture: number; temp: number; light: number; humidity: number },
): { complaint: Complaint; urgency: Exclude<Urgency, "none">; score: number }[] {
  const found: { complaint: Complaint; urgency: Exclude<Urgency, "none">; score: number }[] = [];

  const check = (
    score: number | null, value: number | null, mid: number,
    lowC: Complaint, highC: Complaint,
  ) => {
    // 欠測（センサーが読めていない）→ 判定しない
    if (score === null || value === null) return;
    const urgency = scoreToUrgency(score);
    if (urgency === "none") return;
    // 快適レンジの中央より低ければ「不足系」、高ければ「過剰系」
    found.push({ complaint: value < mid ? lowC : highC, urgency, score });
  };

  check(scores.moisture, f.moisture_pct, comfortMid.moisture, "水分不足", "水分過多");
  check(scores.temp, f.temp, comfortMid.temp, "温度低すぎ", "温度高すぎ");
  check(scores.light, f.lux, comfortMid.light, "日照不足", "日照過剰");
  check(scores.humidity, f.humidity_pct, comfortMid.humidity, "湿度低すぎ", "湿度高すぎ");

  return found;
}

// ------------------------------------------------------------
// 継続時間の計算
// 過去の感情ログを新しい順に遡り、「同じ主訴」が連続している間の
// 最も古い行のタイムスタンプから現在までの時間を継続時間とする
// ------------------------------------------------------------
export function calcDurationHours(
  complaint: Complaint,
  pastLogs: PastEmotionLog[], // created_at 降順（新しい→古い）で渡すこと
): number {
  let oldestSameComplaint: string | null = null;
  for (const log of pastLogs) {
    if (log.complaint === complaint) {
      oldestSameComplaint = log.created_at; // 連続している限り更新
    } else {
      break; // 違う状態を挟んだら連続が途切れたとみなす
    }
  }
  if (!oldestSameComplaint) return 0; // 今回初めて発生した
  const ms = Date.now() - new Date(oldestSameComplaint).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

// "2日" "5時間" のような表示用ラベルに変換
export function durationLabel(hours: number): string {
  if (hours < 1) return "さっきから";
  if (hours < 24) return `${Math.floor(hours)}時間`;
  return `${Math.floor(hours / 24)}日`;
}

// ------------------------------------------------------------
// メイン: 感情状態の決定
// ------------------------------------------------------------
export function evaluateEmotion(
  scores: ComfortScores,
  filtered: FilteredReading,
  comfortMid: { moisture: number; temp: number; light: number; humidity: number },
  pastLogs: PastEmotionLog[],
): EmotionState {
  const complaints = detectComplaints(scores, filtered, comfortMid);

  // 主訴なし → 満足
  if (complaints.length === 0) {
    return {
      emotion: "満足", complaint: null, urgency: "none",
      duration_hours: 0, duration_label: "",
    };
  }

  // 複数の主訴がある場合の優先順位ルール:
  //   1. 緊急度が高いものを最優先（high > medium > low）
  //   2. 緊急度が同じなら COMPLAINT_PRIORITY（ダメージの深刻さ）で決める
  const urgencyRank: Record<Urgency, number> = { high: 3, medium: 2, low: 1, none: 0 };
  complaints.sort((a, b) =>
    urgencyRank[b.urgency] - urgencyRank[a.urgency] ||
    COMPLAINT_PRIORITY[b.complaint] - COMPLAINT_PRIORITY[a.complaint]
  );
  const top = complaints[0];

  const hours = calcDurationHours(top.complaint, pastLogs);
  const emotion = decideEmotion(top.complaint, top.urgency, hours);

  return {
    emotion,
    complaint: top.complaint,
    urgency: top.urgency,
    duration_hours: Math.round(hours * 10) / 10,
    duration_label: durationLabel(hours),
  };
}

// ------------------------------------------------------------
// 状態遷移の判定: 前回の状態と (emotion, complaint) のどちらかが
// 変わっていたら「遷移した」とみなし、通知対象にする。
// 同じ状態が続く間は通知しない → 通知疲労の防止
// ------------------------------------------------------------
export function hasTransitioned(
  current: EmotionState,
  previous: { emotion: string; complaint: string | null } | null,
): boolean {
  if (!previous) {
    // 初回は「満足」なら通知しない（意味のある通知だけ送る）
    return current.emotion !== "満足";
  }
  return current.emotion !== previous.emotion ||
    current.complaint !== previous.complaint;
}

// ------------------------------------------------------------
// 感情の深刻度ランク（満足=0 … 苛立ち=4）
// 「危険域か」の判定は urgency を使うが、将来「悪化したか」を
// 感情ベースで見たくなったとき用に定義を残しておく。
// ------------------------------------------------------------
export const EMOTION_SEVERITY: Record<string, number> = {
  "満足": 0, "軽い不満": 1, "不満": 2, "不安": 3, "苛立ち": 4,
};

// ユーザーが最後に受け取った通知の状態（クールダウン判定の基準）
export interface LastNotifiedState {
  emotion: string;
  complaint: string | null;
  created_at: string; // ISO文字列
}

// ------------------------------------------------------------
// 通知すべきか（クールダウン付き）
//
// なぜ hasTransitioned だけでは足りないか:
//   hasTransitioned は「直前の記録行」と比べる。しかしスコアが境界
//   （例: 80 の 満足/軽い不満 境界）付近で揺れると、毎POSTごとに状態が
//   往復し、その1回1回が「遷移」になって LINE が乱発する（通知疲労）。
//
// この関数は基準を「直前の記録行」ではなく「ユーザーが最後に受け取った
// 通知」に置き、そこから最短通知間隔（クールダウン）を設けることで
// 往復による乱発を頭打ちにする。
//
// ルール:
//   1. 最後に通知した状態と (emotion, complaint) が同じなら通知しない
//   2. urgency==="high"（危険域）は安全優先でクールダウンを無視し即通知
//   3. 欠測中のセンサーが原因だった主訴からの「回復」は送らない
//   4. それ以外は、最後の通知から cooldownMinutes 以内なら見送る
//
// 基準を「最後の通知」に置くのが要点。クールダウン中に状態が悪化しても
// その変化は捨てられず、クールダウン明けの最初のPOSTで確実に通知される
// （＝「悪化を取りこぼす」ことがない）。
// ------------------------------------------------------------
export function shouldNotify(
  current: EmotionState,
  lastNotified: LastNotifiedState | null,
  cooldownMinutes: number,
  missingSensors: readonly string[] = [],
): boolean {
  // 最後に通知した状態（一度も通知していなければ「満足」を基準にする）
  const baseEmotion = lastNotified?.emotion ?? "満足";
  const baseComplaint = lastNotified?.complaint ?? null;

  // 1. ユーザーに伝えるべき変化がなければ通知しない
  const changed =
    current.emotion !== baseEmotion || current.complaint !== baseComplaint;
  if (!changed) return false;

  // 1.5 「満足に戻った」通知は、直前に伝えた主訴のセンサーが欠測している
  //   ときだけ見送る。センサーが壊れて主訴が消えただけで、実際には不調が
  //   続いているかもしれないため（例: 高温で不満 → BME280故障 → 満足）。
  //   見えていないものを「元気になりました」と伝えるのは誤報になる。
  //
  //   逆に、読めているセンサーの回復（例: 水やりで水分不足が解消）は、
  //   温湿度が欠測中でも従来どおり通知する。欠測を理由に、根拠のある
  //   回復報告まで黙ってしまわないための線引き。
  //   悪化方向（新しい主訴の発生）も欠測中に関係なく通知する。
  if (
    current.emotion === "満足" && baseComplaint !== null &&
    missingSensors.includes(COMPLAINT_SOURCE[baseComplaint as Complaint])
  ) {
    return false;
  }

  // 2. 危険域は通知疲労より安全を優先し、クールダウンを無視して即通知
  if (current.urgency === "high") return true;

  // 3. クールダウン中（＝直近に通知したばかり）なら見送る
  if (lastNotified) {
    const elapsedMin =
      (Date.now() - new Date(lastNotified.created_at).getTime()) / 60000;
    if (elapsedMin < cooldownMinutes) return false;
  }

  return true;
}
