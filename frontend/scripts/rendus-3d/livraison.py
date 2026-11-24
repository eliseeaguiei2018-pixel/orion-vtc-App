"""
Rendus 3D du volet LIVRAISON de l'app cliente (version 2.6) : bleu ORION saturé et gris translucide.

Usage : ORION_PALETTE=urbain python livraison.py <dossier-sortie> [nom …]
Puis :  python publier.py <dossier-sortie> ../../public/rendus/livraison

Le studio « urbain » (reflets doux, réponse photographique) est repris ; les couleurs sont
imposées ici : une laque bleue profonde, des blancs nacrés, des gris en verre dépoli.
"""
import math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import orion3d as o3

SORTIE = sys.argv[1]; os.makedirs(SORTIE, exist_ok=True)
M = o3.matiere
RENDUS = {}
def rendu(nom, largeur=600, hauteur=600, azimut=35, elevation=20, marge=0.06):
    def decor(f): RENDUS[nom] = (f, largeur, hauteur, azimut, elevation, marge); return f
    return decor

# ------------------------------------------------------------------ matières
def laque_bleue(): return M('laque bleue', o3.hexa('#0A5BFF'), rugosite=0.20, metal=0.15, vernis=1.0, urbain='#0A5BFF')
def bleu_profond(): return M('bleu profond', o3.hexa('#0434B8'), rugosite=0.34, vernis=0.5, urbain='#0434B8')
def bleu_ciel(): return M('bleu ciel', o3.hexa('#4C93FF'), rugosite=0.30, vernis=0.6, urbain='#4C93FF')
def nacre(): return M('blanc nacré', o3.hexa('#F2F4F8'), rugosite=0.22, vernis=1.0, urbain='#F2F4F8')
def graphite(): return M('graphite', o3.hexa('#2A2E36'), rugosite=0.45, vernis=0.3, urbain='#2A2E36')
def gris_doux(): return M('gris doux', o3.hexa('#B9C0CC'), rugosite=0.5, urbain='#B9C0CC')
def verre_gris(): return M('verre dépoli', o3.hexa('#C9D2DE'), verre=True, rugosite=0.25, urbain='#C9D2DE')
def chrome(): return M('chrome', (0.80, 0.82, 0.86), rugosite=0.16, metal=1.0)
def carton_bleu(): return M('carton bleu', o3.hexa('#0F62FF'), rugosite=0.62, grain=0.25, urbain='#0F62FF')
def adhesif(): return M('adhésif translucide', o3.hexa('#DCE6F5'), verre=True, rugosite=0.3, urbain='#DCE6F5')


# ------------------------------------------------------------------ véhicules
@rendu('liv-moto', 640, 560, azimut=42, elevation=13)
def moto():
    """Scooter électrique bleu, coffre bleu profond à couvercle nacré : la formule moto."""
    o3.scooter(caisse=laque_bleue(), accent=nacre(), coffre=bleu_profond(),
               selle=M('selle', o3.hexa('#1B1D22'), rugosite=0.6, satin=0.3, grain=0.15, urbain='#1B1D22'), couvercle=nacre())


@rendu('liv-voiture', 760, 440, azimut=58, elevation=12)
def voiture():
    """Berline bleue et ses colis posés à l'arrière : la formule voiture (colis volumineux)."""
    o3.voiture('berline', laque_bleue())
    _pile_colis(-2.05, -1.62, echelle=1.0)


def _pile_colis(x, y, echelle=1.0):
    e = echelle
    o3.boite('grand colis', (0.62 * e, 0.52 * e, 0.46 * e), (x, y, 0.23 * e), carton_bleu(), rayon=0.02)
    o3.boite('ruban', (0.625 * e, 0.10 * e, 0.465 * e), (x, y, 0.23 * e), adhesif(), rayon=0.006)
    o3.boite('étiquette', (0.20 * e, 0.010, 0.14 * e), (x + 0.14 * e, y - 0.262 * e, 0.26 * e), nacre(), rayon=0.008)
    o3.boite('petit colis', (0.40 * e, 0.34 * e, 0.28 * e), (x + 0.03, y + 0.02, 0.60 * e), bleu_ciel(), rayon=0.02, rot=(0, 0, 0.32))
    o3.boite('ruban', (0.405 * e, 0.07 * e, 0.285 * e), (x + 0.03, y + 0.02, 0.60 * e), adhesif(), rayon=0.005, rot=(0, 0, 0.32))


# ------------------------------------------------------------------ objets
@rendu('liv-colis', azimut=120, elevation=24)
def colis():
    """Le colis ORION : carton bleu, adhésif translucide, étiquette nacrée."""
    o3.boite('colis', (0.90, 0.70, 0.56), (0, 0, 0.28), carton_bleu(), rayon=0.02)
    o3.boite('ruban', (0.905, 0.14, 0.565), (0, 0, 0.28), adhesif(), rayon=0.008)
    o3.boite('étiquette', (0.30, 0.012, 0.20), (0.24, -0.352, 0.30), nacre(), rayon=0.01)
    for k in range(3):
        o3.boite('ligne', (0.22 - k * 0.05, 0.004, 0.018), (0.22 - k * 0.025, -0.36, 0.35 - k * 0.05), graphite(), rayon=0)
    o3.boite('petit colis', (0.46, 0.38, 0.30), (0.08, 0.02, 0.71), bleu_ciel(), rayon=0.02, rot=(0, 0, 0.35))
    o3.boite('ruban', (0.47, 0.09, 0.305), (0.08, 0.02, 0.71), adhesif(), rayon=0.006, rot=(0, 0, 0.35))


@rendu('liv-isotherme', azimut=128, elevation=20)
def isotherme():
    """Sac isotherme : coque bleue matelassée, bande grise, poignée et liseré réfléchissant."""
    corps = M('sac', o3.hexa('#0B57F2'), rugosite=0.55, satin=0.4, grain=0.18, urbain='#0B57F2')
    o3.boite('sac', (0.70, 0.62, 0.62), (0, 0, 0.31), corps, rayon=0.10)
    o3.boite('rabat', (0.72, 0.64, 0.10), (0, 0, 0.64), bleu_profond(), rayon=0.05)
    o3.boite('fermeture', (0.705, 0.625, 0.025), (0, 0, 0.585), gris_doux(), rayon=0.012)
    o3.boite('réfléchissant', (0.705, 0.625, 0.045), (0, 0, 0.18), M('réfléchissant', o3.hexa('#E7ECF3'), rugosite=0.15, metal=0.6, urbain='#E7ECF3'), rayon=0.01)
    o3.boite('pastille', (0.20, 0.012, 0.20), (0.0, -0.316, 0.40), nacre(), rayon=0.04)
    o3.sphere('flocon', 0.045, (0.0, -0.326, 0.40), bleu_ciel(), echelle=(1, 0.3, 1))
    o3.tube('poignée', [(-0.20, 0, 0.69), (-0.16, 0, 0.84), (0.16, 0, 0.84), (0.20, 0, 0.69)], 0.028, graphite())


@rendu('liv-porte', 480, 600, azimut=212, elevation=12)
def porte():
    """Porte-à-porte : une porte d'appartement bleue, chambranle gris, poignée chromée, paillasson."""
    o3.boite('chambranle', (0.12, 1.06, 2.16), (0, 0, 1.08), gris_doux(), rayon=0.02)
    o3.boite('porte', (0.08, 0.90, 2.02), (-0.035, 0, 1.03), laque_bleue(), rayon=0.02)
    for z in (0.62, 1.42):
        o3.boite('panneau', (0.012, 0.66, 0.56), (-0.078, 0, z), bleu_profond(), rayon=0.01)
    o3.cylindre('rosace', 0.045, 0.02, (-0.085, -0.34, 1.02), chrome(), rot=(0, math.pi / 2, 0), arrondi=0.005)
    o3.tube('poignée', [(-0.09, -0.34, 1.02), (-0.16, -0.34, 1.02), (-0.16, -0.22, 1.02)], 0.016, chrome())
    o3.boite('numéro', (0.006, 0.16, 0.10), (-0.08, 0, 1.78), nacre(), rayon=0.01)
    o3.boite('paillasson', (0.60, 0.80, 0.025), (-0.42, 0, 0.0125), graphite(), rayon=0.01)
    o3.boite('colis', (0.32, 0.26, 0.22), (-0.44, 0.10, 0.135), carton_bleu(), rayon=0.012, rot=(0, 0, 0.25))
    o3.boite('ruban', (0.325, 0.05, 0.225), (-0.44, 0.10, 0.135), adhesif(), rayon=0.004, rot=(0, 0, 0.25))


@rendu('liv-entree', 560, 560, azimut=214, elevation=16)
def entree():
    """À l'entrée : façade grise, porte vitrée en verre dépoli, auvent bleu ; on rejoint le coursier dehors."""
    o3.boite('façade', (0.40, 2.40, 2.20), (0.2, 0, 1.10), gris_doux(), rayon=0.03)
    o3.boite('encadrement', (0.06, 1.12, 1.62), (-0.01, 0, 0.83), graphite(), rayon=0.02)
    o3.boite('porte vitrée', (0.03, 1.00, 1.52), (-0.04, 0, 0.80), verre_gris(), rayon=0.01)
    o3.boite('montant', (0.035, 0.03, 1.52), (-0.045, 0, 0.80), graphite(), rayon=0.005)
    o3.boite('auvent', (0.62, 1.40, 0.08), (-0.25, 0, 1.78), laque_bleue(), rayon=0.03, rot=(0, math.radians(-8), 0))
    o3.boite('marche', (0.50, 1.30, 0.08), (-0.25, 0, 0.04), nacre(), rayon=0.02)
    for y in (-0.82, 0.82):
        o3.boite('fenêtre', (0.03, 0.44, 0.56), (-0.005, y, 1.30), verre_gris(), rayon=0.02)
    o3.cylindre('plante', 0.15, 0.32, (-0.30, -0.80, 0.16), bleu_profond(), arrondi=0.03)
    o3.sphere('feuillage', 0.22, (-0.30, -0.80, 0.46), M('feuillage', o3.hexa('#5E8C6A'), rugosite=0.7, urbain='#5E8C6A'), echelle=(1, 1, 1.2))


if __name__ == '__main__':
    for nom in (sys.argv[2:] or list(RENDUS)):
        fabrique, largeur, hauteur, azimut, elevation, marge = RENDUS[nom]
        t0 = time.time()
        scene = o3.vider(); cam = o3.studio(scene, largeur, hauteur, echantillons=int(os.environ.get('ECHANTILLONS', 96)))
        fabrique()
        o3.cadrer(scene, cam, azimut, elevation, marge)
        o3.rendre(scene, os.path.join(SORTIE, f'{nom}.png'))
        print(f'{nom} : {time.time() - t0:.0f} s', flush=True)
