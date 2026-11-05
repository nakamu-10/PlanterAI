import assert from "node:assert/strict";
import plugin from "./readability.ts";

function lint(source: string) {
  return Deno.lint.runPlugin(plugin, "sample.ts", source);
}

function ruleIds(source: string) {
  return lint(source).map((diagnostic) => diagnostic.id);
}

// 後ろの修正から当てると、前の位置がずれない
function fixed(source: string) {
  const fixes = lint(source)
    .flatMap((diagnostic) => diagnostic.fix ?? [])
    .sort((a, b) => b.range[0] - a.range[0]);
  return fixes.reduce(
    (text, fix) =>
      text.slice(0, fix.range[0]) + (fix.text ?? "") + text.slice(fix.range[1]),
    source,
  );
}

Deno.test("区切り線だけのコメントは、行ごと消す", () => {
  const source = "// ====\n// 役割の説明\n// ====\nconst a = 1;\n";
  assert.deepEqual(ruleIds(source), [
    "planterai/no-separator-comment",
    "planterai/no-separator-comment",
  ]);
  assert.equal(fixed(source), "// 役割の説明\nconst a = 1;\n");
});

Deno.test("区切り線で挟んだ見出しは、見出しだけ残す", () => {
  const source = "  // ---- 1. 判定 ----\n  // --- 基本動作 ----------\n";
  assert.equal(fixed(source), "  // 1. 判定\n  // 基本動作\n");
});

Deno.test("表の罫線と、コードの後ろの区切り線は直さない", () => {
  assert.deepEqual(ruleIds("// ----|------|====\n// a  | b    | c\n"), []);
  const trailing = "const a = 1; // ====\n";
  assert.deepEqual(ruleIds(trailing), ["planterai/no-separator-comment"]);
  assert.equal(fixed(trailing), trailing);
});

Deno.test("★ と【】は、記号だけ消す", () => {
  const source = "// ★必ずログに残す★\n/* 未接続だと【全項目0】になる */\n";
  assert.equal(
    fixed(source),
    "// 必ずログに残す\n/* 未接続だと全項目0になる */\n",
  );
});

Deno.test("三項演算子の入れ子を止める", () => {
  assert.deepEqual(ruleIds("const a = x ? (y ? 1 : 2) : 3;"), [
    "planterai/no-nested-ternary",
  ]);
  assert.deepEqual(ruleIds("const a = x ? 1 : 2;"), []);
});

Deno.test("投げ直すだけの catch を止める", () => {
  assert.deepEqual(ruleIds("try { f(); } catch (e) { throw e; }"), [
    "planterai/no-useless-catch",
  ]);
  assert.deepEqual(
    ruleIds("try { f(); } catch (e) { console.error(e); throw e; }"),
    [],
  );
});

Deno.test("true / false に置き直す書き方を止める", () => {
  const ids = ruleIds(`
function a(x: number) { if (x > 1) { return true; } else { return false; } }
function b(x: number) { if (x > 1) return true; return false; }
const c = (x: number) => x > 1 ? true : false;
`);
  assert.deepEqual(ids, [
    "planterai/no-boolean-return",
    "planterai/no-boolean-return",
    "planterai/no-boolean-return",
  ]);
  assert.deepEqual(ruleIds("function d(x: number) { return x > 1; }"), []);
});

Deno.test("ガード節が並んだ最後の return true は見逃す", () => {
  const source = `
function valid(x: number) {
  if (x < 0) return false;
  if (x > 100) return false;
  return true;
}`;
  assert.deepEqual(ruleIds(source), []);
});

Deno.test("返すためだけの変数を止める。型注釈があれば残す", () => {
  assert.deepEqual(
    ruleIds("function a() { const result = f(); return result; }"),
    [
      "planterai/prefer-direct-return",
    ],
  );
  assert.deepEqual(
    ruleIds("function a() { const result: Foo = f(); return result; }"),
    [],
  );
  assert.deepEqual(
    ruleIds("function a() { const r = f(); g(r); return r; }"),
    [],
  );
});
