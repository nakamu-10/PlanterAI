#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PlanterAI OLED Mirror  ―  ESP32 の 128x64 フレームバッファを USB シリアルで受けて拡大表示する。

    pip install pyserial pygame numpy
    python oled_mirror.py                 # ポート自動検出
    python oled_mirror.py --port COM5
    python oled_mirror.py --list
    python oled_mirror.py --fullscreen

キー:
    F        フルスクリーン切替（画面に収まる最大の整数倍）
    + / -    拡大率（↑ / ↓ でも可。日本語配列では ↑↓ が確実）
    G        グリッド線 ON/OFF
    H        ステータス表示 ON/OFF（本番は OFF 推奨）
    E / C    ESP32 へ 'e' / 'c'（感情・主訴の巡回）を送信
    P        ESP32 へ 'post' を送信（手動でセンサー送信）
    N        ESP32 へ 'n' を送信（顔モード / 数値モード切替）
    S        ESP32 へ 'sensors' を送信
    D        ESP32 へ 'diag' を送信（BME280診断）
    W        ESP32 へ 'wifi' を送信（接続状態の確認）
    ESC / Q  終了

プロトコル:
    フレーム : b'PLNT' + seq(1) + 1024byte
    テキスト : b'PLNX' + len(2, LE) + 本文(UTF-8)  ← DBG() の出力。端末に流す。
"""

import argparse
import sys
import time

import numpy as np

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial が入っていません:  pip install pyserial")

try:
    import pygame
except ImportError:
    sys.exit("pygame が入っていません:  pip install pygame")


# ---------------------------------------------------------------- 定数

MAGIC_FRAME = b"PLNT"
MAGIC_TEXT = b"PLNX"

W, H = 128, 64
FRAME_BYTES = W * H // 8              # 1024
FRAME_PACKET = 4 + 1 + FRAME_BYTES    # 1029
TEXT_MAX = 1024

COLOR_ON = (120, 230, 245)   # 点灯（薄いシアン）
COLOR_OFF = (10, 12, 16)     # 消灯
COLOR_BG = (0, 0, 0)
COLOR_HUD = (150, 150, 160)
COLOR_WARN = (230, 120, 90)

STALE_SEC = 1.5              # これ以上フレームが来なければ「切断」表示


# ---------------------------------------------------------------- パーサ

class StreamParser:
    """マジック探索＋次パケット検証で同期する。バッファ内に偶然 'PLNT' が
    現れても、その 1029byte 先に次のマジックが無ければ採用しない。"""

    def __init__(self):
        self.buf = bytearray()
        self.locked = False
        self.frames = 0
        self.resyncs = 0
        self.dropped = 0
        self.last_seq = None

    def feed(self, data):
        self.buf += data
        frames, texts = [], []

        while True:
            if not self.locked:
                idx = self._find_sync()
                if idx is None:
                    # 同期先が見つからない。バッファが太り続けないよう頭を捨てる。
                    if len(self.buf) > 4 * FRAME_PACKET:
                        cut = len(self.buf) - 2 * FRAME_PACKET
                        del self.buf[:cut]
                        self.dropped += cut
                    break
                if idx > 0:
                    del self.buf[:idx]
                    self.dropped += idx
                self.locked = True

            if len(self.buf) < 6:
                break

            magic = bytes(self.buf[0:4])

            if magic == MAGIC_FRAME:
                if len(self.buf) < FRAME_PACKET:
                    break
                seq = self.buf[4]
                payload = bytes(self.buf[5:FRAME_PACKET])
                del self.buf[:FRAME_PACKET]
                if self.last_seq is not None and (self.last_seq + 1) & 0xFF != seq:
                    self.resyncs += 1          # 取りこぼし（致命的ではない）
                self.last_seq = seq
                self.frames += 1
                frames.append(payload)

            elif magic == MAGIC_TEXT:
                n = self.buf[4] | (self.buf[5] << 8)
                if n > TEXT_MAX:
                    self.locked = False
                    del self.buf[:1]
                    continue
                if len(self.buf) < 6 + n:
                    break
                texts.append(bytes(self.buf[6:6 + n]))
                del self.buf[:6 + n]

            else:
                # 同期が外れた
                self.locked = False
                self.last_seq = None
                self.resyncs += 1
                del self.buf[:1]

        return frames, texts

    def _packet_len_at(self, p):
        """p 位置のパケット長。None=データ不足 / False=マジックでない"""
        if len(self.buf) < p + 6:
            return None
        m = bytes(self.buf[p:p + 4])
        if m == MAGIC_FRAME:
            return FRAME_PACKET
        if m == MAGIC_TEXT:
            n = self.buf[p + 4] | (self.buf[p + 5] << 8)
            if n > TEXT_MAX:
                return False
            return 6 + n
        return False

    def _verify(self, pos, needed=2):
        """pos から needed 個ぶん連続してマジックが並ぶか。None=データ不足"""
        p = pos
        for _ in range(needed):
            step = self._packet_len_at(p)
            if step is None:
                return None
            if step is False:
                return False
            p += step
        return True

    def _find_sync(self):
        """フレーム・テキストどちらのマジックでも同期する。
        起動直後（まだ1フレームも来ていない）の診断ログを拾うため。"""
        start = 0
        while True:
            cands = [i for i in (self.buf.find(MAGIC_FRAME, start),
                                 self.buf.find(MAGIC_TEXT, start)) if i >= 0]
            if not cands:
                return None
            i = min(cands)
            ok = self._verify(i)
            if ok is True:
                return i
            if ok is None:
                return None      # データ待ち。バッファは保持する
            start = i + 1


def decode_frame(payload):
    """U8g2 フルバッファ（ページ優先・LSB が上）→ (64,128) の 0/1 配列"""
    arr = np.frombuffer(payload, dtype=np.uint8).reshape(H // 8, W)
    return np.unpackbits(arr, axis=0, bitorder="little")


# ---------------------------------------------------------------- シリアル

CANDIDATE_HINTS = ("cp210", "ch340", "ch910", "silicon labs", "usb serial",
                   "usb-serial", "ftdi", "wch", "esp32", "uart")


def find_port():
    ports = list(list_ports.comports())
    if not ports:
        return None
    for p in ports:
        blob = f"{p.description} {p.manufacturer} {p.hwid}".lower()
        if any(h in blob for h in CANDIDATE_HINTS):
            return p.device
    return ports[0].device


def print_ports():
    ports = list(list_ports.comports())
    if not ports:
        print("シリアルポートが見つかりません。")
        return
    for p in ports:
        print(f"  {p.device}  {p.description}  [{p.hwid}]")


class Link:
    """接続・自動再接続をまとめたもの。USB を抜き差ししても復帰する。"""

    def __init__(self, port, baud):
        self.port_arg = port
        self.baud = baud
        self.ser = None
        self.port = None
        self.next_try = 0.0

    def poll(self):
        if self.ser is not None:
            return
        now = time.time()
        if now < self.next_try:
            return
        self.next_try = now + 1.0
        port = self.port_arg or find_port()
        if port is None:
            return
        try:
            self.ser = serial.Serial(port, self.baud, timeout=0, write_timeout=0.2)
            self.port = port
            print(f"[mirror] 接続 {port} @ {self.baud}")
        except Exception as e:
            self.ser = None
            print(f"[mirror] 接続失敗 {port}: {e}")

    def read(self):
        if self.ser is None:
            return b""
        try:
            n = self.ser.in_waiting
            if n:
                return self.ser.read(n)
            return b""
        except Exception as e:
            print(f"[mirror] 切断: {e}")
            self.close()
            return b""

    def send_line(self, s):
        if self.ser is None:
            return
        try:
            self.ser.write((s + "\n").encode("ascii"))
            print(f"[mirror] -> {s}")
        except Exception as e:
            print(f"[mirror] 送信失敗: {e}")
            self.close()

    def close(self):
        try:
            if self.ser:
                self.ser.close()
        except Exception:
            pass
        self.ser = None


# ---------------------------------------------------------------- 描画

def make_base_surface(bits):
    img = np.empty((W, H, 3), dtype=np.uint8)
    t = bits.T                       # (128, 64)
    img[:] = COLOR_OFF
    img[t == 1] = COLOR_ON
    return pygame.surfarray.make_surface(img)


def make_grid_overlay(scale):
    """ドット間 1px の隙間。scale>=3 のときだけ意味がある。"""
    surf = pygame.Surface((W * scale, H * scale), pygame.SRCALPHA)
    surf.fill((0, 0, 0, 0))
    line = (0, 0, 0, 255)
    for x in range(1, W):
        pygame.draw.line(surf, line, (x * scale - 1, 0), (x * scale - 1, H * scale))
    for y in range(1, H):
        pygame.draw.line(surf, line, (0, y * scale - 1), (W * scale, y * scale - 1))
    return surf


def max_scale_for(w, h):
    return max(1, min(w // W, h // H))



def apply_scale(new_scale, fullscreen, screen):
    """倍率を変更する。画面からはみ出さないよう上限で頭打ちにする。"""
    limit = max_scale_for(*screen.get_size()) if fullscreen else 40
    new_scale = max(1, min(new_scale, limit))
    if not fullscreen:
        screen = pygame.display.set_mode((W * new_scale, H * new_scale))
    return new_scale, screen


# ---------------------------------------------------------------- 本体

def main():
    ap = argparse.ArgumentParser(description="PlanterAI OLED Mirror")
    ap.add_argument("--port", default=None, help="COM5 / /dev/ttyUSB0 など")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--scale", type=int, default=6)
    ap.add_argument("--fullscreen", action="store_true")
    ap.add_argument("--no-grid", action="store_true")
    ap.add_argument("--hud", action="store_true", help="起動時からステータス表示")
    ap.add_argument("--list", action="store_true", help="ポート一覧を表示して終了")
    args = ap.parse_args()

    if args.list:
        print_ports()
        return

    pygame.init()
    pygame.display.set_caption("PlanterAI OLED Mirror")

    # 日本語配列では Shift+";" が K_PLUS ではなく K_SEMICOLON として届く。
    # 配列に依存しない ↑/↓ も受け付ける。
    ZOOM_IN_KEYS = (pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS,
                    pygame.K_SEMICOLON, pygame.K_UP, pygame.K_RIGHTBRACKET)
    ZOOM_OUT_KEYS = (pygame.K_MINUS, pygame.K_KP_MINUS,
                     pygame.K_UNDERSCORE, pygame.K_DOWN)
    font = pygame.font.SysFont("consolas,monospace", 16)

    scale = max(1, args.scale)
    fullscreen = args.fullscreen
    grid = not args.no_grid
    hud = args.hud

    if fullscreen:
        screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
        # ※ pygame.display.Info() は set_mode 後だと「現在のウィンドウサイズ」を
        #    返すため使えない。実際に張られたサーフェスから測る。
        scale = max_scale_for(*screen.get_size())
    else:
        screen = pygame.display.set_mode((W * scale, H * scale))

    overlay = make_grid_overlay(scale) if scale >= 3 else None
    overlay_scale = scale

    link = Link(args.port, args.baud)
    parser = StreamParser()
    clock = pygame.time.Clock()

    base = None
    last_frame_at = 0.0
    last_text = ""
    text_accum = ""
    fps_count, fps_at, fps = 0, time.time(), 0.0
    running = True

    while running:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                running = False
            elif ev.type == pygame.KEYDOWN:
                k = ev.key
                if k in (pygame.K_ESCAPE, pygame.K_q):
                    running = False
                elif k == pygame.K_f:
                    fullscreen = not fullscreen
                    if fullscreen:
                        screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
                        scale = max_scale_for(*screen.get_size())
                    else:
                        scale = max(1, args.scale)
                        screen = pygame.display.set_mode((W * scale, H * scale))
                elif k in ZOOM_IN_KEYS or ev.unicode in ("+", ";", "^"):
                    scale, screen = apply_scale(scale + 1, fullscreen, screen)
                elif k in ZOOM_OUT_KEYS or ev.unicode == "-":
                    scale, screen = apply_scale(scale - 1, fullscreen, screen)
                elif k == pygame.K_g:
                    grid = not grid
                elif k == pygame.K_h:
                    hud = not hud
                elif k == pygame.K_e:
                    link.send_line("e")
                elif k == pygame.K_c:
                    link.send_line("c")
                elif k == pygame.K_p:
                    link.send_line("post")
                elif k == pygame.K_d:
                    link.send_line("diag")
                elif k == pygame.K_n:
                    link.send_line("n")
                elif k == pygame.K_s:
                    link.send_line("sensors")
                elif k == pygame.K_w:
                    link.send_line("wifi")

        if scale != overlay_scale:
            overlay = make_grid_overlay(scale) if scale >= 3 else None
            overlay_scale = scale

        # ---- 受信
        link.poll()
        data = link.read()
        if data:
            frames, texts = parser.feed(data)
            for t in texts:
                text_accum += t.decode("utf-8", errors="replace")
            while "\n" in text_accum:
                line, text_accum = text_accum.split("\n", 1)
                line = line.rstrip("\r")
                if line:
                    last_text = line
                    print(line, flush=True)
            if len(text_accum) > 400:          # 改行が来ないまま溜まったら吐く
                print(text_accum, flush=True)
                last_text, text_accum = text_accum, ""
            if frames:
                base = make_base_surface(decode_frame(frames[-1]))
                last_frame_at = time.time()
                fps_count += 1

        now = time.time()
        if now - fps_at >= 1.0:
            fps = fps_count / (now - fps_at)
            fps_count, fps_at = 0, now

        # ---- 描画
        screen.fill(COLOR_BG)
        sw, sh = screen.get_size()
        stale = (now - last_frame_at) > STALE_SEC

        if base is not None:
            big = pygame.transform.scale(base, (W * scale, H * scale))  # 補間なし
            if grid and overlay is not None:
                big.blit(overlay, (0, 0))
            if stale:
                big.set_alpha(70)
            else:
                big.set_alpha(255)
            screen.blit(big, ((sw - W * scale) // 2, (sh - H * scale) // 2))

        if base is None or stale:
            msg = font.render("WAITING FOR DEVICE...", True, COLOR_WARN)
            screen.blit(msg, ((sw - msg.get_width()) // 2, sh - 40))

        if hud:
            port = link.port if link.ser else "-"
            lines = [
                f"{port} @ {args.baud}   {fps:4.1f} fps   x{scale}"
                f"   frames={parser.frames} resync={parser.resyncs}",
            ]
            if last_text:
                lines.append(last_text[:110])
            for i, s in enumerate(lines):
                screen.blit(font.render(s, True, COLOR_HUD), (10, 8 + i * 18))

        pygame.display.flip()
        clock.tick(60)

    link.close()
    pygame.quit()


if __name__ == "__main__":
    main()
