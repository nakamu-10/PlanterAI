
import bpy, bmesh, math
from mathutils import Vector, Matrix
# 葉の付け根に茎を付ける。葉は頭に直接付いていたので、茎が見える長さだけ葉を外へ出す
HC=Vector((0,0,0.49)); A,B,C=0.228,0.19,0.182
LEAVES=["Top","UpL","UpR","FrontL","FrontR","BackL","BackR"]
SHOW=0.035   # 頭の表面から葉の付け根までの、茎の見える長さ
def inside(p):
    q=p-HC; return (q.x/A)**2+(q.y/B)**2+(q.z/C)**2
def midrib_base(o):
    me=o.data; uv=me.uv_layers.active.data; d={}
    for l in me.loops: d[l.vertex_index]=tuple(uv[l.index].uv)
    def at(v):
        ps=[o.matrix_world@me.vertices[i].co for i in d if abs(d[i][0]-0.5)<1e-3 and abs(d[i][1]-v)<1e-3]
        return sum(ps,Vector())/len(ps)
    b=at(0.0); return b,(at(0.05)-b).normalized()
def tube(o, a, b, r0, r1, n=12):
    inv=o.matrix_world.inverted(); axis=(b-a).normalized()
    side=axis.cross(Vector((0,0,1)) if abs(axis.z)<0.9 else Vector((1,0,0))).normalized(); up=axis.cross(side)
    bm=bmesh.new(); rings=[]
    for t,r in ((0,r0),(1,r1)):
        c=a+(b-a)*t
        rings.append([bm.verts.new(inv@(c+(side*math.cos(2*math.pi*i/n)+up*math.sin(2*math.pi*i/n))*r)) for i in range(n)])
    for i in range(n):
        bm.faces.new((rings[0][i],rings[0][(i+1)%n],rings[1][(i+1)%n],rings[1][i]))
    bm.faces.new(rings[1]); bm.faces.new(rings[0][::-1])
    bm.normal_update(); bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons: p.use_smooth=True
def build_stems():
    rig=bpy.data.objects["Karami"]; rig.data.pose_position='REST'; bpy.context.view_layer.update()
    col=bpy.data.objects["Leaf_Top"].users_collection[0]
    for n in LEAVES:
        leaf=bpy.data.objects["Leaf_"+n]; base,_=midrib_base(leaf)
        # 茎は頭の表面から垂直に出す。付け根から頭へ戻り、表面を横切る所までの距離
        q=base-HC; d=Vector((q.x/A**2,q.y/B**2,q.z/C**2)).normalized()
        back=0.0
        while inside(base-d*back)>1 and back<0.2: back+=0.001
        shift=max(0.0, SHOW-back)
        if shift>0:
            leaf.data.transform(Matrix.Translation(leaf.matrix_world.inverted().to_3x3()@(d*shift)))
            base=base+d*shift
        stem=bpy.data.objects.get("Stem_"+n)
        if not stem:
            stem=bpy.data.objects.new("Stem_"+n,bpy.data.meshes.new("Stem_"+n)); col.objects.link(stem)
            stem.parent=rig; stem.parent_type='BONE'; stem.parent_bone=leaf.parent_bone
            stem.matrix_world=leaf.matrix_world.copy()
            stem.data.materials.append(bpy.data.materials["Stem"])
        start=base-d*(back+shift+0.02)
        tube(stem, start, base+d*0.004, 0.0065, 0.0042)
        print(n, "shift",round(shift,3),"visible",round(back+shift,3))
    rig.data.pose_position='POSE'
