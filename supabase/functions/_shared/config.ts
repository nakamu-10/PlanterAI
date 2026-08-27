// ============================================================
// config.ts — 植物プロファイル（センサー閾値の設定）
//
// 植物種ごとに「快適レンジ」「注意レンジ」「危険レンジ」を定義する。
// 新しい植物に対応したいときは PLANT_PROFILES にエントリを追加し、
// devices テーブルの plant_profile を切り替えるだけでよい。
//
// ★照度は非対称に扱う（v2）:
//   light      … 瞬時値 lux。「日照過剰（葉焼け）」の判定にのみ使う。
//                 葉焼けは今この瞬間の急性イベントで、今動かせば防げる。
//                 低い側は NO_LOW で無効化してあるので、既存の
//                 detectComplaints（emotionEngine.ts）は瞬時値から
//                 「日照不足」を検出しなくなる（＝夜間の誤発火が消える）。
//   lightDaily … 積算 lux·h。「日照不足」の判定にのみ使う。
//                 不足は1日の積算量の問題で、瞬時値では判定できない。
//                 判定は dailyLight.ts / dailyLightJob.ts が日に最大2回だけ行う。
// ============================================================

// 1つのセンサーに対する閾値。数直線上に6点を置くイメージ:
//
//   dangerLow   cautionLow   comfortLow   comfortHigh   cautionHigh   dangerHigh
//  ----|------------|------------|============|------------|------------|----
//   危険側        注意側        ← 快適レンジ →         注意側         危険側
//
// スコアは快適レンジ内=100、注意境界=50、危険境界=0 になるよう線形補間する
export interface SensorThresholds {
  dangerLow: number;
  cautionLow: number;
  comfortLow: number;
  comfortHigh: number;
  cautionHigh: number;
  dangerHigh: number;
}

export interface PlantProfile {
  displayName: string;
  moisture: SensorThresholds; // 土壌水分（%）
  temp: SensorThresholds; // 気温（℃）
  light: SensorThresholds; // 瞬時照度（lux）※過剰側のみ有効
  lightDaily: SensorThresholds; // 日次積算光量（lux·h）※不足側のみ有効
  humidity: SensorThresholds; // 空気湿度（%）※スコアリングは今後実装
}

// 片側だけを有効にするための番兵値。
// Infinity は JSON.stringify で null になり scores jsonb を壊すので使わない。
const NO_LOW = 0; // これ以下の判定を無効化（luxは0以上なので常に快適扱い）
const NO_HIGH = 10_000_000; // 屋内では到達しない値（快晴12h ≒ 1,200,000 lux·h）

// SEN0193（容量式土壌水分センサー）のキャリブレーション値。
// ESP32の12bit ADC（0〜4095）の生値を水分%に変換するために使う。
// 2026-07-28 実機実測値に更新（空気中 2845 / 水中 1490）
export const SOIL_CALIBRATION = {
  airValue: 2845, // 完全に乾燥した状態のADC値（大きいほど乾燥）
  waterValue: 1490, // 水中のADC値
};

// ADC生値 → 水分% への変換（0〜100にクランプ）
export function soilAdcToPercent(adc: number): number {
  const { airValue, waterValue } = SOIL_CALIBRATION;
  const pct = ((airValue - adc) / (airValue - waterValue)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export const PLANT_PROFILES: Record<string, PlantProfile> = {
  // デフォルトはポトス（丈夫で初心者向け、閾値は一般的な栽培ガイドに基づく仮値）
  pothos: {
    displayName: "ポトス",
    moisture: {
      dangerLow: 10,
      cautionLow: 20,
      comfortLow: 40,
      comfortHigh: 70,
      cautionHigh: 85,
      dangerHigh: 95, // 過湿=根腐れリスク
    },
    temp: {
      dangerLow: 5,
      cautionLow: 12,
      comfortLow: 18,
      comfortHigh: 28,
      cautionHigh: 32,
      dangerHigh: 38,
    },
    // 過剰側のみ有効（低い側は NO_LOW で無効化）。直射日光は葉焼け
    light: {
      dangerLow: NO_LOW,
      cautionLow: NO_LOW,
      comfortLow: NO_LOW,
      comfortHigh: 10_000,
      cautionHigh: 30_000,
      dangerHigh: 60_000,
    },
    // 不足側のみ有効。comfortLow が「1日の目標積算光量」を兼ねる（唯一の真実）
    // ★v2: カラテアと同じ実測基準（10,000 lux·h）に揃えた仮値。
    //   ポトス個体の実測が貯まったら別途調整すること。
    lightDaily: {
      dangerLow: 2_000,
      cautionLow: 5_000,
      comfortLow: 10_000,
      comfortHigh: NO_HIGH,
      cautionHigh: NO_HIGH + 1,
      dangerHigh: NO_HIGH + 2,
    },
    // 空気湿度（%）。ポトスは乾燥に強いので下限はゆるめ。
    // ★v3: 「湿度高すぎ（多湿）」も発火させる方針に変更（両側有効）。
    //   注意: 真の多湿障害（カビ・軟腐）は「風通しの悪さ」との複合要因で、
    //   湿度センサー単体では厳密に判定できない。ここでの多湿判定は
    //   「かなり高湿（90%超〜）が続いている」ことを示す“注意喚起”であり、
    //   カビの断定ではない旨、LLM側のセリフでも断定させないこと。
    humidity: {
      dangerLow: 15,
      cautionLow: 25,
      comfortLow: 35,
      comfortHigh: 80,
      cautionHigh: 90,
      dangerHigh: 97,
    },
  },
  // カラテア（Calathea / マランタ科）。熱帯雨林の林床植物。
  // 特徴: 高湿度を要求し、乾燥すると葉先が褐変する（不可逆）。
  //       直射日光で葉色が褪せ葉焼けするため、上限照度がポトスの半分。
  calathea: {
    displayName: "カラテア",
    // 乾かさない。ただし過湿も嫌うので快適帯は上にシフトしつつ狭い
    moisture: {
      dangerLow: 20,
      cautionLow: 35,
      comfortLow: 50,
      comfortHigh: 80,
      cautionHigh: 90,
      dangerHigh: 97,
    },
    // 熱帯性のため低温側をポトスより引き上げる（15℃以下で生育停止）
    temp: {
      dangerLow: 10,
      cautionLow: 15,
      comfortLow: 18,
      comfortHigh: 28,
      cautionHigh: 32,
      dangerHigh: 35,
    },
    // 過剰側のみ有効。日没後の「日照不足」誤発火は lightDaily 側に移管したので、
    // ここは低い側を NO_LOW で無効化した（旧 TODO を解消）。
    // ★cautionHigh は over_20k の頻度確認後に 12,000 へ下げるか判断（発展設計 §2.7）
    light: {
      dangerLow: NO_LOW,
      cautionLow: NO_LOW,
      comfortLow: NO_LOW,
      comfortHigh: 8_000,
      cautionHigh: 20_000,
      dangerHigh: 40_000,
    },
    // 不足側のみ有効。comfortLow が「1日の目標積算光量」を兼ねる（唯一の真実）。
    // ★実測（2026-08-10〜23）に基づく確定値（v2）。
    //   日次積算は 647〜4,033（暗所群）と 12,608〜36,724（現在地群）に
    //   3倍の断絶があり、後者の最小値 12,608 の約8割 → comfortLow = 10,000。
    lightDaily: {
      dangerLow: 2_000,
      cautionLow: 5_000,
      comfortLow: 10_000,
      comfortHigh: NO_HIGH,
      cautionHigh: NO_HIGH + 1,
      dangerHigh: NO_HIGH + 2,
    },
    // 60%前後を要求。40%未満で葉先が褐変する（乾燥側が本丸）。
    // ★v3: 多湿側も発火させる方針に統一。ただしカラテアは高湿を好むため、
    //   上限は「近飽和（90%超）が続く」領域だけに限定する（風通し不良の目安）。
    //   多湿=カビの断定ではない（風通しとの複合要因）点は llm.ts の注意書き参照。
    humidity: {
      dangerLow: 30,
      cautionLow: 40,
      comfortLow: 55,
      comfortHigh: 90,
      cautionHigh: 96,
      dangerHigh: 100,
    },
  },
};

// 中央値フィルタで参照する直近サンプル数（今回の値を含む）
export const MEDIAN_WINDOW = 5;

// 会話履歴のスライディングウィンドウ件数
export const CONVERSATION_WINDOW = 7;

// 通知クールダウン（分）
// 状態がスコアの境界付近で往復（チャタリング）しても、直近の通知から
// この時間内は原則として再通知しない。境界の行ったり来たりで LINE が
// 乱発する問題（通知疲労）を頭打ちにするための最短通知間隔。
// 例外: urgency==="high"（危険域）は安全を優先し、クールダウンを無視して
//       即通知する（判定は emotionEngine.ts の shouldNotify を参照）。
export const NOTIFY_COOLDOWN_MINUTES = 60;
