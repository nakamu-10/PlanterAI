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
const style = readFileSync("app/src/style.css", "utf8");
// CSS の中の、そのセレクタだけで始まる規則の中身
function ruleOf(selector: string) {
  const start = style.indexOf(`\n${selector} {`);
  return start === -1 ? "" : style.slice(start, style.indexOf("}", start));
}

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
  "ホームのページは画面に固定し、上下にスクロールさせない",
  ruleOf(".home--room").includes("position: fixed;") &&
    ruleOf("html:has(.home--room)").includes("overflow: hidden;") &&
    ruleOf("html:has(.home--room)").includes("overscroll-behavior: none;"),
);
assert(
  "重ねたヘッダーは、ノッチの分だけ下げる",
  ruleOf(".home--room .home-header").includes("env(safe-area-inset-top)"),
);
assert(
  "下のシートは、ホームバーの分だけ中身を上げる",
  ruleOf(".home-sheet").includes("env(safe-area-inset-bottom)"),
);
assert(
  "広い画面では、シートの中身を 640px までにして真ん中に置く",
  ruleOf(".home-sheet").split("(100% - 640px) / 2").length - 1 === 2,
);
assert(
  "Safari の一番上の帯の色（theme-color）は、ホームの地の壁の色と同じ",
  (() => {
    const wall = style.match(/--room-wall: (#[0-9A-Fa-f]{6});/)?.[1];
    return wall !== undefined &&
      home.includes(`<meta name="theme-color" content="${wall}">`);
  })(),
);
assert(
  "気分・水やりと話しかける欄は、下のシートにまとまる",
  /<section class="home-sheet"[\s\S]*id="statusMood"[\s\S]*id="chatForm"[\s\S]*<\/section>/
    .test(home),
);

// ホーム画面から開いたときは、全画面で帯の裏まで描く（ADR 0021）
const manifest = JSON.parse(
  readFileSync("app/public/manifest.webmanifest", "utf8"),
);
assert(
  "ホーム画面のアイコンからは、アプリを全画面で開く",
  manifest.display === "standalone" && manifest.start_url === "/app/" &&
    manifest.scope === "/app/",
);
const pages = {
  home,
  numbers,
  settings,
  records: readFileSync("app/records.html", "utf8"),
};
for (const [name, html] of Object.entries(pages)) {
  assert(
    `${name} は、アプリの manifest を読み、帯の裏まで描く`,
    html.includes('<link rel="manifest" href="/manifest.webmanifest">') &&
      html.includes('content="black-translucent"') &&
      html.includes("viewport-fit=cover"),
  );
}
assert(
  "ホームのほかのページは、帯とノッチの分だけ中身を内側へ寄せる",
  ruleOf(".home:not(.home--room)").includes("env(safe-area-inset-top)"),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
