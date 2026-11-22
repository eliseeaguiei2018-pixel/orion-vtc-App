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

## Palette urbaine (accueil de l'app cliente, depuis la version 1.5.1)

`ORION_PALETTE=urbain` garde le studio à reflets doux de la palette noir, gris et blanc,
mais rend aux matières leur couleur : carton et sacs en kraft, or de la carte et des
alliances, cuir fauve de la selle et du porte-clés, pain doré, salade, tomate, feux
rouges. Seules les teintes de la marque deviennent neutres (blanc cassé, anthracite,
gris). C'est le registre des applications de transport : des objets clairs et doux, où
la couleur vient de la matière et non d'une charte. Les neuf objets sont publiés dans
`public/rendus/urbain/` ; l'app cliente les affiche sur des tuiles translucides.

```bash
ORION_PALETTE=urbain ECHANTILLONS=192 python rendre.py /tmp/rendus-urbain berline-orion scooter food achat supermarche colis abonnement location mariage
python publier.py /tmp/rendus-urbain ../../public/rendus/urbain
```

Trois objets ont rejoint cette palette avec le volet Services et le compte (version 1.5.7) :
`reserver` (calendrier), `protection` (bouclier à croix) et `cadeau` (parrainage). Ils sont
publiés dans `urbain/` et, avivés, dans `vif/`.

Dans `rendre.py`, `o3.URBAIN` choisit les matières de cette palette objet par objet ; dans
`orion3d.py`, `matiere(..., urbain='#RRGGBB')` impose une teinte pour elle seule.

## Palette noir, gris et blanc (essai de la version 1.5)

`ORION_PALETTE=nb` rend les mêmes modèles sans couleur : noir laqué, graphite, gris perle,
céramique blanche, acier brossé. Le studio gagne une boîte à lumière au zénith et une
bande latérale, les matières mates prennent un grain fin, et le rendu sort en niveaux de
gris (transformation AgX). Les neuf objets de l'accueil sont publiés dans
`public/rendus/nb/` ; les rendus en couleur restent à leur place.

```bash
ORION_PALETTE=nb python rendre.py /tmp/rendus-nb berline-orion scooter food achat supermarche colis abonnement location mariage
python publier.py /tmp/rendus-nb ../../public/rendus/nb
```

L'app cliente choisit son style au démarrage, dans `src/main.tsx` :
`definirStyle({ icones: 'trait', accueil: 'urbain' })`. `accueil: 'nb'` rétablit les objets
noir, gris et blanc, `accueil: 'couleur'` les objets vert, blanc et violet ;
`icones: 'volume'` rétablit les icônes en volume des listes. Les autres interfaces
(chauffeur, console, tableau de bord) n'appellent pas `definirStyle` et gardent les objets
en couleur.

## Icônes des listes

Dans l'app cliente (depuis la version 1.5), ces icônes sont dessinées **au trait**, sans
couleur, comme celles des paramètres : `<Objet nom="samu" />` y rend un pictogramme. Les
rendus en volume décrits ci-dessous restent utilisés par les autres interfaces.


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
