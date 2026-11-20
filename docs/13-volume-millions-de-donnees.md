# 13. Volume : des millions de courses et de mouvements financiers

Le test de charge (document 12) mesurait une **rafale** : 5 000 commandes et 300 SOS en
quelques secondes. Ce document mesure l'autre dimension, le **volume accumulé**. Au bout
de plusieurs mois, la console et le tableau de bord doivent rester instantanés avec des
millions de courses en mémoire et autant d'écritures financières.

## Le constat de départ

Avec 200 000 courses en mémoire, la plupart des écrans relisaient tout l'historique à
chaque rafraîchissement. Quelques exemples :
- le poste de direction reconstruisait le grand livre complet : 2 s ;
- la vigilance relisait toutes les courses : 0,5 s ;
- « Mon poste » relisait tout l'historique : 0,7 s.

Le serveur de Node.js ne traite qu'une chose à la fois. Pendant ces lectures, les
commandes, les SOS et le temps réel attendaient. À un million de courses, ces temps
auraient été multipliés par cinq.

## Le principe retenu : ne jamais relire l'historique

Chaque donnée est rangée **au moment où elle arrive**. Une lecture ne parcourt plus que
ce qu'elle affiche.

| Mécanisme | Ce qu'il remplace |
|---|---|
| **Index chronologique** (`core/chrono.ts`) : éléments rangés par date, fenêtre lue par recherche dichotomique | « toutes les courses, filtrées sur les 30 derniers jours » |
| **Index par chauffeur, client, entreprise, jeton de partage** | « toutes les courses dont le chauffeur est X » |
| **Ensembles d'état** : courses en cours, courses terminées en attente de paiement | « toutes les courses dont le statut est … » |
| **Index par événement daté** : terminées, payées, notées, annulées | « toutes les courses payées ce mois-ci » |
| **Cumuls différentiels** : totaux, par statut, par gamme, kilomètres par motorisation, séries par jour et par heure | les recomptages des tableaux de bord |
| **Cumuls quotidiens des paiements** : encaissé, espèces, GMV, TVA, commission, par jour et par service | la reconstruction du grand livre pour chaque total financier |
| **Portefeuilles** : soldes tenus à jour, index des retraits | la relecture de chaque écriture pour chaque solde |
| **Clients** : ordre d'activité, index des numéros, clé de recherche par fiche | le tri de tous les clients et les recherches en trois passes |
| **Alertes** : déduplication par course, alertes de chaque usager | le parcours de toutes les alertes de l'histoire |

### Les cumuls disent exactement la même chose qu'un recomptage

Un cumul tenu au fil de l'eau n'a de valeur que s'il est exact. Quand une course change
d'état (terminée puis payée, par exemple), sa contribution précédente est retirée et la
nouvelle ajoutée. `backend/tests/volume-index.test.ts` compare chaque raccourci à un
recomptage brut de toutes les courses :
- GMV, TVA, commissions ;
- dettes espèces et encaissements ;
- nombre de paiements, sur 1, 7, 30 et 45 jours ;
- totaux par statut et index par chauffeur ;
- soldes des portefeuilles.

Le test couvre aussi un paiement arrivé après coup et des abonnements qui couvrent toute
une course.

### Le grand livre, page par page

Le grand livre de la direction ne fabrique plus que la page affichée. Les paiements de
courses sont lus du plus récent au plus ancien dans leur index, puis fusionnés avec les
autres mouvements : abonnements, locations, retraits, virements, notes de frais et
litiges. Les totaux viennent des cumuls quotidiens, plus une lecture exacte de la seule
journée de départ, entamée.

Le test vérifie deux choses : les pages mises bout à bout redonnent exactement le livre
complet, dans le même ordre, et le filtre « livraison » rend les mêmes lignes.

Les paiements sont datés **du jour du paiement**, comme dans le grand livre, et non du
jour de la commande. C'est la date à laquelle l'argent entre en caisse.

### Exports écrits par tranches

`/admin/rides.csv` et `/admin/executive/livre.csv` s'écrivent par tranches de
2 000 lignes. Entre deux tranches, le serveur reprend la main pour les autres requêtes.
Un export d'un an ne bloque ni la console ni les applications, et le fichier n'est
jamais tenu en entier en mémoire.

### Réponses compressées

Les réponses de plus de 1 Ko sont compressées en Brotli, ou en gzip si le navigateur ne
connaît pas Brotli :

| Réponse | Sans compression | Compressée |
|---|---|---|
| Carte de la flotte (5 000 véhicules) | 739 Ko | 52 Ko |
| File SOS (3 300 alertes) | 506 Ko | 41 Ko |
| Tableau de bord | 180 Ko | 22 Ko |

C'est ce qui garde la console fluide en 4G et en télétravail.

### Analyses partagées

La prévision de demande et les signaux de fraude lisent un mois d'activité. Leur
résultat ne change pas d'une seconde à l'autre, mais chaque employé connecté les
redemande toutes les quelques secondes. Ils sont donc calculés une fois, puis partagés
pendant 30 s pour la prévision et 60 s pour la fraude (`core/cache-court.ts`). Un calcul
déjà en cours est partagé lui aussi. La charge ne dépend plus du nombre de personnes
connectées.

Les alertes, les courses et les soldes ne passent jamais par ce cache : ils se lisent
toujours en direct.

### Recherche libre

Un identifiant, un numéro de téléphone ou un matricule exact sont retrouvés par index.
La recherche d'un morceau de nom parcourt une clé de recherche précalculée par fiche :
300 000 clients en 6 à 15 ms. Elle dispose de 30 ms au plus. Au-delà, la réponse le
signale et la console invite à préciser. Une fiche supprimée n'est plus retrouvable
par son ancien nom ni par son ancien numéro (test).

## Résultats

Banc : `backend/scripts/volume.ts`. Il charge un an d'historique :
- 1 000 000 de courses ;
- 1 674 884 écritures financières ;
- 20 000 chauffeurs, dont 5 000 en ligne ;
- 300 000 clients ;
- 3 000 courses en cours et 300 SOS.

Il chronomètre ensuite chaque lecture de la console, du tableau de bord et des
applications. Machine : 4 cœurs, 16 Go.

```bash
cd backend
NODE_ENV=test SIMULATE_RIDES=false RATE_LIMIT_MAX=10000000 LOG_LEVEL=fatal \
  node --max-old-space-size=12000 --import tsx scripts/volume.ts
# VOLUME_COURSES=200000 pour un banc plus court ; VOLUME_RAPPORT=rapport.json
```

Temps médian de traitement serveur :

| Lecture | Avant, à 200 000 courses | Après, à **1 000 000** de courses |
|---|---|---|
| Vue d'ensemble | 128 ms | 3 à 14 ms |
| Statistiques 30 jours | 101 ms | 0,6 ms |
| Liste des courses, page 5 000 | 50 ms | 0,6 ms |
| Recherche « Client 42 » | 105 ms | 19 ms |
| Finances | 155 ms | 0,3 ms |
| Poste de direction, 30 jours | 1 987 ms | 11 ms |
| Poste de direction, 365 jours | — | 27 ms |
| Grand livre, une page sur un an | 399 ms (30 jours) | 2,5 ms |
| Liquidité | 96 ms | 18 ms |
| Bilan vert | 77 ms | 17 ms |
| Prévision de demande | 169 ms | 78 ms au premier calcul, puis 0,3 ms |
| Signaux de fraude | 210 ms | 75 ms au premier calcul, puis 0,4 ms |
| Satisfaction | 75 ms | 5 ms |
| File SOS | 120 ms | 6 ms |
| Équipages | 178 ms | 9 à 20 ms |
| Vigilance | 547 ms | 8 ms |
| Mon poste | 665 ms | 8 ms |
| Tableau de bord | 256 ms | 9 ms |
| Tableau de bord, analyse | 239 ms | 12 à 43 ms |
| App chauffeur : course en cours | — | 0,3 ms |
| App chauffeur : position GPS | — | 0,6 ms |
| App client : historique | — | 0,5 ms |
| Commande d'une course | 4,8 ms | 4,9 ms |

Les exports sont plus longs, mais écrits par tranches : 9 Mo de courses (31 jours) en
0,2 à 2,4 s, et 21 Mo de grand livre (90 jours) en 0,5 à 2,4 s, sans bloquer le serveur.

## Plusieurs instances : le temps réel est prêt

Un seul serveur ne suffira pas à des millions d'utilisateurs. Le temps réel d'ORION peut
désormais relier plusieurs instances par Redis (`backend/src/modules/realtime/bus.ts`) :

```bash
REDIS_URL=redis://redis:6379   # vide : une seule instance, rien ne sort du processus
```

Chaque message publié sur une instance (SOS, course, configuration, tableau de bord) est
aussi livré aux clients connectés aux autres instances. Son propre écho est ignoré : un
message n'est jamais livré deux fois. Le test
`backend/tests/temps-reel-multi-instances.test.ts` démarre un vrai Redis et deux serveurs
côte à côte. Il vérifie trois choses :
- un SOS levé sur l'instance A arrive une seule fois au poste branché sur l'instance B ;
- le suivi d'une course passe de B à A ;
- si Redis tombe, chaque instance continue de servir ses propres clients, sans bloquer.

L'état du bus figure dans `/health/ready` et `/admin/systeme/mesures` : mode, connexion,
messages reçus, envoyés et perdus.

### Ce qui reste à faire pour plusieurs instances en production

Le temps réel est partagé. **Les données, elles, ne le sont pas encore** : chaque
instance tient ses courses en mémoire, avec une copie SQLite locale. Deux instances
côte à côte ne verraient donc pas les mêmes courses. Le passage effectif à plusieurs
instances demande quatre chantiers :

1. **PostgreSQL comme base de référence commune** (documents 05 et 08). L'interface
   `Repository` est prête, mais l'adaptateur PostgreSQL n'est pas écrit. La mémoire ne
   garde alors que la fenêtre chaude.
2. **Sessions de la console et limiteur de débit partagés**, dans Redis. Aujourd'hui,
   chaque instance a les siens.
3. **Index géographique des chauffeurs dans Redis**, avec les commandes GEO. Il faut
   que le dispatch de n'importe quelle instance voie toute la flotte.
4. **Un répartiteur de charge** qui vérifie `/health/ready` de chaque instance.

D'ici là, le bon déploiement est **une instance par ville ou par grande zone** :
- chaque instance a ses propres données ;
- un client d'Abidjan est toujours servi par l'instance d'Abidjan ;
- le bus Redis relie les postes de supervision et le tableau de bord de la direction.

## Limites, dites franchement

- **Un seul processus tient tout en mémoire** : 3,3 Go de tas à un million de courses.
  Les lectures restent de l'ordre de la milliseconde, mais le ramasse-miettes de Node.js
  marque régulièrement ces 3 Go. Pendant ce marquage, une lecture qui prend
  habituellement 10 ms peut en prendre plusieurs centaines. Le banc l'a montré sur
  Équipages : 456 ms pendant un marquage, 9 à 20 ms sinon, ce que confirme la trace du
  ramasse-miettes.
- **Au-delà de quelques millions de courses**, il faut garder en mémoire la fenêtre
  chaude seulement, environ 90 jours, et laisser l'historique à une base de données.
  PostgreSQL est la base visée : voir les documents 05 et 08. Il faut aussi plusieurs
  instances du serveur, reliées par un bus temps réel (document 05).
- Les mesures sont celles du serveur. Le temps réseau s'y ajoute, réduit par la
  compression.
