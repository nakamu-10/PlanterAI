
import bpy, bmesh, math
from mathutils import Vector
K=0.95/960; HC=Vector((0,0,0.49)); A,B,C=0.228,0.19,0.182
MID=411.8
def W(p): return ((p[0]-MID)*K,(965-p[1])*K)
def surf(x,z,k):
    q=1-(x/A)**2-((z-HC.z)/C)**2
    return HC+(Vector((x,-B*math.sqrt(max(q,0)),z))-HC)*k
def decal(name, pts, center, k, mirror, rings=5):
    """イラストの画像座標の輪郭を、頭の楕円体の表面に貼る（k は表面からの浮き）"""
    o=bpy.data.objects[name]; inv=o.matrix_world.inverted()
    f=(lambda p:(2*MID-p[0],p[1])) if mirror else (lambda p:p)
    pts=[W(f(p)) for p in pts]; c=W(f(center))
    if mirror: pts=pts[::-1]
    bm=bmesh.new(); cv=bm.verts.new(inv@surf(c[0],c[1],k)); layers=[]
    for r in range(1,rings+1):
        t=r/rings; layers.append([bm.verts.new(inv@surf(c[0]+(x-c[0])*t, c[1]+(z-c[1])*t, k)) for x,z in pts])
    n=len(pts)
    for i in range(n): bm.faces.new((cv,layers[0][i],layers[0][(i+1)%n]))
    for r in range(rings-1):
        a,b2=layers[r],layers[r+1]
        for i in range(n): bm.faces.new((a[i],b2[i],b2[(i+1)%n],a[(i+1)%n]))
    for fc in bm.faces:
        fc.normal_update()
        if (o.matrix_world.to_3x3()@fc.normal).y>0: fc.normal_flip()
    bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons: p.use_smooth=True
def shrink(pts,c,px):
    out=[]
    for x,y in pts:
        dx,dy=x-c[0],y-c[1]; d=math.hypot(dx,dy); out.append((c[0]+dx*(d-px)/d, c[1]+dy*(d-px)/d))
    return out
def circ(cx,cy,rx,ry,n=64): return [(cx+rx*math.cos(2*math.pi*i/n), cy+ry*math.sin(2*math.pi*i/n)) for i in range(n)]
