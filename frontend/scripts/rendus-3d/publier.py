"""
Met les rendus à la taille de l'application et les enregistre en WebP (avec transparence).

Usage : python publier.py <dossier-des-png> <frontend/public/rendus>
Dépendance : Pillow.

Couleurs avivées (facultatif) : ORION_VIVACITE=1.5 renforce la saturation des couleurs du rendu
sans changer leur teinte (le kraft reste kraft, en plus franc ; le blanc et le noir, sans couleur,
ne bougent pas) et ORION_CONTRASTE=1.06 creuse légèrement le contraste. C'est ainsi que sont
produits les objets de rendus/vif/ à partir des rendus de la palette urbaine.
"""
import os, sys
from PIL import Image, ImageChops, ImageEnhance

VIVACITE = float(os.environ.get('ORION_VIVACITE', '1'))
CONTRASTE = float(os.environ.get('ORION_CONTRASTE', '1'))

SOURCE, CIBLE = sys.argv[1:3]
os.makedirs(CIBLE, exist_ok=True)
total = 0
for fichier in sorted(os.listdir(SOURCE)):
    if not fichier.endswith('.png') or fichier == 'planche.png': continue
    im = Image.open(os.path.join(SOURCE, fichier)).convert('RGBA')
    if VIVACITE != 1 or CONTRASTE != 1:
        # Les couleurs seules sont retouchées ; la transparence (détourage, ombre) est conservée telle quelle.
        alpha = im.getchannel('A'); couleurs = im.convert('RGB')
        if VIVACITE != 1: couleurs = ImageEnhance.Color(couleurs).enhance(VIVACITE)
        if CONTRASTE != 1: couleurs = ImageEnhance.Contrast(couleurs).enhance(CONTRASTE)
        im = couleurs.convert('RGBA'); im.putalpha(alpha)
    l, h = im.size
    # Largeur utile : trois fois la taille affichée la plus grande (écrans très denses).
    # Icônes de liste (rendues à 360 px) : 168 px suffisent pour 48 px affichés sur écran très dense.
    largeur = 96 if 'dessus' in fichier else 640 if l > h * 1.3 else 480 if l != h else 168 if l <= 400 else 420
    im = im.resize((largeur, round(h * largeur / l)), Image.LANCZOS)
    if 'dessus' not in fichier:
        # L'ombre portée s'éteint avant le bord de l'image : aucune coupure nette dans la tuile.
        L, H = im.size; marge = max(4, round(min(L, H) * 0.07))
        rampe = Image.new('L', (L, H), 255); px = rampe.load()
        for y in range(H):
            for x in range(L):
                d = min(x, y, L - 1 - x, H - 1 - y)
                if d < marge: px[x, y] = round(255 * (d / marge) ** 1.5)
        im.putalpha(ImageChops.multiply(im.getchannel('A'), rampe))
    sortie = os.path.join(CIBLE, fichier[:-4] + '.webp')
    im.save(sortie, 'WEBP', quality=88, method=6)
    total += os.path.getsize(sortie)
    print(f'{fichier[:-4]:26s} {im.size[0]}×{im.size[1]}  {os.path.getsize(sortie) / 1000:.0f} ko')
print(f'total : {total / 1000:.0f} ko')
