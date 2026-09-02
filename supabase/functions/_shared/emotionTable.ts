// ============================================================
// emotionTable.ts — 感情判定テーブル（★差し替えポイント★)
//
// 5感情 × 6主訴 の25パターン表に相当する設定をここに集約している。
// 作成済みの25パターン表がある場合は、このファイルの数値・ルールだけを
// 書き換えればLayer 2のロジック本体は触らなくてよい。
//
// 設計の考え方（仮版）:
//   感情 = 「緊急度（スコアの深刻さ）」×「継続時間」で決まる
//   ・スコアが低いほど緊急度が高い
//   ・同じ主訴が長く続くほど感情がエスカレートする
//   ・主訴ごとに「エスカレートの速さ」が違う
//     （例: 水分過多=根腐れは進行が速いので早めに苛立ちまで到達）
// ============================================================

export type Emotion = "満足" | "軽い不満" | "不満" | "不安" | "苛立ち";
export type Complaint =
  | "水分不足" | "水分過多"
  | "日照不足" | "日照過剰"
  | "温度低すぎ" | "温度高すぎ"
  | "湿度低すぎ" | "湿度高すぎ";
export type Urgency = "none" | "low" | "medium" | "high";

export function scoreToUrgency(score: number): Urgency {
  if (score >= 80) return "none";   // 快適
  if (score >= 50) return "low";    // 注意レンジ寄り
  if (score >= 20) return "medium"; // 注意〜危険の間
  return "high";                    // 危険レンジ
  // 危険度を判定する
}

export const COMPLAINT_PRIORITY: Record<Complaint, number> = {
  "水分過多": 100, // 根腐れは不可逆で進行が速い
  "水分不足": 90,
  "温度高すぎ": 80,
  "温度低すぎ": 70,
  "日照過剰": 60,  // 葉焼け
  "日照不足": 50,  // 進行が遅い
  "湿度低すぎ": 40, // 空気の乾燥。葉先褐変は進行が遅く、水やりより緊急度は低い
  "湿度高すぎ": 30, // 多湿。単体では最も緩やか（カビは風通しとの複合要因）
  // 主訴の優先度を決める関数。
  // 植物の種類によってこの重みは異なる。
};

// ------------------------------------------------------------
// 主訴の由来センサー
// センサーが欠測しているとき「その主訴は今そもそも判定できるのか」を
// 知るために使う（emotionEngine.ts の shouldNotify）。
// ------------------------------------------------------------
export type SensorSource = "moisture" | "temp" | "light" | "humidity";

export const COMPLAINT_SOURCE: Record<Complaint, SensorSource> = {
  "水分不足": "moisture", "水分過多": "moisture",
  "温度低すぎ": "temp", "温度高すぎ": "temp",
  "日照不足": "light", "日照過剰": "light",
  "湿度低すぎ": "humidity", "湿度高すぎ": "humidity",
};

// ------------------------------------------------------------
// 感情エスカレーション表
// 緊急度 × 継続時間（時間単位）→ 感情
// escalationHours: [t1, t2] = t1時間以上で1段階、t2時間以上で2段階エスカレート
// ------------------------------------------------------------
interface EscalationRule {
  base: Record<Exclude<Urgency, "none">, Emotion>; // 発生直後の感情
  escalationHours: [number, number];
}

const EMOTION_LADDER: Emotion[] = ["軽い不満", "不満", "不安", "苛立ち"];

// 感情を n 段階エスカレートさせる（上限=苛立ち）
function escalate(e: Emotion, steps: number): Emotion {
  const idx = EMOTION_LADDER.indexOf(e);
  if (idx === -1) return e; // "満足"はエスカレートしない
  return EMOTION_LADDER[Math.min(idx + steps, EMOTION_LADDER.length - 1)];
}

export const ESCALATION_RULES: Record<Complaint, EscalationRule> = {
  "水分不足": {
    base: { low: "軽い不満", medium: "不満", high: "不安" },
    escalationHours: [24, 48], // 1日で1段階、2日で2段階
  },
  "水分過多": {
    base: { low: "不満", medium: "不安", high: "苛立ち" }, // 最初から強め
    escalationHours: [12, 24], // 根腐れは速い
  },
  "日照不足": {
    base: { low: "軽い不満", medium: "軽い不満", high: "不満" },
    escalationHours: [48, 96], // 進行が遅いのでゆっくり
  },
  "日照過剰": {
    base: { low: "軽い不満", medium: "不満", high: "不安" },
    escalationHours: [6, 12],  // 葉焼けは数時間で進む
  },
  "温度低すぎ": {
    base: { low: "軽い不満", medium: "不満", high: "不安" },
    escalationHours: [12, 24],
  },
  "温度高すぎ": {
    base: { low: "不満", medium: "不安", high: "苛立ち" },
    escalationHours: [6, 12],  // 高温障害は速い
  },
  "湿度低すぎ": {
    base: { low: "軽い不満", medium: "不満", high: "不満" },
    escalationHours: [36, 72], // 葉先の褐変はじわじわ進む（日照不足より少し速い）
  },
  "湿度高すぎ": {
    base: { low: "軽い不満", medium: "軽い不満", high: "不満" },
    escalationHours: [48, 96], // 単体では最も緩やか。近飽和が続いて初めて注意
  },
};

// 最終的な感情判定: 主訴 + 緊急度 + 継続時間 → 感情
export function decideEmotion(
  complaint: Complaint,
  urgency: Exclude<Urgency, "none">,
  durationHours: number,
): Emotion {
  const rule = ESCALATION_RULES[complaint];
  const base = rule.base[urgency];
  const [t1, t2] = rule.escalationHours;
  let steps = 0;
  if (durationHours >= t2) steps = 2;
  else if (durationHours >= t1) steps = 1;
  return escalate(base, steps);
}
