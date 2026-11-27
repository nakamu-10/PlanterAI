// 下のシートを引き上げて広げる（app/src/sheet.logic.js）の検証
// 実行: npx tsx tests/sheet.test.ts
import {
  SHEET_DRAG_PX,
  sheetExpandedAfterDrag,
} from "../app/src/sheet.logic.js";

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

console.log("--- 引いたときの広げ方 ---");
assert("上へ引くと広げる", sheetExpandedAfterDrag(false, -SHEET_DRAG_PX));
assert("下へ引くと戻す", !sheetExpandedAfterDrag(true, SHEET_DRAG_PX));
assert("広げたまま上へ引いても広げたまま", sheetExpandedAfterDrag(true, -80));
assert("戻したまま下へ引いても戻したまま", !sheetExpandedAfterDrag(false, 80));
assert(
  "短い動きでは変えない",
  !sheetExpandedAfterDrag(false, -(SHEET_DRAG_PX - 1)) &&
    sheetExpandedAfterDrag(true, SHEET_DRAG_PX - 1),
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
