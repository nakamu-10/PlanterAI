import {
  layerWeights,
  moodLevels,
  partPoses,
  restStep,
  wiltFromMoistureScore,
} from "../app/src/mood.js";

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
  "満足と軽い不満は、笑った口だけを出す",
  moodLevels({ emotion: "満足" }).frown === 0 &&
    moodLevels({ emotion: "軽い不満" }).frown === 0,
);
assert(
  "不満・不安・苛立ちは、への字の口だけを出す",
  ["不満", "不安", "苛立ち"].every((emotion) =>
    moodLevels({ emotion }).frown === 1
  ),
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

{
  const total = (
    w: { idle: number; wilt: number; pose: number },
    shot: number,
  ) => w.idle + w.wilt + w.pose + shot;
  const cases = [
    { wilt: 0, pose: 0, shot: 0 },
    { wilt: 0.4, pose: 0, shot: 0.3 },
    { wilt: 0.4, pose: 0.7, shot: 0 },
    { wilt: 1, pose: 0.5, shot: 0.5 },
    { wilt: 0.2, pose: 1, shot: 1 },
  ];
  assert(
    "動きの重みは、1回だけの動きまで足すといつも 1",
    cases.every((c) => Math.abs(total(layerWeights(c), c.shot) - 1) < 1e-9),
  );
  const asleep = layerWeights({ wilt: 0.6, pose: 1, shot: 0 });
  assert(
    "寝ている間は、待機としおれを流さない",
    asleep.pose === 1 && asleep.idle === 0 && asleep.wilt === 0,
  );
  assert(
    "1回だけの動きの間は、ポーズも止める",
    layerWeights({ wilt: 0, pose: 1, shot: 1 }).pose === 0,
  );
}

{
  type Rest = {
    hasPose: boolean;
    awake: number;
    posed: number;
    pending: string | null;
    held: boolean;
  };
  // dt 秒ずつ seconds 秒進め、途中で流し始めた動きを集める
  const run = (start: Rest, seconds: number, dt = 1 / 60) => {
    let state = { ...start };
    const played: string[] = [];
    for (let t = 0; t < seconds; t += dt) {
      const next = restStep({ ...state, dt });
      state = { ...state, ...next };
      if (next.play) played.push(next.play);
    }
    return { state, played };
  };
  const asleep: Rest = {
    hasPose: true,
    awake: 0,
    posed: 1,
    pending: null,
    held: false,
  };
  assert(
    "ベッドに移ると、2秒で横になる",
    run({ ...asleep, posed: 0 }, 2).state.posed > 0.95,
  );
  const poked = run({ ...asleep, awake: 10, pending: "surprise" }, 1.5);
  assert(
    "寝ている所をつつくと、起き上がってから驚く",
    poked.played.join() === "surprise" && poked.state.pending === null,
  );
  assert(
    "起き上がる途中では、まだ驚かない",
    run({ ...asleep, awake: 10, pending: "surprise" }, 0.3).played.length ===
      0,
  );
  assert(
    "持ち上げている間は、取っておいた動きを流さない",
    run({ ...asleep, awake: 10, pending: "surprise", held: true }, 2).played
      .length === 0,
  );
  {
    const lifted = run({ ...asleep, awake: 10, posed: 0, held: true }, 12);
    const dropped = run({ ...lifted.state, held: false }, 1);
    assert(
      "長く持ち上げてから離しても、すぐには横にならない",
      dropped.state.posed === 0,
    );
  }
  assert(
    "10秒さわられなければ、寝直す",
    run({ ...asleep, awake: 10, posed: 0 }, 12).state.posed > 0.95,
  );
  assert(
    "10秒たつまでは、立ったまま",
    run({ ...asleep, awake: 10, posed: 0 }, 9).state.posed === 0,
  );
  assert(
    "ポーズの無い居場所では、横にならない",
    run({ ...asleep, hasPose: false, posed: 0 }, 2).state.posed === 0,
  );
}

{
  const sitting = partPoses({ seatOnly: true, posed: 1 });
  assert(
    "座るときは、根元と脚だけをポーズにする",
    sitting.seat === 1 && sitting.body === 0 && sitting.leaves === 0 &&
      sitting.mouth === 0,
  );
  const sleeping = partPoses({ seatOnly: false, posed: 0.6 });
  assert(
    "寝るときは、体ごとポーズにする",
    [sleeping.seat, sleeping.body, sleeping.leaves, sleeping.mouth].every(
      (v) => v === 0.6,
    ),
  );
  assert(
    "寝る途中の目は混ぜず、半分で閉じた目に切り替える",
    sleeping.eyes === 1 &&
      partPoses({ seatOnly: false, posed: 0.4 }).eyes === 0,
  );
  assert("座るときは、目を閉じない", sitting.eyes === 0);
  const standing = partPoses({ seatOnly: null, posed: 1 });
  assert(
    "ポーズの無い所では、どこもポーズにしない",
    Object.values(standing).every((v) => v === 0),
  );
  const walking = partPoses({ seatOnly: null, posed: 0, stepping: 0.7 });
  assert(
    "歩くときは、根元と脚だけを歩く動きにする",
    walking.seat === 0.7 && walking.body === 0 && walking.leaves === 0,
  );
  const landing = partPoses({ seatOnly: true, posed: 0.6, stepping: 0.6 });
  assert("座ると歩くを合わせても、1 を超えない", landing.seat === 1);
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
