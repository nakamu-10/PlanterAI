/*
  PlanterAI - 統合ファームウェア（表情v2 / 堅牢化v3）

  構成:
    ESP32 DevKit
      SEN0193 土壌水分 -> GPIO34（ADC1。Wi-Fi使用時もADC2と違い競合しない）
      BME280  温湿度気圧 -> I2C 0x76
      TSL2591 照度       -> I2C 0x29
      OLED SH1106        -> I2C 0x3C
      I2C: SDA=GPIO21 / SCL=GPIO22

  設計書§11の必須条件:
    - Wire.setClock(400000)
    - フルバッファ版コンストラクタ（_F_）
    - 描画ループで delay() を使わず millis() ベース
    - POST中（数百msブロック）は「目を閉じる」演出で誤魔化す

  ★2026-08-23 表情v2 変更点:
    1. 満足の口の符号バグ修正（正=への字/負=笑顔 の規約に合わせ CMP_NONE を負に）
    2. 満足の目を「上反りアーチ(∩)の笑い目」に描き直し＋ほっぺ /// を追加（寝顔対策）
    3. 日照過剰の「への字」も符号を修正
    4. 湿度の主訴（湿度低すぎ/湿度高すぎ）と空気アイコン(icon=4)を追加
    5. 数値モードに空気湿度の行を追加（scores.humidity を受信）
    6. 確認用シリアルコマンド e(感情巡回) / c(主訴巡回) を追加

  ★2026-08-30 堅牢化v3 変更点（終日無言バグの対策）:
    症状: コンセント給電にもかかわらず、OLEDが「満足の顔を表示したまま」凍結し、
          POSTが十数時間途絶える。人がリセットするまで復帰しない。
    診断: 電源は生きている（画面が消えず最後のフレームを保持）＝ loop() が
          固まっている。共有I2Cバス（OLED/BME280/TSL2591）の固着が最有力で、
          loopTask はウォッチドッグの監視対象外なので永久に復帰しない。
    対策:
      A. タスクウォッチドッグを有効化（60秒）。ハングしたら自動で再起動する。
      B. Wire.setTimeOut() でI2C転送に上限を設ける（永久ブロックの防止）。
      C. I2Cバス回復ルーチン（SCLを9クロック送って固着スレーブを解放）を追加。
      D. boot_count / uptime_s / rssi を送信し、DB側でハング頻度を可視化する。
      E. Wi-Fi再接続を30秒間隔に短縮し、15分復帰しなければ自力で再起動する。
      F. 連続送信失敗が続いた場合も再起動する。

    ※ A〜C は対症療法。根治はハード側（I2Cのプルアップ4.7kΩ、各デバイスの
       VCC-GND間に0.1µFパスコン、配線短縮）で行うこと。
*/

// --- 標準・ライブラリ ---------------------------------------------------
// ★注意: FrameMirror.h は Serial をマクロで置き換えるため、
//        ライブラリの include は必ずこれより前に書くこと。
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <Adafruit_TSL2591.h>
#include <esp_system.h>     // esp_reset_reason()
#include <esp_task_wdt.h>   // ★v3-A: タスクウォッチドッグ
#include <Preferences.h>    // ★v3-D: 起動回数をNVSに保存

#include "FrameMirror.h"    // ← 必ず最後

// ============================================================
// ★接続設定は secrets.h に書く（git 管理外）
//   secrets.example.h をコピーして secrets.h を作り、値を書き換える
// ============================================================
#include "secrets.h"

// 送信間隔。ふだんは10分おき。デモ（撮影・見学会）では DEMO_MODE を true にして
// 書き込むと5秒おきに送り、水やりが十数秒で LINE とアプリに出る
const bool DEMO_MODE = false;
const unsigned long POST_INTERVAL_MS = DEMO_MODE ? 5UL * 1000 : 600UL * 1000;

// ============================================================
// ★v3 堅牢化パラメータ
// ============================================================
// ウォッチドッグのタイムアウト[秒]。
// postReading() は最悪 setConnectTimeout(10s) + setTimeout(20s) = 30秒
// ブロックしうるので、それより十分長く取ること。
static const uint32_t WDT_TIMEOUT_S = 60;

// Wi-Fi再接続を試みる間隔[ms]。旧実装はPOST間隔（10分）と同じだったため
// 復帰が極端に遅かった。
static const unsigned long WIFI_RETRY_MS = 30UL * 1000;

// この時間Wi-Fiが戻らなければ自力で再起動する[ms]
static const unsigned long WIFI_GIVEUP_MS = 15UL * 60 * 1000;

// 連続でこの回数POSTに失敗したら再起動する
static const uint8_t POST_FAIL_LIMIT = 6;

// I2C転送のタイムアウト[ms]。バス固着時に永久ブロックさせない
static const uint16_t I2C_TIMEOUT_MS = 50;

// ============================================================
// デバイス
// ============================================================
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);
Adafruit_BME280 bme;
Adafruit_TSL2591 tsl = Adafruit_TSL2591(2591);
WiFiClientSecure netClient;
Preferences prefs;

const int SOIL_PIN = 34;
const int SOIL_SAMPLES = 9;
const int I2C_SDA = 21;
const int I2C_SCL = 22;
bool bmeOk = false, tslOk = false;

// ★v3-D: 起動回数（NVSに永続化）。ハング→WDT再起動の回数がこれで分かる。
uint32_t bootCount = 0;

// ★v3-E/F: 送信・接続の健全性カウンタ
unsigned long lastWifiTry   = 0;
unsigned long wifiDownSince = 0;
uint8_t       postFailCount = 0;

// ============================================================
// 感情プリセット（設計書§4.2）
// ============================================================
struct EmotionPreset {
  const char* key;      // サーバーから返る日本語の emotion 文字列
  float eyeW, eyeH, eyeR, gap, eyeY;
  float crescent, cutTop, slant;
  float brow, browAng;
  bool  bounce, jitter;
  float blinkMul;
};

enum EmotionIdx { EMO_HAPPY, EMO_MILD, EMO_UNHAPPY, EMO_ANXIOUS, EMO_ANGRY, EMO_COUNT };

const EmotionPreset EMO_TABLE[EMO_COUNT] = {
  // key       eyeW eyeH eyeR gap eyeY  cres   cutTop slant brow browAng bounce jitter blinkMul
  { "満足",     32,  16,  8,  48, 26,   1.0f,  0,     0,    0,   0,      true,  false, 1.0f  },
  { "軽い不満", 32,  28,  8,  48, 26,   0,     0,     0,    0,   0,      false, false, 1.0f  },
  { "不満",     32,  18,  6,  48, 27,   0,     0.34f, 0,    1,  -18,     false, false, 1.0f  },
  { "不安",     28,  34,  12, 46, 25,   0,     0,     0,    1,   16,     false, true,  0.33f },
  { "苛立ち",   34,  16,  4,  48, 27,   0,     0,     1,    1,  -30,     false, false, 1.2f  }
};

// ============================================================
// 主訴プリセット（設計書§5・§10）
//   ★口カーブ mCurve の符号規約:  負 = ∪（笑顔） / 正 = ∩（への字）
//     drawMouth() が y = cy - mCurve*sin(πu) で描くため、
//     中央を下げて笑顔にするには負の値を使う。
//   ★アイコン icon:  0=なし / 1=水滴 / 2=温度計 / 3=太陽 / 4=空気(湿度)
// ============================================================
struct ComplaintPreset {
  const char* key;  // サーバーから返る日本語の complaint 文字列
  int8_t icon;      // 0=なし, 1=水滴, 2=温度計, 3=太陽, 4=空気(湿度)
  int8_t dir;       // -1=不足, 1=過剰, 0=なし
  float w, curve, open, vert, wave, trem, asym, rate, amp;
};

enum ComplaintIdx {
  CMP_NONE, CMP_WATER_LOW, CMP_WATER_HIGH, CMP_TEMP_HIGH,
  CMP_TEMP_LOW, CMP_LIGHT_LOW, CMP_LIGHT_HIGH,
  CMP_HUMID_LOW, CMP_HUMID_HIGH, CMP_COUNT
};

const ComplaintPreset CMP_TABLE[CMP_COUNT] = {
  // key           icon dir  w   curve   open vert wave  trem  asym  rate   amp
  { "",             0,  0,   26, -5.5f,  0,   0,   0,    0,    0,    0,     0 },   // 満足: 上向きの弧(∪スマイル)
  { "水分不足",     1, -1,   8,   0,     1,   1,   0,    0,    0,    0.34f, 5 },   // 渇き: 速い「ぱく」
  { "水分過多",     1,  1,   24, -2.6f,  0,   0,   1,    0,    0,    0,     0 },   // うぇっ: 下向き波線
  { "温度高すぎ",   2,  1,   18,  0,     7,   0,   0,    0,    0,    2.2f,  4 },   // ハッハッ: 速い開閉
  { "温度低すぎ",   2, -1,   22,  0,     0,   0,   0.7f, 1.3f, 0,    9,     0 },   // がたがた: 横震え
  { "日照不足",     3, -1,   24,  0,     0,   0,   0,    0,    0,    0,     0 },   // 気力なし: 横一直線
  { "日照過剰",     3,  1,   22,  2.2f,  0,   0,   0,    0,    1.6f, 0,     0 },   // への字(∩)+左右非対称
  { "湿度低すぎ",   4, -1,   7,   0,     0,   1,   0,    0,    0,    0.20f, 3 },   // 乾燥: 遅い「はぁー」小楕円
  { "湿度高すぎ",   4,  1,   22,  0,     2,   0,   0,    0,    0,    0.18f, 3 }    // 多湿: だらんと半開き
};

// ============================================================
// 状態（サーバーのレスポンスで更新される）
// ============================================================
EmotionIdx   currentEmotion   = EMO_MILD;
ComplaintIdx currentComplaint = CMP_NONE;
float urgency       = 3;
float durationHours = 0;
float tempScore = 80, lightScore = 80, moistScore = 80, humidScore = 80;
float intimacy  = 50;   // 関係性メモリ実装までは固定値
bool  numericMode = false;

// 最新のセンサー実測値（数値モード表示用）
int   lastSoilAdc = 0;
float lastTemp = 0, lastHum = 0, lastPres = 0, lastLux = 0;

// 補間後の実描画パラメータ
struct FaceParams {
  float eyeW = 32, eyeH = 28, eyeR = 8, gap = 48, eyeY = 26;
  float crescent = 0, cutTop = 0, slant = 0, brow = 0, browAng = 0;
  float mW = 16, mCurve = 0, mOpen = 0, mVert = 0, mWave = 0, mTrem = 0, mAsym = 0;
};
FaceParams cur;

// アイドルアニメーション用
float blinkTimer = 0, blinkNext = 1800, blinkPhase = -1;
float gazeX = 0, gazeY = 0, gazeTargetX = 0, gazeTargetY = 0;
float gazeTimer = 0, gazeNext = 5000;
unsigned long speakUntil = 0;

unsigned long lastPost = 0, lastFrame = 0;
String serialBuf = "";

// ============================================================
// ユーティリティ
// ============================================================
// 注: lerp という名前はC++20の std::lerp と衝突するため fLerp にしている
float fLerp(float a, float b, float k) { return a + (b - a) * k; }
float vitality() { return min(1.0f, durationHours / 72.0f); }
float randf() { return (float)random(0, 10000) / 10000.0f; }

// ============================================================
// ★v3-A: ウォッチドッグ
// ============================================================
void wdtSetup() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {
    .timeout_ms     = WDT_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true,
  };
  // コア3系では起動時に既に初期化済みのことがあるので、その場合は再設定する
  if (esp_task_wdt_init(&cfg) == ESP_ERR_INVALID_STATE) {
    esp_task_wdt_reconfigure(&cfg);
  }
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);   // loopTask（setup/loopが動くタスク）を監視対象に
  Serial.printf("[wdt] 有効化 timeout=%lus\n", (unsigned long)WDT_TIMEOUT_S);
}

inline void wdtFeed() { esp_task_wdt_reset(); }

// ============================================================
// ★v3-C: I2Cバス回復
//
// スレーブが転送途中でリセットするとSDAをLowに掴んだままになり、
// バス全体がデッドロックする（OLED/BME280/TSL2591が相乗りしているので
// 描画ループごと止まる）。SCLを最大9クロック手で振って転送を終わらせ、
// STOP条件を作ってからバスを張り直す。
// ============================================================
void i2cRecover() {
  Serial.println("[i2c] バス回復を試みます");
  Wire.end();

  pinMode(I2C_SDA, INPUT_PULLUP);
  pinMode(I2C_SCL, OUTPUT);
  for (int i = 0; i < 9; i++) {
    digitalWrite(I2C_SCL, LOW);  delayMicroseconds(5);
    digitalWrite(I2C_SCL, HIGH); delayMicroseconds(5);
    if (digitalRead(I2C_SDA) == HIGH) break;   // 解放された
  }
  // STOP条件（SCLがHighの間にSDAをLow→High）
  pinMode(I2C_SDA, OUTPUT);
  digitalWrite(I2C_SDA, LOW);  delayMicroseconds(5);
  digitalWrite(I2C_SCL, HIGH); delayMicroseconds(5);
  digitalWrite(I2C_SDA, HIGH); delayMicroseconds(5);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(I2C_TIMEOUT_MS);

  // バスを張り直したのでデバイスも初期化し直す
  u8g2.begin();
  u8g2.setContrast(255);
  bmeOk = bme.begin(0x76);
  if (bmeOk) {
    bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                    Adafruit_BME280::SAMPLING_X1, Adafruit_BME280::SAMPLING_X1,
                    Adafruit_BME280::SAMPLING_X1, Adafruit_BME280::FILTER_X4,
                    Adafruit_BME280::STANDBY_MS_500);
  }
  tslOk = tsl.begin();
  if (tslOk) {
    tsl.setGain(TSL2591_GAIN_LOW);
    tsl.setTiming(TSL2591_INTEGRATIONTIME_200MS);
  }
  Serial.printf("[i2c] 回復後 bmeOk=%d tslOk=%d\n", bmeOk, tslOk);
}

// ============================================================
// センサー読み取り
// ============================================================
int readSoilMedian() {
  int v[SOIL_SAMPLES];
  for (int i = 0; i < SOIL_SAMPLES; i++) { v[i] = analogRead(SOIL_PIN); delay(5); }
  for (int i = 1; i < SOIL_SAMPLES; i++) {
    int key = v[i], j = i - 1;
    while (j >= 0 && v[j] > key) { v[j + 1] = v[j]; j--; }
    v[j + 1] = key;
  }
  return v[SOIL_SAMPLES / 2];
}

// 直近の「妥当だったBME値」。初期値は快適域（センサー完全故障時の安全側）。
float goodTemp = 24.0f, goodHum = 50.0f, goodPres = 1013.0f;

// BME280の1回の読み取りが物理的にありうる範囲かを判定する。
// センサー故障時の典型ゴミ（temp=180 / hum=100.0 / pres=負）を弾くのが狙い。
// 湿度はちょうど 0.0 / 100.0 を故障値として除外（屋内で実測ピッタリ100%はまず無い）。
bool bmeReadValid(float t, float h, float p) {
  return t > -20.0f && t < 60.0f &&
         h > 0.0f  && h < 100.0f &&
         p > 300.0f && p < 1100.0f;
}

void readAllSensors() {
  lastSoilAdc = readSoilMedian();
  wdtFeed();

  if (bmeOk) {
    // BME280が間欠的に異常値を返す。diag解析で「チップID(0x60)は読めるのに測定値だけ
    // 固定ゴミ(180.1/100.0/-154.x)」＝一瞬リセットしてスリープに戻る挙動と判明（電源不安定が疑い）。
    // 対策: 読み取りは低速(100kHz)。異常なら再初期化(setSampling)で起こしてから読み直す。
    //       数回ダメなら直前の正常値を使う。最後にOLEDアニメ用へ400kHzへ戻す。
    Wire.setClock(100000);
    float t = 0, h = 0, p = 0;
    bool ok = false;
    for (int attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt > 0) {
        // 直前が異常＝リセット/スリープの可能性。設定を入れ直してチップを起こす。
        if (bme.begin(0x76)) {
          bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                          Adafruit_BME280::SAMPLING_X1, Adafruit_BME280::SAMPLING_X1,
                          Adafruit_BME280::SAMPLING_X1, Adafruit_BME280::FILTER_X4,
                          Adafruit_BME280::STANDBY_MS_500);
        }
        delay(15);
      }
      t = bme.readTemperature();
      h = bme.readHumidity();
      p = bme.readPressure() / 100.0f;
      ok = bmeReadValid(t, h, p);
      if (!ok) delay(20);
      wdtFeed();
    }
    Wire.setClock(400000);
    if (ok) {
      goodTemp = t; goodHum = h; goodPres = p;   // 正常値を記憶
    } else {
      Serial.printf("[BME異常値を無視] t=%.1f h=%.1f p=%.1f -> 直前値を使用\n", t, h, p);
      // ★v3-C: 3回とも失敗＝チップ単体ではなくバスが怪しい。回復を試みる。
      i2cRecover();
      wdtFeed();
    }
    // 異常時は直前の正常値を送る（ゴミをパイプラインに入れない）
    lastTemp = goodTemp; lastHum = goodHum; lastPres = goodPres;
  }

  if (tslOk) {
    uint32_t lum = tsl.getFullLuminosity();
    lastLux = tsl.calculateLux(lum & 0xFFFF, lum >> 16);
    if (lastLux < 0) lastLux = 0; // 飽和時の負値をガード
    wdtFeed();
  }
}

// ============================================================
// POST中の演出（設計書§11: 数百msのブロックを目を閉じる演出で誤魔化す）
// ============================================================
void drawThinking() {
  u8g2.clearBuffer();
  u8g2.setDrawColor(1);
  // 閉じた目 = 細い横線2本
  u8g2.drawBox(40 - 16, 26, 32, 3);
  u8g2.drawBox(88 - 16, 26, 32, 3);
  // 考え中のドット
  for (int i = 0; i < 3; i++) u8g2.drawDisc(56 + i * 8, 50, 2);
  u8g2.sendBuffer();
  mirrorFrame(u8g2);
}

// ============================================================
// レスポンス適用
// ============================================================
void applyResponse(JsonDocument& doc) {
  JsonObject scores = doc["scores"];
  if (!scores.isNull()) {
    moistScore = scores["moisture"] | moistScore;
    tempScore  = scores["temp"]     | tempScore;
    lightScore = scores["light"]    | lightScore;
    humidScore = scores["humidity"] | humidScore;
  }

  JsonObject state = doc["state"];
  if (!state.isNull()) {
    const char* emo = state["emotion"] | "";
    for (int i = 0; i < EMO_COUNT; i++) {
      if (strcmp(emo, EMO_TABLE[i].key) == 0) { currentEmotion = (EmotionIdx)i; break; }
    }
    const char* cmp = state["complaint"] | "";
    currentComplaint = CMP_NONE;
    for (int i = 0; i < CMP_COUNT; i++) {
      if (strcmp(cmp, CMP_TABLE[i].key) == 0) { currentComplaint = (ComplaintIdx)i; break; }
    }
    // urgency（文字列）を 1〜5 の振幅に変換
    const char* urg = state["urgency"] | "none";
    if      (strcmp(urg, "high")   == 0) urgency = 5;
    else if (strcmp(urg, "medium") == 0) urgency = 3.5f;
    else if (strcmp(urg, "low")    == 0) urgency = 2;
    else                                 urgency = 1;

    durationHours = state["duration_hours"] | 0.0f;

    // ★デバッグ: サーバーが実際に返した状態とスコアを表示する。
    //   scores は中央値フィルタ後の快適スコア(0=悪い/100=快適)。
    Serial.printf("受信state: emotion=%s complaint=%s urgency=%s dur=%.1f | "
                  "scores moist=%.0f temp=%.0f light=%.0f humid=%.0f\n",
                  emo, (cmp[0] ? cmp : "(なし)"), urg, durationHours,
                  moistScore, tempScore, lightScore, humidScore);
  }

  // ★欠測センサーの可視化（サーバーのグレースフルデグレードが効いているかの確認）
  JsonArray missing = doc["missing"];
  if (!missing.isNull() && missing.size() > 0) {
    Serial.print("欠測センサー: ");
    for (JsonVariant m : missing) Serial.printf("%s ", m.as<const char*>());
    Serial.println();
  }

  // message の文字数ぶん口を動かす（設計書§8-①リップシンク）
  const char* msg = doc["message"] | "";
  if (strlen(msg) > 0) {
    // UTF-8のバイト数ではなく文字数に近づけるため3で割る（日本語は1文字3バイト）
    int chars = strlen(msg) / 3;
    speakUntil = millis() + (unsigned long)min(6000.0f, max(1200.0f, chars * 95.0f));
    Serial.printf("メッセージ(%d文字相当): %s\n", chars, msg);
  }
}

// ============================================================
// センサー送信
// ============================================================
void postReading() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi未接続のため送信スキップ");
    return;
  }

  drawThinking();       // ブロックする前に演出を出しておく
  readAllSensors();
  wdtFeed();            // ★HTTPで最大30秒ブロックする前に必ず餌をやる

  // ★v3-D: uptime_s / boot_count / rssi を同送する。
  //   sensor_logs.raw は jsonb なのでサーバー無改修で保存され、
  //   normalize.ts は未知のキーを無視する（既存パイプラインに影響なし）。
  //   空白期間の前後でこれを見れば、電源断・ハング・Wi-Fi断が区別できる:
  //     boot_countが増え uptime_sが戻る → 再起動（電源断 or WDT作動）
  //     boot_count同じで uptime_sが伸びている → ループは生きていた＝Wi-Fi側
  char payload[256];
  snprintf(payload, sizeof(payload),
    "{\"soil_adc\":%d,\"temp\":%.1f,\"humidity\":%.1f,\"pressure\":%.1f,\"lux\":%.1f,"
    "\"uptime_s\":%lu,\"boot_count\":%lu,\"rssi\":%d}",
    lastSoilAdc, lastTemp, lastHum, lastPres, lastLux,
    (unsigned long)(millis() / 1000UL), (unsigned long)bootCount, (int)WiFi.RSSI());

  Serial.printf("送信: %s\n", payload);

  HTTPClient http;
  http.begin(netClient, FUNCTION_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  // 遷移時はサーバがGemini(セリフ生成)+LINE送信を呼ぶため応答が数秒〜十秒かかる。
  // 既定5秒だと特に起動直後(必ず遷移)やコールドスタートで read Timeout になるので延長する。
  http.setConnectTimeout(10000);  // 接続確立まで
  http.setTimeout(20000);         // 応答読み取りまで(ms)

  int code = http.POST((uint8_t*)payload, strlen(payload));
  wdtFeed();

  if (code > 0) {
    String body = http.getString();
    Serial.printf("HTTP %d\n", code);
    if (code == 200) {
      postFailCount = 0;                  // ★成功したので失敗カウンタを戻す
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, body);
      if (err) Serial.printf("JSONパース失敗: %s\n", err.c_str());
      else     applyResponse(doc);
    } else {
      postFailCount++;
      Serial.println(body);
    }
  } else {
    postFailCount++;
    Serial.printf("送信失敗: %s\n", http.errorToString(code).c_str());
  }
  http.end();

  // ★v3-F: 連続失敗が続くならネットワークスタックがこじれている。再起動する。
  if (postFailCount >= POST_FAIL_LIMIT) {
    Serial.printf("送信が%d回連続で失敗。再起動します\n", postFailCount);
    delay(200);
    ESP.restart();
  }

  lastFrame = millis(); // ブロック中の経過時間で dt が跳ねないようリセット
}

// ============================================================
// プリセット→現在値のイージング補間（設計書§9）
// ============================================================
void updateTargets(float dt) {
  const EmotionPreset&   P = EMO_TABLE[currentEmotion];
  const EmotionPreset&   N = EMO_TABLE[EMO_MILD];
  const ComplaintPreset& C = CMP_TABLE[currentComplaint];

  float ex = 0.55f + 0.09f * urgency;
  float k  = 1.0f - expf(-dt / 140.0f);   // ≒500msで収束

  cur.eyeW     = fLerp(cur.eyeW,     fLerp(N.eyeW, P.eyeW, ex), k);
  cur.eyeH     = fLerp(cur.eyeH,     fLerp(N.eyeH, P.eyeH, ex), k);
  cur.eyeR     = fLerp(cur.eyeR,     fLerp(N.eyeR, P.eyeR, ex), k);
  cur.gap      = fLerp(cur.gap,      fLerp(N.gap,  P.gap,  ex), k);
  cur.eyeY     = fLerp(cur.eyeY,     fLerp(N.eyeY, P.eyeY, ex), k);
  cur.crescent = fLerp(cur.crescent, P.crescent * ex, k);
  cur.cutTop   = fLerp(cur.cutTop,   P.cutTop * ex,   k);
  cur.slant    = fLerp(cur.slant,    P.slant * ex,    k);
  cur.brow     = fLerp(cur.brow,     P.brow,          k);
  cur.browAng  = fLerp(cur.browAng,  P.browAng * ex,  k);

  cur.mW     = fLerp(cur.mW,     C.w,          k);
  cur.mCurve = fLerp(cur.mCurve, C.curve * ex, k);
  cur.mOpen  = fLerp(cur.mOpen,  C.open,       k);
  cur.mVert  = fLerp(cur.mVert,  C.vert,       k);
  cur.mWave  = fLerp(cur.mWave,  C.wave,       k);
  cur.mTrem  = fLerp(cur.mTrem,  C.trem,       k);
  cur.mAsym  = fLerp(cur.mAsym,  C.asym * ex,  k);
}

// ============================================================
// 描画: 目・眉・口・アイコン
// ============================================================
void drawEye(int side, float hEff, float jitter, float bounce, float v) {
  float cx = 64 + side * (cur.gap / 2.0f) + gazeX + jitter;
  float cy = cur.eyeY + gazeY + bounce;
  float w = cur.eyeW, h = hEff;
  int innerDir = -side;

  // --- 満足: 上反りアーチの笑い目（∩）------------------------------------
  // 下向き三日月(◡)は「閉じた/眠い目」に見えてしまうため、上に反ったアーチ(∩)で
  // 「起きてて嬉しい」に振る。ほっぺの /// は drawCheeks() が別途描く。
  // まばたき(hEff低下)でアーチが浅くなる。
  if (cur.crescent > 0.05f) {
    float inten = min(1.0f, cur.crescent / 0.40f);            // 0..1（満足の到達度）
    float sq    = constrain(hEff / max(2.0f, cur.eyeH), 0.0f, 1.2f); // まばたき squash
    float aw    = w * 0.95f;                                  // アーチの幅
    float depth = fLerp(3.5f, 7.0f, inten) * sq;              // アーチの高さ
    if (depth < 1.5f) depth = 1.5f;
    int   th    = 3 + (int)round(inten);                      // 線の太さ 3〜4px
    u8g2.setDrawColor(1);
    const int NA = 16;
    for (int off = 0; off < th; off++) {
      int px = 0, py = 0;
      for (int i = 0; i <= NA; i++) {
        float u = (float)i / NA;
        float x = cx - aw / 2.0f + aw * u;
        float y = cy - depth * sinf(PI * u) + depth * 0.5f + off; // ∩(中央上/端下)
        int xi = (int)round(x), yi = (int)round(y);
        if (i > 0) u8g2.drawLine(px, py, xi, yi);
        px = xi; py = yi;
      }
    }
    return;   // 満足時はハイライト等を描かない
  }

  float r = min(cur.eyeR, min(w / 2.0f, h / 2.0f));

  int x0 = (int)round(cx - w / 2.0f), y0 = (int)round(cy - h / 2.0f);
  int wi = max(1, (int)round(w)), hi = max(1, (int)round(h));
  int ri = max(0, (int)round(r));

  u8g2.setDrawColor(1);
  int ri_safe = max(0, (min(wi, hi) - 1) / 2);
  ri_safe = min(ri, ri_safe);
  u8g2.drawRBox(x0, y0, wi, hi, ri_safe);

  if (cur.cutTop > 0.02f) {     // 不満: 上端をカットして半目に
    u8g2.setDrawColor(0);
    u8g2.drawBox(x0 - 1, y0 - 1, wi + 2, (int)round(h * cur.cutTop) + 1);
    u8g2.setDrawColor(1);
  }
  if (cur.slant > 0.02f) {      // 苛立ち: 内側上端に三角でV字の吊り目
    u8g2.setDrawColor(0);
    int xo   = (int)round(cx + innerDir * (w / 2.0f + 2));
    int xo2  = (int)round(cx - innerDir * (w / 2.0f + 2));
    int yTop = (int)round(cy - h / 2.0f - 2);
    int yBot = (int)round(cy - h / 2.0f + h * 0.62f * cur.slant);
    u8g2.drawTriangle(xo, yTop, xo2, yTop, xo, yBot);
    u8g2.setDrawColor(1);
  }
  if (h > 9) {   // ハイライト（親密度連動）
    float hr = 1.1f + (intimacy / 100.0f) * 2.2f * (1.0f - v * 0.7f);
    if (hr > 1.2f) {
      u8g2.setDrawColor(0);
      u8g2.drawDisc((int)round(cx - innerDir * w * 0.20f),
                    (int)round(cy - h * 0.22f), (int)round(hr));
      u8g2.setDrawColor(1);
    }
  }
}

void drawBrow(int side, float hEff, float jitter, float bounce) {
  float cx  = 64 + side * (cur.gap / 2.0f) + gazeX * 0.6f + jitter;
  float top = cur.eyeY + gazeY * 0.6f + bounce - hEff / 2.0f;
  int innerDir = -side;
  float hw = cur.eyeW / 2.0f * 0.92f;
  float dy = tanf(cur.browAng * PI / 180.0f) * hw;
  float yb = max(fabsf(dy) + 2.0f, top - 5.0f);
  int x1 = (int)round(cx + innerDir * hw), y1 = (int)round(yb - dy);
  int x2 = (int)round(cx - innerDir * hw), y2 = (int)round(yb + dy);

  u8g2.setDrawColor(1);
  u8g2.drawLine(x1, y1, x2, y2);
  if (cur.brow > 0.5f) u8g2.drawLine(x1, y1 - 1, x2, y2 - 1);
}

void drawMouth(unsigned long nowMs, bool speaking, float jitter, float bounce) {
  const ComplaintPreset& C = CMP_TABLE[currentComplaint];
  float cx = 64 + gazeX * 0.35f + jitter;
  float cy = 50 + gazeY * 0.35f + bounce;
  float w = cur.mW, openV = cur.mOpen;

  u8g2.setDrawColor(1);

  if (speaking) {   // リップシンク
    float s = fabsf(sinf(nowMs / 1000.0f * 8.0f * TWO_PI));
    openV = 1 + s * 9;
    w = max(14.0f, cur.mW);
    u8g2.drawFilledEllipse((int)round(cx), (int)round(cy),
                           (int)round(w / 2), (int)round(openV / 2));
    return;
  }
  if (C.rate > 0 && C.amp > 0) {   // 暑いときのハッハッ / 湿度の「はぁー」など
    float ph = sinf(nowMs / 1000.0f * C.rate * TWO_PI);
    openV = max(0.0f, openV + (ph > 0 ? ph : 0) * C.amp);
  }
  float trem = (cur.mTrem > 0.05f) ? sinf(nowMs / 1000.0f * 9.0f * TWO_PI) * cur.mTrem : 0;

  if (cur.mVert > 0.5f) {   // 渇き/はぁー: 縦にすぼめた口
    u8g2.drawFilledEllipse((int)round(cx + trem), (int)round(cy),
                           max(1, (int)round(w / 2)), max(1, (int)round((openV + 2) / 2)));
    return;
  }
  if (openV > 1.6f) {
    u8g2.drawFilledEllipse((int)round(cx + trem), (int)round(cy),
                           (int)round(w / 2), (int)round(openV / 2));
    return;
  }
  const int N = 12;   // 線の口を折れ線で近似
  int px = 0, py = 0;
  for (int i = 0; i <= N; i++) {
    float u = (float)i / N;
    float x = cx - w / 2 + w * u + trem;
    float y = cy - cur.mCurve * sinf(PI * u)
                 + cur.mWave * 1.9f * sinf(3 * PI * u)
                 + cur.mAsym * (u - 0.5f) * 2.4f;
    int xi = (int)round(x), yi = (int)round(y);
    if (i > 0) u8g2.drawLine(px, py, xi, yi);
    px = xi; py = yi;
  }
}

void drawIcon(int iconType, int dir) {
  if (iconType == 0) return;   // 満足のときはバブルごと消す
  int x = 100, y = 44;
  u8g2.setDrawColor(1);

  if (iconType == 1) {          // 水滴（しずく形）
    u8g2.drawTriangle(x + 8, y + 1, x + 3, y + 9, x + 13, y + 9);
    u8g2.drawDisc(x + 8, y + 9, 5);
  } else if (iconType == 3) {   // 太陽
    u8g2.drawDisc(x + 8, y + 8, 4);
    for (int i = 0; i < 8; i++) {
      float a = i * PI / 4.0f;
      u8g2.drawLine((int)round(x + 8 + cosf(a) * 5.6f), (int)round(y + 8 + sinf(a) * 5.6f),
                    (int)round(x + 8 + cosf(a) * 7.8f), (int)round(y + 8 + sinf(a) * 7.8f));
    }
  } else if (iconType == 4) {   // 湿度: 空気の横波線3本（水滴と形で区別）
    for (int r = 0; r < 3; r++) {
      int yy = y + 3 + r * 4;
      int px2 = 0, py2 = 0;
      for (int i = 0; i <= 12; i++) {
        int xx = x + 2 + i;
        int yv = yy + (int)round(sinf(i * 0.9f) * 1.3f);
        if (i > 0) u8g2.drawLine(px2, py2, xx, yv);
        px2 = xx; py2 = yv;
      }
    }
  } else {                      // iconType == 2: 温度計
    u8g2.drawRBox(x + 6, y, 4, 10, 2);
    u8g2.drawDisc(x + 8, y + 11, 4);
    u8g2.setDrawColor(0);
    u8g2.drawBox(x + 7, y + 1, 2, 8);
    u8g2.setDrawColor(1);
    u8g2.drawBox(x + 7, (dir > 0) ? y + 2 : y + 6, 2, (dir > 0) ? 7 : 3);
  }

  int ax = x + 17, ay = y + 3;  // 上下矢印
  if (dir > 0) {
    u8g2.drawLine(ax, ay + 10, ax, ay + 1);
    u8g2.drawLine(ax - 3, ay + 4, ax, ay + 1);
    u8g2.drawLine(ax + 3, ay + 4, ax, ay + 1);
  } else if (dir < 0) {
    u8g2.drawLine(ax, ay + 1, ax, ay + 10);
    u8g2.drawLine(ax - 3, ay + 7, ax, ay + 10);
    u8g2.drawLine(ax + 3, ay + 7, ax, ay + 10);
  }
}

// 満足時のほっぺ（/// の斜線チーク）。crescent の強さで表示する。
void drawCheeks(float inten) {
  if (inten < 0.15f) return;
  u8g2.setDrawColor(1);
  for (int side = -1; side <= 1; side += 2) {
    float bx = 64 + side * (cur.gap / 2.0f + 14.0f); // 目より外側のほっぺ位置
    float by = cur.eyeY + 12.0f;                      // 目の下
    for (int i = 0; i < 3; i++) {                     // "/" を3本 = ///
      int x0 = (int)round(bx - 3 + i * 3);
      int y0 = (int)round(by + 3);
      int x1 = x0 + 5;
      int y1 = (int)round(by - 3);
      u8g2.drawLine(x0, y0, x1, y1);
    }
  }
}

// ============================================================
// 顔全体（アイドルアニメーション込み。設計書§6・§7）
// ============================================================
void drawFace(unsigned long nowMs, float dt) {
  const EmotionPreset&   P = EMO_TABLE[currentEmotion];
  const ComplaintPreset& C = CMP_TABLE[currentComplaint];
  float v = vitality();
  bool speaking = nowMs < speakUntil;

  // まばたき（照度スコアが低いほど頻度が下がる）
  float blinkMul = P.blinkMul * (1 + 1.8f * v) * (1 + (100 - lightScore) / 100.0f * 0.6f);
  blinkTimer += dt;
  if (blinkPhase < 0 && blinkTimer > blinkNext) { blinkPhase = 0; blinkTimer = 0; }
  float bf = 1;
  if (blinkPhase >= 0) {
    blinkPhase += dt;
    float p = blinkPhase / 130.0f;
    if (p >= 1) { blinkPhase = -1; blinkNext = (2600 + randf() * 3200) * blinkMul; blinkTimer = 0; }
    else        { bf = 1 - sinf(PI * p) * 0.94f; }
  }

  // 呼吸（温度スコア連動）
  float rate   = 0.33f * (1 + (100 - tempScore) / 100.0f * 1.7f);
  float breath = sinf(nowMs / 1000.0f * rate * TWO_PI) * 2.0f * (1 - 0.8f * v);

  // 視線移動
  gazeTimer += dt;
  if (gazeTimer > gazeNext) {
    gazeTimer = 0;
    gazeNext = (6000 + randf() * 7000) * (1 + 2 * v);
    bool lookUser = randf() < (intimacy / 160.0f);
    if (C.icon != 0 && !lookUser && randf() < 0.6f) { gazeTargetX = 4; gazeTargetY = 3; }
    else if (lookUser) { gazeTargetX = 0; gazeTargetY = 0; }
    else { gazeTargetX = (randf() * 2 - 1) * 4; gazeTargetY = (randf() * 2 - 1) * 2; }
  }
  float gk = 1 - expf(-dt / 120.0f);
  gazeX = fLerp(gazeX, gazeTargetX, gk);
  gazeY = fLerp(gazeY, gazeTargetY, gk);

  // 元気の総量（設計書§7）
  float openBase = (1 - 0.55f * v) * (1 + (moistScore - 80) / 100.0f * 0.12f);
  float jitter   = (P.jitter) ? (randf() * 2 - 1) * 1.0f : 0;
  float bounce   = (P.bounce) ? sinf(nowMs / 1000.0f * 0.8f * TWO_PI) * 1.2f : 0;
  float hEff     = max(2.0f, cur.eyeH * openBase * bf + breath);

  drawEye(-1, hEff, jitter, bounce, v);
  drawEye( 1, hEff, jitter, bounce, v);
  if (cur.brow > 0.05f) { drawBrow(-1, hEff, jitter, bounce); drawBrow(1, hEff, jitter, bounce); }
  drawMouth(nowMs, speaking, jitter, bounce);
  drawCheeks(min(1.0f, cur.crescent / 0.40f));   // 満足のとき /// のほっぺ
  drawIcon(C.icon, C.dir);
}

// ============================================================
// 数値モード（設計書§12）: 土壌水分 / 気温 / 照度 / 空気湿度 の4行
// ============================================================
void drawNumericRow(int row, const char* label, const char* valueStr, float score) {
  int y = 20 + row * 11;          // 4行が収まるよう詰めた（旧: 26 + row*14）
  u8g2.drawStr(2, y, label);
  int tw = u8g2.getStrWidth(valueStr);
  u8g2.drawStr(126 - tw, y, valueStr);
  u8g2.drawFrame(2, y + 2, 124, 5);
  int fw = (int)(120 * score / 100.0f);
  if (fw > 0) u8g2.drawBox(4, y + 3, fw, 3);
}

void drawNumeric() {
  u8g2.setDrawColor(1);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(2, 9, "PLANTER 01");
  u8g2.drawHLine(0, 11, 128);

  char buf[16];
  snprintf(buf, sizeof(buf), "%d", lastSoilAdc);
  drawNumericRow(0, "SOIL", buf, moistScore);
  snprintf(buf, sizeof(buf), "%.1fC", lastTemp);
  drawNumericRow(1, "TEMP", buf, tempScore);
  snprintf(buf, sizeof(buf), "%.0f", lastLux);
  drawNumericRow(2, "LUX", buf, lightScore);
  snprintf(buf, sizeof(buf), "%.0f%%", lastHum);
  drawNumericRow(3, "HUM", buf, humidScore);
}

// ============================================================
// シリアルコマンド
// ============================================================
void printHelp() {
  Serial.println("コマンド: post / n / sensors / wifi / stats / i2c / reboot / "
                 "e(感情巡回) / c(主訴巡回) / diag(BME診断)");
}

// 0x76 / 0x77 のチップIDをその場で読む（起動時ログを取り逃しても確認できる）
// ※ endTransmission(true) で毎回STOPを送る。リピートスタート(false)は存在しない
//    アドレスを叩いたときにバスを不安定化させ、診断自体が失敗を作ることがあるため。
void printChipId(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(0xD0);                       // チップIDレジスタ
  byte tx = Wire.endTransmission(true);
  if (tx != 0) {                          // ACKが無ければデバイス不在。読みに行かない。
    Serial.printf("[診断] 0x%02X 応答なし (txStatus=%d)\n", addr, tx);
    return;
  }
  Wire.requestFrom((int)addr, 1);
  if (Wire.available()) {
    uint8_t id = Wire.read();
    Serial.printf("[診断] 0x%02X チップID: 0x%02X (BME280=0x60 / BMP280=0x58) txStatus=%d\n",
                  addr, id, tx);
  } else {
    Serial.printf("[診断] 0x%02X 応答なし (txStatus=%d)\n", addr, tx);
  }
}

void handleCommand(String line) {
  line.trim();
  if (line == "post") {
    Serial.println("手動送信します");
    postReading();
    lastPost = millis();
  } else if (line == "n") {
    numericMode = !numericMode;
    Serial.println(numericMode ? "数値モード" : "顔モード");
  } else if (line == "e") {   // 感情を巡回（表情確認用）
    currentEmotion = (EmotionIdx)((currentEmotion + 1) % EMO_COUNT);
    Serial.printf("emotion=%s\n", EMO_TABLE[currentEmotion].key);
  } else if (line == "c") {   // 主訴を巡回（口・アイコン確認用）
    currentComplaint = (ComplaintIdx)((currentComplaint + 1) % CMP_COUNT);
    const char* k = CMP_TABLE[currentComplaint].key;
    Serial.printf("complaint=%s\n", (k[0] != '\0') ? k : "(なし)");
  } else if (line == "sensors") {
    readAllSensors();
    Serial.printf("soil=%d temp=%.1f hum=%.1f pres=%.1f lux=%.1f\n",
                  lastSoilAdc, lastTemp, lastHum, lastPres, lastLux);
  } else if (line == "wifi") {
    Serial.printf("status=%d ip=%s rssi=%d\n",
                  WiFi.status(), WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
  } else if (line == "stats") {   // ★v3: 稼働状況の確認
    Serial.printf("boot_count=%lu uptime_s=%lu postFail=%u wdt=%lus\n",
                  (unsigned long)bootCount, (unsigned long)(millis() / 1000UL),
                  postFailCount, (unsigned long)WDT_TIMEOUT_S);
  } else if (line == "i2c") {     // ★v3: バス回復を手動で試す
    i2cRecover();
  } else if (line == "reboot") {
    Serial.println("再起動します");
    delay(200);
    ESP.restart();
  } else if (line == "diag") {   // BME280の素性をその場で確認
    printChipId(0x76);
    printChipId(0x77);           // アドレス違いの可能性も一応チェック
    float t = bme.readTemperature(), h = bme.readHumidity(), p = bme.readPressure() / 100.0f;
    Serial.printf("bmeOk=%d tslOk=%d | 生読み t=%.1f h=%.1f p=%.1f (妥当=%d)\n",
                  bmeOk, tslOk, t, h, p, bmeReadValid(t, h, p));
  } else if (line.length() > 0) {
    printHelp();
  }
}

// ============================================================
// setup / loop
// ============================================================
void setup() {
  mirrorBegin();
  delay(300);
  randomSeed(analogRead(0));

  // ★v3-D: 起動回数をNVSに記録する。
  //   空白期間をまたいで boot_count が増えていれば再起動が起きた証拠になる。
  prefs.begin("planterai", false);
  bootCount = prefs.getUInt("boot", 0) + 1;
  prefs.putUInt("boot", bootCount);
  prefs.end();
  Serial.printf("[boot] 起動回数=%lu / 前回リセット要因=%d\n",
                (unsigned long)bootCount, (int)esp_reset_reason());

  // ★v3-A: ウォッチドッグ。loop()が固まっても自動で復帰する。
  wdtSetup();

  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(I2C_TIMEOUT_MS);   // ★v3-B: I2Cの永久ブロックを防ぐ

  // ============================================================
  // ★診断ブロック（確認が終わったらこのブロックごと削除してよい）
  //   BME280(本物)のチップIDは 0x60、BMP280(湿度なし互換品)は 0x58。
  // ============================================================
  printChipId(0x76);
  // ============================================================

  u8g2.begin();
  u8g2.setContrast(255);

  bmeOk = bme.begin(0x76);
  Serial.println(bmeOk ? "BME280 OK" : "BME280 初期化失敗");
  if (bmeOk) {
    bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                    Adafruit_BME280::SAMPLING_X1, Adafruit_BME280::SAMPLING_X1,
                    Adafruit_BME280::SAMPLING_X1, Adafruit_BME280::FILTER_X4,
                    Adafruit_BME280::STANDBY_MS_500);
  }
  tslOk = tsl.begin();
  Serial.println(tslOk ? "TSL2591 OK" : "TSL2591 初期化失敗");
  if (tslOk) {
    tsl.setGain(TSL2591_GAIN_LOW);   // 室内向け
    tsl.setTiming(TSL2591_INTEGRATIONTIME_200MS);
  }
  wdtFeed();

  // Wi-Fi接続中も目を閉じた顔を出しておく
  drawThinking();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);   // 切断時に自動で再接続を試みる
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Wi-Fi接続中");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 45000) {
    delay(300); Serial.print(".");
    wdtFeed();                   // ★45秒待つのでWDTに餌をやり続ける
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("接続成功: %s (rssi=%d)\n",
                  WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
  } else {
    // ここで諦めない。loop側で30秒ごとに再接続を試み続ける
    Serial.println("接続待ち。表情は動かしつつ、裏で接続を試み続けます");
  }

  // プロトタイプ用途のため証明書検証は省略
  netClient.setInsecure();

  printHelp();

  lastFrame     = millis();
  lastWifiTry   = millis();
  wifiDownSince = 0;
  lastPost      = millis() - POST_INTERVAL_MS; // 起動直後に1回送る
}

void loop() {
  wdtFeed();   // ★v3-A: ループが回っている限り餌をやる。固まれば60秒で自動再起動。

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { handleCommand(serialBuf); serialBuf = ""; }
    else if (c != '\r') serialBuf += c;
  }

  unsigned long now = millis();

  // ------------------------------------------------------------
  // ★v3-E: Wi-Fi/送信の管理
  //   旧実装は「POST間隔と同じ10分に1回しか再接続を試さない」「何度失敗しても
  //   再起動しない」ため、一度こじれると延々と黙り続けた。
  // ------------------------------------------------------------
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiDownSince == 0) {
      wifiDownSince = now;
      Serial.println("Wi-Fi切断を検知");
    }
    if (now - lastWifiTry >= WIFI_RETRY_MS) {
      lastWifiTry = now;
      Serial.println("Wi-Fi再接続を試みます");
      WiFi.disconnect();                        // reconnect()より確実に入り直す
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    if (now - wifiDownSince >= WIFI_GIVEUP_MS) {
      Serial.println("Wi-Fiが復帰しません。再起動します");
      delay(200);
      ESP.restart();
    }
  } else {
    if (wifiDownSince != 0) {
      Serial.printf("Wi-Fi復帰 (%lu秒ぶり)\n", (unsigned long)((now - wifiDownSince) / 1000));
      wifiDownSince = 0;
    }
    if (now - lastPost >= POST_INTERVAL_MS) {
      lastPost = now;
      postReading();
      now = millis();
    }
  }

  float dt = (float)(now - lastFrame);
  if (dt < 20) return;   // 上限約50fps
  lastFrame = now;

  updateTargets(dt);

  u8g2.clearBuffer();
  if (numericMode) drawNumeric(); else drawFace(now, dt);
  u8g2.sendBuffer();
  mirrorFrame(u8g2);
}
