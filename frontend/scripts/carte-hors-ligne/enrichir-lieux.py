#!/usr/bin/env python3
"""
ENRICHISSEMENT DE L'INDEX DES LIEUX D'ABIDJAN.

`indexer-lieux.mjs` lit les tuiles de la carte : elles ne portent qu'une partie des lieux
d'OpenStreetMap (les tuiles écartent les points de transfert d'argent, beaucoup de
commerces, les immeubles nommés…). Ce script ajoute tout ce qui manque, à partir de
sources OUVERTES uniquement :

  • l'export complet d'OpenStreetMap pour la Côte d'Ivoire (Humanitarian OpenStreetMap
    Team, sur data.humdata.org) : points d'intérêt, services financiers, santé,
    enseignement, lieux culturels, localités, aéroports, ports — licence ODbL ;
  • les bâtiments NOMMÉS et les voies NOMMÉES d'OpenStreetMap (même export, GeoParquet) ;
  • Overture Maps (lieux déclarés par Meta, Microsoft…, licence CDLA-Permissive-2.0),
    pour les entreprises, sièges et commerces absents d'OpenStreetMap.

Les données de Google Maps ne sont PAS utilisées : leurs conditions interdisent de les
copier dans une autre carte. Overture Maps remplit le même rôle, légalement.

Chaque lieu ajouté est dédoublonné contre l'index (même nom à moins de 150 m), rangé
dans une catégorie de la carte et rattaché à sa commune.

Usage : enrichir-lieux.py <index.json> <dossier-sources> <sortie.json>
"""
import json, math, os, re, sys, unicodedata, zipfile
from collections import Counter, defaultdict

if len(sys.argv) != 4:
    sys.exit('usage : enrichir-lieux.py <index.json> <dossier-sources> <sortie.json>')
INDEX, SOURCES, SORTIE = sys.argv[1:]
ICI = os.path.dirname(os.path.abspath(__file__))
OUEST, SUD, EST, NORD = -4.32, 5.20, -3.70, 5.62
CONFIANCE_OVERTURE = 0.5

# ---------------------------------------------------------------- outils
def norm(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'\s+', ' ', re.sub(r"[-'’.,()/]", ' ', s)).strip()

def dist_m(a, b):
    r = math.pi / 180
    d_lat = (b[0] - a[0]) * r; d_lng = (b[1] - a[1]) * r
    h = math.sin(d_lat / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(d_lng / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(h))

def dedans(lat, lng):
    return SUD <= lat <= NORD and OUEST <= lng <= EST

SIGLES = set('''SGBCI BICICI NSIA BNI SIB BOA UBA CIE SODECI CNPS CHU CHR MTN RTI SOTRA CNRA INPHB ENA UFR EPP EPV
CAFOP BCEAO BRVM ONG SARL SA SAS CI BACI BDU BGFI BSIC GTB ORANGE CEDEAO UEMOA CCIA CNDJ INJS ESATIC ISTC IPNETP CSU
PMI FSU ANADER ANDE SODEFOR SIPIM SICOGI SOGEFIHA SOPIM BHCI CAA CNCE LONACI PETROCI GESTOCI SIR PAA ARTCI AGEROUTE
OIPR INS INFAS INFS UNICEF OMS PNUD FAO BAD AFD USAID GIZ CGRAE MUGEFCI IPS CNAM CMU HMA PISAM CPU II III IV VI VII VIII IX XI XII'''.split())

def beau_nom(brut):
    """Nom affichable : espaces propres ; un nom tout en capitales est remis en casse normale."""
    nom = re.sub(r'\s+', ' ', brut.replace('\n', ' ')).strip(' -–·,;')
    lettres = [c for c in nom if c.isalpha()]
    if len(lettres) >= 6 and ' ' in nom and all(c.isupper() for c in lettres):
        mots = []
        for m in nom.split(' '):
            nu = re.sub(r'[^A-Za-zÀ-ÿ]', '', m)
            if nu in SIGLES or len(nu) <= 2 or not re.search(r'[AEIOUYÀ-ÿ]', nu): mots.append(m)
            else: mots.append(m[0] + m[1:].lower())
        nom = ' '.join(mots)
        nom = re.sub(r"\b(De|Du|Des|La|Le|Les|Et|Au|Aux|En|Sur|À|A)\b", lambda x: x.group(1).lower(), nom)
        nom = nom[0].upper() + nom[1:]
    return nom

def nom_valable(nom):
    if len(nom) < 3 or len(nom) > 80: return False
    if not re.search(r'[A-Za-zÀ-ÿ]{2}', nom): return False          # coordonnées, numéros seuls
    if re.fullmatch(r'[\d\s.,;:°\'"NSEWO+-]+', nom): return False
    if re.search(r'https?://|www\.|@', nom): return False
    return True

# ---------------------------------------------------------------- index de départ
index = json.load(open(INDEX, encoding='utf-8'))
communes, categories, lieux = index['communes'], index['categories'], index['lieux']
depart = len(lieux)
CAT = {c[0]: i for i, c in enumerate(categories)}

def cat(libelle, icone, rang):
    """Catégorie existante, ou nouvelle (ajoutée à la fin : les numéros déjà servis ne bougent pas)."""
    if libelle not in CAT:
        categories.append([libelle, icone, rang]); CAT[libelle] = len(categories) - 1
    return CAT[libelle]

C = {cle: CAT[lib] for cle, lib in {
    'rue': 'Rue', 'quartier': 'Quartier', 'restaurant': 'Restaurant', 'maquis': 'Maquis · bar', 'rapide': 'Restauration rapide',
    'cafe': 'Café', 'patisserie': 'Boulangerie · pâtisserie', 'glacier': 'Glacier', 'boite': 'Boîte de nuit',
    'evenement': 'Espace événementiel', 'banque': 'Banque', 'dab': 'Distributeur', 'assurance': 'Assurance',
    'supermarche': 'Supermarché', 'marche': 'Marché', 'grand_magasin': 'Centre commercial', 'superette': 'Supérette',
    'commerce': 'Commerce', 'mode': 'Mode · vêtements', 'beaute': 'Beauté · coiffure', 'telephonie': 'Téléphonie · électronique',
    'eglise': 'Église', 'mosquee': 'Mosquée', 'culte': 'Lieu de culte', 'ecole': 'École', 'universite': 'Lycée · université',
    'bibliotheque': 'Librairie · bibliothèque', 'hopital': 'Hôpital', 'clinique': 'Clinique', 'pharmacie': 'Pharmacie',
    'medecin': 'Cabinet médical', 'dentiste': 'Dentiste', 'hotel': 'Hôtel', 'residence': 'Résidence · maison d’hôtes',
    'station': 'Station-service', 'garage': 'Garage · pièces auto', 'cinema': 'Cinéma', 'theatre': 'Théâtre · salle de spectacle',
    'musee': 'Musée', 'culture': 'Espace culturel', 'sport': 'Sport', 'loisirs': 'Loisirs', 'parc': 'Parc · jardin',
    'mairie': 'Mairie · administration', 'police': 'Police', 'pompiers': 'Pompiers', 'poste': 'Poste', 'ambassade': 'Ambassade',
    'tribunal': 'Tribunal', 'bureau': 'Bureau · entreprise', 'gare': 'Gare routière', 'gare_lagunaire': 'Gare lagunaire',
    'cimetiere': 'Cimetière',
}.items()}
C['transfert'] = cat('Transfert d’argent · mobile money', 'bank', 4)
C['immeuble'] = cat('Immeuble · résidence', 'building', 4)
C['aeroport'] = cat('Aéroport', 'airport', 2)
C['port'] = cat('Port', 'harbor', 3)

# ---------------------------------------------------------------- communes
source = open(os.path.join(ICI, '../../src/lieux-abidjan.ts'), encoding='utf-8').read()
QUARTIERS = [(float(m[1]), float(m[2]), int(m[3]), m[0]) for m in
             re.findall(r'^\s*\["(.+?)", ([\d.-]+), ([\d.-]+), \'[a-z-]+\', (-?\d+)\],$', source, re.M)]
if len(QUARTIERS) < 400: sys.exit(f'lecture de lieux-abidjan.ts : {len(QUARTIERS)} quartiers seulement')
def commune_de(lat, lng):
    m = None
    for q in QUARTIERS:
        if abs(q[0] - lat) > 0.05 or abs(q[1] - lng) > 0.05: continue
        d = dist_m((lat, lng), q)
        if m is None or d < m[0]: m = (d, q[2])
    return m[1] if m and m[0] < 5000 else -1
NOMS_COMMUNES = [norm(c) for c in communes]

# ---------------------------------------------------------------- dédoublonnage
grille = defaultdict(list)                     # cellule de ~330 m → [(nom normalisé, lat, lng, catégorie)]
def cellule(lat, lng): return (int(lat / 0.003), int(lng / 0.003))
def enregistrer(n, lat, lng, c): grille[cellule(lat, lng)].append((n, lat, lng, c))
for l in lieux: enregistrer(norm(l[0]), l[1], l[2], l[3])

GENERIQUES = re.compile(r'^(ecole|ecole primaire|ecole coranique|epp|mosquee|eglise|pharmacie|boutique|maquis|restaurant|kiosque|'
                        r'cave|magasin|garage|salon de coiffure|coiffure|couture|atelier|cabine|lavage|orange money|mtn money|moov money|'
                        r'wave|mobile money|point orange|quincaillerie|boulangerie|marche|station|hotel|bar|immeuble|residence|villa)$')

def deja_la(n, lat, lng, rayon):
    cx, cy = cellule(lat, lng)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for (m, a, b, _c) in grille.get((cx + dx, cy + dy), ()):
                if m == n or (len(n) > 7 and len(m) > 7 and (n in m or m in n)):
                    if dist_m((lat, lng), (a, b)) < rayon: return True
    return False

ajouts = Counter(); rejets = Counter()
def ajouter(source_, brut, lat, lng, c, rayon=150):
    if c is None: rejets['sans catégorie'] += 1; return False
    if not dedans(lat, lng): rejets['hors district'] += 1; return False
    nom = beau_nom(brut)
    if not nom_valable(nom): rejets['nom inutilisable'] += 1; return False
    n = norm(nom)
    # Un nom passe-partout (« Boutique », « Orange Money ») : un seul par pâté de maisons.
    if deja_la(n, lat, lng, 60 if GENERIQUES.match(n) else rayon): rejets['déjà présent'] += 1; return False
    lieux.append([nom, round(lat, 5), round(lng, 5), c, commune_de(lat, lng)])
    enregistrer(n, lat, lng, c)
    ajouts[source_] += 1
    return True

# ---------------------------------------------------------------- catégorie d'un objet OpenStreetMap
CULTE_MUSULMAN = re.compile(r'\b(mosquee|mosque|masjid|islam|coranique|medersa)')
CULTE_CHRETIEN = re.compile(r'\b(eglise|paroisse|chapelle|temple|cathedrale|basilique|assemblee|evangeli|methodiste|baptiste|'
                            r'catholique|protestant|ministere|mission|church|sanctuaire|notre dame|saint|sainte|christ|jesus|harriste)')
EVENEMENT = re.compile(r'\b(salle (de|des) (fete|fetes|reception|receptions|spectacle|mariage)|events?|evenementiel|receptions?|'
                       r'palais des congres|centre de conference|centre des congres|jardin de reception)\b')

def culte(n): return C['mosquee'] if CULTE_MUSULMAN.search(n) else C['eglise'] if CULTE_CHRETIEN.search(n) else C['culte']

AMENITY = {
    'restaurant': 'restaurant', 'food_court': 'restaurant', 'fast_food': 'rapide', 'bar': 'maquis', 'pub': 'maquis', 'biergarten': 'maquis',
    'nightclub': 'boite', 'cafe': 'cafe', 'ice_cream': 'glacier', 'bank': 'banque', 'atm': 'dab', 'bureau_de_change': 'transfert',
    'money_transfer': 'transfert', 'mobile_money_agent': 'transfert', 'microfinance': 'banque', 'microfinance_bank': 'banque',
    'sacco': 'banque', 'payment_centre': 'transfert', 'marketplace': 'marche', 'school': 'ecole', 'kindergarten': 'ecole',
    'language_school': 'ecole', 'music_school': 'ecole', 'driving_school': 'bureau', 'training': 'ecole', 'college': 'universite',
    'university': 'universite', 'research_institute': 'universite', 'library': 'bibliotheque', 'hospital': 'hopital', 'clinic': 'clinique',
    'pharmacy': 'pharmacie', 'doctors': 'medecin', 'health_post': 'medecin', 'healthcare': 'medecin', 'nursing_home': 'clinique',
    'dentist': 'dentiste', 'veterinary': 'medecin', 'fuel': 'station', 'charging_station': 'station', 'car_wash': 'garage',
    'car_rental': 'garage', 'vehicle_inspection': 'garage', 'motorcycle_parking': None, 'cinema': 'cinema', 'theatre': 'theatre',
    'arts_centre': 'culture', 'community_centre': 'culture', 'social_centre': 'culture', 'events_venue': 'evenement',
    'conference_centre': 'evenement', 'exhibition_centre': 'evenement', 'townhall': 'mairie', 'public_building': 'mairie',
    'courthouse': 'tribunal', 'prison': 'mairie', 'police': 'police', 'fire_station': 'pompiers', 'post_office': 'poste',
    'embassy': 'ambassade', 'bus_station': 'gare', 'taxi': 'gare', 'ferry_terminal': 'gare_lagunaire', 'grave_yard': 'cimetiere',
    'social_facility': 'bureau', 'coworking_space': 'bureau', 'internet_cafe': 'telephonie', 'casino': 'loisirs',
    'stripclub': 'boite', 'studio': 'culture', 'customs': 'mairie',
}
SHOP = {
    'supermarket': 'supermarche', 'mall': 'grand_magasin', 'department_store': 'grand_magasin', 'wholesale': 'commerce',
    'convenience': 'superette', 'general': 'superette', 'kiosk': 'superette', 'grocery': 'superette', 'greengrocer': 'superette',
    'bakery': 'patisserie', 'pastry': 'patisserie', 'confectionery': 'patisserie', 'clothes': 'mode', 'boutique': 'mode',
    'fabric': 'mode', 'shoes': 'mode', 'jewelry': 'mode', 'tailor': 'mode', 'fashion': 'mode', 'bag': 'mode', 'watches': 'mode',
    'hairdresser': 'beaute', 'beauty': 'beaute', 'cosmetics': 'beaute', 'perfumery': 'beaute', 'massage': 'beaute',
    'mobile_phone': 'telephonie', 'electronics': 'telephonie', 'computer': 'telephonie', 'hifi': 'telephonie', 'telecommunication': 'telephonie',
    'car': 'garage', 'car_repair': 'garage', 'car_parts': 'garage', 'tyres': 'garage', 'motorcycle': 'garage', 'motorcycle_repair': 'garage',
    'books': 'bibliotheque', 'stationery': 'bibliotheque', 'money_lender': 'transfert', 'travel_agency': 'bureau', 'estate_agent': 'bureau',
    'insurance': 'assurance', 'chemist': 'pharmacie', 'optician': 'medecin', 'medical_supply': 'pharmacie', 'ice_cream': 'glacier',
}
TOURISM = {
    'hotel': 'hotel', 'motel': 'hotel', 'guest_house': 'residence', 'hostel': 'residence', 'apartment': 'residence', 'chalet': 'residence',
    'resort': 'hotel', 'museum': 'musee', 'gallery': 'culture', 'artwork': 'culture', 'attraction': 'loisirs', 'viewpoint': 'loisirs',
    'theme_park': 'loisirs', 'zoo': 'loisirs', 'aquarium': 'loisirs', 'picnic_site': 'parc', 'camp_site': 'loisirs',
}
OFFICE = {'government': 'mairie', 'diplomatic': 'ambassade', 'insurance': 'assurance', 'financial': 'banque'}
BUILDING = {
    'apartments': 'immeuble', 'residential': 'immeuble', 'house': 'immeuble', 'dormitory': 'immeuble', 'detached': 'immeuble',
    'commercial': 'bureau', 'office': 'bureau', 'retail': 'commerce', 'industrial': 'bureau', 'warehouse': 'bureau',
    'church': 'eglise', 'cathedral': 'eglise', 'chapel': 'eglise', 'mosque': 'mosquee', 'temple': 'culte',
    'school': 'ecole', 'kindergarten': 'ecole', 'university': 'universite', 'college': 'universite', 'hospital': 'hopital',
    'hotel': 'hotel', 'public': 'mairie', 'government': 'mairie', 'civic': 'mairie', 'supermarket': 'supermarche',
    'train_station': 'gare', 'stadium': 'sport', 'sports_hall': 'sport',
}
PAR_NOM = [  # dernier recours : le nom dit ce que c'est
    (re.compile(r'\b(immeuble|residence|tour|cite|villa|duplex|appartements?|lotissement|building)\b'), 'immeuble'),
    (re.compile(r'\b(pharmacie)\b'), 'pharmacie'), (re.compile(r'\b(clinique|polyclinique)\b'), 'clinique'),
    (re.compile(r'\b(hopital|chu|chr|formation sanitaire|fsu|centre de sante|dispensaire|maternite)\b'), 'hopital'),
    (re.compile(r'\b(ecole|epp|epv|groupe scolaire|college|lycee|institut|universite|ufr|cafop|creche|maternelle|academie)\b'), 'ecole'),
    (re.compile(r'\b(banque|bank|ecobank|sgbci|bicici|nsia banque|bni|coris|orabank|versus|bridge bank|baci|afriland|sib|boa|uba|bdu|stanbic|societe generale|banque atlantique|credit|cofina|advans|microcred|baobab)\b'), 'banque'),
    (re.compile(r'\b(assurances?|insurance)\b'), 'assurance'),
    (re.compile(r'\b(orange money|mtn mo|moov money|wave|western union|moneygram|money gram|transfert|ria|mobile money)\b'), 'transfert'),
    (re.compile(r'\b(hotel|auberge)\b'), 'hotel'), (re.compile(r'\b(supermarche|hypermarche|carrefour market|casino|sococe|prosuma|cdci|king cash|super u|leader price)\b'), 'supermarche'),
    (re.compile(r'\b(marche)\b'), 'marche'), (re.compile(r'\b(restaurant|grill|pizzeria|braise|garba|alloco|poulet)\b'), 'restaurant'),
    (re.compile(r'\b(maquis|bar|cave|buvette|lounge)\b'), 'maquis'),
    (re.compile(r'\b(mairie|sous prefecture|prefecture|ministere|direction (generale|regionale|departementale)|tresor|impots|douanes?|cnps|tribunal|commissariat|gendarmerie|brigade)\b'), 'mairie'),
    (re.compile(r'\b(station|total|shell|petro ivoire|oilibya|ola energy|vivo|corlay)\b'), 'station'),
    (re.compile(r'\b(siege|sarl|sa|group|groupe|agence|cabinet|societe|entreprise|consulting|services?|bureau|compagnie|company|holding|logistique|transit|imprimerie)\b'), 'bureau'),
]
def par_nom(n):
    if CULTE_MUSULMAN.search(n) or CULTE_CHRETIEN.search(n): return culte(n)
    for regle, cle in PAR_NOM:
        if regle.search(n): return C[cle]
    return None

def categorie_osm(p, n):
    """Catégorie de la carte pour les étiquettes d'un objet OpenStreetMap ; None = pas une destination."""
    if EVENEMENT.search(n) and p.get('amenity') not in ('place_of_worship', 'school', 'hospital', 'pharmacy', 'bank'): return C['evenement']
    a = p.get('amenity') or p.get('healthcare')
    if a == 'place_of_worship': return culte(n)
    if a == 'laboratory' or a == 'centre': return C['medecin']
    if a in AMENITY: return C[AMENITY[a]] if AMENITY[a] else None
    s = p.get('shop')
    if s and s not in ('vacant', 'no'): return C[SHOP.get(s, 'commerce')]
    t = p.get('tourism')
    if t in TOURISM: return C[TOURISM[t]]
    o = p.get('office')
    if o and o != 'no': return C[OFFICE.get(o, 'bureau')]
    h = p.get('historic')
    if h in ('monument', 'memorial', 'castle', 'ruins'): return C['loisirs']
    le = p.get('leisure')
    if le in ('stadium', 'sports_centre', 'pitch', 'swimming_pool', 'fitness_centre'): return C['sport']
    if le in ('park', 'garden', 'playground'): return C['parc']
    return None

def centre(g):
    if not g: return None
    c, t = g['coordinates'], g['type']
    if t == 'Point': return c[1], c[0]
    pts = c if t == 'LineString' else c[0] if t in ('Polygon', 'MultiLineString') else c[0][0] if t == 'MultiPolygon' else None
    if not pts: return None
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)

def lire_hot(fichier):
    chemin = os.path.join(SOURCES, fichier)
    if not os.path.exists(chemin): print(f'  (absent : {fichier})'); return []
    with zipfile.ZipFile(chemin) as z:
        geo = [n for n in z.namelist() if n.endswith('.geojson')][0]
        return json.load(z.open(geo))['features']

# ---------------------------------------------------------------- 1. OpenStreetMap complet (export HOT)
vus = set()
for fichier in ('financial_services.zip', 'health_facilities.zip', 'education_facilities.zip', 'cultural_places.zip',
                'points_of_interest.zip', 'airports.zip', 'sea_ports.zip'):
    for f in lire_hot(fichier):
        p = f['properties']; brut = (p.get('name_fr') or p.get('name') or '').strip()
        if not brut or p.get('id') in vus: continue
        vus.add(p.get('id'))
        pt = centre(f.get('geometry'))
        if not pt: continue
        n = norm(brut)
        if fichier == 'airports.zip':
            c = C['aeroport'] if p.get('aeroway') in ('aerodrome', 'terminal') else None
        elif fichier == 'sea_ports.zip':
            c = C['port'] if re.search(r'\b(port|quai|terminal|gare lagunaire)\b', n) else None
        else:
            c = categorie_osm(p, n)
            if c is None and fichier != 'points_of_interest.zip': c = par_nom(n)
        ajouter(f'OpenStreetMap — {fichier[:-4]}', brut, pt[0], pt[1], c)

# ---------------------------------------------------------------- 2. Localités, quartiers, secteurs
VERIFIES = {norm(q[3]) for q in QUARTIERS}
for f in lire_hot('populated_places.zip'):
    p = f['properties']; brut = (p.get('name_fr') or p.get('name') or '').strip()
    if not brut or p.get('place') in (None, 'isolated_dwelling', 'farm', 'plot', 'city', 'country', 'state', 'region', 'island', 'islet'): continue
    pt = centre(f.get('geometry'))
    if not pt or norm(brut) in VERIFIES: continue
    ajouter('OpenStreetMap — quartiers et secteurs', brut, pt[0], pt[1], C['quartier'], rayon=600)

# ---------------------------------------------------------------- 3. Bâtiments nommés
chemin = os.path.join(SOURCES, 'batiments-nommes.json')
if os.path.exists(chemin):
    for b in json.load(open(chemin, encoding='utf-8')):
        n = norm(b['nom'])
        c = C[OFFICE.get(b['office'], 'bureau')] if b.get('office') and b['office'] != 'no' else None
        if c is None: c = par_nom(n)
        if c is None and b.get('building') in BUILDING: c = C[BUILDING[b['building']]]
        ajouter('OpenStreetMap — bâtiments nommés', b['nom'], b['lat'], b['lon'], c)
else: print('  (absent : batiments-nommes.json)')

# ---------------------------------------------------------------- 4. Voies nommées
chemin = os.path.join(SOURCES, 'voies-nommees.json')
if os.path.exists(chemin):
    for v in json.load(open(chemin, encoding='utf-8')):
        if v.get('highway') in ('footway', 'path', 'steps', 'cycleway', 'corridor', 'proposed', 'construction', 'platform'): continue
        ajouter('OpenStreetMap — voies nommées', v['nom'], v['lat'], v['lon'], C['rue'], rayon=1200)
else: print('  (absent : voies-nommees.json)')

# ---------------------------------------------------------------- 5. Overture Maps
OVERTURE = {
    'restaurant': 'restaurant', 'casual_eatery': 'restaurant', 'food_and_drink': 'restaurant', 'fast_food_restaurant': 'rapide',
    'bar': 'maquis', 'lounge': 'maquis', 'dance_club': 'boite', 'cafe': 'cafe', 'coffee_shop': 'cafe',
    'fashion_and_apparel_store': 'mode', 'shopping': 'commerce', 'specialty_store': 'commerce', 'warehouse_club_store': 'commerce',
    'department_store': 'grand_magasin', 'shopping_mall': 'grand_magasin', 'electronics_store': 'telephonie',
    'food_and_beverage_store': 'superette', 'convenience_store': 'superette', 'pharmacy_and_drug_store': 'pharmacie',
    'hospital': 'hopital', 'health_care': 'medecin', 'outpatient_care_facility': 'clinique', 'medical_service': 'medecin',
    'diagnostics_imaging_or_lab_service': 'medecin', 'complementary_and_alternative_medicine': 'medecin', 'dental_clinic': 'dentiste',
    'wellness_service': 'beaute', 'hotel': 'hotel', 'lodging': 'hotel', 'resort': 'hotel', 'private_lodging': 'residence',
    'christian_place_of_worship': 'eglise', 'muslim_place_of_worship': 'mosquee', 'bank_or_credit_union': 'banque',
    'real_estate_service': 'bureau', 'professional_service': 'bureau', 'corporate_or_business_office': 'bureau', 'b2b_service': 'bureau',
    'b2b_transportation_and_storage_service': 'bureau', 'b2b_office_and_professional_service': 'bureau',
    'b2b_industrial_and_machine_service': 'bureau', 'b2b_energy_and_utility_service': 'bureau', 'b2b_science_and_technology_service': 'bureau',
    'home_service': 'bureau', 'technical_service': 'bureau', 'media_service': 'bureau', 'printing_service': 'bureau',
    'travel_service': 'bureau', 'design_service': 'bureau', 'legal_service': 'bureau', 'building_or_construction_service': 'bureau',
    'manufacturer': 'bureau', 'supplier_or_distributor': 'bureau', 'rental_service': 'bureau', 'shipping_or_delivery_service': 'bureau',
    'agricultural_service': 'bureau', 'civic_organization': 'bureau', 'social_or_community_service': 'bureau', 'radio_station': 'bureau',
    'wholesaler': 'commerce', 'government_office': 'mairie', 'community_and_government': 'mairie', 'public_utility': 'mairie',
    'embassy': 'ambassade', 'police_station': 'police', 'place_of_learning': 'ecole', 'education': 'ecole', 'specialty_school': 'ecole',
    'elementary_school': 'ecole', 'middle_school': 'ecole', 'high_school': 'universite', 'preschool': 'ecole',
    'college_university': 'universite', 'campus_building': 'universite', 'library': 'bibliotheque',
    'event_or_party_service': 'evenement', 'music_venue': 'evenement', 'personal_or_beauty_service': 'beaute',
    'personal_care_and_beauty_store': 'beaute', 'hardware_home_and_garden_store': 'commerce', 'arts_crafts_and_hobby_store': 'commerce',
    'books_music_and_video_store': 'bibliotheque', 'flowers_and_gifts_store': 'commerce', 'second_hand_store': 'commerce',
    'sporting_goods_store': 'commerce', 'office_supply_store': 'commerce', 'animal_and_pet_store': 'commerce',
    'automotive_service': 'garage', 'auto_dealer': 'garage', 'vehicle_parts_store': 'garage', 'vehicle_dealer': 'garage',
    'gas_station': 'station', 'sport_or_fitness_facility': 'sport', 'gym': 'sport', 'stadium_arena': 'sport', 'sport_field': 'sport',
    'sports_and_recreation': 'sport', 'arts_and_entertainment': 'culture', 'art_gallery': 'culture', 'cultural_center': 'culture',
    'movie_theater': 'cinema', 'historic_site': 'loisirs', 'monument': 'loisirs', 'beach': 'loisirs', 'park': 'parc',
    'laundry_service': 'commerce', 'airport': 'aeroport',
}
chemin = os.path.join(SOURCES, 'overture-places.json')
if os.path.exists(chemin):
    for p in json.load(open(chemin, encoding='utf-8')):
        if not p.get('nom') or (p.get('conf') or 0) < CONFIANCE_OVERTURE: rejets['Overture : confiance faible'] += 1; continue
        if p.get('statut') in ('closed', 'permanently_closed', 'temporarily_closed'): rejets['Overture : fermé'] += 1; continue
        n = norm(p['nom']); basic = p.get('basic')
        if basic == 'financial_service' or basic == 'religious_organization' or basic is None: c = par_nom(n)
        elif basic in OVERTURE: c = C[OVERTURE[basic]]
        else: c = par_nom(n)
        if c is None and basic == 'financial_service': c = C['bureau']
        if c is None and basic == 'religious_organization': c = C['culte']
        # Point mal placé : l'adresse nomme une commune, le point tombe dans une autre, loin.
        adresse = norm(p.get('adresse') or '')
        citees = [i for i, nc in enumerate(NOMS_COMMUNES) if re.search(rf'\b{re.escape(nc)}\b', adresse)]
        if len(citees) == 1:
            ici = commune_de(p['lat'], p['lon'])
            if ici != -1 and ici != citees[0]:
                proche = min((dist_m((p['lat'], p['lon']), q) for q in QUARTIERS if q[2] == citees[0]), default=0)
                if proche > 3000: rejets['Overture : adresse et position incohérentes'] += 1; continue
        ajouter('Overture Maps', p['nom'], p['lat'], p['lon'], c, rayon=250)
else: print('  (absent : overture-places.json)')

# ---------------------------------------------------------------- sortie
index['lieux'] = lieux
index['sources'] = {
    'carte': 'OpenStreetMap (tuiles OpenFreeMap), ODbL',
    'osm': 'OpenStreetMap, export Humanitarian OpenStreetMap Team (data.humdata.org), ODbL',
    'overture': 'Overture Maps Foundation, CDLA-Permissive-2.0',
}
json.dump(index, open(SORTIE, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'\nindex de départ : {depart} lieux')
for s, n in ajouts.most_common(): print(f'  + {n:6d}  {s}')
print(f'index enrichi : {len(lieux)} lieux ({os.path.getsize(SORTIE) / 1e6:.2f} Mo)')
print('écartés :', dict(rejets.most_common()))
par_cat = Counter(l[3] for l in lieux)
print('par catégorie :', ', '.join(f'{categories[k][0]} {v}' for k, v in par_cat.most_common(30)))
