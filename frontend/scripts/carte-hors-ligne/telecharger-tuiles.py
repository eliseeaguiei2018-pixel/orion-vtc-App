"""Tuiles vectorielles et polices du district d'Abidjan (OpenFreeMap). Usage : python3 telecharger-tuiles.py <dossier>"""
import math, os, sys, urllib.request, json, concurrent.futures as cf
os.makedirs(sys.argv[1], exist_ok=True); os.chdir(sys.argv[1])
# Version courante de la planète OpenFreeMap (mise à jour chaque semaine).
BASE=json.load(urllib.request.urlopen(urllib.request.Request('https://tiles.openfreemap.org/planet', headers={'User-Agent':'orion-demo-tiles/1.0'})))['tiles'][0]
def tuile(lat,lng,z):
    n=2**z; x=int((lng+180)/360*n); r=math.radians(lat); y=int((1-math.asinh(math.tan(r))/math.pi)/2*n); return x,y
W,S,E,N=-4.32,5.20,-3.70,5.62
taches=[]
for z in range(5,15):
    x0,y0=tuile(N,W,z); x1,y1=tuile(S,E,z)
    for x in range(x0,x1+1):
        for y in range(y0,y1+1): taches.append((z,x,y))
def get(t):
    z,x,y=t; d=f'tuiles/{z}/{x}'; os.makedirs(d,exist_ok=True); f=f'{d}/{y}.pbf'
    if os.path.exists(f) and os.path.getsize(f)>0: return 0
    req=urllib.request.Request(BASE.format(z=z,x=x,y=y), headers={'User-Agent':'orion-demo-tiles/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r: data=r.read()
    open(f,'wb').write(data); return len(data)
with cf.ThreadPoolExecutor(4) as ex: tailles=list(ex.map(get,taches))
print(len(taches),'tuiles', sum(tailles)//1024,'Ko')
# polices des libellés
for police in ['Noto Sans Regular','Noto Sans Bold','Noto Sans Italic']:
    d='polices/'+police.replace(' ',''); os.makedirs(d,exist_ok=True)
    for r in ['0-255','256-511','512-767','768-1023','7424-7679','7680-7935','8192-8447']:
        u='https://tiles.openfreemap.org/fonts/'+urllib.request.quote(police)+'/'+r+'.pbf'
        with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'orion-demo-tiles/1.0'}), timeout=60) as rep: open(f'{d}/{r}.pbf','wb').write(rep.read())
print('polices ok')
