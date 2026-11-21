"""
ATELIER 3D D'ORION — objets et véhicules modélisés puis rendus avec Blender (Cycles).

Les pictogrammes de l'application ne sont pas des dessins : ce sont des objets en volume,
éclairés comme en studio, dans les trois teintes de la marque (vert, blanc, violet). Ce
module fournit le studio (lumières, caméra, sol qui ne garde que l'ombre) et les briques
de modélisation ; `rendre.py` compose chaque objet et lance les rendus.

Dépendance : le module Python `bpy` (pip install bpy), aucune interface graphique.
"""
import math
import bpy
import bmesh
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

# ------------------------------------------------------------------ teintes de la marque
def hexa(code):
    """Couleur écran (« #00A651 ») → valeurs linéaires attendues par le moteur de rendu."""
    c = [int(code.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)

VERT = hexa('#00A651')              # vert ORION, vif
VERT_CLAIR = hexa('#3DDC84')
VIOLET = hexa('#6A35F0')            # violet franc
VIOLET_CLAIR = hexa('#A98BFF')
BLANC = hexa('#F2F3F5')
NOIR = hexa('#17181C')
GRIS = hexa('#8B9099')


def vider():
    """Scène neuve : rien ne traîne d'un rendu au suivant."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def matiere(nom, couleur, rugosite=0.4, metal=0.0, vernis=0.0, emission=0.0, verre=False, satin=0.0):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*couleur, 1)
    p.inputs['Roughness'].default_value = rugosite
    p.inputs['Metallic'].default_value = metal
    p.inputs['Coat Weight'].default_value = vernis
    p.inputs['Coat Roughness'].default_value = 0.10
    if satin: p.inputs['Sheen Weight'].default_value = satin
    if emission:
        p.inputs['Emission Color'].default_value = (*couleur, 1)
        p.inputs['Emission Strength'].default_value = emission
    if verre:
        # Vitrage teinté : sombre et très réfléchissant, on ne voit pas l'habitacle.
        p.inputs['Roughness'].default_value = 0.07
        p.inputs['Specular IOR Level'].default_value = 0.32
    return m


def lisser(obj, angle=40):
    for poly in obj.data.polygons: poly.use_smooth = True
    try: obj.data.set_sharp_from_angle(angle=math.radians(angle))
    except AttributeError: pass
    return obj


def _fini(obj, mat, nom):
    obj.name = nom
    if mat: obj.data.materials.append(mat)
    return obj


def boite(nom, taille, pos, mat, rayon=0.05, rot=(0, 0, 0), segments=5):
    """Pavé aux arêtes arrondies."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos, rotation=rot)
    o = bpy.context.object
    o.scale = taille
    bpy.ops.object.transform_apply(scale=True)
    if rayon > 0:
        b = o.modifiers.new('arrondi', 'BEVEL')
        b.width = rayon; b.segments = segments; b.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=b.name)
    return _fini(lisser(o, 50), mat, nom)


def cylindre(nom, rayon, hauteur, pos, mat, rot=(0, 0, 0), arrondi=0.0, cotes=64, rayon_haut=None):
    if rayon_haut is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=rayon, depth=hauteur, vertices=cotes, location=pos, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=rayon, radius2=rayon_haut, depth=hauteur, vertices=cotes, location=pos, rotation=rot)
    o = bpy.context.object
    if arrondi > 0:
        b = o.modifiers.new('arrondi', 'BEVEL')
        b.width = arrondi; b.segments = 5; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(50)
        bpy.ops.object.modifier_apply(modifier=b.name)
    return _fini(lisser(o, 50), mat, nom)


def sphere(nom, rayon, pos, mat, echelle=(1, 1, 1), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rayon, segments=48, ring_count=24, location=pos, rotation=rot)
    o = bpy.context.object
    o.scale = echelle
    bpy.ops.object.transform_apply(scale=True)
    return _fini(lisser(o, 180), mat, nom)


def tore(nom, grand, petit, pos, mat, rot=(0, 0, 0), echelle=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=grand, minor_radius=petit, major_segments=72, minor_segments=24, location=pos, rotation=rot)
    o = bpy.context.object
    o.scale = echelle
    bpy.ops.object.transform_apply(scale=True)
    return _fini(lisser(o, 180), mat, nom)


def tube(nom, points, rayon, mat, ferme=False):
    """Tube lisse passant par des points (cadres, anses, arceaux)."""
    c = bpy.data.curves.new(nom, 'CURVE'); c.dimensions = '3D'
    c.bevel_depth = rayon; c.bevel_resolution = 6; c.resolution_u = 16; c.use_fill_caps = True
    s = c.splines.new('NURBS'); s.points.add(len(points) - 1)
    for p, xyz in zip(s.points, points): p.co = (*xyz, 1)
    s.use_endpoint_u = not ferme; s.use_cyclic_u = ferme; s.order_u = min(4, len(points))
    o = bpy.data.objects.new(nom, c); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o.select_set(False)
    return _fini(lisser(o, 180), mat, nom)


def maillage(nom, sommets, faces, mat, lissage=2, mats=None, faces_mat=None):
    """Maillage libre, adouci par subdivision. `faces_mat` : indice de matière par face."""
    m = bpy.data.meshes.new(nom); m.from_pydata(sommets, [], faces); m.update()
    o = bpy.data.objects.new(nom, m); bpy.context.collection.objects.link(o)
    for x in (mats or [mat]): m.materials.append(x)
    if faces_mat:
        for poly, i in zip(m.polygons, faces_mat): poly.material_index = i
    bm = bmesh.new(); bm.from_mesh(m); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(m); bm.free()
    if lissage:
        bpy.context.view_layer.objects.active = o
        s = o.modifiers.new('lisse', 'SUBSURF'); s.levels = lissage; s.render_levels = lissage
        bpy.ops.object.modifier_apply(modifier=s.name)
    return lisser(o, 180)


def percer(obj, outil):
    """Retire de `obj` le volume de `outil` (passages de roue, évidements)."""
    bpy.context.view_layer.objects.active = obj
    b = obj.modifiers.new('perce', 'BOOLEAN'); b.operation = 'DIFFERENCE'; b.object = outil; b.solver = 'EXACT'
    bpy.ops.object.modifier_apply(modifier=b.name)
    bpy.data.objects.remove(outil, do_unlink=True)
    return obj


def interp(x, cles):
    """Valeur lissée entre des points clés [(x, v), …] : profils de carrosserie."""
    if x <= cles[0][0]: return cles[0][1]
    for (x0, v0), (x1, v1) in zip(cles, cles[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0); t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return cles[-1][1]


# ------------------------------------------------------------------ studio
def studio(scene, largeur=640, hauteur=640, echantillons=96, ombre=True):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = echantillons
    scene.cycles.use_denoising = True
    try: scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except TypeError: pass
    scene.cycles.max_bounces = 6
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = largeur, hauteur
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    # Couleurs franches : pas d'adoucissement « cinéma » qui délaverait le vert et le violet.
    scene.view_settings.view_transform = 'Standard'
    try: scene.view_settings.look = 'Medium High Contrast'
    except TypeError: pass
    monde = bpy.data.worlds.new('studio'); monde.use_nodes = True; scene.world = monde
    fond = monde.node_tree.nodes['Background']
    fond.inputs['Color'].default_value = (1, 1, 1, 1); fond.inputs['Strength'].default_value = 0.34

    def boite_a_lumiere(nom, pos, taille, puissance, couleur=(1, 1, 1)):
        d = bpy.data.lights.new(nom, 'AREA'); d.shape = 'RECTANGLE'; d.size, d.size_y = taille
        d.energy = puissance; d.color = couleur
        o = bpy.data.objects.new(nom, d); scene.collection.objects.link(o); o.location = pos
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        return o
    # Trois boîtes à lumière : principale en haut à gauche, débouchage, liseré arrière.
    boite_a_lumiere('principale', (-3.0, -4.0, 9.0), (5, 5), 560)
    # Une seule lumière porte une ombre : sous l'objet, nette et courte. Les deux autres
    # éclairent sans salir le sol d'un voile gris.
    boite_a_lumiere('debouchage', (6.5, -4.0, 3.5), (5, 5), 190, (1.0, 0.98, 0.96)).data.use_shadow = False
    boite_a_lumiere('lisere', (1.5, 6.5, 5.5), (7, 3), 300).data.use_shadow = False
    # Le sol n'apparaît pas : il ne garde que l'ombre portée, douce, sous l'objet.
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    sol = bpy.context.object; sol.name = 'sol'; sol.is_shadow_catcher = True
    if not ombre: sol.hide_render = True      # repère de carte : l'ombre est posée par l'application
    cam = bpy.data.objects.new('camera', bpy.data.cameras.new('camera')); scene.collection.objects.link(cam)
    cam.data.lens = 90; scene.camera = cam
    return cam


def cadrer(scene, cam, azimut=35, elevation=20, marge=0.06, objets=None, ortho=False):
    """Place la caméra pour que l'objet remplisse le cadre, vu de trois quarts."""
    objets = objets or [o for o in scene.objects if o.type == 'MESH' and o.name != 'sol']
    bpy.context.view_layer.update()
    coins = [o.matrix_world @ Vector(c) for o in objets for c in o.bound_box]
    centre = sum(coins, Vector()) / len(coins)
    a, e = math.radians(azimut), math.radians(elevation)
    sens = Vector((math.cos(e) * math.cos(a), -math.cos(e) * math.sin(a), math.sin(e)))
    cam.rotation_euler = (-sens).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'; cam.location = centre + sens * 30
        if elevation > 85: cam.rotation_euler = (0, 0, -math.pi / 2)
        bpy.context.view_layer.update()
        for _ in range(40):
            pts = [world_to_camera_view(scene, cam, c) for c in coins]
            etendue = max(max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts))
            cam.data.ortho_scale *= etendue / (1 - 2 * marge)
            bpy.context.view_layer.update()
        pts = [world_to_camera_view(scene, cam, c) for c in coins]
    else:
        bas, haut = 1.0, 200.0
        for _ in range(40):
            d = (bas + haut) / 2
            cam.location = centre + sens * d
            bpy.context.view_layer.update()
            pts = [world_to_camera_view(scene, cam, c) for c in coins]
            if all(marge <= p.x <= 1 - marge and marge <= p.y <= 1 - marge for p in pts): haut = d
            else: bas = d
        cam.location = centre + sens * haut
        bpy.context.view_layer.update()
        pts = [world_to_camera_view(scene, cam, c) for c in coins]
    # Recentre l'objet dans le cadre (son milieu apparent n'est pas le milieu de sa boîte).
    dx = (max(p.x for p in pts) + min(p.x for p in pts)) / 2 - 0.5
    dy = (max(p.y for p in pts) + min(p.y for p in pts)) / 2 - 0.5
    cam.data.shift_x += dx; cam.data.shift_y += dy * scene.render.resolution_y / scene.render.resolution_x


def rendre(scene, chemin):
    scene.render.filepath = chemin
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ véhicules
def roue(pos, rayon=0.34, largeur=0.24, jante=None):
    x, y, z = pos
    pneu = matiere('pneu', (0.018, 0.018, 0.020), rugosite=0.85)
    metal = jante or matiere('jante', (0.78, 0.80, 0.83), rugosite=0.22, metal=1.0)
    sombre = matiere('fond de jante', (0.03, 0.03, 0.035), rugosite=0.5, metal=0.6)
    r = (math.pi / 2, 0, 0)
    cylindre('pneu', rayon, largeur, pos, pneu, rot=r, arrondi=largeur * 0.28)
    cote = 1 if y > 0 else -1
    face = y + cote * largeur / 2              # flanc extérieur du pneu
    cylindre('fond', rayon * 0.68, 0.012, (x, face + cote * 0.002, z), sombre, rot=r)
    tore('rebord', rayon * 0.66, 0.020, (x, face + cote * 0.004, z), metal, rot=r)
    for k in range(5):  # cinq branches
        a = k * 2 * math.pi / 5 + 0.3
        boite('branche', (rayon * 0.60, 0.022, 0.085), (x + math.cos(a) * rayon * 0.33, face + cote * 0.012, z + math.sin(a) * rayon * 0.33),
              metal, rayon=0.010, rot=(0, -a, 0), segments=3)
    cylindre('moyeu', rayon * 0.17, 0.035, (x, face + cote * 0.016, z), metal, rot=r, arrondi=0.010)


GABARITS = {
    # longueur, empattement, bas de caisse, ceinture, pavillon, largeur : en mètres.
    'berline': dict(L=4.75, emp=2.85, garde=0.20, roue=0.34,
        ceinture=[(-2.38, 0.84), (-1.95, 0.95), (-1.2, 0.99), (0.0, 0.97), (0.9, 0.93), (1.6, 0.87), (2.1, 0.81), (2.38, 0.73)],
        toit=[(-1.82, 0.0), (-1.18, 0.37), (-0.25, 0.43), (0.38, 0.40), (1.10, 0.0)],
        largeur=[(-2.38, 0.66), (-2.0, 0.86), (-1.0, 0.92), (0.8, 0.92), (1.9, 0.86), (2.38, 0.66)], pavillon=0.66,
        vitres=(-1.12, 0.52), montant=(-0.40, -0.30), pare_brise=(0.40, 1.02), lunette=(-1.74, -1.22)),
    'suv': dict(L=4.70, emp=2.80, garde=0.28, roue=0.38,
        ceinture=[(-2.35, 0.98), (-1.9, 1.07), (-1.0, 1.08), (0.2, 1.06), (0.95, 1.02), (1.6, 0.99), (2.1, 0.94), (2.35, 0.84)],
        toit=[(-2.20, 0.0), (-1.85, 0.52), (-0.3, 0.60), (0.40, 0.56), (1.05, 0.0)],
        largeur=[(-2.35, 0.74), (-2.0, 0.90), (-1.0, 0.95), (0.8, 0.95), (1.9, 0.90), (2.35, 0.72)], pavillon=0.72,
        vitres=(-1.72, 0.52), montant=(-0.46, -0.36), pare_brise=(0.42, 1.0), lunette=(-2.18, -1.90)),
    'limousine': dict(L=5.35, emp=3.30, garde=0.20, roue=0.35,
        ceinture=[(-2.68, 0.84), (-2.2, 0.95), (-1.3, 0.98), (0.2, 0.96), (1.2, 0.92), (1.9, 0.87), (2.4, 0.81), (2.68, 0.73)],
        toit=[(-2.05, 0.0), (-1.45, 0.44), (-0.2, 0.51), (0.6, 0.48), (1.35, 0.0)],
        largeur=[(-2.68, 0.68), (-2.3, 0.88), (-1.2, 0.94), (1.0, 0.94), (2.2, 0.88), (2.68, 0.68)], pavillon=0.68,
        vitres=(-1.38, 0.76), montant=(-0.30, -0.20), pare_brise=(0.64, 1.30), lunette=(-2.0, -1.48)),
}


def voiture(modele='berline', peinture=None, vitrage=None, jante=None):
    """Voiture complète, nez vers +X. La caisse est une surface tendue sur des couples."""
    g = GABARITS[modele]
    peinture = peinture or matiere('peinture', VERT, rugosite=0.24, metal=0.1, vernis=1.0)
    vitrage = vitrage or matiere('vitrage', hexa('#1B1436'), verre=True)
    demi = g['L'] / 2
    xs = sorted(set([-demi, -demi + 0.10, -demi + 0.30, demi - 0.30, demi - 0.10, demi]
                    + [round(-demi + 0.5 + i * (g['L'] - 1.0) / 22, 3) for i in range(23)]
                    + list(g['vitres']) + list(g['montant']) + list(g['pare_brise']) + list(g['lunette'])))
    xs = [-demi - 0.035] + xs + [demi + 0.035]

    def couple(x):
        xc = max(-demi, min(demi, x))
        zb = g['garde'] + 0.09 * max(0, (abs(xc) - demi + 0.55) / 0.55) ** 2
        zc = interp(xc, g['ceinture'])
        h = max(0.0, interp(xc, g['toit'])) if g['toit'][0][0] <= xc <= g['toit'][-1][0] else 0.0
        w = interp(xc, g['largeur']); wr = g['pavillon']
        b = min(1.0, h / 0.14); b = b * b * (3 - 2 * b)
        mix = lambda p, q: (p[0] + (q[0] - p[0]) * b, p[1] + (q[1] - p[1]) * b)
        bas = [(0, zb), (0.55 * w, zb), (0.90 * w, zb + 0.03), (w, zb + 0.16), (w, zb + 0.45 * (zc - zb)), (0.99 * w, zc - 0.10), (0.955 * w, zc - 0.01)]
        capot = [(0.88 * w, zc + 0.015), (0.70 * w, zc + 0.03), (0.45 * w, zc + 0.04), (0.20 * w, zc + 0.045), (0, zc + 0.05)]
        serre = [(0.93 * w + (wr - 0.93 * w) * 0.10, zc + 0.06 * h), (0.93 * w + (wr - 0.93 * w) * 0.85, zc + 0.80 * h),
                 (wr * 0.97, zc + 0.95 * h), (wr * 0.55, zc + h + 0.01), (0, zc + h + 0.03)]
        pts = bas + [mix(p, q) for p, q in zip(capot, serre)]
        if abs(x) > demi:  # bouclier : le couple se resserre pour arrondir le nez et la poupe
            milieu = (zb + zc) / 2
            pts = [(y * 0.80, milieu + (z - milieu) * 0.74) for y, z in pts]
        return pts

    sommets, n = [], None
    for x in xs:
        demi_couple = couple(x)
        tour = demi_couple + [(-y, z) for y, z in reversed(demi_couple[1:-1])]
        n = len(tour)
        sommets += [(x, y, z) for y, z in tour]
    faces, mats = [], []
    cote_vitre = {7, n - 8}          # entre la base et le haut de la vitre latérale
    dessus = {8, 9, 10, n - 9, n - 10, n - 11}
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]; xm = (x0 + x1) / 2
        for j in range(n):
            faces.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
            vitre = False
            if j in cote_vitre and g['vitres'][0] <= xm <= g['vitres'][1] and not (g['montant'][0] <= xm <= g['montant'][1]): vitre = True
            if j in dessus and (g['pare_brise'][0] <= xm <= g['pare_brise'][1] or g['lunette'][0] <= xm <= g['lunette'][1]): vitre = True
            mats.append(1 if vitre else 0)
    faces.append(tuple(range(n))); mats.append(0)
    faces.append(tuple(reversed(range((len(xs) - 1) * n, len(xs) * n)))); mats.append(0)
    caisse = maillage('caisse', sommets, faces, peinture, lissage=2, mats=[peinture, vitrage], faces_mat=mats)

    essieux = (-g['emp'] / 2, g['emp'] / 2)
    r = g['roue']
    for x in essieux:
        bpy.ops.mesh.primitive_cylinder_add(radius=r + 0.075, depth=3.0, vertices=64, location=(x, 0, r), rotation=(math.pi / 2, 0, 0))
        percer(caisse, bpy.context.object)
    sombre = matiere('dessous', (0.02, 0.02, 0.022), rugosite=0.9)
    boite('dessous', (g['L'] - 0.5, 1.42, 0.50), (0, 0, g['garde'] + 0.28), sombre, rayon=0.05)
    for x in essieux:
        for y in (-0.80, 0.80): roue((x, y, r), rayon=r, jante=jante)

    zc_av, zc_ar = interp(demi - 0.22, g['ceinture']), interp(-demi + 0.18, g['ceinture'])
    phare = matiere('phare', (1.0, 0.98, 0.92), emission=2.4, rugosite=0.1)
    feu = matiere('feu', (0.95, 0.03, 0.05), emission=1.6, rugosite=0.15)
    calandre = matiere('calandre', (0.02, 0.02, 0.025), rugosite=0.35, metal=0.4)
    for y in (-1, 1):
        sphere('phare', 0.2, (demi - 0.065, y * 0.46, interp(demi, g['ceinture']) - 0.115), phare, echelle=(0.55, 1.0, 0.27), rot=(0, 0, -y * 0.42))
        sphere('feu', 0.2, (-demi + 0.12, y * 0.58, zc_ar - 0.06), feu, echelle=(0.36, 1.0, 0.26), rot=(0, 0, y * 0.5))
        zc = interp(g['pare_brise'][1] - 0.18, g['ceinture'])
        boite('retro', (0.17, 0.13, 0.11), (g['pare_brise'][1] - 0.16, y * (interp(0.8, g['largeur']) + 0.035), zc + 0.075), peinture, rayon=0.04)
    boite('calandre', (0.10, 0.74, 0.13), (demi + 0.002, 0, g['garde'] + 0.20), calandre, rayon=0.045)
    boite('bandeau', (0.05, 1.10, 0.035), (-demi + 0.03, 0, zc_ar - 0.06), feu, rayon=0.012)
    return caisse


def scooter(caisse=None, accent=None, coffre=None):
    """Scooter électrique de livraison, nez vers +X, avec son coffre."""
    # Carrosserie verte, filets et couvercle blancs, coffre violet : les trois teintes d'ORION.
    caisse = caisse or matiere('carrosserie', VERT, rugosite=0.24, metal=0.1, vernis=1.0)
    accent = accent or matiere('accent', BLANC, rugosite=0.25, vernis=1.0)
    coffre = coffre or matiere('coffre', VIOLET, rugosite=0.32, vernis=0.6)
    blanc = matiere('blanc', BLANC, rugosite=0.25, vernis=1.0)
    sombre = matiere('sombre', (0.025, 0.025, 0.03), rugosite=0.55)
    selle = matiere('selle', (0.035, 0.035, 0.04), rugosite=0.7, satin=0.3)
    chrome = matiere('chrome', (0.80, 0.82, 0.85), rugosite=0.18, metal=1.0)
    r = 0.25
    for x in (-0.62, 0.66):
        cylindre('pneu', r, 0.13, (x, 0, r), matiere('pneu', (0.018, 0.018, 0.02), rugosite=0.85), rot=(math.pi / 2, 0, 0), arrondi=0.045)
        for y in (-1, 1):
            cylindre('jante', r * 0.60, 0.02, (x, y * 0.062, r), chrome, rot=(math.pi / 2, 0, 0), arrondi=0.006)
            cylindre('moyeu', r * 0.20, 0.05, (x, y * 0.07, r), sombre, rot=(math.pi / 2, 0, 0), arrondi=0.01)
    # Plancher, tablier avant, coque arrière.
    boite('plancher', (0.62, 0.36, 0.09), (0.05, 0, 0.30), sombre, rayon=0.035)
    boite('bas de caisse', (0.70, 0.30, 0.12), (0.02, 0, 0.22), caisse, rayon=0.05)
    boite('tablier', (0.13, 0.40, 0.66), (0.42, 0, 0.62), caisse, rayon=0.06, rot=(0, math.radians(-17), 0))
    boite('bandeau', (0.14, 0.14, 0.50), (0.445, 0, 0.64), accent, rayon=0.05, rot=(0, math.radians(-17), 0))
    sphere('coque', 0.5, (-0.50, 0, 0.56), caisse, echelle=(1.02, 0.44, 0.50))
    boite('flanc', (0.56, 0.455, 0.07), (-0.46, 0, 0.52), accent, rayon=0.03)
    boite('selle', (0.74, 0.30, 0.10), (-0.36, 0, 0.83), selle, rayon=0.045)
    # Garde-boue, fourche, guidon.
    sphere('garde-boue', 0.3, (0.66, 0, 0.36), caisse, echelle=(1.0, 0.36, 0.72))
    for y in (-0.085, 0.085):
        tube('fourche', [(0.66, y, r), (0.60, y, 0.62), (0.53, y * 0.6, 0.98)], 0.024, chrome)
    tube('colonne', [(0.56, 0, 0.80), (0.50, 0, 1.06)], 0.035, sombre)
    boite('tete', (0.20, 0.30, 0.16), (0.50, 0, 1.08), blanc, rayon=0.06)
    sphere('phare', 0.085, (0.60, 0, 1.07), matiere('phare', (1.0, 0.98, 0.92), emission=2.2, rugosite=0.1), echelle=(0.5, 1.15, 1.0))
    tube('guidon', [(0.47, -0.36, 1.13), (0.48, -0.16, 1.16), (0.48, 0.16, 1.16), (0.47, 0.36, 1.13)], 0.018, chrome)
    for y in (-1, 1):
        cylindre('poignee', 0.028, 0.13, (0.47, y * 0.33, 1.135), sombre, rot=(math.pi / 2, 0, 0), arrondi=0.008)
        tube('tige', [(0.48, y * 0.20, 1.17), (0.46, y * 0.27, 1.30)], 0.008, sombre)
        sphere('retro', 0.05, (0.455, y * 0.28, 1.33), sombre, echelle=(0.35, 1.0, 0.75))
    sphere('feu', 0.06, (-1.0, 0, 0.60), matiere('feu', (0.95, 0.03, 0.05), emission=1.6), echelle=(0.5, 1.6, 0.7))
    # Coffre de livraison : violet, couvercle blanc, pastille verte.
    boite('porte-bagages', (0.46, 0.34, 0.04), (-0.74, 0, 0.90), sombre, rayon=0.012)
    boite('coffre', (0.50, 0.50, 0.46), (-0.76, 0, 1.15), coffre, rayon=0.07)
    boite('couvercle', (0.52, 0.52, 0.07), (-0.76, 0, 1.40), blanc, rayon=0.03)
    for y in (-1, 1):
        cylindre('pastille', 0.10, 0.012, (-0.76, y * 0.252, 1.16), accent, rot=(math.pi / 2, 0, 0))
