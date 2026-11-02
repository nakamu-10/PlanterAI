import sys, types, random
import numpy as np

# pygame / serial をスタブ化して oled_mirror を import する
for name in ("pygame", "serial", "serial.tools", "serial.tools.list_ports"):
    m = types.ModuleType(name)
    sys.modules[name] = m
sys.modules["serial"].tools = sys.modules["serial.tools"]
sys.modules["serial.tools"].list_ports = sys.modules["serial.tools.list_ports"]

import oled_mirror as om

FAIL = 0
def check(cond, label):
    global FAIL
    print(("  OK  " if cond else "  NG  ") + label)
    if not cond:
        FAIL += 1

def frame_packet(seq, payload):
    return b"PLNT" + bytes([seq]) + payload

def text_packet(s):
    b = s.encode("utf-8")
    return b"PLNX" + bytes([len(b) & 0xFF, len(b) >> 8]) + b

def rand_payload(seed):
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(1024))

print("1) 基本: 連続フレーム")
p = om.StreamParser()
stream = b"".join(frame_packet(i, rand_payload(i)) for i in range(5))
f, t = p.feed(stream)
check(len(f) == 5, f"5フレーム受信 (got {len(f)})")
check(f[0] == rand_payload(0) and f[4] == rand_payload(4), "ペイロード一致")

print("2) 起動ログ等のゴミが先頭に混ざる")
p = om.StreamParser()
junk = b"ets Jun  8 2016 00:22:57\r\nrst:0x1 (POWERON_RESET)\r\n"
f, t = p.feed(junk + stream)
check(len(f) == 5, f"ゴミを飛ばして5フレーム (got {len(f)})")

print("3) 1バイトずつ分割して流し込む")
p = om.StreamParser()
got = 0
for b in junk + stream:
    f, t = p.feed(bytes([b]))
    got += len(f)
check(got == 5, f"分割読み込みでも5フレーム (got {got})")

print("4) ペイロード内に偽マジック 'PLNT' が含まれる")
payload = bytearray(rand_payload(99))
payload[0:4] = b"PLNT"        # 先頭直後
payload[500:504] = b"PLNT"    # 途中
payload = bytes(payload)
p = om.StreamParser()
f, t = p.feed(b"".join(frame_packet(i, payload) for i in range(6)))
check(len(f) == 6, f"誤同期せず6フレーム (got {len(f)})")
check(all(x == payload for x in f), "ペイロードがずれていない")

print("5) テキストパケット（DBG）の混在")
p = om.StreamParser()
s = (frame_packet(0, rand_payload(1))
     + text_packet("受信state: emotion=不安 complaint=水分不足")
     + frame_packet(1, rand_payload(2))
     + text_packet("[BME異常値を無視] t=180.1")
     + frame_packet(2, rand_payload(3)))
f, t = p.feed(s)
check(len(f) == 3 and len(t) == 2, f"frame={len(f)} text={len(t)}")
check(t[0].decode("utf-8").startswith("受信state"), "UTF-8 テキストが復元できる")

print("6) 途中でゴミが割り込んでも次フレームで復帰")
p = om.StreamParser()
s = (frame_packet(0, rand_payload(1))
     + b"\x00\xff\x13garbage"          # 破損
     + frame_packet(1, rand_payload(2))
     + frame_packet(2, rand_payload(3))
     + frame_packet(3, rand_payload(4)))
f, t = p.feed(s)
check(len(f) >= 3, f"復帰して残りを受信 (got {len(f)})")
check(f[-1] == rand_payload(4), "復帰後のペイロードが正しい")

print("7) バッファが無限に太らない")
p = om.StreamParser()
for _ in range(50):
    p.feed(b"x" * 1000)
check(len(p.buf) < 5000, f"バッファ長 {len(p.buf)}")

print("8) ビット展開: buf[page*128+x] の bit n -> (x, y=page*8+n)")
buf = bytearray(1024)
# (x=3, y=9) を点灯 -> page=1, bit=1 -> buf[1*128+3] |= 0x02
buf[1 * 128 + 3] |= 0x02
# (x=127, y=63) -> page=7, bit=7
buf[7 * 128 + 127] |= 0x80
bits = om.decode_frame(bytes(buf))
check(bits.shape == (64, 128), f"shape {bits.shape}")
check(bits[9, 3] == 1, "(x=3,y=9) が点灯")
check(bits[63, 127] == 1, "(x=127,y=63) が点灯")
check(bits.sum() == 2, f"余計な点灯なし (sum={bits.sum()})")

print()
print("FAILED" if FAIL else "ALL PASS")
sys.exit(1 if FAIL else 0)
