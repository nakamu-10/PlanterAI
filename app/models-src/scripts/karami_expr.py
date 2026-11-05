
import bpy, bmesh, math
import numpy as np
from mathutils import Vector
# 表情の差し替え用のパーツ。目を縦につぶすと黒目まで楕円になるので、
# 喜ぶ・なでるは「∩」の笑い目、しおれは上まぶたを下ろした目に描き替える
HC=Vector((0,0,0.49)); A,B,C=0.228,0.19,0.182
EYE=Vector((0.1051,0,0.4748))   # 左目の中心（x, z）。右目は x を反転する
def surf(x,z,k):
    q=1-(x/A)**2-((z-HC.z)/C)**2
    return HC+(Vector((x,-B*math.sqrt(max(q,0)),z))-HC)*k
def fill(o, outline, center, k, rings=6):
    """(x,z) の輪郭を中心から同心の輪で埋め、頭の表面に貼る"""
    inv=o.matrix_world.inverted(); bm=bmesh.new()
    cv=bm.verts.new(inv@surf(center[0],center[1],k)); layers=[]
    for r in range(1,rings+1):
        t=r/rings; layers.append([bm.verts.new(inv@surf(center[0]+(x-center[0])*t, center[1]+(z-center[1])*t, k)) for x,z in outline])
    n=len(outline)
    for i in range(n): bm.faces.new((cv,layers[0][i],layers[0][(i+1)%n]))
    for r in range(rings-1):
        a,b=layers[r],layers[r+1]
        for i in range(n): bm.faces.new((a[i],b[i],b[(i+1)%n],a[(i+1)%n]))
    finish(o,bm)
def stroke(o, line, width, k):
    """(x,z) の折れ線を、太さ width の帯にして貼る（両端は丸める）"""
    inv=o.matrix_world.inverted(); bm=bmesh.new(); L=[];R=[]
    for i,(x,z) in enumerate(line):
        a=line[max(i-1,0)]; b=line[min(i+1,len(line)-1)]
        tx,tz=b[0]-a[0],b[1]-a[1]; l=math.hypot(tx,tz); nx,nz=-tz/l*width/2, tx/l*width/2
        L.append(bm.verts.new(inv@surf(x+nx,z+nz,k))); R.append(bm.verts.new(inv@surf(x-nx,z-nz,k)))
    for i in range(len(line)-1): bm.faces.new((L[i],R[i],R[i+1],L[i+1]))
    for (x,z),(px,pz),sgn in ((line[0],line[1],-1),(line[-1],line[-2],1)):
        tx,tz=x-px,z-pz; l=math.hypot(tx,tz); tx,tz=tx/l,tz/l
        c=bm.verts.new(inv@surf(x,z,k)); arc=[]
        for j in range(9):
            ang=math.pi*j/8; nx,nz=-tz,tx
            dx=(nx*math.cos(ang)+tx*math.sin(ang))*width/2; dz=(nz*math.cos(ang)+tz*math.sin(ang))*width/2
            arc.append(bm.verts.new(inv@surf(x+dx,z+dz,k)))
        for j in range(8): bm.faces.new((c,arc[j],arc[j+1]))
    finish(o,bm)
def finish(o,bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    for f in bm.faces:
        f.normal_update()
        if (o.matrix_world.to_3x3()@f.normal).y>0: f.normal_flip()
    bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons: p.use_smooth=True
def eye_outline(n=72):
    """白目の縁（EyeRim_L）の外側の輪郭を、角度ごとに測る"""
    o=bpy.data.objects["EyeRim_L"]
    P=np.array([tuple(o.matrix_world@v.co) for v in o.data.vertices]); dx=P[:,0]-EYE.x; dz=P[:,2]-EYE.z
    ang=np.arctan2(dz,dx); r=np.hypot(dx,dz); out=[]
    for i in range(n):
        a=-math.pi+2*math.pi*i/n; d=np.abs((ang-a+math.pi)%(2*math.pi)-math.pi)
        m=d<math.radians(4); rr=r[m].max()
        out.append((EYE.x+rr*math.cos(a), EYE.z+rr*math.sin(a)))
    return out
def mirror(pts, sx): return [(sx*x,z) for x,z in pts]
LID=0.476      # しおれの上まぶたの下の縁の高さ（目の中心とほぼ同じ）
def build_expressions():
    rig=bpy.data.objects["Karami"]; rig.data.pose_position='REST'; bpy.context.view_layer.update()
    eye=eye_outline()
    # 笑い目：「∩」の弧
    arc=[(EYE.x+0.052*math.cos(t), EYE.z-0.012+0.034*math.sin(t)) for t in np.linspace(math.radians(20),math.radians(160),24)]
    # まぶた：目の輪郭を少し広げ、下の縁より上だけを残す（下の縁はゆるく垂れる）
    big=[(EYE.x+(x-EYE.x)*1.06, EYE.z+(z-EYE.z)*1.06) for x,z in eye]
    lidz=lambda x: LID-0.006*(1-((x-EYE.x)/0.075)**2)
    lid=[(x,max(z,lidz(x))) for x,z in big]
    xs=[x for x,z in big if z>=lidz(x)]
    edge=[(x,lidz(x)) for x in np.linspace(min(xs)+0.004,max(xs)-0.004,24)]
    for side,sx in (("L",1),("R",-1)):
        stroke(bpy.data.objects["HappyEye_"+side], mirror(arc,sx)[::sx], 0.011, 1.012)
        fill(bpy.data.objects["Lid_"+side], mirror(lid,sx)[::sx], (sx*EYE.x, EYE.z+0.03), 1.020)
        stroke(bpy.data.objects["LidLine_"+side], mirror(edge,sx)[::sx], 0.007, 1.023)
    # 開いた口：上の縁がゆるく笑い、下が丸い D の形。縁取り・中・舌の順に重ねる
    X0,TOP,W,D=0.0,0.4165,0.027,0.020
    def mouth(t, grow=0.0):
        """t=0..1 で輪郭を一周する。grow は外側への太り"""
        n=48
        top=[(-W+2*W*i/n, TOP-0.003*(1-((-W+2*W*i/n)/W)**2)) for i in range(n+1)]
        bot=[(W*math.cos(a), TOP-D*math.sin(a)) for a in np.linspace(0,math.pi,n+1)[1:-1]]
        pts=top[::-1]+bot   # 右の端→左の端（上の縁）→下の弧を左から右へ
        c=(0.0, TOP-D*0.45)
        return [(c[0]+(x-c[0])*(1+grow/ max(1e-6,math.hypot(x-c[0],z-c[1]))), c[1]+(z-c[1])*(1+grow/ max(1e-6,math.hypot(x-c[0],z-c[1])))) for x,z in pts], c
    out,c=mouth(0,0.0028); inner,_=mouth(0)
    fill(bpy.data.objects["MouthLine"], out, c, 1.004)
    fill(bpy.data.objects["MouthInside"], inner, c, 1.007)
    tongue=[(0.012*math.cos(a), TOP-D+0.0065+0.0055*math.sin(a)) for a in np.linspace(0,2*math.pi,40,endpoint=False)]
    tongue=[(x,max(z, TOP-D*math.sqrt(max(0,1-(x/W)**2))+0.0015)) for x,z in tongue]
    fill(bpy.data.objects["Tongue"], tongue, (0, TOP-D+0.007), 1.010)
    rig.data.pose_position='POSE'
