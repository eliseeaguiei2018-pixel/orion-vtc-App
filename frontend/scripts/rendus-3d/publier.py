"""
Met les rendus à la taille de l'application et les enregistre en WebP (avec transparence).

Usage : python publier.py <dossier-des-png> <frontend/public/rendus>
Dépendance : Pillow.
"""
import os, sys
from PIL import Image, ImageChops

SOURCE, CIBLE = sys.argv[1:3]
os.makedirs(CIBLE, exist_ok=True)
total = 0
for fichier in sorted(os.listdir(SOURCE)):
    if not fichier.endswith('.png') or fichier == 'planche.png': continue
    im = Image.open(os.path.join(SOURCE, fichier)).convert('RGBA')
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
