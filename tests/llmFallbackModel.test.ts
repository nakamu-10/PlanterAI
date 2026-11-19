// Gemini が混んでいる（503）ときに、予備のモデルで作り直すことの検証（ADR 0015）
// 実行: npx tsx tests/llmFallbackModel.test.ts
import {
  GEMINI_FALLBACK_MODEL,
  GEMINI_MODEL,
  generateMessage,
  LlmHttpError,
} from "../supabase/functions/_shared/llm.ts";

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean, detail = "") {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

// Edge Functions の外で動かすので、Deno.env と fetch を差し替える。
// 返事は呼ばれた順に replies から1つずつ返し、呼ばれたモデルを記録する
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: () => "test-key" },
};
type Reply = { status: number; text?: string; finishReason?: string };
let replies: Reply[] = [];
let calledModels: string[] = [];
globalThis.fetch = ((url: string) => {
  calledModels.push(url.match(/models\/([^:]+):/)?.[1] ?? "?");
  const reply = replies.shift() ?? { status: 500 };
  const body = reply.status === 200
    ? JSON.stringify({
      candidates: [{
        content: { parts: [{ text: reply.text }] },
        finishReason: reply.finishReason ?? "STOP",
      }],
    })
    : `{"error":{"code":${reply.status}}}`;
  return Promise.resolve(new Response(body, { status: reply.status }));
}) as typeof fetch;
console.warn = () => {};
console.error = () => {};

async function run(given: Reply[]) {
  replies = given;
  calledModels = [];
  try {
    return {
      text: await generateMessage("テスト", "interactive"),
      error: null,
    };
  } catch (e) {
    return { text: null, error: e };
  }
}

console.log("--- 予備のモデル ---");
assert("予備は今のモデルと別", GEMINI_FALLBACK_MODEL !== GEMINI_MODEL);

let result = await run([
  { status: 503 },
  { status: 200, text: "お水ありがとう。" },
]);
assert(
  "503 のあとは予備のモデルで作り直す",
  result.text === "お水ありがとう。" &&
    calledModels.join(",") === `${GEMINI_MODEL},${GEMINI_FALLBACK_MODEL}`,
  `${result.text} ${calledModels}`,
);

result = await run([
  { status: 429 },
  { status: 200, text: "うれしいな。" },
]);
assert(
  "429 のあとも予備のモデルで作り直す",
  calledModels.join(",") === `${GEMINI_MODEL},${GEMINI_FALLBACK_MODEL}`,
  `${calledModels}`,
);

result = await run([{ status: 503 }, { status: 503 }]);
assert(
  "予備も 503 なら、例外を投げて定型文に回させる",
  result.error instanceof LlmHttpError && calledModels.length === 2,
  `${String(result.error)} ${calledModels}`,
);

result = await run([
  { status: 200, text: "お水を少し", finishReason: "MAX_TOKENS" },
  { status: 200, text: "お水を少しちょうだい。" },
]);
assert(
  "打ち切りは同じモデルで作り直す",
  result.text === "お水を少しちょうだい。" &&
    calledModels.join(",") === `${GEMINI_MODEL},${GEMINI_MODEL}`,
  `${result.text} ${calledModels}`,
);

result = await run([{ status: 400 }]);
assert(
  "400 は作り直さない",
  result.error instanceof LlmHttpError && calledModels.length === 1,
  `${calledModels}`,
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
