// ============================================================
// 通知クールダウン（shouldNotify）のロジック検証
// 実行: npx tsx test/notify.test.ts
//
// 目的:
//   スコアが境界付近で往復（チャタリング）しても LINE が乱発しないこと、
//   かつ危険域の悪化は見逃さないこと、を固定する。
//   logic.test.ts と同じ流儀（assert ヘルパ / 最後に exit）で書いている。
// ============================================================
import { NOTIFY_COOLDOWN_MINUTES } from "../supabase/functions/_shared/config.ts";
import {
  EmotionState,
  LastNotifiedState,
  shouldNotify,
} from "../supabase/functions/_shared/emotionEngine.ts";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// テスト用のヘルパ
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();

// 現在の感情状態を作る（duration系は判定に無関係なのでダミー）
function state(emotion: string, complaint: string | null, urgency: string): EmotionState {
  return { emotion, complaint, urgency, duration_hours: 0, duration_label: "" } as EmotionState;
}
// 「最後に通知した状態」を作る（minAgo 分前に通知した想定）
function lastNotified(
  emotion: string, complaint: string | null, minAgo: number,
): LastNotifiedState {
  return { emotion, complaint, created_at: iso(minAgo) };
}

const CD = NOTIFY_COOLDOWN_MINUTES; // 既定 60

console.log(`--- 通知クールダウン = ${CD}分 ---`);

// --- 基本動作 ---------------------------------------------------------------

// 一度も通知していない状態で「満足」なら通知しない（意味のある通知だけ送る）
assert("初回・満足は通知しない",
  shouldNotify(state("満足", null, "none"), null, CD) === false);

// 一度も通知していない状態で主訴が出たら即通知（クールダウンの基準がない）
assert("初回・主訴(low)は通知する",
  shouldNotify(state("軽い不満", "水分不足", "low"), null, CD) === true);

// 最後に通知した状態と同じ (emotion, complaint) なら通知しない
assert("最後の通知と同一状態は通知しない",
  shouldNotify(
    state("軽い不満", "水分不足", "low"),
    lastNotified("軽い不満", "水分不足", 5),
    CD,
  ) === false);

// --- 本命: 境界の往復（チャタリング）を抑制する ------------------------------

// スコア80境界の往復: 満足 → 軽い不満。5分前に満足を通知済み → クールダウンで抑制
assert("80境界の往復(満足⇄軽い不満)はクールダウンで抑制",
  shouldNotify(
    state("軽い不満", "水分不足", "low"),
    lastNotified("満足", null, 5),
    CD,
  ) === false);

// 回復方向の往復: 軽い不満 → 満足。5分前に通知済み → 抑制
assert("回復方向の往復(軽い不満→満足)も抑制",
  shouldNotify(
    state("満足", null, "none"),
    lastNotified("軽い不満", "水分不足", 5),
    CD,
  ) === false);

// 境界ちょうど手前（50分前 < 60分）→ まだ抑制される
assert("クールダウン内(50分前)は抑制",
  shouldNotify(
    state("軽い不満", "水分不足", "low"),
    lastNotified("満足", null, 50),
    CD,
  ) === false);

// クールダウン明け（65分経過）→ 変化があれば通知する（＝取りこぼさない）
assert("クールダウン明け(65分前)は通知する",
  shouldNotify(
    state("軽い不満", "水分不足", "low"),
    lastNotified("満足", null, 65),
    CD,
  ) === true);

// --- 危険域(high)の例外: 悪化を見逃さない ----------------------------------

// クールダウン中でも、危険域(high)への悪化は即通知
assert("危険域(high)はクールダウン中でも即通知",
  shouldNotify(
    state("不安", "水分不足", "high"),
    lastNotified("軽い不満", "水分不足", 5),
    CD,
  ) === true);

// ただし危険域でも「同一状態」の連投はしない（HTTPスパム防止）
assert("危険域でも同一状態なら通知しない",
  shouldNotify(
    state("不安", "水分不足", "high"),
    lastNotified("不安", "水分不足", 5),
    CD,
  ) === false);

// --- 設計判断の固定: 非危険な悪化はクールダウンに従う ------------------------
// （medium域への悪化まで即通知にすると 50境界の往復穴が開くため、
//   例外は high のみに絞っている。この方針をテストで固定する）

assert("クールダウン中の非危険な悪化(medium)は見送る",
  shouldNotify(
    state("不満", "水分不足", "medium"),
    lastNotified("軽い不満", "水分不足", 5),
    CD,
  ) === false);

// 主訴が別物に変わっても、非危険かつクールダウン中なら見送る（ラベルの往復対策）
assert("クールダウン中の主訴の横滑り(medium)も見送る",
  shouldNotify(
    state("不満", "温度高すぎ", "medium"),
    lastNotified("軽い不満", "水分不足", 5),
    CD,
  ) === false);

// --- センサー欠測時: 誤った「回復しました」通知を抑止する ------------------
// BME280が壊れて温度の主訴が消えただけなのに「満足に戻った」と伝えるのは誤報。
// ただし黙るのは「欠測したセンサーが原因だった主訴」からの回復だけで、
// 水やりによる水分不足の回復のように根拠のある回復は従来どおり通知する。
const BME_DEAD = ["temp", "humidity"]; // BME280が読めていない状態

assert("欠測なし: 温度主訴からの回復は通知する",
  shouldNotify(
    state("満足", null, "none"),
    lastNotified("不満", "温度高すぎ", CD + 5),
    CD,
  ) === true);

assert("温湿度が欠測: 温度主訴からの回復は通知しない",
  shouldNotify(
    state("満足", null, "none"),
    lastNotified("不満", "温度高すぎ", CD + 5),
    CD,
    BME_DEAD,
  ) === false);

assert("温湿度が欠測でも: 水やりによる回復は通知する",
  shouldNotify(
    state("満足", null, "none"),
    lastNotified("不満", "水分不足", CD + 5),
    CD,
    BME_DEAD,
  ) === true);

assert("温湿度が欠測: 新たな不調（悪化）は通知する",
  shouldNotify(
    state("不満", "水分不足", "medium"),
    lastNotified("満足", null, CD + 5),
    CD,
    BME_DEAD,
  ) === true);

assert("温湿度が欠測: 危険域はクールダウン中でも即通知",
  shouldNotify(
    state("不安", "水分不足", "high"),
    lastNotified("軽い不満", "水分不足", 5),
    CD,
    BME_DEAD,
  ) === true);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
