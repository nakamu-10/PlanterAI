
exec(bpy.data.texts["karami_anim"].as_string())
import math
from mathutils import Vector

# 持ち上げられてジタバタする（くり返し）。顔は Surprise のいちばん驚いた瞬間（6フレーム目）を使い、
# 手足・頭・葉をばたつかせる。12フレーム（0.5秒）で1周
STRUGGLE_LEN = 12
FACE_FROM = ("Surprise", 6)
X = Vector((1,0,0)); Y = Vector((0,1,0)); Z = Vector((0,0,1))

def pose_from(action_name, frame):
    a = bpy.data.actions[action_name]
    for pb in P:
        for prop, n in (("rotation_quaternion",4),("location",3),("scale",3)):
            vals = []
            for i in range(n):
                fc = a.fcurves.find(f'pose.bones["{pb.name}"].{prop}', index=i)
                vals.append(fc.evaluate(frame) if fc else getattr(pb, prop)[i])
            pb.rotation_mode = "QUATERNION"
            setattr(pb, prop, vals)

def build_struggle():
    act = new_action("Struggle")
    for f in range(0, STRUGGLE_LEN + 1, 2):
        t = f / STRUGGLE_LEN * 2 * math.pi
        s, c = math.sin(t), math.cos(t)
        pose_from(*FACE_FROM)
        for pb in P:            # 手足はまっすぐに戻してから振る
            if pb.name.startswith(("arm_","leg_","body","root","head")):
                pb.rotation_quaternion = (1,0,0,0); pb.location = (0,0,0)
        # 腕：左右で互い違いに、上下にばたばた
        rot_world(P["arm_L"], Y, -70 - 50 * s)
        rot_world(P["arm_R"], Y,  70 - 50 * s)
        # 足：交互に横へけり出す（正面から見て分かるように、前後より横を大きく）
        rot_world(P["leg_L"], Y, -10 - 25 * max(s, 0))
        rot_world(P["leg_R"], Y,  10 + 25 * max(-s, 0))
        rot_world(P["leg_L"], X,  25 * s)
        rot_world(P["leg_R"], X, -25 * s)
        # 口を大きく開けて叫ぶ
        mo = P["mouth_open"]; mo.scale = (mo.scale[0] * 1.2, mo.scale[1], 1.5)
        # 体と頭：左右にいやいや
        rot_world(P["body"], Y, 6 * c)
        rot_world(P["head"], Z, 10 * s)
        # 葉：倍の速さでぱたぱた
        for i, n in enumerate(LEAVES):
            droop(P["leaf_" + n], 12 * math.sin(2 * t + i))
        key(f)
    smooth(act)
    act.id_root = "OBJECT"
    return act
