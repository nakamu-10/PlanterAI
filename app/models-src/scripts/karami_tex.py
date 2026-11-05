
import bpy, numpy as np
def leaf_texture(TW=512, TH=1024, base=(0.49,0.86,0.21), mint=(0.64,0.95,0.68), rib=(0.31,0.60,0.12), thick=1.25):
    """イラストの葉：黄緑の地に、ミント色の短い葉脈が矢羽根状に並び、主脈は濃い緑。片側を少し暗く"""
    u=(np.arange(TW)+0.5)/TW; v=(np.arange(TH)+0.5)/TH; U,V=np.meshgrid(u,v)
    ASP=1.45
    img=np.ones((TH,TW,3))*np.array(base)
    def stroke(p0,p1,bulge,T):
        s=np.linspace(0,1,40)
        px=p0[0]+(p1[0]-p0[0])*s; py=p0[1]+(p1[1]-p0[1])*s
        nx,ny=-(p1[1]-p0[1])*ASP,(p1[0]-p0[0]); n=np.hypot(nx,ny); nx/=n; ny/=n
        px=px+nx*bulge*np.sin(np.pi*s); py=py+ny*bulge*np.sin(np.pi*s)/ASP
        th=T*np.sin(np.pi*s)**0.7+1e-4
        m=np.zeros_like(U)
        x0,x1=max(0,int((min(px)-0.05)*TW)),min(TW,int((max(px)+0.05)*TW)+1)
        y0,y1=max(0,int((min(py)-0.05)*TH)),min(TH,int((max(py)+0.05)*TH)+1)
        Us,Vs=U[y0:y1,x0:x1],V[y0:y1,x0:x1]; best=np.full(Us.shape,9.0)
        for i in range(len(s)): best=np.minimum(best,np.hypot(Us-px[i],(Vs-py[i])*ASP)-th[i]/2)
        m[y0:y1,x0:x1]=np.clip(0.5-best/(1.5/TW),0,1); return m
    mask=np.zeros_like(U)
    for k,v0 in enumerate(np.arange(0.13,0.83,0.085)):
        long_=(k%2==0); du=(0.30 if long_ else 0.19)*(1-0.35*max(0,(v0-0.55)/0.3))
        for sgn in (1,-1):
            mask=np.maximum(mask,stroke((0.5+sgn*0.035,v0),(0.5+sgn*(0.035+du),v0+du*0.5),-0.012*sgn,(0.027 if long_ else 0.022)*thick))
    img=img*(1-mask[...,None])+np.array(mint)*mask[...,None]
    w=(0.0055*(1-V)+0.0015); rm=np.clip(0.5-(np.abs(U-0.5)-w)/(1.2/TW),0,1)*(V<0.9)
    img=img*(1-rm[...,None])+np.array(rib)*rm[...,None]
    shade=np.where(U<0.5,0.88,1.0); edge=np.clip((np.abs(U-0.5)-0.43)/0.07,0,1)*0.18
    img*= (shade*(1-edge))[...,None]
    im=bpy.data.images['LeafTex']
    if tuple(im.size)!=(TW,TH): im.scale(TW,TH)
    im.pixels[:]=np.concatenate([img,np.ones((TH,TW,1))],axis=2).ravel(); im.pack()

def cape_texture():
    """マントは葉と同じ模様で、少し青みを足す（イラストで腕と見分けがつくように）"""
    src=bpy.data.images['LeafTex']; TW,TH=src.size
    px=np.array(src.pixels[:]).reshape(TH,TW,4).copy()
    px[...,:3]=np.clip(px[...,:3]*np.array([0.86,0.88,1.25]),0,1)
    ct=bpy.data.images.get("CapeTex") or bpy.data.images.new("CapeTex",TW,TH)
    if tuple(ct.size)!=(TW,TH): ct.scale(TW,TH)
    ct.pixels[:]=px.ravel(); ct.pack()
