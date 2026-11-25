"""
Icône de l'application ORION, en volume.

La feuille blanche du logo est modelée en relief sur une dalle verte laquée, avec sa
nervure-route gravée et les trois étoiles de la ceinture d'Orion ; une seule lumière, en
haut à gauche, pose l'ombre. L'image couvre tout le cadre : Android la découpe ensuite à la
forme du téléphone (rond, carré arrondi, « squircle »).

Usage : python icone_app.py <dossier-sortie>          → <dossier-sortie>/icone-app.png (864 px)
        ORION_ICONE=chauffeur | console : même icône, avec l'emblème de l'app en relief en bas à
        gauche (volant pour ORION Chauffeur, cadran de supervision pour ORION Console).
Puis   : python icone_android.py <dossier-sortie> ../../android/app/src/main/res ../../public
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import orion3d as o3
from mathutils import Vector

bpy = o3.bpy
SORTIE = sys.argv[1]; os.makedirs(SORTIE, exist_ok=True)
K = 2.3 / 512                 # le logo occupe la zone sûre de l'icône adaptative (66 dp sur 108)
HAUT = 0.30                   # dessus de la dalle

def pt(X, Y, z=0.0):
    """Point du logo (pixels SVG) → scène. La caméra regarde d'en haut, +x vers le haut de l'image."""
    return ((256 - Y) * K, (256 - X) * K, z)

def bezier(p0, p1, p2, p3, n=16):
    out = []
    for i in range(n):
        t = i / n; u = 1 - t
        out.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return out

def plaque(nom, contour, z0, z1, mat, arrondi=0.05):
    """Contour (x, y) extrudé de z0 à z1, arêtes arrondies."""
    n = len(contour)
    sommets = [(x, y, z0) for x, y in contour] + [(x, y, z1) for x, y in contour]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    o = o3.maillage(nom, sommets, faces, mat, lissage=0)
    bpy.context.view_layer.objects.active = o
    b = o.modifiers.new('arrondi', 'BEVEL'); b.width = arrondi; b.segments = 8; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(40)
    bpy.ops.object.modifier_apply(modifier=b.name)
    return o3.lisser(o, 60)

scene = o3.vider()
cam = o3.studio(scene, 864, 864, echantillons=int(os.environ.get('ECHANTILLONS', 160)), ombre=False)
# La lumière principale passe en haut à gauche de l'image (convention des icônes).
principale = bpy.data.objects['principale']
principale.location = (4.6, 3.8, 5.2)
principale.rotation_euler = (Vector((0, 0, 0)) - Vector(principale.location)).to_track_quat('-Z', 'Y').to_euler()
principale.data.energy = 520

vert = o3.matiere('laque verte', o3.hexa('#00A651'), rugosite=0.34, vernis=0.8, metal=0.05)
vert_fonce = o3.matiere('gravure', o3.hexa('#007A3D'), rugosite=0.35, vernis=0.6)
blanc = o3.matiere('céramique', o3.hexa('#FAFBFC'), rugosite=0.20, vernis=1.0)

# Dalle verte : déborde du cadre, pour que la découpe du téléphone ne montre jamais de bord.
o3.boite('dalle', (4.0, 4.0, HAUT), (0, 0, HAUT / 2), vert, rayon=0.02)
# Feuille : le tracé du logo, en relief bombé.
segments = [((256, 92), (338, 150), (372, 252), (318, 350)), ((318, 350), (300, 382), (280, 404), (256, 424)),
            ((256, 424), (232, 404), (212, 382), (194, 350)), ((194, 350), (140, 252), (174, 150), (256, 92))]
contour = [pt(*p)[:2] for s in segments for p in bezier(*s)]
plaque('feuille', contour, HAUT - 0.02, HAUT + 0.30, blanc, arrondi=0.15)
# Nervure-route et ses deux embranchements, gravés dans la feuille.
dessus = HAUT + 0.288
o3.tube('nervure', [pt(X, Y, dessus) for X, Y in bezier((256, 158), (250, 240), (250, 330), (256, 398), n=10)] + [pt(256, 398, dessus)], 0.034, vert_fonce)
o3.tube('branche', [pt(254, 250, dessus), pt(218, 218, dessus)], 0.028, vert_fonce)
o3.tube('branche', [pt(254, 300, dessus), pt(296, 270, dessus)], 0.028, vert_fonce)
# Ceinture d'Orion : trois étoiles posées sur la dalle.
for X, Y, r in ((372, 120, 15), (406, 150, 12), (430, 186, 9)):
    rayon = r * K * 1.45
    o3.sphere('étoile', rayon, pt(X, Y, HAUT + rayon * 0.72), blanc)

# Emblème de l'application, dans la même céramique que la feuille et les étoiles.
EMBLEME = os.environ.get('ORION_ICONE', 'client')
if EMBLEME in ('chauffeur', 'console'):
    # En bas à gauche, entièrement dans la zone sûre (cercle de 66 dp) : visible quelle que
    # soit la découpe du téléphone.
    cx, cy, R = 152, 372, 36
    epais = 6.8 * K                                            # demi-épaisseur de l'anneau
    z = HAUT + epais * 0.95
    centre = pt(cx, cy, z)
    o3.tore('anneau', R * K, epais, centre, blanc)
    if EMBLEME == 'chauffeur':
        # Volant : moyeu et trois branches (gauche, droite, bas), comme le pictogramme de l'app.
        o3.cylindre('moyeu', 9 * K, epais * 1.6, pt(cx, cy + 4, HAUT + epais * 0.8), blanc, arrondi=0.01)
        for X, Y in ((cx - R + 4, cy - 5), (cx + R - 4, cy - 5), (cx, cy + R - 4)):
            o3.tube('branche-volant', [pt(cx, cy + 4, z), pt(X, Y, z)], epais * 0.72, blanc)
    else:
        # Cadran de supervision : graduations, aiguille vers le haut à droite, moyeu.
        for a in (200, 245, 290, 335, 20):
            r = math.radians(a)
            o3.sphere('graduation', 3.0 * K, pt(cx + math.cos(r) * (R - 12), cy - math.sin(r) * (R - 12), HAUT + 3.0 * K), blanc)
        o3.tube('aiguille', [pt(cx, cy, z), pt(cx + 19, cy - 17, z)], epais * 0.6, blanc)
        o3.sphere('moyeu', 7 * K, pt(cx, cy, HAUT + 5.5 * K), blanc)

# Cadre : les 108 dp de l'icône adaptative (3 unités), vus d'aplomb.
bpy.ops.mesh.primitive_plane_add(size=3.0, location=(0, 0, HAUT)); cadre = bpy.context.object; cadre.hide_render = True
o3.cadrer(scene, cam, azimut=90, elevation=89.9, marge=0.0, objets=[cadre], ortho=True)
o3.rendre(scene, os.path.join(SORTIE, 'icone-app.png'))
print('icone-app : ok', EMBLEME)
