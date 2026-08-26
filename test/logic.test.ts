// Layer 1 + Layer 2 のロジック検証（実行: npx tsx test/logic.test.ts）
import { applyMedianFilter, toComfortScores, toScore } from "../supabase/functions/_shared/normalize.ts";
import { evaluateEmotion, hasTransitioned } from "../supabase/functions/_shared/emotionEngine.ts";
import { PLANT_PROFILES, soilAdcToPercent, SOIL_CALIBRATION } from "../supabase/functions/_shared/config.ts";

const profile = PLANT_PROFILES.pothos;
const comfortMid = {
  moisture: (profile.moisture.comfortLow + profile.moisture.comfortHigh) / 2,
  temp: (profile.temp.comfortLow + profile.temp.comfortHigh) / 2,
  light: (profile.light.comfortLow + profile.light.comfortHigh) / 2,
  humidity: (profile.humidity.comfortLow + profile.humidity.comfortHigh) / 2,
};

// 土壌が快適レンジ(約55%)になるADC生値。他センサーを固定して湿度だけ動かす検証に使う
const SOIL_OK = Math.round(
  SOIL_CALIBRATION.airValue - 0.55 * (SOIL_CALIBRATION.airValue - SOIL_CALIBRATION.waterValue),
);

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

console.log("--- Layer 1: ADC変換 ---");
const { airValue, waterValue } = SOIL_CALIBRATION;
assert("ADC waterValue(水中) → 100%", soilAdcToPercent(waterValue) === 100);
assert("ADC airValue(乾燥) → 0%", soilAdcToPercent(airValue) === 0);
assert("ADC 100(異常に低い) → 100%にクランプ", soilAdcToPercent(100) === 100);

console.log("--- Layer 1: 快適スコア ---");
assert("水分55%(快適) → 100", toScore(55, profile.moisture) === 100, `got ${toScore(55, profile.moisture)}`);
assert("水分20%(注意境界) → 50", toScore(20, profile.moisture) === 50, `got ${toScore(20, profile.moisture)}`);
assert("水分10%(危険境界) → 0", toScore(10, profile.moisture) === 0);
assert("水分90%(過湿・注意側) → 25", toScore(90, profile.moisture) === 25, `got ${toScore(90, profile.moisture)}`);
assert("気温40℃(危険超え) → 0", toScore(40, profile.temp) === 0);

console.log("--- Layer 1: 中央値フィルタ ---");
const normal = { soil_adc: 1900, temp: 24, humidity: 55, lux: 2000 };
const glitch = { soil_adc: 0, temp: 24, humidity: 55, lux: 2000 }; // 接触不良の瞬間バグ値
const f1 = applyMedianFilter([normal, normal, normal, normal], glitch);
assert("バグ値1回は中央値で無視される",
  Math.abs(f1.moisture_pct - soilAdcToPercent(1900)) < 0.01, `got ${f1.moisture_pct}`);

console.log("--- Layer 2: 感情判定 ---");
const fGood = applyMedianFilter([], normal);
const s1 = evaluateEmotion(toComfortScores(fGood, profile), fGood, comfortMid, []);
assert("快適 → 満足", s1.emotion === "満足" && s1.complaint === null, JSON.stringify(s1));
assert("初回の満足は通知しない", hasTransitioned(s1, null) === false);

const dry = { soil_adc: 2700, temp: 24, humidity: 40, lux: 2000 };
const fDry = applyMedianFilter([], dry);
const dryScores = toComfortScores(fDry, profile);
const s2 = evaluateEmotion(dryScores, fDry, comfortMid, []);
assert("乾燥 → 主訴=水分不足", s2.complaint === "水分不足", JSON.stringify(s2));
assert("乾燥直後は通知対象（遷移）", hasTransitioned(s2, null) === true);
console.log(`   発生直後: ${s2.emotion} / 緊急度=${s2.urgency}`);

console.log("--- Layer 2: 継続によるエスカレーション ---");
const pastLogs = Array.from({ length: 10 }, (_, i) => ({
  emotion: "不満",
  complaint: "水分不足",
  created_at: new Date(Date.now() - (i === 9 ? 49 : i) * 3600 * 1000).toISOString(),
}));
const s3 = evaluateEmotion(dryScores, fDry, comfortMid, pastLogs);
assert("水分不足が2日以上継続と判定される", s3.duration_hours >= 48, `duration=${s3.duration_hours}`);
assert("2段階エスカレートして苛立ちに到達", s3.emotion === "苛立ち", `got ${s3.emotion}`);
console.log(`   継続後: ${s3.emotion}（継続${s3.duration_label}）`);

console.log("--- Layer 2: 複合主訴の優先順位 ---");
const dryAndDark = { soil_adc: 2700, temp: 24, humidity: 40, lux: 100 };
const fDD = applyMedianFilter([], dryAndDark);
const s4 = evaluateEmotion(toComfortScores(fDD, profile), fDD, comfortMid, []);
assert("乾燥+日照不足 → 水分不足を優先", s4.complaint === "水分不足", `got ${s4.complaint}`);

console.log("--- Layer 1: 湿度スコア ---");
assert("湿度55%(快適) → 100", toScore(55, profile.humidity) === 100, `got ${toScore(55, profile.humidity)}`);
assert("湿度25%(乾燥・注意境界) → 50", toScore(25, profile.humidity) === 50, `got ${toScore(25, profile.humidity)}`);
assert("湿度90%(多湿・注意境界) → 50", toScore(90, profile.humidity) === 50, `got ${toScore(90, profile.humidity)}`);
assert("中央値フィルタが湿度も通す",
  Math.abs(applyMedianFilter([], normal).humidity_pct - 55) < 0.01,
  `got ${applyMedianFilter([], normal).humidity_pct}`);

console.log("--- Layer 2: 湿度の主訴 ---");
// 土壌・気温・照度は快適に固定し、湿度だけを動かす
const dryAir = { soil_adc: SOIL_OK, temp: 24, humidity: 20, lux: 2000 };
const fDryAir = applyMedianFilter([], dryAir);
const sDryAir = evaluateEmotion(toComfortScores(fDryAir, profile), fDryAir, comfortMid, []);
assert("空気が乾燥 → 主訴=湿度低すぎ", sDryAir.complaint === "湿度低すぎ", JSON.stringify(sDryAir));

const humidAir = { soil_adc: SOIL_OK, temp: 24, humidity: 95, lux: 2000 };
const fHumidAir = applyMedianFilter([], humidAir);
const sHumidAir = evaluateEmotion(toComfortScores(fHumidAir, profile), fHumidAir, comfortMid, []);
assert("空気が多湿 → 主訴=湿度高すぎ", sHumidAir.complaint === "湿度高すぎ", JSON.stringify(sHumidAir));

const humidComfort = { soil_adc: SOIL_OK, temp: 24, humidity: 55, lux: 2000 };
const fHC = applyMedianFilter([], humidComfort);
const sHC = evaluateEmotion(toComfortScores(fHC, profile), fHC, comfortMid, []);
assert("湿度が快適レンジなら主訴なし(満足)", sHC.emotion === "満足" && sHC.complaint === null, JSON.stringify(sHC));

console.log("--- Layer 2: 湿度を含む複合主訴の優先順位 ---");
// 水分不足(低urgency) と 湿度低すぎ(低urgency) が同時発生 → 水分不足を優先(priority 90 > 40)
const soilMildDry = Math.round(
  SOIL_CALIBRATION.airValue - 0.30 * (SOIL_CALIBRATION.airValue - SOIL_CALIBRATION.waterValue),
); // 約30% = 水分やや不足(低urgency)
const bothMild = { soil_adc: soilMildDry, temp: 24, humidity: 30, lux: 2000 };
const fBoth = applyMedianFilter([], bothMild);
const sBoth = evaluateEmotion(toComfortScores(fBoth, profile), fBoth, comfortMid, []);
assert("水分やや不足+空気乾燥(同urgency) → 水分不足を優先",
  sBoth.complaint === "水分不足", JSON.stringify(sBoth));

console.log("--- 状態遷移の検出（通知疲労対策） ---");
assert("同じ状態の継続は通知しない",
  hasTransitioned(s2, { emotion: s2.emotion, complaint: s2.complaint }) === false);
assert("感情がエスカレートしたら通知する",
  hasTransitioned(s3, { emotion: "不満", complaint: "水分不足" }) === true);
assert("回復（満足に戻る）も通知する",
  hasTransitioned(s1, { emotion: "不満", complaint: "水分不足" }) === true);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
