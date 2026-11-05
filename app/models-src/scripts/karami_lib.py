
import bpy, bmesh, math
from mathutils import Vector, Matrix
col = bpy.context.scene.collection

def leaf_mesh(name, L, W, cup=0.25, bend=0.12, thick=0.007, nu=10, nv=20):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    def half_w(v):
        return 0.5*W*(math.sin(math.pi*min(v,1.0))**0.55)*(1-0.15*v) + 0.006*(1-v)
    g = {}
    for side, off in (("f",-1),("b",1)):
        for j in range(nv+1):
            v = j/nv; hw = half_w(v)
            for i in range(nu+1):
                x = (i/nu-0.5)*2*hw
                rel = (x/(0.5*W))**2
                y = -cup*0.5*W*(1-rel)*math.sin(math.pi*v)*0.35 + bend*L*v*v
                y += off*thick*0.5*(1-0.7*v)
                g[(side,i,j)] = bm.verts.new((x, y, v*L))
    def quad(vs, ids):
        f = bm.faces.new(vs)
        for loop,(a,b) in zip(f.loops, ids): loop[uvl].uv = (a/nu, b/nv)
    for j in range(nv):
        for i in range(nu):
            ids = [(i,j),(i+1,j),(i+1,j+1),(i,j+1)]
            quad([g[("f",a,b)] for a,b in ids], ids)
            r = ids[::-1]; quad([g[("b",a,b)] for a,b in r], r)
    def rim(seq):
        for (a,b),(c,d) in zip(seq, seq[1:]):
            quad([g[("f",a,b)], g[("f",c,d)], g[("b",c,d)], g[("b",a,b)]], [(a,b),(c,d),(c,d),(a,b)])
    rim([(0,j) for j in range(nv+1)][::-1]); rim([(nu,j) for j in range(nv+1)])
    rim([(i,nv) for i in range(nu+1)][::-1]); rim([(i,0) for i in range(nu+1)])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    me.materials.append(bpy.data.materials["Leaf"])
    return me

def orient(theta_deg, phi_deg):
    t, p = math.radians(theta_deg), math.radians(phi_deg)
    d = Vector((math.sin(t)*math.cos(p), -math.sin(p), math.cos(t)*math.cos(p))).normalized()
    x = d.cross(Vector((0,-1,0)))
    if x.length < 1e-4: x = Vector((1,0,0))
    x.normalize(); y = d.cross(x).normalized()
    return Matrix((x, y, d)).transposed().to_4x4()

def place_leaves(parent_name, spec, **kw):
    parent = bpy.data.objects[parent_name]
    for name, base, th, ph, L, W in spec:
        old = bpy.data.objects.get(name)
        if old:
            me = old.data; bpy.data.objects.remove(old, do_unlink=True); bpy.data.meshes.remove(me)
        o = bpy.data.objects.new(name, leaf_mesh(name, L, W, **kw)); col.objects.link(o)
        o.parent = parent
        o.matrix_basis = Matrix.Translation(base) @ orient(th, ph)
