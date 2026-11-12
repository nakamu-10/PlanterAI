// 公式サイトのトップで、公開中の鉢を選ぶ（site/src/pots.js）の検証
// 実行: npx tsx tests/sitePots.test.ts
import { publicSlugs } from "../site/src/pots.js";

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

const sameSet = (actual: Set<string>, expected: string[]) =>
  actual.size === expected.length && expected.every((s) => actual.has(s));

assert(
  "公開している鉢の名前を全部取り出す",
  sameSet(
    publicSlugs({
      pots: [
        { slug: "karami", name: "カラ美" },
        { slug: "cactus", name: "サボテン" },
      ],
    }),
    ["karami", "cactus"],
  ),
);
assert(
  "カラ美しか公開していなければ、カラ美だけ",
  sameSet(publicSlugs({ pots: [{ slug: "karami", name: "カラ美" }] }), [
    "karami",
  ]),
);
assert(
  "一覧が無い答えは、どの鉢も開かない",
  sameSet(publicSlugs({ error: "not found" }), []),
);
assert("答えが null でも落ちない", sameSet(publicSlugs(null), []));
assert(
  "名前の無い鉢や空の名前は数えない",
  sameSet(
    publicSlugs({
      pots: [{ slug: "karami" }, { name: "名無し" }, { slug: "" }, null],
    }),
    ["karami"],
  ),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
