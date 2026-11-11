// アプリで触った記録を、返事のプロンプトに入れる言葉にする処理の検証
// 実行: npx tsx tests/touches.test.ts
import {
  describeTouches,
  isTouchKind,
  type TouchEntry,
} from "../supabase/functions/_shared/touches.ts";
import { buildReplyPrompt } from "../supabase/functions/_shared/llm.ts";
import { stateFromLog } from "../supabase/functions/_shared/emotionEngine.ts";

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

const now = new Date("2026-11-06T12:00:00Z");
const at = (minutesAgo: number) =>
  new Date(now.getTime() - minutesAgo * 60_000).toISOString();

console.log("--- 触った記録の言葉 ---");
assert("触られていなければ null", describeTouches([], now) === null);

const touches: TouchEntry[] = [
  { kind: "poke", created_at: at(10) },
  { kind: "poke", created_at: at(30) },
  { kind: "poke", created_at: at(50) },
  { kind: "pet", created_at: at(2) },
];
const described = describeTouches(touches, now) ?? "";
assert(
  "種類ごとに回数と最後の時刻を出す",
  described ===
    "- つつかれた（3回、最後は10分前）\n- なでられた（1回、最後はたった今）",
  described,
);
assert(
  "1時間より前は時間で言う",
  describeTouches([{ kind: "lift", created_at: at(150) }], now) ===
    "- 持ち上げられた（1回、最後は2時間前）",
);
assert(
  "6時間より前のことは話題にしない",
  describeTouches([{ kind: "poke", created_at: at(6 * 60 + 1) }], now) ===
    null,
);

console.log("--- 受け付ける種類 ---");
assert(
  "poke・pet・lift は受け付ける",
  ["poke", "pet", "lift"].every(isTouchKind),
);
assert("それ以外は受け付けない", !isTouchKind("kick") && !isTouchKind(1));

console.log("--- 返事のプロンプト ---");
const base = {
  plantName: "カラ美",
  plantProfile: "calathea",
  characterId: "amaenbo",
  state: stateFromLog(null),
  recentConversation: [],
  relationshipSummary: null,
  todayLight: null,
  userMessage: "元気？",
};
const withTouches = buildReplyPrompt({ ...base, touchMemory: described });
assert(
  "触られたことをプロンプトに入れる",
  withTouches.includes("飼い主に触られたこと") &&
    withTouches.includes("つつかれた（3回"),
);
assert(
  "毎回は触れないよう指示する",
  withTouches.includes("毎回は触れないでください"),
);
assert(
  "「話していない行動にお礼を言わない」の指示から、触られたことを除く",
  withTouches.includes("飼い主に触られたこと」に書かれたものは除く"),
);
const withoutTouches = buildReplyPrompt({ ...base, touchMemory: null });
assert(
  "触られていなければ、見出しも指示も入れない",
  !withoutTouches.includes("触られた"),
);
assert(
  "返事のプロンプトにも植物の種類を伝える",
  buildReplyPrompt({ ...base, plantProfile: "cactus", touchMemory: null })
    .includes("サボテンです"),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
