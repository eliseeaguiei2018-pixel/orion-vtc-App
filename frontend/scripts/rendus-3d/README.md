# Atelier 3D d'ORION

Les véhicules et les objets des services ne sont pas des dessins : ce sont des modèles en
volume, éclairés comme en studio et rendus avec Blender (moteur Cycles), dans les trois
teintes de la marque — vert, blanc, violet.

| Fichier | Rôle |
|---|---|
| `orion3d.py` | Le studio (trois boîtes à lumière, sol qui ne garde que l'ombre, cadrage automatique) et les briques : pavés arrondis, tubes, surfaces tendues, voiture (berline, SUV, limousine), scooter de livraison |
| `rendre.py` | La liste des rendus : voitures par gamme et par teinte, scooter, vues de dessus pour la carte, les neuf objets de l'accueil et les 32 icônes des listes (packs, urgences, paramètres, lieux) |
| `publier.py` | Mise à la taille de l'application et conversion en WebP transparent |
| `icone_app.py` | L'icône de l'application : la feuille du logo en relief sur une dalle verte laquée, vue d'aplomb |
| `icone_android.py` | Décline cette icône pour Android (icône adaptative, anciennes icônes ronde et carrée) et pour le logo affiché dans l'application |

```bash
pip install bpy pillow                       # Blender en module Python, sans interface
python rendre.py /tmp/rendus                 # tout rendre (≈ 40 s par image sur 4 cœurs)
python rendre.py /tmp/rendus food colis      # ou seulement certains
python publier.py /tmp/rendus ../../public/rendus
```

Pour ajouter un objet : écrire une fonction décorée par `@rendu('nom')` dans `rendre.py`,
avec les briques d'`orion3d.py`, puis l'afficher avec `<Objet nom="nom" />`.

## Icônes des listes

Les icônes des paramètres, des numéros d'urgence, des packs d'abonnement et des lieux sont des
objets comme les autres, rendus à 360 px et publiés à 168 px : `<Objet nom="samu" taille={34} />`.
Elles se lisent petites — formes pleines, peu de détails — et tiennent sur fond clair comme
sur fond sombre. Les pictogrammes au trait ne restent que pour les gestes de l'interface
(retour, fermer, cocher, chercher).

| Famille | Objets |
|---|---|
| Packs | `pack-argent`, `pack-or` (couronnes), `pack-diamant` |
| Urgences | `samu` (croix blanche sur vert, le signe ISO des premiers secours), `police`, `pompiers` |
| Compte | `reglages`, `assurance`, `historique`, `alertes-sos`, `portefeuille`, `cadenas`, `document`, `serveur`, `telephone`, `message`, `wifi` |
| Lieux | `lieu` (repère vert), `destination` (repère violet), `domicile`, `bureau`, `banque`, `aeroport`, `ecole`, `eglise`, `mosquee`, `hotel`, `carburant`, `bus`, `loisirs`, `immeuble`, `parc` |

## Icône de l'application

```bash
python icone_app.py /tmp/icone                                   # rendu 864 px
python icone_android.py /tmp/icone ../../android/app/src/main/res ../../public
```

L'image couvre les 108 dp de l'icône adaptative et Android la découpe à la forme du
téléphone (rond, carré arrondi, « squircle ») : le logo tient dans la zone sûre de 66 dp.
