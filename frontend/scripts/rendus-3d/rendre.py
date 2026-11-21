"""Rend les objets 3D de l'application. Usage : python rendre.py <dossier-sortie> [nom …]"""
import math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import orion3d as o3

SORTIE = sys.argv[1]; os.makedirs(SORTIE, exist_ok=True)
RENDUS = {}
def rendu(nom, largeur=600, hauteur=600, azimut=35, elevation=20, marge=0.06, ortho=False):
    def decor(f): RENDUS[nom] = (f, largeur, hauteur, azimut, elevation, marge, ortho); return f
    return decor

# ---------------------------------------------------------------- véhicules
def _peinture(nom, couleur, metal=0.6, rugosite=0.22): return o3.matiere(nom, couleur, rugosite=rugosite, metal=metal, vernis=1.0)
PEINTURES = {
    'orion': lambda: _peinture('vert ORION', o3.VERT, metal=0.1, rugosite=0.24),
    # L'accent choisi par le client (vert, bleu ou orange) habille la voiture ORION.
    'bleu': lambda: _peinture('bleu', o3.hexa('#1463FF'), metal=0.1, rugosite=0.24),
    'orange': lambda: _peinture('orange', o3.hexa('#FF6A00'), metal=0.1, rugosite=0.24),
    'argent': lambda: _peinture('argent', (0.62, 0.65, 0.69), metal=0.9, rugosite=0.26),
    'or': lambda: _peinture('or', (0.80, 0.58, 0.22), metal=0.9, rugosite=0.26),
    'diamant': lambda: _peinture('diamant', (0.92, 0.93, 0.97), metal=0.25, rugosite=0.16),
    'nuit': lambda: _peinture('nuit', (0.012, 0.012, 0.02), metal=0.7, rugosite=0.18),
    'perle': lambda: _peinture('perle', (0.88, 0.87, 0.84), metal=0.35, rugosite=0.2),
}
for modele in ('berline', 'suv'):
    for teinte in ('orion', 'argent', 'or', 'diamant'):
        rendu(f'{modele}-{teinte}', 760, 440, azimut=58, elevation=12)(lambda m=modele, t=teinte: o3.voiture(m, PEINTURES[t]()))
rendu('limousine-nuit', 760, 440, azimut=58, elevation=12)(lambda: o3.voiture('limousine', PEINTURES['nuit']()))
rendu('suv-perle', 760, 440, azimut=58, elevation=12)(lambda: o3.voiture('suv', PEINTURES['perle']()))
rendu('berline-perle', 760, 440, azimut=58, elevation=12)(lambda: o3.voiture('berline', PEINTURES['perle']()))
rendu('scooter', 640, 560, azimut=42, elevation=13)(lambda: o3.scooter())
rendu('voiture-dessus', 256, 512, azimut=90, elevation=89.9, marge=0.08, ortho=True)(lambda: o3.voiture('berline', PEINTURES['orion']()))
for teinte in ('bleu', 'orange'):
    rendu(f'berline-{teinte}', 760, 440, azimut=58, elevation=12)(lambda t=teinte: o3.voiture('berline', PEINTURES[t]()))
    rendu(f'voiture-dessus-{teinte}', 256, 512, azimut=90, elevation=89.9, marge=0.08, ortho=True)(lambda t=teinte: o3.voiture('berline', PEINTURES[t]()))
rendu('scooter-dessus', 256, 512, azimut=90, elevation=89.9, marge=0.10, ortho=True)(lambda: o3.scooter())


# ---------------------------------------------------------------- objets des services
M = o3.matiere
def _teintes():
    return dict(
        vert=M('vert', o3.VERT, rugosite=0.30, vernis=0.5), vert_clair=M('vert clair', o3.VERT_CLAIR, rugosite=0.35, vernis=0.3),
        violet=M('violet', o3.VIOLET, rugosite=0.30, vernis=0.5), violet_clair=M('violet clair', o3.VIOLET_CLAIR, rugosite=0.35, vernis=0.3),
        blanc=M('blanc', o3.BLANC, rugosite=0.32, vernis=0.4), noir=M('noir', o3.NOIR, rugosite=0.45),
        metal=M('métal', o3.hexa('#D9DCE1'), rugosite=0.16, metal=1.0), papier=M('papier', o3.hexa('#FAFAFA'), rugosite=0.65),
    )

def _sac(pos, corps, anse, taille=(0.62, 0.30, 0.74), pastille=None):
    x, y, z = pos; l, p_, h = taille
    o3.boite('sac', taille, (x, y, z + h / 2), corps, rayon=0.035)
    o3.boite('pli', (l * 1.01, p_ * 1.02, 0.10), (x, y, z + h - 0.05), corps, rayon=0.02)
    for s_ in (-1, 1):
        o3.tube('anse', [(x - l * 0.22, y + s_ * p_ * 0.42, z + h - 0.02), (x - l * 0.20, y + s_ * p_ * 0.40, z + h + 0.20),
                         (x + l * 0.20, y + s_ * p_ * 0.40, z + h + 0.20), (x + l * 0.22, y + s_ * p_ * 0.42, z + h - 0.02)], 0.018, anse)
    if pastille: o3.cylindre('pastille', l * 0.20, 0.012, (x, y - p_ / 2 - 0.002, z + h * 0.52), pastille, rot=(math.pi / 2, 0, 0))

@rendu('food', azimut=118, elevation=22)
def food():
    t = _teintes()
    pain = M('pain', o3.hexa('#E0A34A'), rugosite=0.55); viande = M('viande', o3.hexa('#4A2A1A'), rugosite=0.75)
    fromage = M('fromage', o3.hexa('#FFC531'), rugosite=0.4); tomate = M('tomate', o3.hexa('#E5372B'), rugosite=0.35)
    o3.cylindre('pain bas', 0.36, 0.14, (0.42, -0.30, 0.07), pain, arrondi=0.06)
    o3.cylindre('salade', 0.40, 0.035, (0.42, -0.30, 0.165), t['vert_clair'], arrondi=0.015, cotes=11)
    o3.cylindre('viande', 0.37, 0.10, (0.42, -0.30, 0.235), viande, arrondi=0.04)
    o3.boite('fromage', (0.62, 0.62, 0.022), (0.42, -0.30, 0.298), fromage, rayon=0.008, rot=(0, 0, 0.6))
    o3.cylindre('tomate', 0.33, 0.04, (0.42, -0.30, 0.33), tomate, arrondi=0.015)
    o3.cylindre('salade haute', 0.39, 0.03, (0.42, -0.30, 0.365), t['vert'], arrondi=0.012, cotes=9)
    o3.sphere('pain haut', 0.37, (0.42, -0.30, 0.38), pain, echelle=(1, 1, 0.62))
    for i in range(14):  # graines de sésame
        a, r = i * 2.4, 0.07 + (i % 4) * 0.055
        z = 0.38 + 0.229 * math.sqrt(max(0, 1 - (r / 0.37) ** 2))
        o3.sphere('sésame', 0.016, (0.42 + r * math.cos(a), -0.30 + r * math.sin(a), z), t['papier'], echelle=(1.5, 0.9, 0.5), rot=(0, 0, a))
    _sac((-0.22, 0.16, 0), t['violet'], t['blanc'], taille=(0.60, 0.34, 0.80), pastille=t['vert'])

@rendu('achat', azimut=112, elevation=20)
def achat():
    t = _teintes()
    _sac((-0.20, 0.14, 0), t['vert'], t['blanc'], taille=(0.60, 0.30, 0.76), pastille=t['blanc'])
    _sac((0.30, -0.16, 0), t['blanc'], t['violet'], taille=(0.48, 0.26, 0.56), pastille=t['violet'])
    o3.boite('étiquette', (0.20, 0.014, 0.28), (0.63, -0.34, 0.20), t['violet'], rayon=0.02, rot=(0.25, 0.3, 0.2))
    o3.cylindre('œillet', 0.022, 0.02, (0.645, -0.365, 0.30), t['blanc'], rot=(math.pi / 2 + 0.25, 0, 0.2))

@rendu('supermarche', azimut=115, elevation=26)
def supermarche():
    t = _teintes()
    panier = o3.boite('panier', (0.96, 0.62, 0.42), (0, 0, 0.21), t['vert'], rayon=0.07)
    bpy = o3.bpy
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.30)); c = bpy.context.object; c.scale = (0.88, 0.54, 0.44); bpy.ops.object.transform_apply(scale=True)
    o3.percer(panier, c)
    for y in (-0.31, 0.31):
        for k in range(7): o3.boite('fente', (0.05, 0.012, 0.20), (-0.36 + k * 0.12, y, 0.22), t['vert_clair'], rayon=0.004)
    o3.tube('anse', [(-0.40, -0.02, 0.40), (-0.36, -0.02, 0.74), (0.36, -0.02, 0.74), (0.40, -0.02, 0.40)], 0.022, t['blanc'])
    o3.boite('brique', (0.20, 0.20, 0.50), (-0.24, 0.10, 0.36), t['blanc'], rayon=0.02)
    o3.boite('bande', (0.205, 0.205, 0.14), (-0.24, 0.10, 0.34), t['violet'], rayon=0.01)
    o3.boite('toit de brique', (0.20, 0.03, 0.10), (-0.24, 0.10, 0.64), t['blanc'], rayon=0.012)
    o3.cylindre('bouteille', 0.085, 0.42, (0.10, 0.12, 0.34), t['violet_clair'], arrondi=0.03)
    o3.cylindre('goulot', 0.035, 0.14, (0.10, 0.12, 0.60), t['violet_clair'], arrondi=0.01)
    o3.cylindre('bouchon', 0.042, 0.04, (0.10, 0.12, 0.68), t['blanc'], arrondi=0.01)
    o3.sphere('pomme', 0.115, (0.30, -0.12, 0.42), M('pomme', o3.hexa('#7BD13C'), rugosite=0.3, vernis=0.5), echelle=(1, 1, 0.92))
    o3.sphere('orange', 0.105, (0.06, -0.14, 0.44), M('orange', o3.hexa('#FF9A1F'), rugosite=0.5))
    o3.cylindre('baguette', 0.05, 0.62, (-0.02, 0.02, 0.50), M('pain', o3.hexa('#DDA050'), rugosite=0.6), rot=(0.15, 0.5, 0.4), arrondi=0.045)

@rendu('colis', azimut=120, elevation=24)
def colis():
    t = _teintes()
    carton = M('carton', o3.hexa('#F1F2F4'), rugosite=0.6)
    o3.boite('colis', (0.90, 0.70, 0.56), (0, 0, 0.28), carton, rayon=0.02)
    o3.boite('ruban', (0.905, 0.14, 0.565), (0, 0, 0.28), t['violet'], rayon=0.008)
    o3.boite('étiquette', (0.30, 0.012, 0.20), (0.24, -0.352, 0.30), t['papier'], rayon=0.01)
    for k in range(3): o3.boite('ligne', (0.22 - k * 0.05, 0.004, 0.018), (0.22 - k * 0.025, -0.36, 0.35 - k * 0.05), t['noir'], rayon=0)
    o3.boite('petit colis', (0.46, 0.38, 0.30), (0.08, 0.02, 0.71), t['vert'], rayon=0.02, rot=(0, 0, 0.35))
    o3.boite('ruban', (0.47, 0.09, 0.305), (0.08, 0.02, 0.71), t['blanc'], rayon=0.006, rot=(0, 0, 0.35))

@rendu('abonnement', azimut=100, elevation=18)
def abonnement():
    t = _teintes()
    o3.boite('carte arrière', (0.98, 0.022, 0.62), (0.06, 0.12, 0.40), t['blanc'], rayon=0.045, rot=(-0.20, 0, -0.10))
    o3.boite('carte', (0.98, 0.024, 0.62), (-0.04, -0.06, 0.36), t['violet'], rayon=0.045, rot=(-0.20, 0, 0.12))
    o3.boite('puce', (0.15, 0.012, 0.11), (-0.30, -0.115, 0.42), M('or', o3.hexa('#F2C14E'), rugosite=0.2, metal=1.0), rayon=0.02, rot=(-0.20, 0, 0.12))
    for k in range(2): o3.boite('ligne', (0.46 - k * 0.14, 0.008, 0.03), (-0.10 - k * 0.07, -0.075, 0.23 - k * 0.07), t['violet_clair'], rayon=0.01, rot=(-0.20, 0, 0.12))
    # Médaille à couronne : ce que l'abonnement donne en plus.
    o3.cylindre('médaille', 0.20, 0.05, (0.40, -0.28, 0.20), t['vert'], rot=(math.pi / 2 - 0.25, 0, 0.3), arrondi=0.018)
    o3.tore('bord', 0.20, 0.016, (0.40, -0.28, 0.20), t['vert_clair'], rot=(math.pi / 2 - 0.25, 0, 0.3))
    for k, h in enumerate((0.07, 0.11, 0.07)):
        o3.cylindre('pointe', 0.03, h, (0.33 + k * 0.07, -0.318, 0.215 + h / 2 - 0.035), t['blanc'], rot=(-0.25, 0, 0), rayon_haut=0.004, cotes=20)
    o3.boite('socle', (0.20, 0.022, 0.035), (0.40, -0.318, 0.165), t['blanc'], rayon=0.008, rot=(-0.25, 0, 0))

@rendu('location', azimut=105, elevation=30)
def location():
    t = _teintes()
    o3.boite('télécommande', (0.42, 0.72, 0.13), (0, 0, 0.09), t['noir'], rayon=0.055, rot=(0, 0, 0.35))
    o3.boite('jonc', (0.43, 0.73, 0.03), (0, 0, 0.09), t['metal'], rayon=0.012, rot=(0, 0, 0.35))
    for k, m in enumerate((t['vert'], t['blanc'], t['violet'])):
        d = (k - 1) * 0.19
        o3.cylindre('bouton', 0.062, 0.03, (-math.sin(0.35) * d, math.cos(0.35) * d, 0.16), m, arrondi=0.01)
    o3.tore('anneau', 0.17, 0.014, (-0.17, 0.46, 0.06), t['metal'], rot=(0.25, 0.1, 0))
    o3.boite('porte-clés', (0.26, 0.40, 0.05), (-0.46, 0.50, 0.04), t['violet'], rayon=0.022, rot=(0, 0, -0.7))
    o3.cylindre('pastille', 0.07, 0.012, (-0.46, 0.50, 0.068), t['blanc'])

@rendu('mariage', azimut=110, elevation=24)
def mariage():
    t = _teintes()
    or_blanc = M('or blanc', o3.hexa('#F1EEE6'), rugosite=0.12, metal=1.0)
    o3.boite('écrin', (0.80, 0.66, 0.22), (0, 0, 0.11), t['violet'], rayon=0.05)
    o3.boite('coussin', (0.68, 0.54, 0.10), (0, 0, 0.24), t['blanc'], rayon=0.045)
    o3.boite('couvercle', (0.80, 0.05, 0.62), (0, 0.33, 0.50), t['violet'], rayon=0.022, rot=(-0.20, 0, 0))
    o3.boite('doublure', (0.68, 0.02, 0.50), (0, 0.300, 0.50), t['blanc'], rayon=0.02, rot=(-0.20, 0, 0))
    o3.tore('alliance', 0.15, 0.030, (-0.13, -0.02, 0.42), or_blanc, rot=(math.pi / 2 - 0.25, 0, 0.5))
    o3.tore('alliance', 0.13, 0.026, (0.15, -0.04, 0.40), or_blanc, rot=(math.pi / 2 - 0.2, 0, -0.5))
    bpy = o3.bpy
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.062, location=(0.15, -0.04, 0.575))
    gemme = bpy.context.object; gemme.scale = (1, 1, 0.8)
    gemme.data.materials.append(M('gemme', o3.VERT_CLAIR, rugosite=0.03, vernis=1.0, metal=0.2))
    o3.cylindre('griffe', 0.035, 0.05, (0.15, -0.04, 0.535), or_blanc, rayon_haut=0.055, cotes=6)

@rendu('mes-courses', azimut=108, elevation=34)
def mes_courses():
    t = _teintes()
    o3.boite('plan', (1.10, 0.86, 0.045), (0, 0, 0.025), t['blanc'], rayon=0.02)
    for k, (x, y, l, p_) in enumerate([(-0.30, 0.20, 0.34, 0.26), (0.20, 0.24, 0.42, 0.20), (-0.26, -0.18, 0.40, 0.30), (0.26, -0.12, 0.30, 0.34)]):
        o3.boite('îlot', (l, p_, 0.02), (x, y, 0.055), M('îlot', o3.hexa('#E4E6EA'), rugosite=0.6), rayon=0.012)
    o3.tube('itinéraire', [(-0.44, -0.34, 0.075), (-0.06, -0.36, 0.075), (-0.02, 0.02, 0.075), (0.02, 0.06, 0.075), (0.36, 0.06, 0.075)], 0.024, t['vert'])
    o3.cylindre('départ', 0.055, 0.03, (-0.44, -0.34, 0.08), t['blanc'], arrondi=0.008)
    o3.cylindre('cœur', 0.03, 0.035, (-0.44, -0.34, 0.082), t['vert'])
    o3.cylindre('pied', 0.012, 0.36, (0.36, 0.06, 0.25), t['metal'], rayon_haut=0.045, cotes=24)
    o3.sphere('repère', 0.17, (0.36, 0.06, 0.52), t['violet'])
    o3.sphere('cœur', 0.065, (0.36, -0.095, 0.545), t['blanc'], echelle=(1, 0.6, 1))

@rendu('aide', azimut=112, elevation=14)
def aide():
    t = _teintes()
    arc = [(0, -0.44 * math.cos(a), 0.56 + 0.44 * math.sin(a)) for a in [i * math.pi / 8 for i in range(9)]]
    o3.tube('arceau', arc, 0.036, t['blanc'])
    o3.tube('coussin', arc[2:7], 0.05, t['violet_clair'])
    for y in (-1, 1):
        o3.cylindre('coque', 0.21, 0.12, (0, y * 0.46, 0.40), t['blanc'], rot=(math.pi / 2, 0, 0), arrondi=0.045)
        o3.cylindre('mousse', 0.19, 0.08, (0, y * 0.38, 0.40), t['violet'], rot=(math.pi / 2, 0, 0), arrondi=0.035)
        o3.cylindre('médaillon', 0.09, 0.02, (0, y * 0.525, 0.40), t['vert'], rot=(math.pi / 2, 0, 0), arrondi=0.006)
    o3.tube('perche', [(0, -0.46, 0.30), (0.10, -0.44, 0.16), (0.34, -0.30, 0.12), (0.44, -0.12, 0.14)], 0.016, t['noir'])
    o3.sphere('micro', 0.05, (0.46, -0.09, 0.145), t['vert'], echelle=(1.4, 1, 1), rot=(0, 0, 1.0))

# ---------------------------------------------------------------- icônes de l'application
# Affichées petites (listes, boutons) : formes pleines, peu de détails, 360 px suffisent.
ICONE = dict(largeur=360, hauteur=360)
FACE = (math.pi / 2, 0, 0)          # un disque tourné vers l'appareil (l'avant d'un objet est en −y)

def _prisme(nom, contour, y0, y1, mat):
    """Contour (x, z) extrudé entre y0 et y1 : toits, boucliers, étoiles."""
    n = len(contour)
    sommets = [(x, y0, z) for x, z in contour] + [(x, y1, z) for x, z in contour]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return o3.lisser(o3.maillage(nom, sommets, faces, mat, lissage=0), 30)

def _adoucir(o, largeur=0.02):
    """Arêtes arrondies sur un maillage libre."""
    bpy = o3.bpy; bpy.context.view_layer.objects.active = o
    b = o.modifiers.new('arrondi', 'BEVEL'); b.width = largeur; b.segments = 4; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(30)
    bpy.ops.object.modifier_apply(modifier=b.name)
    return o3.lisser(o, 50)

def _etoile(cx, cz, r, y0, y1, mat):
    pts = [(cx + (r if k % 2 == 0 else r * 0.42) * math.sin(k * math.pi / 5), cz + (r if k % 2 == 0 else r * 0.42) * math.cos(k * math.pi / 5)) for k in range(10)]
    return _adoucir(_prisme('étoile', pts, y0, y1, mat), 0.008)

def _rouge(): return M('rouge', o3.hexa('#E5372B'), rugosite=0.26, vernis=0.7)

# ---- Packs d'abonnement : couronne d'argent, couronne d'or, diamant ----
def _couronne(metal, velours, gemme):
    o3.sphere('velours', 0.36, (0, 0, 0.20), velours, echelle=(1, 1, 0.75))
    o3.cylindre('bandeau', 0.40, 0.17, (0, 0, 0.10), metal, arrondi=0.03)
    for k in range(6):
        a = k * math.pi / 3 + math.pi / 6
        x, y = 0.36 * math.cos(a), 0.36 * math.sin(a)
        o3.cylindre('pointe', 0.11, 0.36, (x, y, 0.35), metal, rayon_haut=0.015, cotes=24)
        o3.sphere('perle', 0.055, (x, y, 0.555), metal)
        b = k * math.pi / 3
        o3.sphere('gemme', 0.05, (0.405 * math.cos(b), 0.405 * math.sin(b), 0.10), gemme)

@rendu('pack-argent', azimut=100, elevation=16, **ICONE)
def pack_argent():
    t = _teintes()
    _couronne(M('argent', o3.hexa('#DDE1E7'), rugosite=0.16, metal=1.0), t['vert'], t['violet'])

@rendu('pack-or', azimut=100, elevation=16, **ICONE)
def pack_or():
    t = _teintes()
    _couronne(M('or', o3.hexa('#F2C14E'), rugosite=0.18, metal=1.0), t['violet'], t['vert'])

@rendu('pack-diamant', azimut=100, elevation=12, **ICONE)
def pack_diamant():
    t = _teintes(); bpy = o3.bpy
    gemme = M('diamant', o3.hexa('#8F6BFF'), rugosite=0.05, vernis=1.0, metal=0.35)
    eclat = M('éclat', o3.hexa('#C9B8FF'), rugosite=0.04, vernis=1.0, metal=0.35)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.015, radius2=0.50, depth=0.56, location=(0, 0, 0.30), rotation=(0, 0, 0.2))
    bpy.context.object.data.materials.append(gemme)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.50, radius2=0.30, depth=0.18, location=(0, 0, 0.67), rotation=(0, 0, 0.2))
    bpy.context.object.data.materials.append(eclat)
    o3.cylindre('socle', 0.20, 0.04, (0, 0, 0.02), t['blanc'], arrondi=0.012)

# ---- Urgences ----
@rendu('samu', azimut=108, elevation=16, **ICONE)
def samu():
    # Croix blanche sur fond vert : le signe international des premiers secours (ISO 7010).
    t = _teintes()
    o3.boite('mallette', (0.92, 0.34, 0.66), (0, 0, 0.33), t['vert'], rayon=0.07)
    o3.boite('jonc', (0.93, 0.35, 0.03), (0, 0, 0.54), t['vert_clair'], rayon=0.01)
    o3.boite('croix h', (0.34, 0.03, 0.115), (0, -0.175, 0.28), t['blanc'], rayon=0.012)
    o3.boite('croix v', (0.115, 0.034, 0.34), (0, -0.177, 0.28), t['blanc'], rayon=0.012)
    o3.tube('poignée', [(-0.16, 0, 0.64), (-0.14, 0, 0.80), (0.14, 0, 0.80), (0.16, 0, 0.64)], 0.03, t['blanc'])
    for x in (-0.30, 0.30): o3.boite('fermoir', (0.10, 0.03, 0.08), (x, -0.175, 0.54), t['blanc'], rayon=0.012)

BOUCLIER = [(-0.40, 0.82), (-0.20, 0.86), (0, 0.95), (0.20, 0.86), (0.40, 0.82), (0.40, 0.48), (0.30, 0.24), (0, 0.04), (-0.30, 0.24), (-0.40, 0.48)]
def _bouclier(mat, bord):
    _adoucir(_prisme('bord', [(x * 1.12, (z - 0.5) * 1.10 + 0.5) for x, z in BOUCLIER], -0.04, 0.07, bord), 0.03)
    _adoucir(_prisme('bouclier', BOUCLIER, -0.09, 0.05, mat), 0.035)

@rendu('police', azimut=104, elevation=10, **ICONE)
def police():
    t = _teintes()
    _bouclier(t['violet'], t['blanc'])
    _etoile(0, 0.54, 0.23, -0.135, -0.08, t['blanc'])

@rendu('pompiers', azimut=110, elevation=14, **ICONE)
def pompiers():
    t = _teintes(); rouge = _rouge()
    o3.cylindre('base', 0.25, 0.05, (0, 0, 0.03), t['noir'], arrondi=0.015)
    o3.cylindre('corps', 0.24, 0.60, (0, 0, 0.34), rouge, arrondi=0.04)
    o3.sphere('épaule', 0.24, (0, 0, 0.62), rouge, echelle=(1, 1, 0.55))
    o3.cylindre('étiquette', 0.244, 0.20, (0, 0, 0.36), t['blanc'])
    o3.cylindre('col', 0.07, 0.10, (0, 0, 0.78), t['metal'])
    o3.boite('poignée', (0.34, 0.07, 0.05), (0.08, 0, 0.86), t['noir'], rayon=0.02)
    o3.boite('levier', (0.30, 0.06, 0.04), (0.10, 0, 0.94), t['noir'], rayon=0.015, rot=(0, -0.25, 0))
    o3.tube('flexible', [(-0.06, 0, 0.80), (-0.30, 0, 0.78), (-0.37, 0, 0.55), (-0.34, 0, 0.30)], 0.03, t['noir'])
    o3.cylindre('buse', 0.045, 0.10, (-0.34, 0, 0.26), t['noir'], rayon_haut=0.03)

# ---- Paramètres et compte ----
@rendu('reglages', azimut=102, elevation=10, **ICONE)
def reglages():
    t = _teintes()
    o3.cylindre('roue', 0.34, 0.16, (0, 0, 0.5), t['violet'], rot=FACE, arrondi=0.03)
    for k in range(8):
        a = k * math.pi / 4
        o3.boite('dent', (0.17, 0.16, 0.17), (0.40 * math.cos(a), 0, 0.5 + 0.40 * math.sin(a)), t['violet'], rayon=0.03, rot=(0, -a, 0))
    o3.cylindre('moyeu', 0.18, 0.20, (0, 0, 0.5), t['blanc'], rot=FACE, arrondi=0.03)
    o3.cylindre('axe', 0.075, 0.22, (0, 0, 0.5), t['violet'], rot=FACE, arrondi=0.02)

@rendu('assurance', azimut=104, elevation=10, **ICONE)
def assurance():
    t = _teintes()
    _bouclier(t['vert'], t['blanc'])
    o3.boite('croix h', (0.34, 0.05, 0.115), (0, -0.11, 0.54), t['blanc'], rayon=0.012)
    o3.boite('croix v', (0.115, 0.054, 0.34), (0, -0.112, 0.54), t['blanc'], rayon=0.012)

@rendu('historique', azimut=102, elevation=10, **ICONE)
def historique():
    t = _teintes()
    o3.cylindre('boîtier', 0.44, 0.16, (0, 0, 0.5), t['violet'], rot=FACE, arrondi=0.04)
    o3.cylindre('cadran', 0.36, 0.18, (0, 0, 0.5), t['blanc'], rot=FACE, arrondi=0.01)
    o3.boite('heures', (0.05, 0.03, 0.21), (0, -0.10, 0.595), t['noir'], rayon=0.012)
    o3.boite('minutes', (0.27, 0.03, 0.045), (0.115, -0.10, 0.5), t['vert'], rayon=0.012)
    o3.cylindre('axe', 0.045, 0.05, (0, -0.10, 0.5), t['vert'], rot=FACE)
    for k in range(4):
        a = k * math.pi / 2
        o3.cylindre('repère', 0.026, 0.02, (0.29 * math.cos(a), -0.095, 0.5 + 0.29 * math.sin(a)), t['violet_clair'], rot=FACE)

@rendu('alertes-sos', azimut=114, elevation=28, **ICONE)
def alertes_sos():
    t = _teintes(); rouge = _rouge()
    o3.boite('socle', (0.86, 0.86, 0.22), (0, 0, 0.11), t['blanc'], rayon=0.07)
    o3.cylindre('collerette', 0.34, 0.08, (0, 0, 0.25), t['violet'], arrondi=0.02)
    o3.cylindre('bouton', 0.27, 0.12, (0, 0, 0.33), rouge, arrondi=0.03)
    o3.sphere('dôme', 0.27, (0, 0, 0.38), rouge, echelle=(1, 1, 0.42))

@rendu('portefeuille', azimut=110, elevation=16, **ICONE)
def portefeuille():
    t = _teintes()
    o3.boite('billet', (0.62, 0.02, 0.36), (0.08, 0.03, 0.66), t['vert'], rayon=0.01, rot=(0, 0.12, 0))
    o3.boite('billet', (0.62, 0.02, 0.36), (-0.08, 0.06, 0.62), t['vert_clair'], rayon=0.01, rot=(0, -0.08, 0))
    o3.boite('portefeuille', (0.92, 0.20, 0.60), (0, 0, 0.30), t['violet'], rayon=0.07)
    o3.boite('rabat', (0.40, 0.06, 0.24), (0.30, -0.10, 0.32), t['violet_clair'], rayon=0.025)
    o3.cylindre('pression', 0.05, 0.03, (0.22, -0.14, 0.32), t['blanc'], rot=FACE, arrondi=0.008)

@rendu('cadenas', azimut=106, elevation=12, **ICONE)
def cadenas():
    t = _teintes()
    o3.tube('anse', [(-0.20, 0, 0.48), (-0.20, 0, 0.80), (-0.10, 0, 0.93), (0.10, 0, 0.93), (0.20, 0, 0.80), (0.20, 0, 0.48)], 0.05, t['metal'])
    o3.boite('corps', (0.72, 0.26, 0.54), (0, 0, 0.27), t['violet'], rayon=0.08)
    o3.cylindre('serrure', 0.07, 0.03, (0, -0.135, 0.33), t['blanc'], rot=FACE)
    o3.boite('fente', (0.05, 0.03, 0.15), (0, -0.135, 0.24), t['blanc'], rayon=0.01)

@rendu('document', azimut=104, elevation=12, **ICONE)
def document():
    t = _teintes(); gris = M('gris', o3.hexa('#C9CDD4'), rugosite=0.6)
    o3.boite('feuille arrière', (0.62, 0.02, 0.84), (0.08, 0.07, 0.50), t['violet_clair'], rayon=0.008, rot=(0, 0.08, 0))
    o3.boite('feuille', (0.64, 0.02, 0.86), (0, 0, 0.47), t['blanc'], rayon=0.008)
    for k in range(4):
        o3.boite('ligne', (0.42 - (k % 2) * 0.10, 0.012, 0.045), (-0.02 - (k % 2) * 0.05, -0.014, 0.76 - k * 0.12), t['violet'] if k == 0 else gris, rayon=0.005)
    o3.cylindre('sceau', 0.10, 0.03, (0.14, -0.02, 0.22), t['vert'], rot=FACE, arrondi=0.008)

@rendu('serveur', azimut=118, elevation=18, **ICONE)
def serveur():
    t = _teintes()
    for k in range(3):
        z = 0.13 + k * 0.26
        o3.boite('baie', (0.90, 0.54, 0.22), (0, 0, z), t['blanc'], rayon=0.04)
        o3.boite('façade', (0.50, 0.02, 0.07), (-0.14, -0.275, z), t['violet'] if k != 1 else t['violet_clair'], rayon=0.02)
        for j in range(2): o3.sphere('voyant', 0.032, (0.24 + j * 0.10, -0.275, z), t['vert'])

@rendu('telephone', azimut=112, elevation=14, **ICONE)
def telephone():
    t = _teintes()
    o3.boite('téléphone', (0.50, 0.07, 0.94), (0, 0, 0.47), t['noir'], rayon=0.03)
    o3.boite('écran', (0.44, 0.02, 0.86), (0, -0.03, 0.47), t['violet'], rayon=0.008)
    o3.cylindre('appel', 0.13, 0.02, (0, -0.045, 0.32), t['vert'], rot=FACE)
    o3.boite('ligne', (0.26, 0.012, 0.045), (0, -0.045, 0.72), t['blanc'], rayon=0.005)
    o3.boite('ligne', (0.18, 0.012, 0.035), (0, -0.045, 0.63), t['violet_clair'], rayon=0.005)

@rendu('message', azimut=104, elevation=12, **ICONE)
def message():
    t = _teintes()
    o3.boite('bulle', (0.94, 0.22, 0.62), (0, 0, 0.58), t['violet'], rayon=0.10)
    _adoucir(_prisme('queue', [(-0.30, 0.32), (-0.36, 0.06), (-0.04, 0.30)], -0.07, 0.07, t['violet']), 0.02)
    for k in range(3): o3.sphere('point', 0.065, (-0.22 + k * 0.22, -0.115, 0.58), t['blanc'], echelle=(1, 0.5, 1))

@rendu('wifi', azimut=110, elevation=16, **ICONE)
def wifi():
    t = _teintes()
    o3.boite('boîtier', (0.90, 0.46, 0.16), (0, 0, 0.09), t['blanc'], rayon=0.05)
    for k in range(3): o3.sphere('voyant', 0.032, (-0.30 + k * 0.10, -0.235, 0.09), t['violet'])
    for r in (0.20, 0.36):
        o3.tube('onde', [(r * math.sin(a), 0, 0.36 + r * math.cos(a)) for a in (-0.85, -0.42, 0, 0.42, 0.85)], 0.032, t['vert'])
    o3.sphere('source', 0.055, (0, 0, 0.36), t['vert'])

# ---- Lieux ----
def _repere(mat, coeur):
    o3.cylindre('pointe', 0.012, 0.52, (0, 0, 0.30), mat, rayon_haut=0.25, cotes=48)
    o3.sphere('tête', 0.30, (0, 0, 0.66), mat)
    o3.sphere('cœur', 0.12, (0, -0.235, 0.68), coeur, echelle=(1, 0.5, 1))

@rendu('lieu', azimut=100, elevation=14, **ICONE)
def lieu():
    # Repère vert : un lieu, un point de départ.
    t = _teintes(); _repere(t['vert'], t['blanc'])

@rendu('destination', azimut=100, elevation=14, **ICONE)
def destination():
    # Repère violet : là où l'on va.
    t = _teintes(); _repere(t['violet'], t['blanc'])

@rendu('domicile', azimut=118, elevation=18, **ICONE)
def domicile():
    t = _teintes()
    o3.boite('murs', (0.78, 0.62, 0.46), (0, 0, 0.23), t['blanc'], rayon=0.03)
    _adoucir(_prisme('toit', [(-0.50, 0.44), (0, 0.86), (0.50, 0.44)], -0.37, 0.37, t['vert']), 0.025)
    o3.boite('porte', (0.18, 0.03, 0.28), (-0.14, -0.315, 0.14), t['violet'], rayon=0.012)
    o3.boite('fenêtre', (0.17, 0.03, 0.15), (0.18, -0.315, 0.27), t['violet_clair'], rayon=0.012)
    o3.boite('cheminée', (0.11, 0.11, 0.26), (0.26, 0.10, 0.72), t['blanc'], rayon=0.015)

@rendu('bureau', azimut=110, elevation=16, **ICONE)
def bureau():
    t = _teintes()
    o3.tube('poignée', [(-0.17, 0, 0.58), (-0.15, 0, 0.77), (0.15, 0, 0.77), (0.17, 0, 0.58)], 0.03, t['noir'])
    o3.boite('mallette', (0.92, 0.28, 0.60), (0, 0, 0.30), t['violet'], rayon=0.07)
    o3.boite('bande', (0.93, 0.29, 0.05), (0, 0, 0.38), t['violet_clair'], rayon=0.012)
    o3.boite('fermoir', (0.14, 0.03, 0.12), (0, -0.145, 0.38), t['blanc'], rayon=0.012)

@rendu('banque', azimut=116, elevation=16, **ICONE)
def banque():
    t = _teintes()
    o3.boite('marche', (1.00, 0.56, 0.08), (0, 0, 0.04), t['blanc'], rayon=0.02)
    o3.boite('socle', (0.90, 0.48, 0.07), (0, 0, 0.115), t['blanc'], rayon=0.02)
    o3.boite('fond', (0.80, 0.20, 0.40), (0, 0.08, 0.35), t['violet'], rayon=0.01)
    for k in range(4): o3.cylindre('colonne', 0.058, 0.40, (-0.33 + k * 0.22, -0.14, 0.35), t['blanc'], arrondi=0.01, cotes=24)
    o3.boite('architrave', (0.92, 0.50, 0.08), (0, 0, 0.59), t['blanc'], rayon=0.02)
    _adoucir(_prisme('fronton', [(-0.50, 0.63), (0, 0.92), (0.50, 0.63)], -0.26, 0.26, t['vert']), 0.02)

@rendu('aeroport', azimut=52, elevation=34, **ICONE)
def aeroport():
    t = _teintes()
    o3.sphere('fuselage', 0.5, (0, 0, 0.45), t['blanc'], echelle=(1.10, 0.20, 0.20))
    for c in (-1, 1):
        o3.boite('aile', (0.24, 0.58, 0.035), (-0.02, c * 0.30, 0.43), t['vert'], rayon=0.015, rot=(0, 0, c * 0.38))
        o3.boite('empennage', (0.13, 0.24, 0.03), (-0.46, c * 0.13, 0.48), t['vert'], rayon=0.012, rot=(0, 0, c * 0.38))
        o3.cylindre('réacteur', 0.055, 0.18, (0.04, c * 0.28, 0.375), t['violet'], rot=(0, math.pi / 2, 0), arrondi=0.02)
    o3.boite('dérive', (0.22, 0.035, 0.26), (-0.44, 0, 0.60), t['vert'], rayon=0.015, rot=(0, 0.55, 0))
    o3.sphere('cockpit', 0.075, (0.42, 0, 0.50), t['violet'], echelle=(1.3, 1.1, 0.7))

@rendu('ecole', azimut=118, elevation=22, **ICONE)
def ecole():
    t = _teintes()
    o3.cylindre('calotte', 0.26, 0.22, (0, 0, 0.30), t['violet'], arrondi=0.04)
    o3.boite('plateau', (0.80, 0.80, 0.045), (0, 0, 0.45), t['violet'], rayon=0.015, rot=(0, 0, math.pi / 4))
    o3.cylindre('bouton', 0.04, 0.03, (0, 0, 0.485), t['blanc'])
    o3.tube('cordon', [(0, 0, 0.49), (0.20, -0.20, 0.49), (0.36, -0.36, 0.44), (0.37, -0.37, 0.24)], 0.014, t['vert'])
    o3.cylindre('pompon', 0.035, 0.12, (0.37, -0.37, 0.19), t['vert'], rayon_haut=0.02)

@rendu('eglise', azimut=120, elevation=16, **ICONE)
def eglise():
    t = _teintes()
    o3.boite('nef', (0.56, 0.70, 0.38), (0.12, 0.06, 0.19), t['blanc'], rayon=0.02)
    _adoucir(_prisme('toit', [(-0.20, 0.36), (0.12, 0.60), (0.44, 0.36)], -0.31, 0.43, t['vert']), 0.02)
    o3.boite('clocher', (0.26, 0.26, 0.66), (-0.26, -0.20, 0.33), t['blanc'], rayon=0.02)
    o3.cylindre('flèche', 0.19, 0.26, (-0.26, -0.20, 0.79), t['vert'], rayon_haut=0.0, cotes=4, rot=(0, 0, math.pi / 4))
    o3.boite('croix v', (0.035, 0.035, 0.20), (-0.26, -0.20, 1.00), t['violet'], rayon=0.008)
    o3.boite('croix h', (0.13, 0.035, 0.035), (-0.26, -0.20, 1.02), t['violet'], rayon=0.008)
    o3.boite('porte', (0.14, 0.02, 0.22), (-0.26, -0.335, 0.11), t['violet'], rayon=0.008)

@rendu('mosquee', azimut=120, elevation=16, **ICONE)
def mosquee():
    t = _teintes()
    o3.boite('salle', (0.66, 0.60, 0.36), (0.08, 0, 0.18), t['blanc'], rayon=0.02)
    o3.sphere('dôme', 0.26, (0.08, 0, 0.40), t['vert'])
    o3.cylindre('pointe', 0.02, 0.12, (0.08, 0, 0.71), t['violet'], rayon_haut=0.004)
    o3.cylindre('minaret', 0.075, 0.80, (-0.36, -0.14, 0.40), t['blanc'], arrondi=0.01, cotes=32)
    o3.cylindre('balcon', 0.11, 0.05, (-0.36, -0.14, 0.66), t['violet_clair'], arrondi=0.01)
    o3.cylindre('toit', 0.09, 0.20, (-0.36, -0.14, 0.90), t['vert'], rayon_haut=0.0, cotes=32)
    o3.boite('porte', (0.16, 0.02, 0.22), (0.08, -0.305, 0.11), t['violet'], rayon=0.008)

@rendu('hotel', azimut=122, elevation=24, **ICONE)
def hotel():
    t = _teintes()
    o3.boite('tête de lit', (0.90, 0.08, 0.56), (0, 0.38, 0.28), t['violet'], rayon=0.03)
    o3.boite('sommier', (0.90, 0.80, 0.16), (0, 0, 0.12), t['violet'], rayon=0.03)
    o3.boite('matelas', (0.86, 0.76, 0.12), (0, 0, 0.25), t['blanc'], rayon=0.04)
    o3.boite('couette', (0.88, 0.46, 0.13), (0, -0.16, 0.26), t['vert'], rayon=0.04)
    for x in (-0.20, 0.20): o3.boite('oreiller', (0.32, 0.20, 0.09), (x, 0.24, 0.34), t['blanc'], rayon=0.04)

@rendu('carburant', azimut=112, elevation=14, **ICONE)
def carburant():
    t = _teintes()
    o3.boite('socle', (0.66, 0.40, 0.08), (0, 0, 0.04), t['noir'], rayon=0.02)
    o3.boite('pompe', (0.50, 0.30, 0.82), (-0.04, 0, 0.49), t['vert'], rayon=0.05)
    o3.boite('écran', (0.34, 0.02, 0.22), (-0.04, -0.155, 0.66), t['blanc'], rayon=0.008)
    o3.boite('bandeau', (0.34, 0.02, 0.07), (-0.04, -0.155, 0.44), t['violet'], rayon=0.008)
    o3.tube('flexible', [(0.21, 0, 0.74), (0.40, 0, 0.72), (0.44, 0, 0.44), (0.36, -0.02, 0.26), (0.28, -0.06, 0.38)], 0.025, t['noir'])
    o3.boite('pistolet', (0.06, 0.06, 0.16), (0.27, -0.08, 0.44), t['violet'], rayon=0.015)

@rendu('bus', azimut=124, elevation=16, **ICONE)
def bus():
    t = _teintes()
    o3.boite('caisse', (1.04, 0.42, 0.50), (0, 0, 0.37), t['vert'], rayon=0.07)
    o3.boite('vitres', (0.90, 0.43, 0.17), (0.02, 0, 0.46), t['noir'], rayon=0.02)
    o3.boite('pare-brise', (0.03, 0.34, 0.20), (0.515, 0, 0.45), t['noir'], rayon=0.01)
    o3.boite('bande', (1.045, 0.425, 0.04), (0, 0, 0.30), t['blanc'], rayon=0.008)
    for x in (-0.32, 0.32):
        for y in (-0.20, 0.20): o3.cylindre('roue', 0.10, 0.07, (x, y, 0.10), t['noir'], rot=FACE, arrondi=0.02)

@rendu('loisirs', azimut=104, elevation=14, **ICONE)
def loisirs():
    t = _teintes()
    o3.boite('billet arrière', (0.84, 0.03, 0.44), (0.08, 0.09, 0.56), t['blanc'], rayon=0.012, rot=(0, 0.20, 0))
    o3.boite('billet', (0.84, 0.03, 0.44), (-0.02, -0.04, 0.42), t['violet'], rayon=0.012, rot=(0, -0.14, 0))
    _etoile(-0.16, 0.43, 0.13, -0.085, -0.05, t['blanc'])
    for k in range(4): o3.boite('pointillé', (0.025, 0.012, 0.05), (0.19, -0.058, 0.30 + k * 0.10), t['violet_clair'], rayon=0.004)

@rendu('immeuble', azimut=122, elevation=16, **ICONE)
def immeuble():
    t = _teintes()
    o3.boite('tour', (0.46, 0.42, 0.90), (-0.14, 0, 0.45), t['blanc'], rayon=0.02)
    o3.boite('aile', (0.36, 0.38, 0.52), (0.26, 0.02, 0.26), t['violet'], rayon=0.02)
    for i in range(4):
        for j in range(2): o3.boite('fenêtre', (0.12, 0.02, 0.10), (-0.24 + j * 0.20, -0.215, 0.20 + i * 0.18), t['violet'], rayon=0.006)
    for i in range(2):
        for j in range(2): o3.boite('fenêtre', (0.10, 0.02, 0.09), (0.175 + j * 0.17, -0.175, 0.18 + i * 0.18), t['blanc'], rayon=0.006)
    o3.boite('toit', (0.48, 0.44, 0.04), (-0.14, 0, 0.92), t['vert'], rayon=0.01)

@rendu('parc', azimut=110, elevation=14, **ICONE)
def parc():
    t = _teintes()
    o3.cylindre('herbe', 0.36, 0.03, (0, 0, 0.015), t['vert_clair'], arrondi=0.01)
    o3.cylindre('tronc', 0.07, 0.40, (0, 0, 0.20), M('tronc', o3.hexa('#8A5A3C'), rugosite=0.7), rayon_haut=0.05)
    o3.sphere('feuillage', 0.34, (0, 0, 0.64), t['vert'])
    o3.sphere('feuillage', 0.22, (-0.22, -0.06, 0.50), t['vert_clair'])
    o3.sphere('feuillage', 0.20, (0.22, 0.04, 0.52), t['vert'])


# ---- Outils de travail : app chauffeur, console, tableau de bord ----
def _or(): return M('or', (0.80, 0.58, 0.22), rugosite=0.26, metal=0.9)

@rendu('eco', azimut=108, elevation=14, **ICONE)
def eco():
    # Une batterie pleine : la mobilité électrique.
    t = _teintes()
    o3.boite('pile', (0.58, 0.30, 0.78), (0, 0, 0.39), t['vert'], rayon=0.08)
    o3.boite('socle', (0.60, 0.32, 0.16), (0, 0, 0.09), t['violet'], rayon=0.06)
    o3.boite('borne', (0.24, 0.16, 0.09), (0, 0, 0.82), t['metal'], rayon=0.02)
    _adoucir(_prisme('éclair', [(0.08, 0.72), (-0.15, 0.44), (-0.02, 0.44), (-0.08, 0.24), (0.15, 0.52), (0.02, 0.52)], -0.185, -0.145, t['blanc']), 0.008)

@rendu('chauffeur', azimut=104, elevation=10, **ICONE)
def chauffeur():
    # Un volant : les chauffeurs, la conduite.
    t = _teintes()
    o3.tore('jante', 0.40, 0.068, (0, 0, 0.5), t['violet'], rot=FACE)
    o3.boite('branche', (0.74, 0.07, 0.09), (0, 0, 0.5), t['violet_clair'], rayon=0.03)
    o3.boite('branche', (0.09, 0.07, 0.37), (0, 0, 0.30), t['violet_clair'], rayon=0.03)
    o3.cylindre('moyeu', 0.15, 0.12, (0, 0, 0.5), t['blanc'], rot=FACE, arrondi=0.03)
    o3.cylindre('feuille', 0.06, 0.14, (0, 0, 0.5), t['vert'], rot=FACE, arrondi=0.02)

def _personne(x, y, mat, k=1.0):
    o3.cylindre('corps', 0.25 * k, 0.42 * k, (x, y, 0.21 * k), mat, arrondi=0.13 * k)
    o3.sphere('tête', 0.165 * k, (x, y, 0.63 * k), mat)

@rendu('clients', azimut=104, elevation=14, **ICONE)
def clients():
    # Deux personnes : les clients, une équipe.
    t = _teintes()
    _personne(0.21, 0.16, t['violet'], 1.0)
    _personne(-0.19, -0.10, t['vert'], 0.92)

@rendu('finances', azimut=112, elevation=16, **ICONE)
def finances():
    # Trois colonnes qui montent et une pièce : les recettes.
    t = _teintes(); metal_or = _or()
    for x, h, mat in ((-0.30, 0.34, t['violet_clair']), (-0.04, 0.56, t['violet']), (0.22, 0.82, t['vert'])):
        o3.boite('colonne', (0.21, 0.21, h), (x, 0.04, h / 2), mat, rayon=0.035)
    o3.cylindre('pièce', 0.20, 0.055, (-0.30, -0.24, 0.20), metal_or, rot=FACE, arrondi=0.02)
    o3.cylindre('frappe', 0.13, 0.065, (-0.30, -0.24, 0.20), M('or pâle', (0.90, 0.72, 0.36), rugosite=0.3, metal=0.9), rot=FACE, arrondi=0.01)

@rendu('objectif', azimut=112, elevation=14, **ICONE)
def objectif():
    # Une cible et sa flèche au centre : les objectifs.
    t = _teintes()
    o3.cylindre('cible', 0.45, 0.08, (0, 0, 0.5), t['blanc'], rot=FACE, arrondi=0.03)
    o3.cylindre('anneau', 0.35, 0.10, (0, 0, 0.5), t['violet'], rot=FACE, arrondi=0.008)
    o3.cylindre('anneau', 0.24, 0.12, (0, 0, 0.5), t['blanc'], rot=FACE, arrondi=0.008)
    o3.cylindre('centre', 0.13, 0.14, (0, 0, 0.5), t['vert'], rot=FACE, arrondi=0.008)
    o3.tube('flèche', [(0, -0.07, 0.5), (0.13, -0.26, 0.60), (0.26, -0.46, 0.70)], 0.022, t['metal'])
    for dz in (-0.05, 0.05):
        o3.boite('empennage', (0.03, 0.14, 0.05), (0.27, -0.47, 0.70 + dz), t['violet'], rayon=0.01, rot=(0, 0, -0.55))

@rendu('carte', azimut=112, elevation=30, **ICONE)
def carte():
    # Une carte dépliée et son repère : la supervision, les zones.
    t = _teintes(); gris = M('gris carte', o3.hexa('#E4E6EA'), rugosite=0.6)
    o3.boite('dos', (1.00, 0.80, 0.03), (0, 0, 0.018), t['violet'], rayon=0.012)
    for k, x in enumerate((-0.31, 0, 0.31)):
        o3.boite('volet', (0.30, 0.72, 0.03), (x, 0, 0.06 + (0.035 if k != 1 else 0)), t['blanc'] if k != 1 else gris, rayon=0.01, rot=(0, 0.20 * (1 - k), 0))
    o3.boite('route', (0.86, 0.05, 0.012), (0, -0.12, 0.095), t['violet_clair'], rayon=0.005, rot=(0, 0, 0.28))
    o3.boite('route', (0.05, 0.60, 0.012), (-0.16, 0.02, 0.095), t['vert_clair'], rayon=0.005)
    o3.cylindre('pointe', 0.010, 0.34, (0.14, 0.06, 0.26), t['vert'], rayon_haut=0.16, cotes=48)
    o3.sphere('tête', 0.19, (0.14, 0.06, 0.50), t['vert'])
    o3.sphere('cœur', 0.075, (0.14, -0.09, 0.51), t['blanc'], echelle=(1, 0.5, 1))


if __name__ == '__main__':
    # Sans nom donné : tout, dans l'ordre de la liste. Avec des noms : ceux-là, dans l'ordre demandé.
    for nom in (sys.argv[2:] or list(RENDUS)):
        fabrique, largeur, hauteur, azimut, elevation, marge, ortho = RENDUS[nom]
        t0 = time.time()
        scene = o3.vider(); cam = o3.studio(scene, largeur, hauteur, echantillons=int(os.environ.get('ECHANTILLONS', 96)), ombre=not ortho)
        fabrique()
        o3.cadrer(scene, cam, azimut, elevation, marge, ortho=ortho)
        o3.rendre(scene, os.path.join(SORTIE, f'{nom}.png'))
        print(f'{nom} : {time.time() - t0:.0f} s', flush=True)
