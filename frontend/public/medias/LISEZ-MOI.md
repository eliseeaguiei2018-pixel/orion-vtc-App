# Photos et vidéos réelles des véhicules

L'application montre, dans **Mariage** et **Location Signature**, une vitrine du véhicule
choisi. Tant qu'aucune photo n'est enregistrée, elle affiche le modèle en volume et le dit.
Pour ajouter de vraies images ou vidéos, deux moyens, sans toucher au code :

1. **Dans l'application livrée** : déposer les fichiers dans ce dossier (`public/medias/`)
   et les déclarer dans `vehicules.json`.
2. **Depuis le serveur ORION** : `PUT /admin/medias/vehicules` (droit « Paramètres ») avec la
   même liste ; l'application la lit à `GET /rental/medias-vehicules` et la fusionne avec celle-ci.
   Les `src` sont alors des adresses `https://…` complètes.

## Une entrée

```json
{
  "service": "mariage",
  "vehicule": "or",
  "options": { "decoration": true },
  "type": "image",
  "src": "medias/mariage/or-fleurie-1.webp",
  "legende": "Berline Or, décoration florale blanche"
}
```

| Champ | Valeurs |
|---|---|
| `service` | `mariage` ou `location` |
| `vehicule` | Mariage : la gamme (`argent`, `or`, `diamant`). Location : l'identifiant du véhicule du catalogue. `*` : tous. |
| `options` | Facultatif. L'entrée n'est montrée que si chaque option indiquée a cette valeur chez le client. Mariage : `decoration` (vrai/faux), `duree` (`halfday`, `fullday`, `weekend`), `cortege` (vrai/faux). Location : `formule`, `decoration`, `tapisRouge`, `cortege`. |
| `type` | `image` (WebP ou JPEG, 1600 px de large conseillé) ou `video` (MP4 H.264, 10 à 30 s, moins de 8 Mo) |
| `src` | Chemin dans l'application (`medias/…`) ou adresse `https://…` |
| `affiche` | Vidéo seulement : image montrée avant la lecture |
| `legende` | Facultatif, une ligne |

Les entrées s'affichent dans l'ordre du fichier ; celles dont les options correspondent le
mieux au choix du client passent en premier. La vitrine se met à jour dès qu'il change une
option.
