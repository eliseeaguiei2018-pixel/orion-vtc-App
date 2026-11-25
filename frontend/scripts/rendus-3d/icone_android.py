"""
Décline l'icône rendue (icone-app.png, 864 px) pour Android et pour l'application.

Usage : python icone_android.py <dossier-du-rendu> <android/app/src/main/res> <public>
Dépendance : Pillow.

- Icône adaptative (Android 8 et plus) : l'image entière sert de fond, 108 dp ; Android la
  découpe à la forme du téléphone. Le premier plan est vide.
- Anciennes icônes (carrée arrondie et ronde) : les 72 dp du centre, déjà découpés.
- `public/rendus/icone-app.webp` : le logo affiché dans l'application.
"""
import os, sys
from PIL import Image, ImageDraw

SOURCE, RES, PUBLIC = sys.argv[1:4]
art = Image.open(os.path.join(SOURCE, 'icone-app.png')).convert('RGB')
L = art.width; bord = round(L / 6)
visible = art.crop((bord, bord, L - bord, L - bord))            # les 72 dp du centre

def masque(cote, forme):
    grand = cote * 4                                              # dessiné 4× puis réduit : bord lisse
    m = Image.new('L', (grand, grand), 0); d = ImageDraw.Draw(m)
    if forme == 'rond': d.ellipse((0, 0, grand - 1, grand - 1), fill=255)
    else: d.rounded_rectangle((0, 0, grand - 1, grand - 1), radius=round(grand * 0.22), fill=255)
    return m.resize((cote, cote), Image.LANCZOS)

DENSITES = {'ldpi': 0.75, 'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for nom, k in DENSITES.items():
    dossier = os.path.join(RES, f'mipmap-{nom}'); os.makedirs(dossier, exist_ok=True)
    adaptatif = round(108 * k); ancien = round(48 * k)
    art.resize((adaptatif, adaptatif), Image.LANCZOS).save(os.path.join(dossier, 'ic_launcher_background.png'), optimize=True)
    Image.new('RGBA', (adaptatif, adaptatif), (0, 0, 0, 0)).save(os.path.join(dossier, 'ic_launcher_foreground.png'), optimize=True)
    petit = visible.resize((ancien, ancien), Image.LANCZOS).convert('RGBA')
    for fichier, forme in (('ic_launcher.png', 'carre'), ('ic_launcher_round.png', 'rond')):
        im = petit.copy(); im.putalpha(masque(ancien, forme)); im.save(os.path.join(dossier, fichier), optimize=True)

XML = '''<?xml version="1.0" encoding="utf-8"?>
<!-- Icône en volume : l'image couvre les 108 dp, Android la découpe à la forme du téléphone. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'''
for fichier in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    open(os.path.join(RES, 'mipmap-anydpi-v26', fichier), 'w', encoding='utf-8').write(XML)

# Logo dans l'application : carré arrondi, 256 px.
logo = visible.resize((256, 256), Image.LANCZOS).convert('RGBA'); logo.putalpha(masque(256, 'carre'))
os.makedirs(os.path.join(PUBLIC, 'rendus'), exist_ok=True)
logo.save(os.path.join(PUBLIC, 'rendus', 'icone-app.webp'), 'WEBP', quality=92, method=6)
print('icônes Android :', ', '.join(DENSITES), '— logo :', os.path.getsize(os.path.join(PUBLIC, 'rendus', 'icone-app.webp')) // 1000, 'ko')
