// 名前の横の「∨」で開く鉢の一覧（app/src/potMenu.logic.js）の検証
// 実行: npx tsx tests/potMenu.test.ts
import { potCountLabel, potMenuItems } from "../app/src/potMenu.logic.js";

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

const pots = [
  { slug: "karami", name: "カラ美" },
  { slug: "cactus", name: "サボ太郎" },
  { slug: "everfresh", name: "エバ子" },
];

const items = potMenuItems(pots, "cactus", "/app/", "?pot=cactus&demo");
assert("鉢の数だけ並ぶ", items.length === 3);
assert("名前を出す", items[0].name === "カラ美");
assert("見ている鉢に印を付ける", items[1].current && !items[0].current);
assert(
  "?demo は残し、鉢だけを替える",
  items[2].href === "/app/?pot=everfresh&demo=",
);
assert(
  "鉢の指定が無くても、鉢を足す",
  potMenuItems(pots, "karami", "/app/", "")[1].href === "/app/?pot=cactus",
);
assert(
  "鉢が1つなら一覧を出さない",
  potMenuItems(pots.slice(0, 1), "karami", "/app/", "").length === 0,
);
assert(
  "鉢の一覧が無い（鍵ありの手元）なら出さない",
  potMenuItems(undefined, "karami", "/app/", "").length === 0,
);

assert("鉢の数を出す", potCountLabel(pots) === "3鉢");
assert("鉢が1つなら数を出さない", potCountLabel(pots.slice(0, 1)) === "");
assert("鉢の一覧が無ければ数を出さない", potCountLabel(undefined) === "");

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
