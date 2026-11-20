# Répertoire des lieux du Grand Abidjan (OpenStreetMap)

Données de la recherche d'adresse, du nom des positions GPS (client, chauffeur, console,
tableau de bord) et des communes. © contributeurs OpenStreetMap, licence ODbL.

## Mettre à jour (chaque mois : OSM évolue chaque semaine)

```bash
cd backend
D=/tmp/lieux-osm
node scripts/lieux-osm/extraire-tuiles.mjs $D            # tuiles OpenFreeMap : lieux + limites
curl -o $D/civ.zip https://production-raw-data-api.s3.amazonaws.com/ISO3/CIV/populated_places/hotosm_civ_populated_places_osm_geojson.zip
unzip -o $D/civ.zip -d $D                                  # export OSM de HOT publié sur HDX
npx tsx scripts/lieux-osm/generer-lieux.mts $D             # → src/modules/maps/quartiers-abidjan.ts, limites-communes.ts
npm test                                                   # contrôles : doublons, communes de référence
```

`$D/rapport-lieux.json` liste les lieux fusionnés, le recoupement HDX et les totaux par
commune et par niveau.

## Règles de nettoyage

- **Doublons** : même nom (sans accents, sans « village », « quartier », « cité »,
  singulier = pluriel) à moins de 1,5 km → un seul lieu (point + polygone, deux
  contributeurs, deux graphies).
- **Niveaux** : quartier (`suburb`, `quarter`), sous-quartier (`neighbourhood`), village,
  hameau, île. Maisons isolées écartées.
- **Commune** : limites administratives OSM de niveau 8. Un lieu appartient à la commune
  dont le point central est joignable en ligne droite sans franchir de limite.
- **Contrôle** : `tests/recherche-lieux.test.ts` (aucun doublon, communes de référence).

## Limites connues

- Les limites communales viennent des tuiles (géométrie simplifiée, précision de l'ordre
  de quelques dizaines de mètres) : un point situé exactement sur une limite peut être
  rattaché à la commune voisine.
- Le recoupement avec une extraction Overpass directe reste à faire depuis un poste qui
  y a accès (le service était injoignable depuis l'environnement d'audit).
