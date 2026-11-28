// 部屋の窓・日だまり・ランプ・時計（app/src/room.logic.js）の検証
// 実行: npx tsx tests/roomLook.test.ts
import {
  BRIGHT_LUX,
  clockAngles,
  DIM_LUX,
  freshLux,
  LUX_FRESH_MINUTES,
  roomLook,
} from "../app/src/room.logic.js";

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

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
// 2026-11-28 の日本時間の h:m
const at = (h: number, m = 0) =>
  Date.parse(`2026-11-28T00:00:00+09:00`) + (h * 60 + m) * 60_000;

{
  assert("昼は昼の空", roomLook({ now: at(12), lux: 2000 }).phase === "day");
  assert(
    "16時は夕方の空",
    roomLook({ now: at(16), lux: 300 }).phase === "twilight",
  );
  assert(
    "6時台は朝焼けの空",
    roomLook({ now: at(6, 30) }).phase === "twilight",
  );
  assert("18時からは夜の空", roomLook({ now: at(18) }).phase === "night");
  assert("5時は夜の空", roomLook({ now: at(5) }).phase === "night");
}

{
  assert(
    "明るい区切り以上なら、一番明るい",
    roomLook({ now: at(12), lux: BRIGHT_LUX + 500 }).daylight === 1,
  );
  assert(
    "暗い区切り以下なら、一番暗い",
    roomLook({ now: at(12), lux: DIM_LUX - 50 }).daylight === 0,
  );
  const half = roomLook({ now: at(12), lux: (DIM_LUX + BRIGHT_LUX) / 2 });
  assert("間の照度は、間の明るさ", near(half.daylight, 0.5));
  assert(
    "照度が分からなければ、明るい日として見せる",
    roomLook({ now: at(12), lux: null }).daylight === 1,
  );
}

{
  assert(
    "日だまりは、昼の明るさで濃くなる",
    near(
      roomLook({ now: at(12), lux: (DIM_LUX + BRIGHT_LUX) / 2 }).sunpatch,
      0.5,
    ),
  );
  assert(
    "夕方と夜は、日だまりを出さない",
    roomLook({ now: at(16), lux: 2000 }).sunpatch === 0 &&
      roomLook({ now: at(20), lux: 2000 }).sunpatch === 0,
  );
}

{
  assert("ランプは18時に点く", roomLook({ now: at(18) }).lamp);
  assert("ランプは寝る22時に消える", !roomLook({ now: at(22) }).lamp);
  assert("昼はランプを消す", !roomLook({ now: at(12) }).lamp);
}

{
  const threeOClock = clockAngles(at(3));
  assert(
    "3時は、短い針が右（四分の一回り）で、長い針が真上",
    near(threeOClock.hour, Math.PI / 2) && near(threeOClock.minute, 0),
  );
  const halfPast = clockAngles(at(15, 30));
  assert(
    "15時半は、短い針が3と4の間で、長い針が真下",
    near(halfPast.hour, Math.PI / 2 + Math.PI / 12) &&
      near(halfPast.minute, Math.PI),
  );
}

{
  const now = at(12);
  const sensor = (minutesAgo: number, lux: unknown = 800) => ({
    filtered: { lux },
    created_at: new Date(now - minutesAgo * 60_000).toISOString(),
  });
  assert("新しい照度は、そのまま使う", freshLux(sensor(10), now) === 800);
  assert(
    "鉢が止まって古くなった照度は、使わない",
    freshLux(sensor(LUX_FRESH_MINUTES), now) === null,
  );
  assert(
    "センサー値や照度が無ければ、使わない",
    freshLux(null, now) === null && freshLux(sensor(10, null), now) === null,
  );
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
