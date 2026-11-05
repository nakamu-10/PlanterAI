
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix
# 体（胴・腕・ベルト）の外形を、高さ z と角度 phi（0=前、90=横、180=後ろ）ごとに測る
BODY=["Torso","Arm_L","Arm_R","Belt","Buckle"]
def body_hull():
    pts=[]
    for n in BODY:
        o=bpy.data.objects[n]; mw=o.matrix_world
        pts+=[tuple(mw@v.co) for v in o.data.vertices]
    P=np.array(pts); r=np.hypot(P[:,0],P[:,1]); ph=np.degrees(np.arctan2(np.abs(P[:,0]),-P[:,1])); z=P[:,2]
    def hull(zz,ff):
        m=(np.abs(z-zz)<0.025)&(np.abs(ph-ff)<10)
        return float(r[m].max()) if m.any() else 0.0
    return hull
TOP=0.35
def interp(x, table):
    xs=[a for a,_ in table]; ys=[b for _,b in table]; return float(np.interp(x,xs,ys))
# 下の縁：前は胸の上だけの肩かけ、横から後ろは裾まで届くマント
LOW=[(0,0.287),(60,0.272),(78,0.255),(92,0.16),(108,0.10),(140,0.095),(180,0.125)]
# 横幅（rx）と前後（ry）の、高さごとの半径。首元から広がり、裾で丸くすぼまる
RX=[(0.09,0.170),(0.12,0.205),(0.17,0.222),(0.24,0.212),(0.30,0.170),(0.35,0.10)]
RY=[(0.09,0.150),(0.17,0.165),(0.24,0.160),(0.30,0.138),(0.35,0.10)]
def base_radius(z,phi):
    ex=interp(z,RX); ey=interp(z,RY)
    s,c=math.sin(math.radians(phi)),math.cos(math.radians(phi))
    return 1/math.sqrt((s/ex)**2+(c/ey)**2)


# 左右それぞれ1枚の葉。展開図（s=角度×0.17, z）の上で、首元を付け根に、
# 肩を回って裾を先端にした葉を作り、体の外形に沿って巻きつける
MIDRIB=[(4,0.335),(45,0.315),(85,0.255),(110,0.17),(124,0.075)]
def midrib(v):
    """v=0（付け根）〜1（先端）の主脈上の点と、葉の幅方向の向き"""
    P=[(math.radians(p)*0.17,z) for p,z in MIDRIB]
    L=[math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(P,P[1:])]; total=sum(L); d=v*total
    for (a,b),l in zip(zip(P,P[1:]),L):
        if d<=l or l is L[-1]:
            t=min(1.0,d/l); x=a[0]+(b[0]-a[0])*t; y=a[1]+(b[1]-a[1])*t
            tx,ty=(b[0]-a[0])/l,(b[1]-a[1])/l
            return x,y,(-ty,tx)
        d-=l
def half_width(v, W):
    return W*0.5*(math.sin(math.pi*v)**0.6)*(1-0.15*v)+0.004
FRONT=0.5
# 葉の後ろ側を背中の真ん中（180度）まで伸ばす。後ろで左右の葉が背骨の線で合わさる
BACK_FROM=90
def back_target(z):
    return interp(z,[(0.07,150),(0.11,175),(0.13,180),(0.33,180),(0.37,120)])
def build_cape(W=0.31, nu=16, nv=40, margin=0.012):
    rig=bpy.data.objects["Karami"]; rig.data.pose_position='REST'; bpy.context.view_layer.update()
    hull=body_hull()
    # 1回目：展開図の上の点（角度, 高さ）を作る
    raw={}
    for j in range(nv+1):
        v=j/nv; x0,z0,(nx,nz)=midrib(v); hw=half_width(v,W)
        for i in range(nu+1):
            # 前（下）側の半分は細くして、腕がマントの前に出るようにする
            u=i/nu; off=(u-0.5)*2*hw*(1.0 if u>=0.5 else FRONT)
            sx_,z=x0+nx*off, z0+nz*off
            raw[i,j]=(max(2.0,math.degrees(sx_/0.17)), min(z,0.36))
    # 高さごとに、葉がいちばん後ろまで届く角度を測り、そこを背中の真ん中に合わせる
    zs=np.array([z for _,z in raw.values()]); ps=np.array([p for p,_ in raw.values()])
    bins=np.arange(0.04,0.40,0.02); reach=[]
    for b in bins:
        m=np.abs(zs-b)<0.015
        reach.append(ps[m].max() if m.any() else BACK_FROM+1)
    for side,sx in (("L",1),("R",-1)):
        o=bpy.data.objects["Cape_"+side]; inv=o.matrix_world.inverted()
        bm=bmesh.new(); uvl=bm.loops.layers.uv.new("UVMap"); grid={}
        for (i,j),(ph,z) in raw.items():
            if ph>BACK_FROM:
                m=max(float(np.interp(z,bins,reach)),BACK_FROM+1)
                ph=BACK_FROM+(ph-BACK_FROM)*(back_target(z)-BACK_FROM)/(m-BACK_FROM)
            ph=min(ph,180.0)
            r=max(base_radius(z,ph), hull(z,ph)+margin)
            p=Vector((sx*r*math.sin(math.radians(ph)), -r*math.cos(math.radians(ph)), z))
            grid[i,j]=bm.verts.new(inv@p)
        for j in range(nv):
            for i in range(nu):
                ids=[(i,j),(i+1,j),(i+1,j+1),(i,j+1)]
                if sx<0: ids=ids[::-1]
                f=bm.faces.new([grid[k] for k in ids])
                for loop,(a,b) in zip(f.loops,ids): loop[uvl].uv=(a/nu, b/nv)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.normal_update()
        for f in bm.faces:
            c=o.matrix_world@f.calc_center_median(); n=o.matrix_world.to_3x3()@f.normal
            if n.dot(Vector((c.x,c.y,0)))<0: f.normal_flip()
        bm.to_mesh(o.data); bm.free()
        for p in o.data.polygons: p.use_smooth=True
    rig.data.pose_position='POSE'
