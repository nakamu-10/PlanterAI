exec(bpy.data.texts["karami_struggle"].as_string())
import math
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# ベッドで横向きに寝て、布団をかぶる（くり返し）。部屋のベッドの立ち位置（spot_bed）に合わせ、
# 頭を枕のある後ろ（+Y）へ、顔を部屋の内側（+X）へ向けて、左わきを下にする。
# カメラは足元の斜め前から見るので、体を出したままだと足の裏ばかりが見える。布団で胴から下を隠す。
# 72フレーム（3秒）で1回息をする
SLEEP_LEN = 72
X = Vector((1,0,0)); Y = Vector((0,1,0)); Z = Vector((0,0,1))
# 部屋の寸法（build_room.py のベッド）を、立ち位置から見た値にしてキャラの大きさ（1.35倍）で割ったもの。
# 足先をマットレスの足元に収め、布団はマットレスの横から少しはみ出して垂らす
FEET_Y = -0.44
MATTRESS_HALF_W = 0.267
QUILT_HALF_W = 0.3
QUILT_FOOT_Y = -0.47
QUILT_COLOR = (0.3, 0.55, 0.8, 1)   # 部屋の掛け布団と同じ色
# 布団の中は見えないので、手足とマントは隠す。横に寝ると肩のマントの幅がそのまま高さになり、
# 布団が盛り上がりすぎる。胴もマットレスの方へ沈め、頭だけを枕の上に残す
HIDDEN_UNDER_FUTON = ("arm_", "leg_", "cape_")
SINK = 0.1
# 下になった葉を、頭のてっぺん側へ寝かせる角度。マットレスを突き抜けないようにする
FOLD = 55
FOLDED = []
BODY_BONES = ("body", "root")

def lie_down():
    pose_from("Idle", 0)
    for pb in P:
        if pb.name.startswith(("arm_","leg_","body","root","head")):
            pb.rotation_quaternion = (1,0,0,0); pb.location = (0,0,0)
    root = P["root"]
    rot_world(root, X, -90)   # 仰向け（頭が +Y、顔が上）
    rot_world(root, Y, 90)    # 顔を +X へ（左わきが下）
    P["futon"].scale = (1,1,1)
    # 目を閉じる：黒目を隠し、笑い目（∩）を逆さにして ∪ にする
    for side in "LR":
        P["eye_" + side].scale = (0.001,)*3
        P["lid_" + side].scale = (1, 1, 0.001)
        happy = P["eye_happy_" + side]
        happy.scale = (1,1,1)
        # Idle は笑い目の回転をキーにしていないので、戻さないと呼ぶたびに 180° ずつ重なって目が回る
        happy.rotation_quaternion = (1,0,0,0)
        rot_world(happy, Y, 180)
    for pb in P:
        if pb.name.startswith(HIDDEN_UNDER_FUTON):
            pb.scale = (0.001,)*3
    turned = rest_q(root) @ root.rotation_quaternion @ rest_q(root).inverted()
    down = turned.inverted() @ Vector((0, 0, -SINK))
    move_world(P["body"], down)
    move_world(P["head"], -down)
    for n in FOLDED:
        pb = P["leaf_" + n]
        rot_world(pb, droop_axis(pb, Vector((0, 0.3, 1)).normalized()), FOLD)

def find_lower_leaves():
    FOLDED.clear()
    lie_down()
    body_lo, _ = rig_box({"HeadMesh", "Torso"})
    FOLDED.extend(n for n in LEAVES if P["leaf_" + n].tail.z < body_lo.z + 0.1)

def rig_box(only=None):
    """見えているメッシュを囲む箱（骨組みの座標）"""
    bpy.context.view_layer.update()
    lo = Vector((9,9,9)); hi = Vector((-9,-9,-9))
    to_rig = rig.matrix_world.inverted()
    for o in bpy.data.objects:
        if o.type != "MESH" or o.parent is not rig: continue
        if only and o.name not in only: continue
        if any(s < 0.01 for s in o.matrix_world.to_scale()): continue
        for c in o.bound_box:
            w = to_rig @ o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

def add_futon_bone():
    """掛け布団の骨。どの骨にも付けず、Sleep 以外の動きでは大きさ 0.001 で隠す"""
    global P
    if "futon" not in rig.data.bones:
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        b = rig.data.edit_bones.new("futon")
        b.head = (0, 0, 0); b.tail = (0, 0, 0.05)
        bpy.ops.object.mode_set(mode="OBJECT")
    # 編集モードを出ると骨の参照が作り直されるので、取り直す
    P = rig.pose.bones
    path = 'pose.bones["futon"].scale'
    for act in bpy.data.actions:
        if act.name == "Sleep": continue
        for i in range(3):
            fc = act.fcurves.find(path, index=i) or act.fcurves.new(path, index=i, action_group="futon")
            fc.keyframe_points.insert(0, 0.001)

def build_sleep():
    add_futon_bone()
    # 骨を足すと、付いている動きで姿勢が上書きされるので、測る間は外す
    rig.animation_data.action = None
    find_lower_leaves()
    lie_down()
    lo, _ = rig_box()
    # 高さは頭と胴で合わせる（葉は枕やマットレスに少しめり込んでよい）
    body_lo, _ = rig_box({"HeadMesh", "Torso"})
    shift = Vector((0, FEET_Y - lo.y, -body_lo.z))
    build_futon(shift)
    act = new_action("Sleep")
    for f in range(0, SLEEP_LEN + 1, 6):
        t = f / SLEEP_LEN * 2 * math.pi
        breath = 0.5 - 0.5 * math.cos(t)
        lie_down()
        move_world(P["root"], shift)
        # 息を吸うと布団がふくらみ、頭が少し上を向く
        P["futon"].scale = (1, 1 + 0.05 * breath, 1)
        rot_world(P["head"], X, -2 * breath)
        for i, n in enumerate(LEAVES):
            droop(P["leaf_" + n], 3 * math.sin(t + i * 0.7))
        key(f)
    smooth(act)
    act.id_root = "OBJECT"
    return act

def body_bvh():
    """胴（布団の中に残る部分）の形を、上から光線を当てて測れるようにする"""
    dg = bpy.context.evaluated_depsgraph_get()
    to_rig = rig.matrix_world.inverted()
    verts, polys = [], []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.parent is not rig or not o.parent_bone.startswith(BODY_BONES): continue
        if any(s < 0.01 for s in o.matrix_world.to_scale()): continue
        m = o.evaluated_get(dg).to_mesh()
        base = len(verts)
        verts += [to_rig @ o.matrix_world @ v.co for v in m.vertices]
        polys += [[base + i for i in p.vertices] for p in m.polygons]
        o.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)

def blur(h):
    nx, ny = len(h), len(h[0])
    def mean(i, j):
        near = [h[a][b] for a, b in ((i, j), (i-1, j), (i+1, j), (i, j-1), (i, j+1))
                if 0 <= a < nx and 0 <= b < ny]
        return sum(near) / len(near)
    return [[mean(i, j) for j in range(ny)] for i in range(nx)]

def spread(h, step, reach=4, slope=0.8):
    nx, ny = len(h), len(h[0])
    def peak(i, j):
        return max(h[a][b] - slope * step * math.hypot(a - i, b - j)
                   for a in range(max(i - reach, 0), min(i + reach + 1, nx))
                   for b in range(max(j - reach, 0), min(j + reach + 1, ny)))
    return [[peak(i, j) for j in range(ny)] for i in range(nx)]

def build_futon(shift):
    """寝た体に、上から布をかぶせた形の布団を作る（胴の高さを測って、布のようにならす）"""
    lie_down()
    move_world(P["root"], shift)
    head_lo, _ = rig_box({"HeadMesh"})
    neck_y = head_lo.y + 0.05
    bvh = body_bvh()
    nx, ny = 26, 20
    xs = [-QUILT_HALF_W + 2 * QUILT_HALF_W * i / (nx - 1) for i in range(nx)]
    ys = [QUILT_FOOT_Y + (neck_y - QUILT_FOOT_Y) * j / (ny - 1) for j in range(ny)]
    h = [[0.03] * ny for _ in range(nx)]
    for i, x in enumerate(xs):
        for j, y in enumerate(ys):
            hit = bvh.ray_cast(Vector((x, y, 2)), Vector((0, 0, -1)))[0]
            if hit: h[i][j] = max(hit.z + 0.03, 0.03)
    # 真上から測った高さだけだと、体の横のふくらみが布団から出る。まわりへ斜めに広げてからならす
    cover = spread(h, xs[1] - xs[0])
    h = [[z + 0.03 for z in row] for row in cover]
    for _ in range(6):
        h = blur(h)
    h = [[max(a, b) for a, b in zip(row, low)] for row, low in zip(h, cover)]
    for i, x in enumerate(xs):   # マットレスの外は下へ垂らす
        over = abs(x) - MATTRESS_HALF_W
        if over > 0:
            h[i] = [min(z, 0.03) - over * 3 for z in h[i]]
    # 面はどれも外（上・足元・首元）を向くように、頂点を回る向きをそろえて張る
    bm = bmesh.new()
    grid = [[bm.verts.new((x, y, h[i][j])) for j, y in enumerate(ys)] for i, x in enumerate(xs)]
    foot = [bm.verts.new((x, QUILT_FOOT_Y - 0.01, -0.06)) for x in xs]
    neck = [bm.verts.new((x, neck_y + 0.01, 0.0)) for x in xs]
    for i in range(nx - 1):
        for j in range(ny - 1):
            bm.faces.new((grid[i][j], grid[i+1][j], grid[i+1][j+1], grid[i][j+1]))
        bm.faces.new((foot[i], foot[i+1], grid[i+1][0], grid[i][0]))
        bm.faces.new((grid[i][-1], grid[i+1][-1], neck[i+1], neck[i]))
    mesh = bpy.data.meshes.get("Futon") or bpy.data.meshes.new("Futon")
    bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = True
    mat = bpy.data.materials.get("Futon") or bpy.data.materials.new("Futon")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = QUILT_COLOR
    bsdf.inputs["Roughness"].default_value = 0.9
    mesh.materials.clear(); mesh.materials.append(mat)
    old = bpy.data.objects.get("Futon")
    if old: bpy.data.objects.remove(old, do_unlink=True)
    o = bpy.data.objects.new("Futon", mesh)
    bpy.context.scene.collection.objects.link(o)
    o.parent = rig; o.parent_type = "BONE"; o.parent_bone = "futon"
    # 骨に付けると骨の先が原点になるので、親の位置が決まってから置き直す
    bpy.context.view_layer.update()
    o.matrix_world = rig.matrix_world
    return o
