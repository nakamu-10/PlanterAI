// アプリの画面どうしのリンクの検証（ADR 0020 でホームから移したもの）
// 実行: npx tsx tests/appPages.test.ts
import { readFileSync } from "node:fs";

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

const home = readFileSync("app/index.html", "utf8");
const settings = readFileSync("app/settings.html", "utf8");
const numbers = readFileSync("app/numbers.html", "utf8");

assert(
  "ホームの右上から数値の画面を開ける",
  /<a class="home-icon-button" href="\/app\/numbers\.html"/.test(home),
);
assert(
  "「キャラ／数値」の切り替えは、ホームにも数値の画面にも無い",
  !home.includes("view-toggle") && !numbers.includes("view-toggle"),
);
assert(
  "数値の画面からホームへ戻れる",
  /<a class="home-icon-button" href="\/app\/"/.test(numbers),
);
assert(
  "公式サイトへのリンクは、設定のページにだけある",
  !home.includes("/index.html#pots") &&
    !numbers.includes("/index.html#pots") &&
    settings.includes('href="/index.html#pots"'),
);
assert(
  "ホームは、ノッチやホームバーの裏まで部屋を描く",
  home.includes("viewport-fit=cover"),
);
assert(
  "気分・水やりと話しかける欄は、下のシートにまとまる",
  /<section class="home-sheet"[\s\S]*id="statusMood"[\s\S]*id="chatForm"[\s\S]*<\/section>/
    .test(home),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
