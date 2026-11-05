
import bpy, math
import numpy as np
from mathutils import Vector
exec(bpy.data.texts["karami_expr"].as_string())
# 悲しい顔のパーツ。まぶたは外側が下がる困り顔に、目には下側のうるみと光、
# 頬には流れ落ちる涙。涙とうるみは骨 cry_* の下に置き、アプリが気分に合わせて大きさを変える
PUPIL=(0.090,0.4655)
def sad_lid():
    eye=eye_outline()
    big=[(EYE.x+(x-EYE.x)*1.06, EYE.z+(z-EYE.z)*1.06) for x,z in eye]
    # 内側（鼻の側）は高く、外側は低い
    lidz=lambda x: 0.522-(x-0.04)*0.30
    lid=[(x,max(z,lidz(x))) for x,z in big]
    xs=[x for x,z in big if z>=lidz(x)]
    edge=[(x,lidz(x)) for x in np.linspace(min(xs)+0.004,max(xs)-0.004,24)]
    return lid, edge, lidz
def white_outline(n=72):
    """白目（EyeWhite_L）の輪郭を、角度ごとに測る"""
    o=bpy.data.objects["EyeWhite_L"]
    P=np.array([tuple(o.matrix_world@v.co) for v in o.data.vertices]); dx=P[:,0]-EYE.x; dz=P[:,2]-EYE.z
    ang=np.arctan2(dz,dx); r=np.hypot(dx,dz); out=[]
    for i in range(n):
        a=-math.pi+2*math.pi*i/n; d=np.abs((ang-a+math.pi)%(2*math.pi)-math.pi)
        out.append((EYE.x+r[d<math.radians(4)].max()*math.cos(a), EYE.z+r[d<math.radians(4)].max()*math.sin(a)))
    return out
def circle(cx,cz,r,n=32): return [(cx+r*math.cos(2*math.pi*i/n), cz+r*math.sin(2*math.pi*i/n)) for i in range(n)]
def drop(cx,cz,r):
    """上がとがったしずく"""
    pts=[]
    for i in range(40):
        a=-math.pi/2+2*math.pi*i/40
        x=r*math.cos(a); z=r*math.sin(a)
        if z>0: x*= (1-z/(r*1.9)); z*=1.9
        pts.append((cx+x,cz+z))
    return pts
TEAR_PATH=[(0.074,0.424),(0.076,0.40),(0.080,0.375),(0.085,0.35)]
TK=1.04   # 涙の浮き。頬を下るほど面が内へ傾くので、沈まないよう大きめに浮かせる
def build_cry():
    rig=bpy.data.objects["Karami"]; rig.data.pose_position='REST'; bpy.context.view_layer.update()
    lid,edge,lidz=sad_lid()
    white=white_outline()
    # 表面から浮かせると外へずれるので、横を詰めて白目の内に収める
    inner=[(EYE.x+(x-EYE.x)*0.80, EYE.z+(z-EYE.z)*0.93) for x,z in white]
    pool_top=lambda x: EYE.z-0.036+0.004*math.cos((x-EYE.x)/0.07*math.pi/2)
    pool=[(x,min(z,pool_top(x))) for x,z in inner]
    for side,sx in (("L",1),("R",-1)):
        fill(bpy.data.objects["Lid_"+side], mirror(lid,sx)[::sx], (sx*EYE.x, EYE.z+0.045), 1.020)
        stroke(bpy.data.objects["LidLine_"+side], mirror(edge,sx)[::sx], 0.007, 1.023)
        fill(bpy.data.objects["TearPool_"+side], mirror(pool,sx)[::sx], (sx*EYE.x, EYE.z-0.05), 1.016)
        fill(bpy.data.objects["Shine_"+side], mirror(circle(PUPIL[0]-0.016,PUPIL[1]+0.016,0.012),sx)[::sx], (sx*(PUPIL[0]-0.016),PUPIL[1]+0.016), 1.018, rings=3)
        fill(bpy.data.objects["Shine2_"+side], mirror(circle(PUPIL[0]+0.018,PUPIL[1]-0.012,0.006),sx)[::sx], (sx*(PUPIL[0]+0.018),PUPIL[1]-0.012), 1.018, rings=2)
        x0,z0=TEAR_PATH[0]
        fill(bpy.data.objects["Tear_"+side], mirror(drop(x0,z0,0.0095),sx)[::sx], (sx*x0,z0), TK, rings=3)
    rig.data.pose_position='POSE'
def tear_offset(t, sx):
    """涙が頬を流れる道の、t（0〜1）の位置への、出発点からのずれ（体の空間）"""
    xs=[p[0] for p in TEAR_PATH]; zs=[p[1] for p in TEAR_PATH]; ts=np.linspace(0,1,len(TEAR_PATH))
    x=float(np.interp(t,ts,xs)); z=float(np.interp(t,ts,zs))
    return surf(sx*x,z,TK)-surf(sx*TEAR_PATH[0][0],TEAR_PATH[0][1],TK)
