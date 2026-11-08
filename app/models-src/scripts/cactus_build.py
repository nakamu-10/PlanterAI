
# カラ美の blend を土台に、サボテンの見た目に置き換える。
# 骨と動きはそのまま使うので、アプリ側は glb を差し替えるだけで動く
import bpy, bmesh, math, random
from mathutils import Vector, Matrix

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
    nt = m.node_tree
    for n in [n for n in nt.nodes if n.type == "TEX_IMAGE"]:
        nt.nodes.remove(n)
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = srgb(hex_)
    b.inputs["Roughness"].default_value = rough
    return m


def remove(name):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)


def parent_to_bone(obj, bone, world):
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = world


def new_object(name, mesh, mats):
    remove(name)
    for m in mats:
        mesh.materials.append(m)
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def smooth(mesh):
    for p in mesh.polygons:
        p.use_smooth = True


# 色（画像から拾った値）
SKIN = material("Skin", "8db38b")
PAD = material("Pad", "93b88f")
AREOLE = material("Areole", "efe6c8", 0.6)
FLOWER = material("Flower", "e98aa6", 0.7)
FLOWER_CORE = material("FlowerCore", "d9607f", 0.7)
SCARF = material("Scarf", "c97a5a")
BADGE = material("Badge", "efe2c4", 0.7)
BADGE_DISC = material("BadgeDisc", "b35d3c")
BOOT = material("Boot", "c0704f")
BELT = material("Belt", "efe7d0")
SEAM = material("Seam", "6f946d")

for n in ["Cape_L", "Cape_R", "Drop", "Leaf_FrontL", "Leaf_FrontR", "Leaf_Top",
          "Stem_Top", "Stem_UpL", "Stem_UpR", "Stem_FrontL", "Stem_FrontR",
          "Stem_BackL", "Stem_BackR"]:
    remove(n)

material("EyeLine", "6e2323", 0.5)

rig.data.pose_position = "REST"
bpy.context.view_layer.update()


def ellipsoid(name, r, taper=0.0, flat_bottom=False, boxy=2.0):
    """半径 r の楕円体（z が縦）。taper > 0 で下ほど太くする。flat_bottom で底を平らにする。
    boxy を大きくすると、横はまっすぐで端だけ丸い円柱に近づく（2 で楕円体）"""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=24, radius=1.0)
    for v in bm.verts:
        side = math.sqrt(max(0.0, 1 - v.co.z ** 2))
        if side > 1e-6:
            want = (1 - abs(v.co.z) ** boxy) ** (1 / boxy)
            v.co.x *= want / side
            v.co.y *= want / side
        k = 1 - taper * v.co.z
        z = max(v.co.z, -0.6) if flat_bottom else v.co.z
        v.co = Vector((v.co.x * r[0] * k, v.co.y * r[1] * k, z * r[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


def along(a, b):
    """a から b へ向かう向きを z にした、中点に置く行列"""
    d = (b - a).normalized()
    M = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    M.translation = (a + b) / 2
    return M


# 体は画像に合わせて作り直す。画像は頭に対して体が大きく（足元から首まで、頭の幅の 0.8 倍ほど）、
# 胴は下ぶくれ、腕は長く体の横に下がる。頭から上は、その分だけ持ち上げる
LIFT = 0.12
SHOULDER = Vector((0.155, -0.01, 0.375))
HAND = Vector((0.2, -0.03, 0.215))
FOOT_X = 0.075
for n in ["Torso", "Belt", "Buckle", "Arm_L", "Arm_R", "Leg_L", "Leg_R",
          "Boot_L", "Boot_R", "BootTop_L", "BootTop_R"]:
    remove(n)

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
eb["head"].use_connect = False
for b in [eb["head"]] + list(eb["head"].children_recursive):
    b.translate(Vector((0, 0, LIFT)))
for side, sx in (("L", 1), ("R", -1)):
    arm = eb["arm_" + side]
    roll_z = arm.z_axis.copy()
    s, h = SHOULDER * 1, HAND * 1
    s.x *= sx
    h.x *= sx
    arm.head = s
    arm.tail = s + (h - s).normalized() * 0.12
    arm.align_roll(roll_z)
    leg = eb["leg_" + side]
    leg.head = Vector((sx * FOOT_X, 0, 0.19))
    leg.tail = Vector((sx * FOOT_X, 0, 0.02))
bpy.ops.object.mode_set(mode="OBJECT")



def place_body(name, mesh, mats, bone, world):
    parent_to_bone(new_object(name, mesh, mats), bone, world)


# 胴の下端は画像どおり地面から 0.15 ほどにし、ブーツとの間に足が見えるようにする
place_body("Torso", ellipsoid("Torso", (0.17, 0.15, 0.15), taper=0.15), [SKIN], "body",
           Matrix.Translation((0, 0, 0.3)))
# ベルトは縦の幅がある帯にする（楕円体だと、真ん中の線しか胴の外に出ない）
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=1.0, radius2=1.0, depth=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.18, v.co.y * 0.16, v.co.z * 0.032))
belt_me = bpy.data.meshes.new("Belt")
bm.to_mesh(belt_me)
bm.free()
place_body("Belt", belt_me, [BELT], "body", Matrix.Translation((0, 0, 0.25)))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.019, radius2=0.019, depth=0.01)
inner = bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.008, radius2=0.008, depth=0.012)
for f in {f for v in inner["verts"] for f in v.link_faces}:
    f.material_index = 1
buckle_me = bpy.data.meshes.new("Buckle")
bm.to_mesh(buckle_me)
bm.free()
place_body("Buckle", buckle_me, [SCARF, BELT], "body",
           Matrix.Translation((0, -0.163, 0.25)) @ Matrix.Rotation(math.radians(90), 4, "X"))
for side, sx in (("L", 1), ("R", -1)):
    s, h = SHOULDER * 1, HAND * 1
    s.x *= sx
    h.x *= sx
    length = (h - s).length
    # 腕は手の先ほど少し太い（ミトンのような手）
    place_body("Arm_" + side, ellipsoid("Arm", (0.056, 0.052, length / 2 + 0.035), taper=0.15),
               [SKIN], "arm_" + side, along(h, s))
    place_body("Leg_" + side, ellipsoid("Leg", (0.052, 0.05, 0.065), boxy=5), [SKIN], "leg_" + side,
               Matrix.Translation((sx * FOOT_X, 0, 0.14)))
    place_body("Boot_" + side, ellipsoid("Boot", (0.06, 0.066, 0.065), flat_bottom=True, boxy=4), [BOOT],
               "leg_" + side, Matrix.Translation((sx * FOOT_X, -0.006, 0.039)))
    place_body("BootTop_" + side, ellipsoid("BootTop", (0.064, 0.066, 0.016), boxy=3), [BOOT], "leg_" + side,
               Matrix.Translation((sx * FOOT_X, -0.004, 0.092)))


# 頭と目は作り直す。カラ美と見分けがつくよう、頭は画像どおりのほぼまん丸（カラ美は横に平たい）、
# 目は画像をなぞった形にする。
# 頭を式で決めておき、目・まぶた・ほっぺは頭の表面から少しずつ浮かせて重ねる（めり込まない）
HEAD_C = Vector((0, 0, 0.53 + LIFT))
HEAD_R = Vector((0.26, 0.23, 0.24))


def surface(x, z, lift=0.0):
    """頭の前面で (x, z) にある点を、法線の向きに lift だけ浮かせて返す"""
    dx, dz = x / HEAD_R.x, (z - HEAD_C.z) / HEAD_R.z
    y = -HEAD_R.y * math.sqrt(max(1e-4, 1 - dx * dx - dz * dz))
    n = Vector((x / HEAD_R.x ** 2, y / HEAD_R.y ** 2, (z - HEAD_C.z) / HEAD_R.z ** 2)).normalized()
    return Vector((x, y, z)) + n * lift


def circle(t):
    return math.cos(t), math.sin(t)


# 画像の目のふち（赤茶色の画素）から、左右の平均を取って測った輪郭（u は外側が +、v は上が +）。
# 外側は丸く、内側は下の角が張り、上の角が斜めに落ちる
EYE_TRACE = [(-0.93, -0.01), (-1.0, -0.28), (-0.98, -0.59), (-0.8, -0.83), (-0.54, -0.95), (-0.27, -1.0),
             (-0.02, -0.99), (0.23, -0.98), (0.48, -0.91), (0.7, -0.76), (0.88, -0.55), (0.98, -0.29),
             (1.0, -0.01), (0.98, 0.27), (0.88, 0.53), (0.71, 0.75), (0.49, 0.91), (0.24, 1.0),
             (-0.02, 0.99), (-0.26, 0.92), (-0.46, 0.79), (-0.62, 0.62), (-0.75, 0.43), (-0.85, 0.22)]


def eye_outline(sx):
    """EYE_TRACE をなめらかにつないだ輪郭。sx は左右の向き（外側が +x なら 1）"""
    n = len(EYE_TRACE)

    def outline(t):
        f = (t / (2 * math.pi)) % 1.0 * n
        i = int(f)
        k = f - i
        p0, p1, p2, p3 = (Vector(EYE_TRACE[(i + d) % n]) for d in (-1, 0, 1, 2))
        q = 0.5 * ((2 * p1) + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k * k
                   + (-p0 + 3 * p1 - 3 * p2 + p3) * k * k * k)
        return sx * q.x, q.y
    return outline


def oval_patch(name, cx, cz, rx, rz, lift, outline=circle, rings=8, segs=48):
    """頭の表面に沿った板。形は outline（角度 → 縁の点。中心から放射状に縮めて埋める）"""
    bm = bmesh.new()
    grid = {}
    for i in range(rings + 1):
        for j in range(segs):
            r = i / rings
            u, v = outline(2 * math.pi * j / segs)
            grid[i, j] = bm.verts.new(surface(cx + rx * r * u, cz + rz * r * v, lift))
    for i in range(rings):
        for j in range(segs):
            bm.faces.new([grid[i, j], grid[i + 1, j], grid[i + 1, (j + 1) % segs], grid[i, (j + 1) % segs]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


def span_at(outline, v):
    """outline の形を高さ v で横に切ったときの左右の端"""
    pts = [outline(2 * math.pi * k / 360) for k in range(360)]
    us = []
    for (u0, v0), (u1, v1) in zip(pts, pts[1:] + pts[:1]):
        if (v0 - v) * (v1 - v) <= 0 and v0 != v1:
            us.append(u0 + (u1 - u0) * (v - v0) / (v1 - v0))
    return (min(us), max(us)) if us else (0.0, 0.0)


def band_patch(name, cx, cz, rx, rz, lift, bottom, flip=1, outline=circle, rows=14, cols=32):
    """形のうち flip * v >= bottom の部分（flip=-1 で下側）。縁がぎざぎざにならないよう、横一列ずつ並べる"""
    edge = max(flip * outline(2 * math.pi * k / 360)[1] for k in range(360))
    bm = bmesh.new()
    grid = []
    for i in range(rows + 1):
        v = flip * (bottom + (edge * 0.999 - bottom) * i / rows)
        lo, hi = span_at(outline, v)
        grid.append([bm.verts.new(surface(cx + rx * (lo + (hi - lo) * j / cols), cz + rz * v, lift))
                     for j in range(cols + 1)])
    for r0, r1 in zip(grid, grid[1:]):
        for j in range(cols):
            bm.faces.new([r0[j], r0[j + 1], r1[j + 1], r1[j]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


def tube_on_surface(name, pts, radius):
    """頭の表面に沿った線（まぶたのふちや、笑った目の「へ」の字）"""
    bm = bmesh.new()
    rings = []
    for k, p in enumerate(pts):
        d = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a)
        rings.append([bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * radius)
                      for t in [2 * math.pi * s / 8 for s in range(8)]])
    for r0, r1 in zip(rings, rings[1:]):
        for s in range(8):
            bm.faces.new([r0[s], r1[s], r1[(s + 1) % 8], r0[(s + 1) % 8]])
    for r in (rings[0], rings[-1]):
        bm.faces.new(r)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


def place(name, mesh, mats, bone):
    o = new_object(name, mesh, mats)
    parent_to_bone(o, bone, Matrix.Identity(4))
    return o


# 頭
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * HEAD_R.x, v.co.y * HEAD_R.y, v.co.z * HEAD_R.z))
head_me = bpy.data.meshes.new("HeadMesh")
bm.to_mesh(head_me)
bm.free()
smooth(head_me)
head_me.materials.append(SKIN)
head = bpy.data.objects["HeadMesh"]
old = head.data
head.data = head_me
bpy.data.meshes.remove(old)
head.matrix_world = Matrix.Translation(HEAD_C)

# 画像から測った目の大きさと位置
EYE_X, EYE_Z, EYE_RX, EYE_RZ = 0.108, 0.525 + LIFT, 0.066, 0.064
LID_TOP = EYE_Z + EYE_RZ
for n in ("EyeWhite", "EyeRim", "Pupil", "Lid", "LidLine", "HappyEye", "Cheek",
          "Shine", "Shine2", "TearPool", "Highlight"):
    for side in ("L", "R"):
        remove(f"{n}_{side}")

# 目の骨を新しい目の位置へ。涙の部品（cry・tear の骨に付いている）も一緒に動く
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
for side, sx in (("L", 1), ("R", -1)):
    eye = surface(sx * EYE_X, EYE_Z)
    delta = eye - eb["eye_" + side].head
    for n in ("eye_", "eye_happy_", "cry_", "tear_"):
        eb[n + side].translate(delta)
    # まぶたは骨の Z の向きに縮んで消える。縮む中心を頭の奥（目の上端の高さ）に置き、
    # Z をそこから目の中心へ向けると、縮んだまぶたは頭の中に入って見えなくなる
    lid = eb["lid_" + side]
    pivot = Vector((sx * EYE_X, HEAD_C.y, LID_TOP))
    toward_eye = (eye - pivot).normalized()
    up = Vector((0, 0, 1))
    lid.head = pivot
    lid.tail = pivot + (up - toward_eye * up.dot(toward_eye)).normalized() * 0.04
    lid.align_roll(toward_eye)
# 口は画像に合わせて、ほっぺとほぼ同じ高さに置く
mouth_move = surface(0, 0.45 + LIFT) - eb["mouth"].head
for n in ("mouth", "mouth_open", "mouth_frown"):
    eb[n].translate(mouth_move)
bpy.ops.object.mode_set(mode="OBJECT")

EYE_LINE = bpy.data.materials["EyeLine"]
EYE_WHITE = bpy.data.materials["EyeWhite"]
BLACK = bpy.data.materials["Black"]
CHEEK = bpy.data.materials["Cheek"]
TEAR = bpy.data.materials["Tear"]
# 口は画像どおり、目のふちと同じ赤茶色にする（カラ美は黒）
for n in ("Mouth", "MouthFrown"):
    bpy.data.objects[n].data = bpy.data.objects[n].data.copy()
    bpy.data.objects[n].data.materials[0] = EYE_LINE
for side, sx in (("L", 1), ("R", -1)):
    cx = sx * EYE_X
    shape = eye_outline(sx)
    place("EyeRim_" + side, oval_patch("EyeRim", cx, EYE_Z, EYE_RX, EYE_RZ, 0.002, shape), [EYE_LINE], "eye_" + side)
    place("EyeWhite_" + side, oval_patch("EyeWhite", cx, EYE_Z, EYE_RX * 0.9, EYE_RZ * 0.89, 0.004, shape), [EYE_WHITE], "eye_" + side)
    # 黒目は大きな丸で、少し内側・下に寄せる
    place("Pupil_" + side, oval_patch("Pupil", cx - sx * 0.008, EYE_Z - 0.006, 0.034, 0.034, 0.006), [BLACK], "eye_" + side)
    # まぶた：上半分を覆う肌色の板。骨を縮めると目のふちの上端に畳まれる。
    # ふちの線は付けない（畳んだときに、目より幅の広い線として見えてしまう）
    place("Lid_" + side, band_patch("Lid", cx, EYE_Z, EYE_RX * 1.08, EYE_RZ * 1.08, 0.012, 0.02, outline=shape), [SKIN], "lid_" + side)
    arch = [surface(cx + EYE_RX * 0.8 * math.cos(t), EYE_Z - 0.01 + EYE_RZ * 0.45 * math.sin(t), 0.006)
            for t in [math.pi * (0.1 + 0.8 * k / 24) for k in range(25)]]
    place("HappyEye_" + side, tube_on_surface("HappyEye", arch, 0.006), [EYE_LINE], "eye_happy_" + side)
    # 泣くときのうるみ（骨 cry_* の大きさで出し入れする）。白目の下にたまる涙と、黒目の光
    place("TearPool_" + side, band_patch("TearPool", cx, EYE_Z, EYE_RX * 0.9, EYE_RZ * 0.89, 0.005, 0.3, flip=-1, outline=shape), [TEAR], "cry_" + side)
    place("Shine_" + side, oval_patch("Shine", cx - sx * 0.024, EYE_Z + 0.006, 0.009, 0.011, 0.008), [EYE_WHITE], "cry_" + side)
    place("Shine2_" + side, oval_patch("Shine2", cx - sx * 0.002, EYE_Z - 0.02, 0.005, 0.005, 0.008), [EYE_WHITE], "cry_" + side)
    place("Cheek_" + side, oval_patch("Cheek", sx * 0.152, 0.435 + LIFT, 0.037, 0.022, 0.003), [CHEEK], "head")

# 頭のてっぺんから額へ下りる縫い目（画像のぬいぐるみの縫い目）。細い線を頭の表面に沿わせる
top = HEAD_C.z + HEAD_R.z
seam = [surface(0, top - 0.012 - 0.07 * k / 20, 0.0012) for k in range(21)]
place("Seam", tube_on_surface("Seam", seam, 0.0028), [SEAM], "head")


# ウチワ（平たい卵形）。z が骨の向き、y が厚み。表と裏にトゲの座（白い点）を並べる
def pad_mesh(name, L, W, T, dots):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        k = 1.0 + 0.18 * z          # 先のほうを少し広く
        v.co = Vector((x * W / 2 * k, y * T / 2, (z + 1) * L / 2))
    rnd = random.Random(len(name))
    placed = []
    for _ in range(5000):   # 詰まって置けなくなっても止まるように回数で切る
        if len(placed) == dots:
            break
        u, h = rnd.uniform(-0.8, 0.8), rnd.uniform(-0.75, 0.8)
        if u * u + h * h > 0.8 or any((u - a) ** 2 + (h - b) ** 2 < 0.03 for a, b in placed):
            continue
        placed.append((u, h))
    for side in (-1, 1):
        for u, h in placed:
            k = 1.0 + 0.18 * h
            r = math.sqrt(max(0.0, 1 - u * u - h * h))
            p = Vector((u * W / 2 * k, side * r * T / 2, (h + 1) * L / 2))
            ret = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
            for v in ret["verts"]:
                v.co = Vector((v.co.x * 0.005, v.co.y * 0.004, v.co.z * 0.008)) + p
            for f in {f for v in ret["verts"] for f in v.link_faces}:
                f.material_index = 1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


# 骨を置き直す。局所 X をしおれる軸にそろえる（カラ美の葉と同じ決まり）
PADS = {
    # 骨の名前: (付け根, 向き, 長さ, 幅, 厚み, 点の数, 付け根の埋まり)
    "UpL": ((0.12, 0.0, 0.72 + LIFT), (0.42, 0.0, 1.0), 0.30, 0.21, 0.055, 22, 0.03),
    "UpR": ((-0.12, 0.0, 0.72 + LIFT), (-0.42, 0.0, 1.0), 0.30, 0.21, 0.055, 22, 0.03),
    "BackL": ((0.23, 0.0, 0.60 + LIFT), (1.0, 0.0, 0.42), 0.22, 0.16, 0.05, 14, 0.02),
    "BackR": ((-0.23, 0.0, 0.60 + LIFT), (-1.0, 0.0, 0.42), 0.22, 0.16, 0.05, 14, 0.02),
}
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
frames = {}
for side, (base, d, L, W, T, dots, sink) in PADS.items():
    d = Vector(d).normalized()
    b = eb["leaf_" + side]
    b.head = Vector(base)
    b.tail = Vector(base) + d * L * 0.85
    a = d.cross(DOWN)
    if a.length < 1e-3:
        a = Vector((1, 0, 0))
    a.normalize()
    b.align_roll(a.cross(d))
    y = (FRONT - d * FRONT.dot(d)).normalized()
    x = y.cross(d)
    M = Matrix((x, y, d)).transposed().to_4x4()
    M.translation = Vector(base) - d * sink
    frames[side] = M
bpy.ops.object.mode_set(mode="OBJECT")

PAD_MATS = [PAD, AREOLE]
for side, (base, d, L, W, T, dots, sink) in PADS.items():
    remove("Leaf_" + side)
    o = new_object("Pad_" + side, pad_mesh("Pad_" + side, L, W, T, dots), PAD_MATS)
    parent_to_bone(o, "leaf_" + side, frames[side])


# 頭のてっぺんの花（骨 leaf_Top）
def flower_mesh():
    bm = bmesh.new()
    for i in range(5):
        a = i * 2 * math.pi / 5
        ret = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        for v in ret["verts"]:
            p = Vector((v.co.x * 0.022, v.co.y * 0.014, v.co.z * 0.03))
            p = Matrix.Rotation(math.radians(35), 3, "X") @ p
            p = Matrix.Rotation(a, 3, "Z") @ (p + Vector((0, 0.018, 0.02)))
            v.co = p
    ret = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    for v in ret["verts"]:
        v.co = Vector((v.co.x * 0.02, v.co.y * 0.02, v.co.z * 0.016 + 0.035))
        for f in v.link_faces:
            f.material_index = 1
    me = bpy.data.meshes.new("Flower")
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


fl = new_object("Flower", flower_mesh(), [FLOWER, FLOWER_CORE])
parent_to_bone(fl, "leaf_Top", Matrix.Translation((0, 0, 0.755 + LIFT)) @ Matrix.Scale(1.4, 4))


# 首のスカーフ・太陽のバッジ・結び目の垂れ（体に固定）
def scarf_mesh():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    for v in bm.verts:
        # 首に巻いた厚みのある輪。首と頭の継ぎ目を隠す
        v.co = Vector((v.co.x * 0.17, v.co.y * 0.16, v.co.z * 0.045))
    me = bpy.data.meshes.new("Scarf")
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


def tail_mesh(sign):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        t = z + 0.5                       # 0=下 1=上
        w = 0.012 + 0.006 * (1 - t)
        v.co = Vector((x * w * 2 + sign * 0.02 * (1 - t), y * 0.01, -0.085 * (1 - t)))
    me = bpy.data.meshes.new("ScarfTail")
    bm.to_mesh(me)
    bm.free()
    smooth(me)
    return me


def badge_mesh():
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=0.032, radius2=0.032, depth=0.012)
    sun = []   # 太陽の部分の頂点。あとでその面にクリーム色を付ける
    ret = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    sun += ret["verts"]
    for v in ret["verts"]:
        v.co = Vector((v.co.x * 0.011, v.co.y * 0.011, v.co.z * 0.004 + 0.007))
    for i in range(8):
        a = i * math.pi / 4
        ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=3, radius1=0.004, radius2=0.0, depth=0.01)
        sun += ret["verts"]
        for v in ret["verts"]:
            p = Matrix.Rotation(-math.pi / 2, 3, "X") @ v.co + Vector((0, 0.019, 0))
            v.co = Matrix.Rotation(a, 3, "Z") @ p + Vector((0, 0, 0.007))
    for f in {f for v in sun for f in v.link_faces}:
        f.material_index = 1
    me = bpy.data.meshes.new("Badge")
    bm.to_mesh(me)
    bm.free()
    return me


sc = new_object("Scarf", scarf_mesh(), [SCARF])
parent_to_bone(sc, "body", Matrix.Translation((0, 0, 0.425)))

for sign, name in ((1, "ScarfTail_L"), (-1, "ScarfTail_R")):
    t = new_object(name, tail_mesh(sign), [SCARF])
    M = Matrix.Translation((sign * 0.018, -0.162, 0.40)) @ Matrix.Rotation(math.radians(-sign * 14), 4, "Y") @ Matrix.Rotation(math.radians(-14), 4, "X")
    parent_to_bone(t, "body", M)

bd = new_object("Badge", badge_mesh(), [BADGE_DISC, BADGE])
parent_to_bone(bd, "body", Matrix.Translation((0, -0.17, 0.412)) @ Matrix.Rotation(math.radians(90 - 14), 4, "X") @ Matrix.Rotation(math.pi, 4, "Z"))

rig.data.pose_position = "POSE"
