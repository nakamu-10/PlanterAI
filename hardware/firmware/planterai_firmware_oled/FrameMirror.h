// ============================================================================
//  FrameMirror.h  —  PlanterAI OLED Mirror (ESP32 送信側)
//
//  U8g2 のフルバッファ(128x64=1024byte)を USB シリアルでそのまま PC へ送る。
//  Wi-Fi 不使用。PC 側は oled_mirror.py。
//
//  ── sketch 側の変更は4行だけ ──────────────────────────────
//    1) #include "FrameMirror.h"        ← ライブラリ include の「一番最後」に置く
//    2) setup():  Serial.begin(115200)  →  mirrorBegin();
//    3) loop() :  u8g2.sendBuffer();    の直後に  mirrorFrame(u8g2);
//    4) drawThinking(): u8g2.sendBuffer(); の直後に mirrorFrame(u8g2);
//
//  既存の Serial.printf / print / println は **書き換え不要**。
//  MIRROR_CAPTURE_SERIAL=1（既定）のとき、それらは自動でテキストパケットに
//  包まれて送られ、PC 側のターミナルにそのまま表示される。
//  Serial.available() / read()（シリアルコマンド）も従来どおり使える。
//
//  通常運用へ戻すとき: この include より前で #define MIRROR_ENABLED 0
// ============================================================================
#pragma once

#include <Arduino.h>
#include <U8g2lib.h>
#include <stdarg.h>
#include <string.h>

#ifndef MIRROR_ENABLED
#define MIRROR_ENABLED 1
#endif

// 既存の Serial.* 呼び出しを横取りしてテキストパケット化するか。
// 0 にすると素の Serial 出力になり、フレームに混ざって一瞬乱れる（次フレームで復帰）。
#ifndef MIRROR_CAPTURE_SERIAL
#define MIRROR_CAPTURE_SERIAL 1
#endif

// ミラー時のボーレート。115200 だと 1029byte/frame で 11fps 上限になり
// 感情間補間(400〜600ms)がカクつくため 921600 を使う。
#ifndef MIRROR_BAUD
#define MIRROR_BAUD 921600
#endif

// 通常運用時（MIRROR_ENABLED 0）のボーレート
#ifndef MIRROR_NORMAL_BAUD
#define MIRROR_NORMAL_BAUD 115200
#endif

// 送信の最小間隔[ms]。0 で毎フレーム送る。
#ifndef MIRROR_MIN_INTERVAL_MS
#define MIRROR_MIN_INTERVAL_MS 15
#endif

// テキスト1回の最大長[byte]
#ifndef MIRROR_TEXT_MAX
#define MIRROR_TEXT_MAX 480
#endif

// ----------------------------------------------------------------------------
//  プロトコル
//    フレーム : 'P''L''N''T' + seq(1) + framebuffer(1024)   = 1029 byte
//    テキスト : 'P''L''N''X' + len(2, little endian) + 本文(UTF-8)
//
//  seq と「次パケットのマジック検証」の2段で、フレームバッファ内に偶然
//  "PLNT" が現れても誤同期しない。PC 側で復帰処理済み。
// ----------------------------------------------------------------------------

#if MIRROR_ENABLED

static uint8_t  _mirrorSeq = 0;
static uint32_t _mirrorLast = 0;

// マクロで Serial が置き換わる前に、本物への参照を確保しておく
static HardwareSerial &_mirrorRaw = Serial;

// U8G2 基底クラス参照なので SH1106 / SSD1306 どちらのコンストラクタでも通る。
// ※ フルバッファ版（_F_ 付き）が必須。ページモードでは getBufferPtr() が nullptr。
inline void mirrorFrame(U8G2 &g) {
  uint8_t *buf = g.getBufferPtr();
  if (buf == nullptr) return;

#if MIRROR_MIN_INTERVAL_MS > 0
  uint32_t now = millis();
  if (now - _mirrorLast < (uint32_t)MIRROR_MIN_INTERVAL_MS) return;
  _mirrorLast = now;
#endif

  const uint16_t len =
      (uint16_t)g.getBufferTileWidth() * (uint16_t)g.getBufferTileHeight() * 8;

  uint8_t head[5] = {'P', 'L', 'N', 'T', _mirrorSeq++};
  _mirrorRaw.write(head, 5);
  _mirrorRaw.write(buf, len);
}

inline size_t mirrorText(const char *s, size_t n) {
  if (s == nullptr || n == 0) return 0;
  if (n > MIRROR_TEXT_MAX) n = MIRROR_TEXT_MAX;
  uint8_t head[6] = {'P', 'L', 'N', 'X',
                     (uint8_t)(n & 0xFF), (uint8_t)((n >> 8) & 0xFF)};
  _mirrorRaw.write(head, 6);
  _mirrorRaw.write((const uint8_t *)s, n);
  return n;
}

inline size_t mirrorVprintf(const char *fmt, va_list ap) {
  char buf[MIRROR_TEXT_MAX + 1];
  int n = vsnprintf(buf, sizeof(buf), fmt, ap);
  if (n < 0) return 0;
  if (n > MIRROR_TEXT_MAX) n = MIRROR_TEXT_MAX;
  return mirrorText(buf, (size_t)n);
}

// 起動直後にテキストを1本出す。PC 側はこれで即座に同期でき、
// setup() 内の診断ログ（[診断] や BME280 OK など）を取り逃さない。
inline void mirrorBegin() {
  _mirrorRaw.begin(MIRROR_BAUD);
  delay(50);
  mirrorText("[mirror] ESP32 ready\n", 21);
}

inline size_t mirrorPrintf(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  size_t n = mirrorVprintf(fmt, ap);
  va_end(ap);
  return n;
}

#define DBG(...) mirrorPrintf(__VA_ARGS__)
#define MIRROR_ACTIVE 1

// ---------------------------------------------------------------------------
//  Serial 捕捉シム
//  既存コードの Serial.printf(...) / print(...) / println(...) をそのまま
//  テキストパケットへ流す。入力系(available/read/peek)は本物へ委譲する。
//  ※ このヘッダを **ライブラリ include の最後** に置くこと。
//    先に置くと後続ライブラリの内部 Serial まで置換されてしまう。
// ---------------------------------------------------------------------------
#if MIRROR_CAPTURE_SERIAL

class MirrorSerialShim {
 public:
  // --- 入力・制御は本物へ委譲 ---
  void begin(unsigned long baud) { (void)baud; }   // mirrorBegin() で開始済み
  void end() {}
  void flush() { _mirrorRaw.flush(); }
  int  available() { return _mirrorRaw.available(); }
  int  availableForWrite() { return _mirrorRaw.availableForWrite(); }
  int  read() { return _mirrorRaw.read(); }
  int  peek() { return _mirrorRaw.peek(); }
  void setTimeout(unsigned long ms) { _mirrorRaw.setTimeout(ms); }
  operator bool() const { return true; }

  // --- 出力はテキストパケット化 ---
  size_t printf(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    size_t n = mirrorVprintf(fmt, ap);
    va_end(ap);
    return n;
  }

  size_t print(const char *s)        { return mirrorText(s, s ? strlen(s) : 0); }
  size_t print(const String &s)      { return mirrorText(s.c_str(), s.length()); }
  size_t print(char c)               { char b[2] = {c, 0}; return mirrorText(b, 1); }
  size_t print(int v)                { return printf("%d", v); }
  size_t print(unsigned int v)       { return printf("%u", v); }
  size_t print(long v)               { return printf("%ld", v); }
  size_t print(unsigned long v)      { return printf("%lu", v); }
  size_t print(double v, int d = 2)  { return printf("%.*f", d, v); }

  size_t println()                   { return mirrorText("\n", 1); }
  size_t println(const char *s)      { return printf("%s\n", s ? s : ""); }
  size_t println(const String &s)    { return printf("%s\n", s.c_str()); }
  size_t println(char c)             { char b[3] = {c, '\n', 0}; return mirrorText(b, 2); }
  size_t println(int v)              { return printf("%d\n", v); }
  size_t println(unsigned int v)     { return printf("%u\n", v); }
  size_t println(long v)             { return printf("%ld\n", v); }
  size_t println(unsigned long v)    { return printf("%lu\n", v); }
  size_t println(double v, int d = 2){ return printf("%.*f\n", d, v); }

  // 生バイト書き込みはフレームを壊すので握り潰す（誤用の保険）
  size_t write(uint8_t) { return 0; }
  size_t write(const uint8_t *, size_t) { return 0; }
};

static MirrorSerialShim _mirrorSerial;

// ここから下（＝sketch本体）の Serial は全てシムを指す
#define Serial _mirrorSerial

#endif  // MIRROR_CAPTURE_SERIAL

#else  // ---------------- 通常運用（ミラー無効） ----------------

inline void mirrorBegin() { Serial.begin(MIRROR_NORMAL_BAUD); }
inline void mirrorFrame(U8G2 &g) { (void)g; }
inline size_t mirrorText(const char *s, size_t n) { (void)s; (void)n; return 0; }

#define DBG(...) Serial.printf(__VA_ARGS__)
#define MIRROR_ACTIVE 0

#endif
