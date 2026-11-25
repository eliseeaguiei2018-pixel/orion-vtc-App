# Carte d'Abidjan embarquée (app autonome et APK)

L'app client peut fonctionner **sans serveur ORION** (APK de démonstration) avec une carte
complète du district d'Abidjan livrée dans l'application. Trois ingrédients :

| Dossier | Contenu | Source |
|---|---|---|
| `tuiles/{z}/{x}/{y}.pbf` | 860 tuiles vectorielles OpenStreetMap, niveaux 5 à 14, emprise -4,32 / 5,20 / -3,70 / 5,62 | OpenFreeMap (schéma OpenMapTiles) |
| `polices/<police>/<plage>.pbf` | Noto Sans Regular, Bold, Italic | OpenFreeMap |
| `carte/` | `lieux-index.json` (près de 49 000 lieux), `quartiers-usage.json`, `sprites/` (pictogrammes) | générés ici |

## Étapes

```bash
# 1. Tuiles et polices (≈ 25 Mo)
python3 scripts/carte-hors-ligne/telecharger-tuiles.py <dossier-donnees>
# 2. Index de recherche + quartiers d'usage (Riviéra Golf, Palmeraie…)
node scripts/carte-hors-ligne/indexer-lieux.mjs <dossier-donnees>/tuiles <dossier-donnees>/carte/lieux-index.json
# 2 bis. Carte « comblée » : tout OpenStreetMap + Overture Maps (voir plus bas)
python3 scripts/carte-hors-ligne/telecharger-sources.py <dossier-sources>      # pyarrow conseillé
python3 scripts/carte-hors-ligne/enrichir-lieux.py <dossier-donnees>/carte/lieux-index.json <dossier-sources> <dossier-donnees>/carte/lieux-index.json
# 3. Pictogrammes de la carte
mkdir -p <dossier-donnees>/carte/sprites && for f in ofm.json ofm.png ofm@2x.json ofm@2x.png; do
  curl -sSo <dossier-donnees>/carte/sprites/$f https://tiles.openfreemap.org/sprites/ofm_f384/$f; done
# 4. App autonome, puis APK
scripts/carte-hors-ligne/construire-autonome.sh <dossier-donnees> dist
npx cap sync android && (cd android && ./gradlew assembleDebug)
```

Dans l'APK, les tuiles livrées servent d'abord (hors connexion, instantané) ; au-delà du
district, la carte passe d'elle-même aux tuiles OpenFreeMap en ligne (protocole `hybride:`).

**Quartiers d'usage.** Plusieurs quartiers que tout Abidjan emploie (« Riviéra Golf »,
« Riviéra Palmeraie », « Angré Château », « Abobo Gare »…) ne figurent pas comme quartiers
dans OpenStreetMap. L'indexeur les place à la médiane des lieux qui portent leur nom
(arrêts, écoles, commerces, rues) et ne les retient que si au moins trois lieux concordent
à moins de 1,2 km : un nom dispersé dans toute la ville est écarté.

## Une carte aussi complète que possible, avec des données ouvertes

Les tuiles de la carte ne portent qu'une partie d'OpenStreetMap : les points de transfert
d'argent, beaucoup de commerces et tous les immeubles nommés en sont absents. Deux scripts
comblent l'écart, et la carte affiche ensuite **tous** les lieux de l'index (pas seulement
ceux des tuiles) :

| Source | Apport dans le district (novembre 2026) | Licence |
|---|---|---|
| Tuiles OpenStreetMap (étape 2) | 31 341 lieux, rues et arrêts | ODbL |
| OpenStreetMap complet, export HOT (data.humdata.org) | + 4 300 commerces, banques, points de transfert d'argent, santé, écoles | ODbL |
| Bâtiments nommés d'OpenStreetMap | + 5 100 immeubles, résidences, sièges | ODbL |
| Voies nommées et localités d'OpenStreetMap | + 280 | ODbL |
| Overture Maps (Meta, Microsoft…) | + 7 900 entreprises, bureaux, commerces | CDLA-Permissive-2.0 |
| **Total** | **48 924 lieux** (+56 %) | |

Chaque ajout est dédoublonné contre l'index (même nom à moins de 150 m), classé dans une
catégorie de la carte et rattaché à sa commune. Les lieux Overture de confiance
inférieure à 0,5, fermés, ou dont l'adresse nomme une commune éloignée du point, sont
écartés.

**Pourquoi pas Google Maps ?** Ses conditions d'utilisation interdisent de copier ses
données dans une autre carte (et de les garder hors connexion). Overture Maps est
l'équivalent ouvert : des lieux déclarés par les entreprises elles-mêmes, réutilisables.
Aucune carte n'est complète à 100 % — pour ajouter un lieu manquant, le plus durable est
de le saisir dans OpenStreetMap : il arrive dans l'application à la reconstruction suivante.

Données © les contributeurs d'OpenStreetMap (ODbL) et Overture Maps Foundation
(CDLA-Permissive-2.0) — mentions affichées dans l'app.
