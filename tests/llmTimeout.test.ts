// Gemini を待つ時間を、呼ぶ側で変えられることの検証（#89）
// 実行: npx tsx tests/llmTimeout.test.ts
import {
  generateMessage,
  REPLY_TIMEOUT_MS,
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
// fetch は返事をせず、打ち切られるまで待つ（Gemini がとても遅いとき）
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: () => "test-key" },
};
let calls = 0;
globalThis.fetch = ((_url: string, init?: RequestInit) => {
  calls++;
  return new Promise((_resolve, reject) => {
    // Node の AbortSignal.timeout はプロセスを生かさないので、打ち切りまで待たせる
    const keepAlive = setInterval(() => {}, 1_000);
    init?.signal?.addEventListener("abort", () => {
      clearInterval(keepAlive);
      reject(init.signal?.reason);
    });
  });
}) as typeof fetch;
console.warn = () => {};

console.log("--- 待つ時間 ---");
assert("返事は通知（12秒）より長く待つ", REPLY_TIMEOUT_MS > 12_000);

const startedAt = Date.now();
let error: unknown = null;
try {
  await generateMessage("テスト", "interactive", { timeoutMs: 100 });
} catch (e) {
  error = e;
}
const elapsed = Date.now() - startedAt;
assert(
  "指定した時間で打ち切る",
  error instanceof Error && error.name === "TimeoutError" && elapsed < 2_000,
  `${String(error)} ${elapsed}ms`,
);
assert("時間切れは作り直さない（1回だけ呼ぶ）", calls === 1, `${calls}回`);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
