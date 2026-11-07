
# サボテンの blend（cactus_build.py で作ったもの）を土台に、エバーフレッシュの見た目に置き換える。
# 頭・体・目の作りはサボテンと同じ作風なので引き継ぎ、色・葉・まぶた・枕・腕を変える。
# 骨と動きの名前はそのままなので、アプリ側は glb を差し替えるだけで動く
import bpy, bmesh, math
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

rig = bpy.data.objects["Karami"]
DOWN = Vector((0, 0, -1))
FRONT = Vector((0, -1, 0))


def srgb(hex_):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(hex_[i:i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


def material(name, hex_, rough=0.85):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = srgb(hex_)
    b.inputs["Roughness"].default_value = rough
    return m


def remove(name):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)


def new_object(name, mesh, mats):
    remove(name)
    for m in mats:
        mesh.materials.append(m)
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def parent_to_bone(obj, bone, world):
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = world


def place(name, mesh, mats, bone):
    """頂点をワールド座標で作ったメッシュを、骨に付ける"""
    parent_to_bone(new_object(name, mesh, mats), bone, Matrix.Identity(4))


def finish(bm, name, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


def ellipsoid(name, r, taper=0.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=1.0)
    for v in bm.verts:
        k = 1 - taper * v.co.z
        v.co = Vector((v.co.x * r[0] * k, v.co.y * r[1] * k, v.co.z * r[2]))
    return finish(bm, name)


def along(a, b):
    """a から b へ向かう向きを z にした、中点に置く行列"""
    d = (b - a).normalized()
    M = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    M.translation = (a + b) / 2
    return M


# 色（画像から拾った値）
SKIN = material("Skin", "67a6a3")
# 画像の葉は 7caf6c だが、アプリの背景の緑とほぼ同じで溶けるので、少し濃くする
LEAF = material("Frond", "4e9443", 0.8)
STEM = material("FrondStem", "3a7034", 0.8)
material("Boot", "22334c")
PILLOW = material("Pillow", "ece4cc", 0.9)
MOON = material("Moon", "22334c", 0.7)

for n in ["Pad_UpL", "Pad_UpR", "Pad_BackL", "Pad_BackR", "Flower", "Scarf", "ScarfTail_L",
          "ScarfTail_R", "Badge", "Belt", "Buckle", "Seam"]:
    remove(n)

rig.data.pose_position = "REST"
bpy.context.view_layer.update()

# 頭と目の位置は cactus_build.py と同じ
LIFT = 0.12
HEAD_C = Vector((0, 0, 0.53 + LIFT))
HEAD_R = Vector((0.26, 0.23, 0.24))
EYE_X, EYE_Z, EYE_RX, EYE_RZ = 0.108, 0.525 + LIFT, 0.066, 0.064


def surface(x, z, lift=0.0):
    dx, dz = x / HEAD_R.x, (z - HEAD_C.z) / HEAD_R.z
    y = -HEAD_R.y * math.sqrt(max(1e-4, 1 - dx * dx - dz * dz))
    n = Vector((x / HEAD_R.x ** 2, y / HEAD_R.y ** 2, (z - HEAD_C.z) / HEAD_R.z ** 2)).normalized()
    return Vector((x, y, z)) + n * lift


def oval_patch(name, cx, cz, rx, rz, lift, rings=8, segs=48):
    bm = bmesh.new()
    grid = {}
    for i in range(rings + 1):
        for j in range(segs):
            r = i / rings
            t = 2 * math.pi * j / segs
            grid[i, j] = bm.verts.new(surface(cx + rx * r * math.cos(t), cz + rz * r * math.sin(t), lift))
    for i in range(rings):
        for j in range(segs):
            bm.faces.new([grid[i, j], grid[i + 1, j], grid[i + 1, (j + 1) % segs], grid[i, (j + 1) % segs]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    return finish(bm, name)


def lid_mesh(name, cx, sx, bottom, lift):
    """目の上から、高さ bottom（目の半径を 1 とした値）までを覆うまぶた。
    下の縁は真ん中が少し下がり、目尻の側（sx の向き）も下がる眠たげな形"""
    bm = bmesh.new()
    rows, cols = 16, 32
    grid = []
    for i in range(rows + 1):
        v = bottom + (1.0 - bottom) * i / rows
        half = math.sqrt(max(0.0, 1 - v * v)) * 1.08
        row = []
        for j in range(cols + 1):
            u = 2 * j / cols - 1
            # 縁の形は下の行ほど強く効かせ、上の行では目の丸みに合わせる
            droop = (0.08 * (1 - u * u) + 0.1 * u * sx) * (1 - i / rows)
            row.append(bm.verts.new(surface(cx + EYE_RX * half * u, EYE_Z + EYE_RZ * 1.08 * (v - droop), lift)))
        grid.append(row)
    for r0, r1 in zip(grid, grid[1:]):
        for j in range(cols):
            bm.faces.new([r0[j], r0[j + 1], r1[j + 1], r1[j]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return finish(bm, name)


# 眠たげな目：黒目は大きく下に寄せ、いつも目の上半分をまぶたで覆う。
# まぶたの骨（lid_*）は縮めると頭の中へ沈む作りで、途中で止められないので、
# 半分のまぶたは目の骨に付ける（笑い目のときは目と一緒に隠れる）。
# しおれのときは、まぶたの骨の板が下まで覆う
BLACK = bpy.data.materials["Black"]
for side, sx in (("L", 1), ("R", -1)):
    cx = sx * EYE_X
    place("Pupil_" + side, oval_patch("Pupil", cx - sx * 0.004, EYE_Z - 0.012, 0.043, 0.041, 0.006),
          [BLACK], "eye_" + side)
    # 目は画像どおりの丸にする（サボテンの目は目頭の上が斜めに落ちる形で、ここでは怒った目に見える）
    place("EyeRim_" + side, oval_patch("EyeRim", cx, EYE_Z, EYE_RX, EYE_RZ, 0.002),
          [bpy.data.materials["EyeLine"]], "eye_" + side)
    place("EyeWhite_" + side, oval_patch("EyeWhite", cx, EYE_Z, EYE_RX * 0.88, EYE_RZ * 0.88, 0.004),
          [bpy.data.materials["EyeWhite"]], "eye_" + side)
    place("SleepyLid_" + side, lid_mesh("SleepyLid", cx, sx, 0.3, 0.007), [SKIN], "eye_" + side)
    lid = bpy.data.objects["Lid_" + side]
    old = lid.data
    lid.data = lid_mesh("Lid", cx, sx, -0.35, 0.009)
    lid.data.materials.append(SKIN)
    lid.matrix_world = Matrix.Identity(4)
    bpy.data.meshes.remove(old)


# 羽のような葉（羽状複葉）。中心の軸に沿って、小さな葉を左右に並べる。
# 経路は画像の座標（px）で決め、頭の大きさから縮尺を合わせる
PX = 0.00113
IMG_HEAD = (512, 400)


def from_image(px, py, y):
    return Vector(((px - IMG_HEAD[0]) * PX, y, HEAD_C.z + (IMG_HEAD[1] - py) * PX))


def spline(points, n):
    """点を通るなめらかな線（Catmull-Rom）を n 点で返す"""
    P = [points[0]] + points + [points[-1]]
    out = []
    for k in range(n):
        f = k / (n - 1) * (len(points) - 1)
        i = min(int(f), len(points) - 2)
        t = f - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return out


def leaflet(bm, base, direction, normal, length, width, mat):
    """小さな葉1枚。付け根 base から direction へ伸びる、平たいしずく形。
    小葉は数が多いので、厚みを付けずに1枚の面にする（glb の材質は両面を描くので裏からも見える）。
    真ん中の筋を少し手前に出して、光の当たり方で葉らしく見せる"""
    side = direction.cross(normal).normalized()
    root = bm.verts.new(base)
    tip = bm.verts.new(base + direction * length)
    rows = []
    for t in (0.25, 0.5, 0.75):
        w = width / 2 * math.sin(math.pi * t) ** 0.8
        p = base + direction * (t * length)
        rows.append((bm.verts.new(p + side * w), bm.verts.new(p - normal * 0.002), bm.verts.new(p - side * w)))
    left = [root] + [r[0] for r in rows] + [tip]
    mid = [root] + [r[1] for r in rows] + [tip]
    right = [root] + [r[2] for r in rows] + [tip]
    for edge in (left, right):
        for k in range(len(mid) - 1):
            quad = [edge[k], edge[k + 1], mid[k + 1], mid[k]]
            for f in ([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]):
                if len({id(v) for v in f}) == 3:
                    face = bm.faces.new(f)
                    face.material_index = mat
                    # 面の表を手前（normal の向き＝カメラの側）にそろえ、光の当たり方をそろえる
                    face.normal_update()
                    if face.normal.dot(normal) < 0:
                        face.normal_flip()


def frond_mesh(name, path, spacing=0.019, leaf_len=0.05, leaf_w=0.024, start=0.05, facing=lambda p: FRONT):
    """facing(p) は、軸の点 p で葉の表を向ける向き"""
    bm = bmesh.new()
    pts = spline(path, 60)
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    total = lengths[-1]
    # 軸（細い管）
    rings = []
    for k, p in enumerate(pts):
        d = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a)
        r = 0.0045 * (1 - 0.5 * lengths[k] / total)
        rings.append([bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * r)
                      for t in [2 * math.pi * s / 6 for s in range(6)]])
    for k, (r0, r1) in enumerate(zip(rings, rings[1:])):
        for s in range(6):
            f = bm.faces.new([r0[s], r1[s], r1[(s + 1) % 6], r0[(s + 1) % 6]])
            f.material_index = 1
            # 管の面は外向きにする
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - pts[k]) < 0:
                f.normal_flip()
    # 小葉。付け根の近くは頭に埋まるので start から並べ、先ほど小さくする
    s = start
    k = 0
    while s < total - 0.01:
        i = next(j for j in range(len(lengths)) if lengths[j] >= s)
        p = pts[i]
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        normal = facing(p)
        normal = (normal - d * normal.dot(d)).normalized()
        out = d.cross(normal).normalized()
        size = 0.55 + 0.45 * math.sin(math.pi * min(1.0, 0.25 + 0.75 * s / total))
        for sign in (1, -1):
            # 先のほうへ斜めに出す
            direction = (out * sign * 0.8 + d * 0.6).normalized()
            leaflet(bm, p, direction, normal, leaf_len * size, leaf_w * size, 0)
        s += spacing
        k += 1
    # 先端の1枚
    d = (pts[-1] - pts[-3]).normalized()
    normal = facing(pts[-1])
    normal = (normal - d * normal.dot(d)).normalized()
    leaflet(bm, pts[-1], d, normal, leaf_len * 0.6, leaf_w * 0.6, 0)
    # 小葉は1枚の面なので、向きを自動でそろえ直すと表裏がばらばらになる
    return finish(bm, name, recalc=False)


# 骨の名前: (画像上の経路, 奥行き（付け根, 先）)。左側で決め、右は x を反転する
FRONDS = {
    "Up": ([(475, 200), (390, 110), (280, 95), (180, 150)], (0.0, 0.03)),
    "Back": ([(445, 215), (320, 170), (190, 240), (95, 440)], (0.03, 0.09)),
    "Front": ([(415, 235), (320, 270), (250, 400), (225, 640)], (0.06, 0.12)),
}


def frond_path(points, depth, sx):
    """画像の左半分の経路を、sx の側（_L は +x）へ置く。画像の左は -x なので反転する"""
    n = len(points)
    return [from_image(IMG_HEAD[0] - sx * (px - IMG_HEAD[0]), py,
                       depth[0] + (depth[1] - depth[0]) * k / (n - 1)) for k, (px, py) in enumerate(points)]


bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
paths = {}
for key, (points, depth) in FRONDS.items():
    for side, sx in (("L", 1), ("R", -1)):
        path = frond_path(points, depth, sx)
        paths[key + side] = path
        b = eb["leaf_" + key + side]
        d = (path[1] - path[0]).normalized()
        b.head = path[0]
        b.tail = path[0] + d * 0.15
        # 局所 X をしおれる軸（横向き）にそろえる。カラ美の葉と同じ決まり
        a = d.cross(DOWN)
        if a.length < 1e-3:
            a = Vector((1, 0, 0))
        b.align_roll(a.normalized().cross(d))
bpy.ops.object.mode_set(mode="OBJECT")

for n in ["Leaf_UpL", "Leaf_UpR", "Leaf_BackL", "Leaf_BackR", "Leaf_FrontL", "Leaf_FrontR"]:
    remove(n)
for name, path in paths.items():
    place("Frond_" + name, frond_mesh("Frond_" + name, path), [LEAF, STEM], "leaf_" + name)

for n in ["Frond_ShoulderL", "Frond_ShoulderR"]:
    remove(n)


# 枕：ふくらんだ四角で、四隅が少し尖る。前に紺の三日月
PILLOW_C = Vector((0, -0.2, 0.3))
PW, PH, PT = 0.118, 0.12, 0.045


def pillow_point(u, v, front):
    f = max(0.0, (1 - abs(u) ** 4)) ** 0.5 * max(0.0, (1 - abs(v) ** 4)) ** 0.5
    ear = 1 + 0.1 * (abs(u) * abs(v)) ** 3     # 四隅を外へ
    x = u * PW * ear * (1 - 0.06 * (1 - v * v))  # 辺の中ほどを少しくびらせる
    z = v * PH * ear * (1 - 0.06 * (1 - u * u))
    return PILLOW_C + Vector((x, front * PT * f, z))


def pillow_mesh():
    bm = bmesh.new()
    N = 24
    grids = {}
    for front in (-1, 1):
        for i in range(N + 1):
            for j in range(N + 1):
                u, v = 2 * i / N - 1, 2 * j / N - 1
                edge = i in (0, N) or j in (0, N)
                key = (i, j) if edge else (i, j, front)
                if key not in grids:
                    grids[key] = bm.verts.new(pillow_point(u, v, front))
    for front in (-1, 1):
        g = lambda i, j: grids[(i, j)] if (i in (0, N) or j in (0, N)) else grids[(i, j, front)]
        for i in range(N):
            for j in range(N):
                bm.faces.new([g(i, j), g(i + 1, j), g(i + 1, j + 1), g(i, j + 1)])
    return finish(bm, "Pillow")


def moon_mesh():
    """前の面に貼る三日月。同じ大きさの円を2つ横にずらし、左の円からはみ出た側を残す。
    同じ高さの外の弧と内の弧を帯でつなぐ（1枚の多角形で塗ると、曲面の上で三角形に分け損なう）。
    開いた側は画像どおり右上に向ける"""
    bm = bmesh.new()
    R, d = 0.03, 0.018
    phi = math.acos(d / 2 / R)               # 2つの円の交点の角度
    turn = Matrix.Rotation(math.radians(35), 2)
    cu, cv = 0.0, 0.38

    def on_pillow(x, y):
        p = turn @ Vector((x, y))
        return bm.verts.new(pillow_point(cu + p.x / PW, cv + p.y / PH, -1) + Vector((0, -0.0015, 0)))

    rows = []
    n = 40
    for k in range(n + 1):
        t = phi + (2 * math.pi - 2 * phi) * k / n
        y = R * math.sin(t)
        x_in = d - math.sqrt(max(0.0, R * R - y * y))
        rows.append((on_pillow(R * math.cos(t), y), on_pillow(x_in, y)))
    for (o0, i0), (o1, i1) in zip(rows, rows[1:]):
        bm.faces.new([o0, o1, i1, i0])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    return finish(bm, "Moon")


place("Pillow", pillow_mesh(), [PILLOW], "body")
place("Moon", moon_mesh(), [MOON], "body")


# 腕は前へ回して、枕の下の角を抱える
SHOULDER = Vector((0.155, -0.02, 0.37))
HAND = Vector((0.09, -0.245, 0.26))
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
for side, sx in (("L", 1), ("R", -1)):
    arm = eb["arm_" + side]
    roll_z = arm.z_axis.copy()
    s, h = SHOULDER.copy(), HAND.copy()
    s.x *= sx
    h.x *= sx
    arm.head = s
    arm.tail = s + (h - s).normalized() * 0.12
    arm.align_roll(roll_z)
bpy.ops.object.mode_set(mode="OBJECT")
for side, sx in (("L", 1), ("R", -1)):
    s, h = SHOULDER.copy(), HAND.copy()
    s.x *= sx
    h.x *= sx
    remove("Arm_" + side)
    parent_to_bone(new_object("Arm_" + side, ellipsoid("Arm", (0.05, 0.047, (h - s).length / 2 + 0.03), taper=0.15),
                              [SKIN]), "arm_" + side, along(h, s))


# マント：首元から肩・脇・背中を包むように、羽のような葉を体に沿って垂らす（画像の肩の葉）。
# 葉の面を体の外へ向けるので、横や斜めから見てもすき間ができない。
# 正面に向けた葉を扇形に並べると、横から見て細い線になり、裾も外へ広がってしまう
def body_surface(names):
    verts, polys = [], []
    for n in names:
        o = bpy.data.objects[n]
        offset = len(verts)
        verts += [o.matrix_world @ v.co for v in o.data.vertices]
        polys += [[offset + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys)


BODY = body_surface(["Torso", "Arm_L", "Arm_R"])
CAPE_TOP, CAPE_WAIST = 0.44, 0.3          # 首元と、胴のいちばん太い高さ
CAPE_LEAF = {"spacing": 0.016, "leaf_len": 0.05, "leaf_w": 0.026, "start": 0.01}


def on_body(phi, z):
    """後ろ（+y）から phi だけ回った向きで、高さ z の体の表面と外向きの向き"""
    out = Vector((math.sin(phi), math.cos(phi), 0))
    hit, normal, _, _ = BODY.ray_cast(Vector((0, 0, z)) + out * 0.6, -out)
    if normal.dot(out) < 0:
        normal = -normal
    return hit, normal


def cape_path(phi, bottom, lift):
    """首元から胴のいちばん太いところまでは体に沿わせ、その下はまっすぐ垂らす（裾をすぼめない）"""
    path = []
    # 肩では腕の付け根の上を通るので、細かく測って腕に沿わせる
    for z in (CAPE_TOP, 0.425, 0.41, 0.39, 0.37, 0.35, 0.33, CAPE_WAIST):
        hit, normal = on_body(phi, z)
        path.append(hit + normal * lift)
    waist = path[-1]
    for z in (0.25, bottom):
        path.append(Vector((waist.x, waist.y, z)) + Vector((waist.x, waist.y, 0)).normalized() * 0.004)
    return path


def cape_facing(p):
    return Vector((p.x, p.y, 0)).normalized()


# 体の後ろ半分と脇（真後ろから左右 112 度まで。正面から見て腕の外に葉がのぞく）を、
# すき間なく重なる間隔で覆う。胴の骨と一緒に動けばよいので、すべて cape_Back に付ける
CAPE_SPREAD, CAPE_COUNT = 112, 17
for k in range(CAPE_COUNT):
    phi = math.radians(CAPE_SPREAD * (2 * k / (CAPE_COUNT - 1) - 1))
    # 脇の葉は、腕の付け根の丸みに小葉が刺さらないよう少し浮かせる
    lift = 0.014 + 0.006 * (k % 2) + 0.03 * max(0.0, abs(math.sin(phi)) - 0.6)
    path = cape_path(phi, 0.2 + 0.015 * (k % 2), lift)
    place(f"Cape_{k}", frond_mesh("CapeFrond", path, facing=cape_facing, **CAPE_LEAF), [LEAF, STEM], "cape_Back")

# 腕の付け根の上は体より太く、葉の間が開いて腕がのぞくので、短い葉を重ねてふさぐ（画像の肩の葉）
for k, deg in enumerate((70, 84, 98, 112, -70, -84, -98, -112)):
    path = cape_path(math.radians(deg), 0.2, 0.03)[:-2]     # 胴のいちばん太いところまで
    place(f"CapeShoulder_{k}", frond_mesh("CapeFrond", path, facing=cape_facing, **CAPE_LEAF),
          [LEAF, STEM], "cape_Back")

rig.data.pose_position = "POSE"


# しおれ（Wilt）で葉を回す角度を小さくする。エバーフレッシュの葉はもとから弧を描いて垂れていて、
# カラ美と同じだけ付け根から回すと、葉の先が頭の中や後ろにめり込む
WILT_SCALE = {"Up": 0.4, "Back": 0.3, "Front": 0.2}
Q = chr(34)
for fc in bpy.data.actions["Wilt"].fcurves:
    for key, scale in WILT_SCALE.items():
        if not any(fc.data_path == f"pose.bones[{Q}leaf_{key}{side}{Q}].rotation_quaternion" for side in "LR"):
            continue
        for k in fc.keyframe_points:
            # 回転は局所 X だけ（w と x のキー）。角度を縮めて、w と x を作り直す
            if fc.array_index == 0:
                angle = 2 * math.acos(max(-1.0, min(1.0, k.co[1])))
                value = math.cos(angle * scale / 2)
            elif fc.array_index == 1:
                angle = 2 * math.asin(max(-1.0, min(1.0, k.co[1])))
                value = math.sin(angle * scale / 2)
            else:
                continue
            k.co[1] = value
            k.handle_left[1] = k.handle_right[1] = value

# マントは体に沿わせているので、しおれでも回さない（回すと背中から浮くか、体にめり込む）
for fc in bpy.data.actions["Wilt"].fcurves:
    if fc.data_path == f"pose.bones[{Q}cape_Back{Q}].rotation_quaternion":
        for k in fc.keyframe_points:
            value = 1.0 if fc.array_index == 0 else 0.0
            k.co[1] = value
            k.handle_left[1] = k.handle_right[1] = value


# 腕の振りを小さくして、どの動きでも枕を抱えたままにする。
# カラ美の腕は喜ぶ・驚く・ジタバタで大きく回り、エバーフレッシュでは枕が胸の前に浮いて見えた
ARM_SCALE = 0.15
for action in bpy.data.actions:
    for side in "LR":
        path = f"pose.bones[{Q}arm_{side}{Q}].rotation_quaternion"
        fcs = sorted((fc for fc in action.fcurves if fc.data_path == path), key=lambda fc: fc.array_index)
        if len(fcs) != 4:
            continue
        for keys in zip(*(fc.keyframe_points for fc in fcs)):
            q = Quaternion([k.co[1] for k in keys])
            small = Quaternion().slerp(q, ARM_SCALE)
            for k, value in zip(keys, small):
                k.co[1] = value
                k.handle_left[1] = k.handle_right[1] = value
