const fs = require("fs");
const pptx = require("pptxgenjs");
const p = new pptx();

const W = 33.11, H = 46.81;
p.defineLayout({ name: "A0", width: W, height: H });
p.layout = "A0";
const s = p.addSlide();
const OUT = [];
const plain = (t) => t.replace(/\*\*/g, "");

// ---- palette (CUD-safe, same as ver1) ----
const DARK = "1E4A38", GREEN = "03AF7A", ORANGE = "F6AA00";
const INK = "1A1A1A",
  SUB = "44514B",
  RULE = "BDCEC5",
  TINT = "EDF3EF",
  WARM = "FDF1D8";
const F = "Meiryo";

// ---- geometry ----
const M = 1.25;
const GUT = 0.95;
const CW = (W - M * 2 - GUT) / 2;
const LX = M, RX = M + CW + GUT;
const HDR = 3.75;

OUT.push("PlanterAI：植物が自ら世話を要求する IoT プランター");
OUT.push(
  "状態の判定を決定論的なルール層に閉じ込め、言語化だけを大規模言語モデルに委ねる",
);
OUT.push("");
OUT.push("中村 耕介†1　地引 宙翔†2");
OUT.push(
  "†1, †2  電気通信大学 情報理工学域 II類　／　連絡先：planterai-contact@example.ac.jp",
);

// ================= header =================
s.addShape(p.ShapeType.rect, {
  x: 0,
  y: 0,
  w: W,
  h: HDR,
  fill: { color: DARK },
});
s.addText("PlanterAI：植物が自ら世話を要求する IoT プランター", {
  x: M,
  y: 0.28,
  w: W - M - 4.6,
  h: 1.2,
  fontFace: F,
  fontSize: 72,
  bold: true,
  color: "FFFFFF",
  valign: "middle",
});
s.addText(
  "状態の判定を決定論的なルール層に閉じ込め、言語化だけを大規模言語モデルに委ねる",
  {
    x: M,
    y: 1.52,
    w: W - M - 4.6,
    h: 0.75,
    fontFace: F,
    fontSize: 32,
    color: "AECFBE",
    valign: "middle",
  },
);
s.addText([
  { text: "中村 耕介", options: { fontSize: 34, bold: true } },
  { text: " †1    ", options: { fontSize: 22 } },
  { text: "地引 宙翔", options: { fontSize: 34, bold: true } },
  { text: " †2", options: { fontSize: 22 } },
], {
  x: M,
  y: 2.38,
  w: W - M - 4.6,
  h: 0.62,
  fontFace: F,
  color: "FFFFFF",
  valign: "middle",
});
s.addText(
  "†1, †2  電気通信大学 情報理工学域 II類  ／  連絡先：planterai-contact@example.ac.jp",
  {
    x: M,
    y: 3.00,
    w: W - M - 4.6,
    h: 0.5,
    fontFace: F,
    fontSize: 20,
    color: "C2DACE",
    valign: "middle",
  },
);
s.addShape(p.ShapeType.rect, {
  x: W - M - 2.55,
  y: 0.5,
  w: 2.55,
  h: 2.35,
  fill: { color: "FFFFFF" },
});
s.addText("QR", {
  x: W - M - 2.55,
  y: 0.5,
  w: 2.55,
  h: 2.35,
  fontFace: F,
  fontSize: 26,
  color: SUB,
  align: "center",
  valign: "middle",
});
s.addText("実機デモ動画", {
  x: W - M - 2.55,
  y: 2.90,
  w: 2.55,
  h: 0.4,
  fontFace: F,
  fontSize: 17,
  bold: true,
  color: "FFFFFF",
  align: "center",
});

// ================= helpers =================
function head(n, title, x, y) {
  OUT.push(
    "\n\n" + "=".repeat(60) + "\n" + n + ". " + title + "\n" + "=".repeat(60) +
      "\n",
  );
  s.addShape(p.ShapeType.rect, {
    x,
    y,
    w: 1.05,
    h: 1.05,
    fill: { color: DARK },
  });
  s.addText(String(n), {
    x,
    y,
    w: 1.05,
    h: 1.05,
    fontFace: F,
    fontSize: 38,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
  });
  s.addText(title, {
    x: x + 1.4,
    y,
    w: CW - 1.4,
    h: 1.05,
    fontFace: F,
    fontSize: 40,
    bold: true,
    color: DARK,
    valign: "middle",
  });
  s.addShape(p.ShapeType.line, {
    x,
    y: y + 1.18,
    w: CW,
    h: 0,
    line: { color: DARK, width: 3 },
  });
  return y + 1.5;
}
// 段落。**強調** は太字＋濃緑
function para(md, x, y, w, h, fs) {
  OUT.push(plain(md) + "\n");
  const parts = [];
  md.split(/(\*\*[^*]+\*\*)/).forEach((t) => {
    if (!t) return;
    if (t.startsWith("**")) {
      parts.push({
        text: t.slice(2, -2),
        options: { bold: true, color: DARK },
      });
    } else parts.push({ text: t });
  });
  s.addText(parts, {
    x,
    y,
    w,
    h,
    fontFace: F,
    fontSize: fs || 28,
    color: INK,
    valign: "top",
    lineSpacingMultiple: 1.45,
    margin: 0,
  });
}
function caption(t, x, y, w, h) {
  OUT.push("［" + t + "］\n");
  s.addText(t, {
    x,
    y,
    w,
    h: h || 0.6,
    fontFace: F,
    fontSize: 21,
    bold: true,
    color: SUB,
    align: "center",
    valign: "top",
    lineSpacingMultiple: 1.25,
    margin: 0,
  });
}

// ================= LEFT COLUMN =================
let y = HDR + 0.85;

// --- 1 背景 ---
y = head(1, "気づいたときには、もう手遅れ", LX, y);
para(
  "観葉植物への一世帯当たりの支出は、2020年から2022年にかけて伸びたのち、**2022年をピークに約16％減少**している（図1）。" +
    "育て始めた人が、続かずに離れている。我々が実施した調査（N=83）では、育成経験者の**89％が枯死を経験**し、" +
    "そのうち**78％が「気づいたときには手遅れだった」**と答えた。観葉植物は動物と違い、音や動作で SOS を発しない。" +
    "水分や日照の不足は、葉の変色や萎れとして現れた時点で既に回復が難しく、初心者ほど気づけないまま枯らしてしまう。" +
    "育成をやめた・始めない理由の上位3つも留守・置き場所・気づけなさであり、**いずれもその場に居なければ解けない障壁**であった（図2）。" +
    "**人が見に行くことを前提とした道具では、この障壁は解けない。**",
  LX,
  y,
  CW,
  5.7,
);
y += 6.5;

// 図1
const g1h = 6.0;
s.addChart(p.ChartType.bar, [{
  name: "支出額",
  labels: ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"],
  values: [3198, 3068, 3226, 3370, 3475, 3301, 2922, 2963],
}], {
  x: LX,
  y: y + 0.2,
  w: CW,
  h: g1h - 0.4,
  barDir: "col",
  chartColors: [GREEN],
  showValue: true,
  dataLabelFontSize: 19,
  dataLabelFontFace: F,
  dataLabelFontBold: true,
  dataLabelColor: INK,
  dataLabelPosition: "outEnd",
  catAxisLabelFontSize: 22,
  catAxisLabelFontFace: F,
  catAxisLabelColor: INK,
  valAxisLabelFontSize: 20,
  valAxisLabelFontFace: F,
  valAxisLabelColor: SUB,
  valAxisMinVal: 2600,
  valAxisMaxVal: 3600,
  valAxisMajorUnit: 200,
  showLegend: false,
  barGapWidthPct: 60,
  valGridLine: { color: "E3E9E5", style: "solid", size: 1 },
});
y += g1h + 0.2;
caption(
  "図1　園芸用植物への一世帯当たり年間支出額［円］（総務省家計調査より作成）",
  LX,
  y,
  CW,
  0.7,
);
y += 1.5;

// 図2
const rH = 6.4;
s.addText([
  {
    text: "育成をやめた・始めない理由 上位3つ",
    options: { fontSize: 29, bold: true, color: DARK },
  },
  { text: "   複数選択・N=83", options: { fontSize: 21, color: SUB } },
], { x: LX, y: y + 0.3, w: CW, h: 0.7, fontFace: F, valign: "middle" });
const reasons = [["旅行・外出時に世話ができない", 47], [
  "日当たり・置き場所が分からない",
  46,
], ["異変に気づけない", 42]];
OUT.push("【図2の内容】育成をやめた・始めない理由 上位3つ（複数選択・N=83）");
reasons.forEach((rr) => OUT.push("  ・" + rr[0] + "　" + rr[1] + "％"));
OUT.push(
  "  いずれも、留守・置き場所・気づけなさ ― 人がその場に居ることを前提とした障壁である",
);
const labW = 6.6, pctW = 1.7;
const trkX = LX + labW + 0.35;
const trkW = CW - labW - 0.35 - pctW - 0.25;
reasons.forEach((rr, i) => {
  const ry = y + 1.6 + i * 1.38;
  s.addText(rr[0], {
    x: LX,
    y: ry,
    w: labW,
    h: 0.75,
    fontFace: F,
    fontSize: 26,
    color: INK,
    valign: "middle",
  });
  s.addShape(p.ShapeType.rect, {
    x: trkX,
    y: ry + 0.16,
    w: trkW,
    h: 0.44,
    fill: { color: "E8EEEA" },
  });
  s.addShape(p.ShapeType.rect, {
    x: trkX,
    y: ry + 0.16,
    w: trkW * (rr[1] / 50),
    h: 0.44,
    fill: { color: ORANGE },
  });
  s.addText(rr[1] + "％", {
    x: trkX + trkW + 0.25,
    y: ry,
    w: pctW,
    h: 0.75,
    fontFace: F,
    fontSize: 30,
    bold: true,
    color: "9C6600",
    valign: "middle",
  });
});
s.addText(
  "留守・置き場所・気づけなさ ― 人がその場に居ることを前提とした障壁である",
  {
    x: LX,
    y: y + rH - 1.05,
    w: CW,
    h: 0.65,
    fontFace: F,
    fontSize: 23,
    color: SUB,
    valign: "middle",
  },
);
y += rH + 0.2;
caption("図2　育成をやめた・始めない理由（複数選択・N=83）", LX, y, CW, 0.7);
y += 1.5;

// --- 2 提案 ---
y = head(2, "判定は決定論、表現だけを AI に", LX, y);
para(
  "そこで我々は、植物を擬人化し、**自ら世話を要求する IoT プランター PlanterAI** を開発した。" +
    "装置の側から話しかければ、その場に居なくても異変は届く。ただし、擬人化された発話は内容が正しくなければ意味がない。" +
    "センサーの生値を大規模言語モデルにそのまま渡せば、モデルが数値を解釈する過程で誤りが混入しうる。" +
    "そこで、**状態の判定と、その表現の生成を分離した**。センサー値の正規化（Layer 1）と、感情・主訴の決定（Layer 2）は" +
    "**決定論的なルールで完結**させ、大規模言語モデルには**「確定した状態をどう言語化するか」だけを委ねる**（Layer 3）。" +
    "生の数値は LLM まで流れないため、判定の正しさはルール表だけで保証できる。",
  LX,
  y,
  CW,
  5.1,
);
y += 5.9;

// 図3 構成図
const dh = 7.4;
const bx = LX, bw = 3.1, bh = 4.2, by = y + 0.8;
s.addShape(p.ShapeType.roundRect, {
  x: bx,
  y: by,
  w: bw,
  h: bh,
  fill: { color: "FFFFFF" },
  line: { color: DARK, width: 2.5 },
  rectRadius: 0.05,
});
s.addText([{
  text: "ESP32",
  options: { fontSize: 30, bold: true, breakLine: true },
}, {
  text: "土壌水分／気温\n湿度／照度\nOLED 128×64",
  options: { fontSize: 21, color: SUB },
}], {
  x: bx,
  y: by,
  w: bw,
  h: bh,
  fontFace: F,
  color: INK,
  align: "center",
  valign: "middle",
  lineSpacingMultiple: 1.2,
  margin: 0,
});
s.addShape(p.ShapeType.rightArrow, {
  x: bx + bw + 0.12,
  y: by + bh / 2 - 0.25,
  w: 0.5,
  h: 0.5,
  fill: { color: GREEN },
});
const sx = bx + bw + 0.7, sw = 6.9;
s.addShape(p.ShapeType.rect, {
  x: sx,
  y: by - 0.75,
  w: sw,
  h: bh + 1.45,
  fill: { color: TINT },
  line: { color: DARK, width: 2.5 },
});
s.addText("Supabase Edge Functions", {
  x: sx,
  y: by - 0.62,
  w: sw,
  h: 0.7,
  fontFace: F,
  fontSize: 26,
  bold: true,
  color: DARK,
  align: "center",
});
OUT.push("【図3の内容】システム構成");
OUT.push("  ESP32（土壌水分／気温／湿度／照度、OLED 128×64）");
OUT.push("    → Supabase Edge Functions");
OUT.push("        Layer 1 正規化：中央値フィルタ／快適スコア");
OUT.push("        Layer 2 感情エンジン：決定論ルール表（5感情 × 6主訴）");
OUT.push("        Layer 3 対話生成：Gemini が文体のみ生成");
OUT.push(
  "    → LINE 通知（状態が遷移した時のみ）／ LINE 対話（返信にも人格を保つ）",
);
OUT.push("  感情状態を返却 → OLED に表情を描画");
const lw = (sw - 0.8) / 3;
const layers = [["Layer 1", "正規化", "中央値フィルタ\n快適スコア", "FFFFFF"], [
  "Layer 2",
  "感情エンジン",
  "決定論ルール表\n5感情 × 6主訴",
  "FFFFFF",
], ["Layer 3", "対話生成", "Gemini が\n文体のみ生成", WARM]];
layers.forEach((L, i) => {
  const lx = sx + 0.2 + i * (lw + 0.2);
  s.addShape(p.ShapeType.rect, {
    x: lx,
    y: by + 0.25,
    w: lw,
    h: bh - 0.25,
    fill: { color: L[3] },
    line: { color: i === 2 ? ORANGE : RULE, width: i === 2 ? 2.5 : 1.5 },
  });
  s.addText([{ text: L[0] + "\n", options: { fontSize: 22, bold: true } }, {
    text: L[1] + "\n\n",
    options: { fontSize: 22, bold: true },
  }, { text: L[2], options: { fontSize: 19, color: SUB } }], {
    x: lx,
    y: by + 0.25,
    w: lw,
    h: bh - 0.25,
    fontFace: F,
    color: INK,
    align: "center",
    valign: "middle",
    lineSpacingMultiple: 1.15,
    margin: 0,
  });
});
s.addShape(p.ShapeType.rightArrow, {
  x: sx + sw + 0.12,
  y: by + bh / 2 - 0.25,
  w: 0.5,
  h: 0.5,
  fill: { color: GREEN },
});
const nx = sx + sw + 0.7, nw = CW - (nx - LX);
[["LINE 通知", "状態が遷移した時のみ"], ["LINE 対話", "返信にも人格を保つ"]]
  .forEach((L, i) => {
    const ny = by + i * (bh / 2 + 0.15);
    s.addShape(p.ShapeType.rect, {
      x: nx,
      y: ny,
      w: nw,
      h: bh / 2 - 0.15,
      fill: { color: "FFFFFF" },
      line: { color: DARK, width: 2 },
    });
    s.addText([{ text: L[0] + "\n", options: { fontSize: 26, bold: true } }, {
      text: L[1],
      options: { fontSize: 19, color: SUB },
    }], {
      x: nx,
      y: ny,
      w: nw,
      h: bh / 2 - 0.15,
      fontFace: F,
      color: INK,
      align: "center",
      valign: "middle",
      lineSpacingMultiple: 1.15,
      margin: 0,
    });
  });
s.addShape(p.ShapeType.leftArrow, {
  x: bx,
  y: by + bh + 0.75,
  w: sw + bw + 0.7,
  h: 0.5,
  fill: { color: ORANGE },
});
s.addText("感情状態を返却 → OLED に表情を描画", {
  x: bx,
  y: by + bh + 1.35,
  w: sw + bw + 0.7,
  h: 0.55,
  fontFace: F,
  fontSize: 23,
  bold: true,
  color: "9C6600",
  align: "center",
});
y += dh + 0.2;
caption(
  "図3　システム構成。状態の判定は Layer 2 までで完結し、Layer 3 の LLM には確定済みの状態だけが渡される",
  LX,
  y,
  CW,
  1.3,
);

// ================= RIGHT COLUMN =================
let r = HDR + 0.85;

// --- 3 結果 ---
r = head(3, "実機で動き、想定外にも耐えた", RX, r);
para(
  "試作機は ESP32-DevKitC に、土壌水分（SEN0193）・温湿度（BME280）・照度（TSL2591）の各センサーと 128×64 の OLED を接続し、" +
    "バックエンドを Supabase Edge Functions、言語化を Gemini Flash、対話を LINE Messaging API で構成した。" +
    "カラテア（キャラクター名「カラ美」）を対象に連続稼働させ、" +
    "**OLED による表情表示と LINE を介した双方向対話を実現している**（図4・図5）。" +
    "通知は状態が遷移した時点のみ発火させ、初期ログで**9.5時間に11件**生じていた通知を、クールダウンとヒステリシスで抑制した。",
  RX,
  r,
  CW,
  4.4,
);
r += 4.8;

// 図4 / 図5
const fw = 7.6, gw = CW - 7.6 - 0.4;
const fh = 7.2;
const iw = (fw - 0.45) / 2, ih = iw / 2;
const gridH = 3 * ih + 3 * 0.62 + 0.3, gy0 = r + (fh - gridH) / 2;
const faceLabels = ["満足", "軽い不満", "不満", "不安", "苛立ち"];
const faceFiles = [
  "face2_satisfied.png",
  "face2_mild.png",
  "face2_unhappy.png",
  "face2_anxious.png",
  "face2_irritated.png",
];
faceFiles.forEach((fn, i) => {
  const ix = (i === 4) ? RX + (fw - iw) / 2 : RX + (i % 2) * (iw + 0.45);
  const iy = gy0 + Math.floor(i / 2) * (ih + 0.62);
  s.addImage({ path: fn, x: ix, y: iy, w: iw, h: ih });
  s.addText(faceLabels[i], {
    x: ix,
    y: iy + ih + 0.02,
    w: iw,
    h: 0.5,
    fontFace: F,
    fontSize: 23,
    bold: true,
    color: INK,
    align: "center",
  });
});
const g5h = Math.min(fh - 0.5, (gw - 0.5) * 1032 / 804), g5w = g5h * 804 / 1032;
s.addImage({
  path: "line_ver2.jpg",
  x: RX + fw + 0.4 + (gw - g5w) / 2,
  y: r + (fh - g5h) / 2,
  w: g5w,
  h: g5h,
});
r += fh + 0.2;
caption(
  "図4　OLED に描画される5種類の表情。感情間を約500msで補間し、放置時間に応じた衰弱を提示する",
  RX,
  r,
  fw,
  1.3,
);
caption(
  "図5　LINE による双方向対話。単一の Edge Function で署名検証・重複排除・返信生成を完結させている",
  RX + fw + 0.4,
  r,
  gw,
  1.3,
);
r += 1.9;

// --- 異常値耐性（結果の後半） ---
para(
  "設計の効果は、想定外の事象で確かめられた。運用中に BME280 が間欠的にリセットし、" +
    "**固定異常値（180.1℃／湿度100％）を返す事象が発生**した。生値を LLM に直接渡す構成であれば、センサー異常がそのまま体感として語られてしまう。" +
    "PlanterAI では異常値ガードと中央値フィルタを経てルールベースが判定するため、" +
    "**確定済みの主訴だけが発話され、異常値の影響を受けなかった**（図6）。",
  RX,
  r,
  CW,
  3.6,
);
r += 4.0;

const hw = (CW - 0.5) / 2, hh = 4.0;
const cmp = [
  [
    "LLM 直結型（比較対象）",
    "生値をそのままプロンプトに投入",
    "「あつい…！ ボク、溶けちゃうよ…！」",
    "センサー異常を植物の体感として誤って解釈する",
    "F7E7E7",
    "B03A3A",
  ],
  [
    "PlanterAI（本提案）",
    "異常値ガード → 中央値フィルタ → ルール判定",
    "「おとといからずっと、のど かわいてるの…」",
    "確定済みの主訴のみを発話し、異常値の影響を受けない",
    TINT,
    DARK,
  ],
];
OUT.push("【図6の内容】実機で発生した異常値に対する出力の比較");
cmp.forEach((c) =>
  OUT.push("  " + c[0] + "／" + c[1] + "／" + c[2] + "／" + c[3])
);
cmp.forEach((c, i) => {
  const cx = RX + i * (hw + 0.5);
  s.addShape(p.ShapeType.rect, {
    x: cx,
    y: r,
    w: hw,
    h: hh,
    fill: { color: c[4] },
    line: { color: c[5], width: 2 },
  });
  s.addText([
    { text: c[0] + "\n", options: { fontSize: 27, bold: true, color: c[5] } },
    { text: c[1] + "\n\n", options: { fontSize: 21, color: SUB } },
    { text: c[2] + "\n\n", options: { fontSize: 28, bold: true, color: INK } },
    { text: c[3], options: { fontSize: 21, color: SUB } },
  ], {
    x: cx + 0.35,
    y: r + 0.3,
    w: hw - 0.7,
    h: hh - 0.6,
    fontFace: F,
    valign: "top",
    lineSpacingMultiple: 1.25,
  });
});
r += hh + 0.2;
caption(
  "図6　実機で発生したセンサー異常値に対する出力の比較。同じ異常値を受けても、判定を閉じ込めた側は発話が破綻しない",
  RX,
  r,
  CW,
  1.3,
);
r += 1.9;

// --- 4 今後の展望 ---
r = head(4, "ルール表に触れずに、身体を持たせる", RX, r);
para(
  "判定と表現を分離したこの構成は、**判定パイプラインを保ったまま入力と出力を増やせる**。",
  RX,
  r,
  CW,
  1.4,
);
r += 1.65;
para(
  "入力側にはカメラを加え、葉色や萎れを数値化して Layer 1 へ合流させる。" +
    "土壌水分や照度では捉えられない**病害や日焼けにも、主訴を割り当てられる**ようになる。",
  RX,
  r,
  CW,
  1.7,
);
r += 1.9;
para(
  "出力側には、**モーターによる身体性**を与えたい。乾けばうなだれ、水をやれば葉を持ち上げる ―― " +
    "**画面を見ていなくても、部屋の中で異変が目に入る**。",
  RX,
  r,
  CW,
  1.7,
);
r += 1.9;
para(
  "**専用アプリ**では、アバターが実機のステータスと連動して動く。外出先からでも、いま植物がどんな状態かがひと目で分かり、" +
    "**最も多く挙がった「留守中に世話ができない」という障壁に直接応える**。",
  RX,
  r,
  CW,
  2.3,
);
r += 2.5;
para(
  "Layer 3 の言語化は、植物の口調と育成知識に特化させた**独自モデル**へ置き換える。" +
    "API コストを抑えつつ、応答の一貫性を高められる。いずれも**Layer 2 のルール表には手を入れずに実現できる**。",
  RX,
  r,
  CW,
  2.3,
);
r += 2.6;

// --- 会場デモの案内 ---
s.addShape(p.ShapeType.rect, {
  x: RX,
  y: r,
  w: CW,
  h: 2.2,
  fill: { color: TINT },
  line: { color: DARK, width: 3 },
});
s.addText([
  {
    text: "会場で実機が稼働しています\n",
    options: { fontSize: 29, bold: true, color: DARK },
  },
  {
    text:
      "土壌の乾燥を再現すると、OLED の表情と LINE の発話がその場で変わります。右上の QR からデモ動画もご覧いただけます。",
    options: { fontSize: 24, color: INK },
  },
], {
  x: RX + 0.55,
  y: r + 0.35,
  w: CW - 1.1,
  h: 1.7,
  fontFace: F,
  valign: "top",
  lineSpacingMultiple: 1.3,
  margin: 0,
});

OUT.push("【会場デモの案内】会場で実機が稼働しています");
OUT.push(
  "  土壌の乾燥を再現すると、OLED の表情と LINE の発話がその場で変わります。右上の QR からデモ動画もご覧いただけます。",
);

// --- 参考文献 ---
const refY = H - 1.95;
s.addText("参考文献・謝辞", {
  x: RX,
  y: refY - 0.15,
  w: CW,
  h: 0.5,
  fontFace: F,
  fontSize: 22,
  bold: true,
  color: DARK,
});
s.addText(
  [
    "[1] 総務省統計局：家計調査（総世帯）家計収支編 詳細結果表，e-Stat, 2018–2025.",
    "[2] 本研究 課題検証アンケート（N=83），2026年7月実施．",
    "筐体設計・3Dプリントは地引が担当した。アンケートにご協力いただいた皆様に感謝します。",
  ].map((t) => ({ text: t, options: { breakLine: true } })),
  {
    x: RX,
    y: refY + 0.35,
    w: CW,
    h: 1.6,
    fontFace: F,
    fontSize: 17,
    color: SUB,
    lineSpacingMultiple: 1.3,
  },
);

OUT.push("\n\n【参考文献・謝辞】");
OUT.push(
  "[1] 総務省統計局：家計調査（総世帯）家計収支編 詳細結果表，e-Stat, 2018–2025.",
);
OUT.push("[2] 本研究 課題検証アンケート（N=83），2026年7月実施．");
OUT.push(
  "筐体設計・3Dプリントは地引が担当した。アンケートにご協力いただいた皆様に感謝します。",
);

fs.writeFileSync(
  "PlanterAI_poster_ver3.txt",
  OUT.join("\n").replace(/\n{4,}/g, "\n\n\n") + "\n",
);
p.writeFile({ fileName: "PlanterAI_poster_ver3.pptx" }).then(() =>
  console.log("ok")
);
