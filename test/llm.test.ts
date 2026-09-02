// ============================================================
// LLM プロファイル設定 / エラー分類 / フォールバック文面の検証
// 実行: npx tsx test/llm.test.ts
//
// 目的（2026-09-02 の定型文多発バグの再発防止）:
//   1. thinkingLevel に Gemini の有効値以外（"none" 等）が入らないこと。
//      "none" を送ると HTTP 400 になり、その経路の生成が100%失敗して
//      全通がフォールバック定型文に落ちる。しかも定型文は「それらしい文」
//      なので LINE 上は正常に見え、外から気づけなかった。
//   2. リトライが「条件を変えて」再試行すること（同一条件の再試行は無意味）。
//   3. 恒久的な失敗（400）は再試行対象外、一時障害（429/5xx）は対象。
//   4. フォールバック文面が emotion で変わること。
//      通知は (emotion, complaint) の変化で発火するので、complaint 据え置きで
//      emotion だけ変わる再通知のとき、旧実装は毎回まったく同じ文字列を送っていた。
// ============================================================
import {
  describeLlmFailure,
  LlmEmptyResponseError,
  LlmHttpError,
  LLM_PROFILES,
  LLM_RETRY_CONFIG,
  LlmTruncatedError,
} from "../supabase/functions/_shared/llm.ts";
import { fallbackMessage } from "../supabase/functions/_shared/fallback.ts";
import { Complaint, Emotion } from "../supabase/functions/_shared/emotionTable.ts";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// Google AI Studio の gemini-3.6-flash で選べる思考レベル。ここに無い値は 400 になる。
const VALID_THINKING = ["minimal", "low", "medium", "high"];

console.log("--- LLMプロファイル ---");
for (const [name, cfg] of Object.entries(LLM_PROFILES)) {
  assert(`${name}: thinkingLevel が有効値`,
    VALID_THINKING.includes(cfg.thinkingLevel), `got "${cfg.thinkingLevel}"`);
  assert(`${name}: 予算が60文字のセリフ＋思考に足りる`,
    cfg.maxOutputTokens >= 400, `got ${cfg.maxOutputTokens}`);
}
assert("retry: thinkingLevel が有効値",
  VALID_THINKING.includes(LLM_RETRY_CONFIG.thinkingLevel));
assert("retry は interactive と条件が違う（予算が厚い）",
  LLM_RETRY_CONFIG.maxOutputTokens > LLM_PROFILES.interactive.maxOutputTokens,
  `retry=${LLM_RETRY_CONFIG.maxOutputTokens} interactive=${LLM_PROFILES.interactive.maxOutputTokens}`);
assert("retry は batch とも条件が違う（予算が厚い）",
  LLM_RETRY_CONFIG.maxOutputTokens > LLM_PROFILES.batch.maxOutputTokens);

console.log("--- HTTPエラーの再試行可否 ---");
assert("400（設定ミス）は再試行しない", new LlmHttpError(400, "bad request").retryable === false);
assert("403（認証）は再試行しない", new LlmHttpError(403, "forbidden").retryable === false);
assert("429（レート制限）は再試行する", new LlmHttpError(429, "rate limit").retryable === true);
assert("500（サーバ側）は再試行する", new LlmHttpError(500, "internal").retryable === true);
assert("503（過負荷）は再試行する", new LlmHttpError(503, "overloaded").retryable === true);

console.log("--- 失敗理由のラベル（conversation_logs.finish_reason 用） ---");
assert("HTTPエラー → HTTP_400", describeLlmFailure(new LlmHttpError(400, "x")) === "HTTP_400");
assert("打ち切り → MAX_TOKENS",
  describeLlmFailure(new LlmTruncatedError("途中まで", "MAX_TOKENS")) === "MAX_TOKENS");
assert("SAFETY もそのまま残る",
  describeLlmFailure(new LlmTruncatedError("", "SAFETY")) === "SAFETY");
assert("空応答 → EMPTY", describeLlmFailure(new LlmEmptyResponseError("{}")) === "EMPTY");
assert("想定外の例外でも落ちない", typeof describeLlmFailure(new Error("boom")) === "string");
assert("例外以外でも落ちない", describeLlmFailure("なにか") === "ERROR");

console.log("--- フォールバック文面 ---");
const COMPLAINTS: Complaint[] = [
  "水分不足", "水分過多", "日照不足", "日照過剰",
  "温度低すぎ", "温度高すぎ", "湿度低すぎ", "湿度高すぎ",
];
const ALL_EMOTIONS: Emotion[] = ["満足", "軽い不満", "不満", "不安", "苛立ち"];

assert("満足（complaint=null）は専用の定型文",
  fallbackMessage(null) === fallbackMessage(null, "満足") &&
  fallbackMessage(null).length > 0);

for (const c of COMPLAINTS) {
  const mild = fallbackMessage(c, "不満");
  const strong = fallbackMessage(c, "苛立ち");
  assert(`${c}: 感情が強まると文面が変わる`, mild !== strong, `both="${mild}"`);
  assert(`${c}: どの感情でも空文字にならない`,
    ALL_EMOTIONS.every((e) => fallbackMessage(c, e).length > 0));
  assert(`${c}: emotion 省略時も従来どおり返る`, fallbackMessage(c).length > 0);
  assert(`${c}: 60文字以内`,
    ALL_EMOTIONS.every((e) => fallbackMessage(c, e).length <= 60));
}

// フォールバックはキャラ非依存。一人称を書くと tsundere / keigo で口調が破綻する。
const FIRST_PERSON = ["ボク", "わたし", "わたくし", "僕", "私"];
const allLines = COMPLAINTS.flatMap((c) => ALL_EMOTIONS.map((e) => fallbackMessage(c, e)))
  .concat(fallbackMessage(null));
assert("全定型文が一人称を含まない（キャラ非依存）",
  allLines.every((l) => !FIRST_PERSON.some((p) => l.includes(p))),
  allLines.filter((l) => FIRST_PERSON.some((p) => l.includes(p))).join(" / "));

// 確認できていない被害を断定しない（llm.ts の complaintCaution と同じ制約）
const FORBIDDEN = ["カビ", "腐っ", "根腐れ", "葉焼け", "枯れ"];
assert("全定型文が未確認の被害を断定しない",
  allLines.every((l) => !FORBIDDEN.some((w) => l.includes(w))),
  allLines.filter((l) => FORBIDDEN.some((w) => l.includes(w))).join(" / "));

// 主訴が違えば文面も違う（取り違えの検知）
const strongLines = COMPLAINTS.map((c) => fallbackMessage(c, "苛立ち"));
assert("主訴ごとに文面が一意", new Set(strongLines).size === COMPLAINTS.length);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
