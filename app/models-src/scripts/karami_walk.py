exec(bpy.data.texts["karami_struggle"].as_string())
import math

# 歩く（その場で足踏みをくり返す）。アプリは台ごと前へ動かし、この動きのうち根元の骨と脚
# （SEAT_BONES）だけを使う。顔・頭・葉は待機としおれのまま気分で動かすので、しおれたまま歩ける。
# 24フレーム（1秒）で2歩
WALK_LEN = 24
WALK_BONES = ("root", "leg_")
SWING = 22   # 脚を前後に振る角度
WADDLE = 4   # 踏み出す脚の方へ体を傾ける角度
TWIST = 5    # 踏み出す脚の方へ腰をひねる角度

def leg_length():
    b = P["leg_L"].bone
    return (b.head_local - b.tail_local).length

def stride():
    """1歩で足が進む距離（キャラの大きさ 1 のとき）。アプリの歩く速さはこれから決める"""
    return 2 * leg_length() * math.sin(math.radians(SWING))

def step(t):
    pose_from("Idle", 0)
    for pb in P:
        if pb.name.startswith(WALK_BONES):
            pb.rotation_quaternion = (1,0,0,0); pb.location = (0,0,0)
    s = math.sin(t)
    rot_world(P["leg_L"], X, -SWING * s)
    rot_world(P["leg_R"], X, SWING * s)
    rot_world(P["root"], Y, WADDLE * s)
    rot_world(P["root"], Z, TWIST * s)
    # 脚を傾けたぶん足先が上がるので、根元を下げて、ついている足を床に付けたままにする
    lift = leg_length() * (1 - math.cos(math.radians(SWING * s)))
    move_world(P["root"], (0, 0, -lift))

def build_walk():
    rig.animation_data.action = None
    act = new_action("Walk")
    for f in range(0, WALK_LEN + 1, 2):
        step(f / WALK_LEN * 2 * math.pi)
        key(f)
    smooth(act)
    act.id_root = "OBJECT"
    return act
