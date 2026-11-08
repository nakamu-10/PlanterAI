import bpy, math
from mathutils import Matrix
exec(bpy.data.texts["karami_expr"].as_string())
# 黒目の光（ハイライト）。両目とも黒目の右上（見る側から）に1つ入れ、光が片側から当たって見えるようにする。
# 目の骨 eye_* に付けるので、笑い目のときは目と一緒に隠れる。
# 泣くときの光（Shine_*・Shine2_*、骨 cry_*）も同じ向きにそろえる。左右対称のままだと、
# 泣いたときに片目だけ大きな光が2つ横に並ぶ
PUPIL = (0.090, 0.4655)
R = 0.012


def circle(cx, cz, r, n=32):
    return [(cx + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def build_highlight():
    rig = bpy.data.objects["Karami"]
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    for side, sx in (("L", 1), ("R", -1)):
        name = "Highlight_" + side
        o = bpy.data.objects.get(name)
        if o is None:
            o = bpy.data.objects.new(name, bpy.data.meshes.new(name))
            bpy.data.objects["Pupil_" + side].users_collection[0].objects.link(o)
            o.data.materials.append(bpy.data.materials["EyeWhite"])
        o.parent = rig
        o.parent_type = 'BONE'
        o.parent_bone = "eye_" + side
        o.matrix_world = Matrix.Identity(4)
        center = (sx * PUPIL[0] + 0.016, PUPIL[1] + 0.016)
        fill(o, circle(center[0], center[1], R), center, 1.018, rings=3)
        # 泣くときの大きな光はハイライトに重ね、小さな光は黒目の左下に置く
        fill(bpy.data.objects["Shine_" + side], circle(center[0], center[1], R), center, 1.018, rings=3)
        small = (sx * PUPIL[0] - 0.018, PUPIL[1] - 0.012)
        fill(bpy.data.objects["Shine2_" + side], circle(small[0], small[1], 0.006), small, 1.018, rings=2)
    rig.data.pose_position = 'POSE'


build_highlight()
