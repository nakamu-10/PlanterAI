// LINE のトークから、話しかけられた鉢を決める処理の検証
// 実行: npx tsx tests/lineTalk.test.ts
import {
  isGroupTalk,
  mentionsBot,
  pickDevice,
  talkIdOf,
  withoutBotMention,
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

const inGroup = { group: true, mentioned: false };
const oneToOne = { group: false, mentioned: false };

console.log("--- 話しかけられた鉢 ---");
assert(
  "名前を呼ばれた鉢が答える",
  pickDevice([karami, cactus], "サボテン元気？", inGroup) === cactus,
);
assert(
  "重なる名前は長いほうを選ぶ",
  pickDevice([kara, karami], "カラ美、おはよう", inGroup) === karami,
);
assert(
  "グループで名前がなければ答えない",
  pickDevice([karami], "今日の夕飯なに？", inGroup) === null,
);
assert(
  "1対1なら名前がなくても答える",
  pickDevice([karami], "おはよう", oneToOne) === karami,
);
assert(
  "結んだ鉢がなければ答えない",
  pickDevice([], "カラ美", oneToOne) === null,
);

assert(
  "グループで公式アカウントにメンションされたら、名前がなくても答える",
  pickDevice([karami, cactus], "@PlanterAI おはよう", {
    group: true,
    mentioned: true,
  }) === karami,
);
assert(
  "メンションと名前があれば、名前の鉢が答える",
  pickDevice([karami, cactus], "@PlanterAI サボテンは？", {
    group: true,
    mentioned: true,
  }) === cactus,
);

console.log("--- メンション ---");
assert(
  "公式アカウントへのメンションを見分ける",
  mentionsBot({
    mention: { mentionees: [{ isSelf: false }, { isSelf: true }] },
  }),
);
assert(
  "家族へのメンションは数えない",
  !mentionsBot({ mention: { mentionees: [{ isSelf: false }] } }),
);
assert(
  "@All には反応しない",
  !mentionsBot({ mention: { mentionees: [{ type: "all" }] } }),
);
assert("メンションがなければ false", !mentionsBot({ text: "おはよう" }));

console.log("--- メンションを除く ---");
assert(
  "公式アカウントへのメンションを除く",
  withoutBotMention({
    text: "@PlanterAI おはよう",
    mention: { mentionees: [{ isSelf: true, index: 0, length: 10 }] },
  }) === "おはよう",
);
assert(
  "家族へのメンションは残す",
  withoutBotMention({
    text: "@PlanterAI @母 見て",
    mention: {
      mentionees: [
        { isSelf: true, index: 0, length: 10 },
        { isSelf: false, index: 11, length: 2 },
      ],
    },
  }) === "@母 見て",
);
assert(
  "メンションがなければそのまま",
  withoutBotMention({ text: "カラ美、元気？" }) === "カラ美、元気？",
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
