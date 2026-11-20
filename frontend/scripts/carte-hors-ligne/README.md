# Carte d'Abidjan embarquée (app autonome et APK)

L'app client peut fonctionner **sans serveur ORION** (APK de démonstration) avec une carte
complète du district d'Abidjan livrée dans l'application. Trois ingrédients :

| Dossier | Contenu | Source |
|---|---|---|
| `tuiles/{z}/{x}/{y}.pbf` | 860 tuiles vectorielles OpenStreetMap, niveaux 5 à 14, emprise -4,32 / 5,20 / -3,70 / 5,62 | OpenFreeMap (schéma OpenMapTiles) |
| `polices/<police>/<plage>.pbf` | Noto Sans Regular, Bold, Italic | OpenFreeMap |
| `carte/` | `lieux-index.json` (31 000 lieux), `quartiers-usage.json`, `sprites/` (pictogrammes) | générés ici |

## Étapes

```bash
# 1. Tuiles et polices (≈ 25 Mo)
python3 scripts/carte-hors-ligne/telecharger-tuiles.py <dossier-donnees>
# 2. Index de recherche + quartiers d'usage (Riviéra Golf, Palmeraie…)
node scripts/carte-hors-ligne/indexer-lieux.mjs <dossier-donnees>/tuiles <dossier-donnees>/carte/lieux-index.json
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

Données © les contributeurs d'OpenStreetMap, licence ODbL — mention affichée dans l'app.
