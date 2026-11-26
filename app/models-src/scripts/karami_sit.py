exec(bpy.data.texts["karami_sleep"].as_string())
import math
from mathutils import Vector

# ソファに座る（くり返し）。部屋のソファの立ち位置（spot_sofa）に合わせ、座面に腰を下ろして
# 脚を前へ投げ出し、足をぶらぶらさせる。アプリはこの動きのうち根元の骨と脚（SEAT_BONES）
# だけを使い、顔・頭・葉は待機としおれのまま気分で動かす。Idle と同じ 48 フレームで1周
SIT_LEN = 48
SEAT_BONES = ("root", "leg_")
# 部屋の寸法（build_room.py のソファ）を、立ち位置から見た値にしてキャラの大きさ（1.35倍）で
# 割ったもの。背中の一番後ろを背もたれの前に置く
BACK_Y = 0.15
SWING = 10

def sit_down(t):
    pose_from("Idle", 0)
    for pb in P:
        if pb.name.startswith(SEAT_BONES):
            pb.rotation_quaternion = (1,0,0,0); pb.location = (0,0,0)
    P["futon"].scale = (0.001,)*3
    s = math.sin(t)
    rot_world(P["leg_L"], X, -90 + SWING * s)
    rot_world(P["leg_R"], X, -90 - SWING * s)

def seat_box():
    """座面に触れる所（胴と脚）を囲む箱"""
    names = {o.name for o in bpy.data.objects if o.type == "MESH" and o.parent is rig
             and o.parent_bone.startswith(("body",) + SEAT_BONES)}
    return rig_box(names)

def build_sit():
    add_futon_bone()
    rig.animation_data.action = None
    sit_down(0)
    seat_lo, _ = seat_box()
    _, hi = rig_box()
    shift = Vector((0, BACK_Y - hi.y, -seat_lo.z))
    act = new_action("Sit")
    for f in range(0, SIT_LEN + 1, 4):
        t = f / SIT_LEN * 2 * math.pi
        sit_down(t)
        move_world(P["root"], shift)
        key(f)
    smooth(act)
    act.id_root = "OBJECT"
    return act
