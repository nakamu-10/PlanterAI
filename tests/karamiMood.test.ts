import { moodLevels, wiltFromMoistureScore } from "../app/src/mood.js";

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

assert(
  "水分が快適（80以上）なら葉はしおれない",
  wiltFromMoistureScore(80) === 0,
);
assert("水分100でもしおれない", wiltFromMoistureScore(100) === 0);
assert("水分0で葉は最大までしおれる", wiltFromMoistureScore(0) === 1);
assert("水分40で半分しおれる", wiltFromMoistureScore(40) === 0.5);
assert("範囲外の値は0〜1に収める", wiltFromMoistureScore(-20) === 1);
assert("水分が分からなければ null", wiltFromMoistureScore(null) === null);
assert("数値でなければ null", wiltFromMoistureScore(Number.NaN) === null);

{
  const m = moodLevels({ emotion: "満足", moistureScore: 10 });
  assert(
    "気分がよくても、乾いていれば葉はしおれる",
    m.body === 0 && m.leaves > 0.8,
  );
}
{
  const m = moodLevels({ emotion: "苛立ち", moistureScore: 90 });
  assert(
    "水が足りていれば、不機嫌でも葉はしおれない",
    m.leaves === 0 && m.body === 0.85,
  );
}
{
  const m = moodLevels({ emotion: "不満" });
  assert("水分が分からないときは、葉も気分に合わせる", m.leaves === 0.5);
}
assert("不安なら涙を流す", moodLevels({ emotion: "不安" }).tears === 1);
assert("苛立ちでも涙を流す", moodLevels({ emotion: "苛立ち" }).tears === 1);
assert("不満では涙を流さない", moodLevels({ emotion: "不満" }).tears === 0);
assert(
  "乾いていても、気分がよければ涙は流さない",
  moodLevels({ emotion: "満足", moistureScore: 0 }).tears === 0,
);
assert(
  "知らない気分は元気として扱う",
  moodLevels({ emotion: "謎" }).body === 0,
);
{
  const m = moodLevels({ emotion: "constructor" });
  assert(
    "どのオブジェクトにもあるキーも、知らない気分として扱う",
    m.body === 0 && m.leaves === 0 && m.tears === 0,
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
