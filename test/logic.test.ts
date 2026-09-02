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
const fNormalHumid = applyMedianFilter([], normal).humidity_pct;
assert("中央値フィルタが湿度も通す",
  fNormalHumid !== null && Math.abs(fNormalHumid - 55) < 0.01,
  `got ${fNormalHumid}`);

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

console.log("--- Layer 1: BME280 読み取り失敗の検知 ---");
// 実機で観測されたBME280の固定ゴミ（チップがスリープに落ちレジスタ初期値を返す）
const bmeGarbage = { soil_adc: SOIL_OK, temp: 180.1, humidity: 100.0, lux: 2000 };
const fGarbage = applyMedianFilter([], bmeGarbage);
assert("固定ゴミ(t=180.1)は欠測として棄却", fGarbage.temp === null, `got ${fGarbage.temp}`);
assert("固定ゴミ(h=100.0)は欠測として棄却", fGarbage.humidity_pct === null, `got ${fGarbage.humidity_pct}`);
assert("欠測項目が missing に載る",
  JSON.stringify(fGarbage.missing) === JSON.stringify(["temp", "humidity"]),
  JSON.stringify(fGarbage.missing));
assert("BME欠測でも土壌水分・照度は生き残る",
  fGarbage.moisture_pct > 0 && fGarbage.lux === 2000,
  JSON.stringify(fGarbage));

const gScores = toComfortScores(fGarbage, profile);
assert("欠測スコアは0ではなくnull（危険域と誤認させない）",
  gScores.temp === null && gScores.humidity === null, JSON.stringify(gScores));

// ファームが「読めなかった」と明示送信（null）してくるケース
const fNull = applyMedianFilter([], { soil_adc: SOIL_OK, temp: null, humidity: null, lux: 2000 });
assert("temp/humidity が null でも欠測として扱う",
  fNull.temp === null && fNull.humidity_pct === null, JSON.stringify(fNull));

// 過去ログがゴミだらけでも、正常値が1件来れば即復帰する
// （旧実装はゴミを中央値に混ぜていたため、窓5件中3件のきれいな値が必要だった）
const fRecover = applyMedianFilter(
  [bmeGarbage, bmeGarbage, bmeGarbage, bmeGarbage],
  { soil_adc: SOIL_OK, temp: 25.2, humidity: 50.3, lux: 2000 },
);
assert("窓がゴミだらけでも正常値1件で即復帰",
  fRecover.temp === 25.2 && fRecover.humidity_pct === 50.3, JSON.stringify(fRecover));

// 現在の実機の故障状態: BME280未接続で全項目0を返し続ける
const allZero = { soil_adc: SOIL_OK, temp: 0, humidity: 0, pressure: 0, lux: 2000 };
const fZero = applyMedianFilter([], allZero);
assert("全ゼロ(未接続)は欠測として棄却",
  fZero.temp === null && fZero.humidity_pct === null, JSON.stringify(fZero));

// 気温0℃は妥当範囲(-20〜60)に入るため、値ごとの判定だけでは通ってしまう。
// 0℃はurgency=highなので、通ると「温度低すぎ・危険」が最優先の主訴になる。
const sZero = evaluateEmotion(toComfortScores(fZero, profile), fZero, comfortMid, []);
assert("全ゼロが「温度低すぎ(危険域)」として誤発火しない",
  sZero.complaint === null && sZero.emotion === "満足", JSON.stringify(sZero));

// 故障が本命の主訴を隠さないこと（0℃のhighは水分不足のmediumより優先されてしまう）
const dryZero = { soil_adc: 2700, temp: 0, humidity: 0, pressure: 0, lux: 2000 };
const fDryZero = applyMedianFilter([], dryZero);
const sDryZero = evaluateEmotion(toComfortScores(fDryZero, profile), fDryZero, comfortMid, []);
assert("全ゼロ故障が水分不足の主訴を隠さない",
  sDryZero.complaint === "水分不足", JSON.stringify(sDryZero));

// チップ単位の判定: 湿度だけ壊れていても気温は信用しない
const halfBroken = { soil_adc: SOIL_OK, temp: 24, humidity: 100.0, lux: 2000 };
const fHalf = applyMedianFilter([], halfBroken);
assert("湿度が壊れていれば同じチップの気温も捨てる",
  fHalf.temp === null && fHalf.humidity_pct === null, JSON.stringify(fHalf));

// 気圧の固定ゴミ(-154.x)からもチップ故障を検出する
const badPressure = { soil_adc: SOIL_OK, temp: 25.2, humidity: 50.3, pressure: -154.9, lux: 2000 };
const fBadP = applyMedianFilter([], badPressure);
assert("気圧が異常ならチップ故障として気温・湿度も捨てる",
  fBadP.temp === null && fBadP.humidity_pct === null, JSON.stringify(fBadP));

console.log("--- Layer 2: BME280欠測時も判定を続行する ---");
// 乾燥 + BME280故障 → 温湿度は黙り、土壌水分の主訴は従来どおり出る
const dryNoBme = { soil_adc: 2700, temp: 180.1, humidity: 100.0, lux: 2000 };
const fDryNoBme = applyMedianFilter([], dryNoBme);
const sDryNoBme = evaluateEmotion(toComfortScores(fDryNoBme, profile), fDryNoBme, comfortMid, []);
assert("BME欠測でも土壌水分から主訴を出せる",
  sDryNoBme.complaint === "水分不足", JSON.stringify(sDryNoBme));

// 故障ゴミ(180.1℃/100%)が「温度高すぎ」「湿度高すぎ」として誤発火しないこと
const okNoBme = { soil_adc: SOIL_OK, temp: 180.1, humidity: 100.0, lux: 2000 };
const fOkNoBme = applyMedianFilter([], okNoBme);
const sOkNoBme = evaluateEmotion(toComfortScores(fOkNoBme, profile), fOkNoBme, comfortMid, []);
assert("故障ゴミが温度・湿度の主訴として誤発火しない",
  sOkNoBme.complaint === null && sOkNoBme.emotion === "満足", JSON.stringify(sOkNoBme));

console.log("--- 状態遷移の検出（通知疲労対策） ---");
assert("同じ状態の継続は通知しない",
  hasTransitioned(s2, { emotion: s2.emotion, complaint: s2.complaint }) === false);
assert("感情がエスカレートしたら通知する",
  hasTransitioned(s3, { emotion: "不満", complaint: "水分不足" }) === true);
assert("回復（満足に戻る）も通知する",
  hasTransitioned(s1, { emotion: "不満", complaint: "水分不足" }) === true);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
