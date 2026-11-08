// LINE のトークから、話しかけられた鉢を決める処理の検証
// 実行: npx tsx tests/lineTalk.test.ts
import {
  isGroupTalk,
  pickDevice,
  talkIdOf,
} from "../supabase/functions/_shared/lineTalk.ts";

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

const karami = { id: "1", plant_name: "カラ美" };
const kara = { id: "2", plant_name: "カラ" };
const cactus = { id: "3", plant_name: "サボテン" };

console.log("--- トークの ID ---");
assert(
  "1対1は送り主の ID",
  talkIdOf({ type: "user", userId: "U1" }) === "U1",
);
assert(
  "グループはグループの ID（送り主ではない）",
  talkIdOf({ type: "group", groupId: "C1", userId: "U1" }) === "C1",
);
assert(
  "複数人トークはトークの ID",
  talkIdOf({ type: "room", roomId: "R1", userId: "U1" }) === "R1",
);
assert("ID が無ければ null", talkIdOf(undefined) === null);
assert("グループを見分ける", isGroupTalk({ type: "group" }));
assert("1対1はグループではない", !isGroupTalk({ type: "user" }));

console.log("--- 話しかけられた鉢 ---");
assert(
  "名前を呼ばれた鉢が答える",
  pickDevice([karami, cactus], "サボテン元気？", true) === cactus,
);
assert(
  "重なる名前は長いほうを選ぶ",
  pickDevice([kara, karami], "カラ美、おはよう", true) === karami,
);
assert(
  "グループで名前がなければ答えない",
  pickDevice([karami], "今日の夕飯なに？", true) === null,
);
assert(
  "1対1なら名前がなくても答える",
  pickDevice([karami], "おはよう", false) === karami,
);
assert(
  "結んだ鉢がなければ答えない",
  pickDevice([], "カラ美", false) === null,
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
