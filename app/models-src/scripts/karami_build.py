
import bpy, math
from mathutils import Vector, Matrix
def build_leaves(spec, cup=0.25, bend=0.12, bone_prefix="leaf_", obj_prefix="Leaf_"):
    lib={}; exec(bpy.data.texts['karami_lib'].as_string(), lib)
    rig=bpy.data.objects["Karami"]; rig.data.pose_position='REST'
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb=rig.data.edit_bones
    mats={}
    for side_name, base, th, ph, L, W, off in spec:
        M=lib['orient'](th,ph); d=Vector(M.col[2][:3])
        b=eb[bone_prefix+side_name]; b.head=Vector(base); b.tail=Vector(base)+d*(off+L*0.85)
        a=d.cross(Vector((0,0,-1)))
        if a.length<1e-3: a=Vector((1,0,0))
        a.normalize(); b.align_roll(a.cross(d))   # 局所Xをしおれ軸に
        mats[side_name]=Matrix.Translation(Vector(base)+d*off)@M
    bpy.ops.object.mode_set(mode='OBJECT')
    for side_name,_,_,_,L,W,_ in spec:
        o=bpy.data.objects[obj_prefix+side_name]; old=o.data
        o.data=lib['leaf_mesh'](obj_prefix+side_name, L, W, cup=cup, bend=bend); bpy.data.meshes.remove(old)
        o.matrix_world=mats[side_name]
