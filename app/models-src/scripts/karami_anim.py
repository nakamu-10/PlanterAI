
import bpy, math
from mathutils import Vector, Quaternion
rig = bpy.data.objects["Karami"]
P = rig.pose.bones
LEAVES = ["Top","UpL","UpR","FrontL","FrontR","BackL","BackR"]
CAPES = ["L","R","Back"]
DOWN = Vector((0,0,-1)); UP = Vector((0,0,1))

def rest_q(pb): return pb.bone.matrix_local.to_quaternion()
def bone_dir(pb): return (pb.bone.tail_local - pb.bone.head_local).normalized()

def rot_world(pb, axis, deg):
    """ワールドの軸まわりに回す（親からの相対）。複数回呼ぶと積み重なる"""
    B = rest_q(pb)
    q = B.inverted() @ Quaternion(axis.normalized(), math.radians(deg)) @ B
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = q @ pb.rotation_quaternion

def droop_axis(pb, toward=DOWN):
    a = bone_dir(pb).cross(toward)
    if a.length < 1e-3: a = Vector((1,0,0))   # 真上を向いた葉は前に倒す
    return a.normalized()

def droop(pb, deg): rot_world(pb, droop_axis(pb), deg)

def move_world(pb, v):
    pb.location = rest_q(pb).inverted() @ Vector(v)

def scale_world_z(pb, k, others=1.0):
    """ワールドの上下方向だけ k 倍（目の開き具合、口の向き）"""
    m = pb.bone.matrix_local.to_3x3()
    idx = max(range(3), key=lambda i: abs(m.col[i].z))
    s = [others]*3; s[idx] = k
    pb.scale = s

def reset():
    for pb in P:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1,0,0,0); pb.location = (0,0,0); pb.scale = (1,1,1)
    P["mouth_frown"].scale = (0.001,)*3   # への字口はしおれのときだけ出す

def key(frame):
    for pb in P:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("scale", frame=frame)

def new_action(name):
    old = bpy.data.actions.get(name)
    if old: bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    return act

def smooth(act):
    for fc in act.fcurves:
        for k in fc.keyframe_points: k.interpolation = "BEZIER"
