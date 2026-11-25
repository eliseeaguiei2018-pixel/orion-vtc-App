#!/usr/bin/env python3
"""
SOURCES OUVERTES DES LIEUX D'ABIDJAN, à fusionner ensuite avec `enrichir-lieux.py`.

  1. OpenStreetMap complet (export du Humanitarian OpenStreetMap Team pour la Côte
     d'Ivoire, hébergé pour data.humdata.org) — huit fichiers GeoJSON zippés. ODbL.
  2. Bâtiments nommés et voies nommées d'OpenStreetMap (même export, GeoParquet).
  3. Lieux d'Overture Maps (Meta, Microsoft… — CDLA-Permissive-2.0) du district.

Les étapes 2 et 3 demandent `pyarrow` (pip install pyarrow) : elles lisent à distance
les seules colonnes utiles, sans télécharger les fichiers entiers. Sans pyarrow, elles
sont sautées et l'enrichissement se fait avec l'étape 1.

Usage : telecharger-sources.py <dossier-sources> [version Overture, ex. 2026-11-18.0]
"""
import json, os, sys, time, urllib.request
from collections import defaultdict

if len(sys.argv) < 2: sys.exit('usage : telecharger-sources.py <dossier-sources> [version Overture]')
DOSSIER = sys.argv[1]; os.makedirs(DOSSIER, exist_ok=True)
OUEST, SUD, EST, NORD = -4.32, 5.20, -3.70, 5.62
HOT = 'https://production-raw-data-api.s3.amazonaws.com/ISO3/CIV'

# ---------------------------------------------------------------- 1. export HOT (GeoJSON)
for theme in ('points_of_interest', 'financial_services', 'health_facilities', 'education_facilities',
              'cultural_places', 'populated_places', 'airports', 'sea_ports'):
    cible = os.path.join(DOSSIER, f'{theme}.zip')
    if os.path.exists(cible) and os.path.getsize(cible) > 1000: print(f'déjà là : {theme}.zip'); continue
    for essai in range(4):
        try:
            urllib.request.urlretrieve(f'{HOT}/{theme}/hotosm_civ_{theme}_osm_geojson.zip', cible)
            print(f'{theme}.zip : {os.path.getsize(cible) / 1e6:.1f} Mo'); break
        except Exception as e:
            if essai == 3: print(f'ÉCHEC {theme} : {e}')
            time.sleep(2 ** essai)

try:
    import pyarrow.compute as pc, pyarrow.dataset as ds, pyarrow.fs as pfs, pyarrow.parquet as pq
except ImportError:
    sys.exit('pyarrow absent : bâtiments, voies et Overture Maps sautés (pip install pyarrow pour les ajouter).')

proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
dedans = lambda x, y: OUEST <= x <= EST and SUD <= y <= NORD

# ---------------------------------------------------------------- 2. bâtiments et voies nommés
est = pfs.S3FileSystem(anonymous=True, region='us-east-1', proxy_options=proxy)
def lignes_nommees(fichier, colonnes):
    f = pq.ParquetFile(est.open_input_file(f'production-raw-data-api/ISO3/CIV/_layers/osm/{fichier}'))
    for g in range(f.metadata.num_row_groups):
        t = f.read_row_group(g, columns=colonnes)
        for r in t.filter(pc.is_valid(t['name'])).to_pylist():
            nom = (r.get('name') or '').strip(); b = r.get('bbox')
            if not nom or not b: continue
            x, y = (b['xmin'] + b['xmax']) / 2, (b['ymin'] + b['ymax']) / 2
            if dedans(x, y): yield nom, x, y, r

batiments = [{'nom': nom, 'lon': round(x, 6), 'lat': round(y, 6), 'building': r.get('building'), 'office': r.get('office')}
             for nom, x, y, r in lignes_nommees('buildings.parquet', ['name', 'building', 'office', 'bbox'])]
json.dump(batiments, open(os.path.join(DOSSIER, 'batiments-nommes.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f'bâtiments nommés : {len(batiments)}')

segments = defaultdict(list)      # deux rues du même nom à plus de ~1,5 km sont deux rues
for nom, x, y, r in lignes_nommees('roads.parquet', ['name', 'highway', 'bbox']):
    segments[(nom, round(x / 0.015), round(y / 0.015))].append((x, y, r.get('highway')))
voies = []
for (nom, _, _), pts in segments.items():
    cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    x, y, hw = min(pts, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    voies.append({'nom': nom, 'lon': round(x, 6), 'lat': round(y, 6), 'highway': hw})
json.dump(voies, open(os.path.join(DOSSIER, 'voies-nommees.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f'voies nommées : {len(voies)}')

# ---------------------------------------------------------------- 3. Overture Maps
ouest = pfs.S3FileSystem(anonymous=True, region='us-west-2', proxy_options=proxy)
if len(sys.argv) > 2: version = sys.argv[2]
else:
    versions = sorted(i.base_name for i in ouest.get_file_info(pfs.FileSelector('overturemaps-us-west-2/release/')))
    version = versions[-1]
print(f'Overture Maps, version {version}')
d = ds.dataset(f'overturemaps-us-west-2/release/{version}/theme=places/type=place/', filesystem=ouest, format='parquet')
bx, by = pc.field('bbox', 'xmin'), pc.field('bbox', 'ymin')
filtre = (bx >= OUEST) & (bx <= EST) & (by >= SUD) & (by <= NORD)
colonnes = [c for c in ('names', 'confidence', 'addresses', 'bbox', 'operating_status', 'basic_category') if c in d.schema.names]
lieux = []
for r in d.to_table(filter=filtre, columns=colonnes).to_pylist():
    adresse = (r.get('addresses') or [None])[0] or {}
    lieux.append({
        'nom': (r.get('names') or {}).get('primary'), 'conf': r.get('confidence'), 'lon': r['bbox']['xmin'], 'lat': r['bbox']['ymin'],
        'adresse': adresse.get('freeform'), 'statut': r.get('operating_status'), 'basic': r.get('basic_category'),
    })
json.dump(lieux, open(os.path.join(DOSSIER, 'overture-places.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f'Overture Maps : {len(lieux)} lieux dans le district')
