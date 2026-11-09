// LINE に送れなくても、セリフを記録できるように理由を返す処理の検証
// 実行: npx tsx tests/line.test.ts
import { pushIfLinked } from "../supabase/functions/_shared/line.ts";

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

// Edge Functions の外で動かすので、Deno.env と fetch を差し替える
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: () => "test-token" },
};
let calls = 0;
let status = 200;
globalThis.fetch = (() => {
  calls++;
  return Promise.resolve(new Response("quota", { status }));
}) as typeof fetch;
console.error = () => {};

console.log("--- LINE と結んでいない鉢 ---");
assert("送らずに null", (await pushIfLinked(null, "のどかわいた")) === null);
assert("LINE を呼ばない", calls === 0);

console.log("--- 届いた ---");
assert("null を返す", (await pushIfLinked("U1", "のどかわいた")) === null);

console.log("--- 届かなかった（形を断られた）---");
status = 400;
const error = await pushIfLinked("U1", "のどかわいた");
assert(
  "例外にせず、理由を返す",
  error !== null && error.includes("400"),
  String(error),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
