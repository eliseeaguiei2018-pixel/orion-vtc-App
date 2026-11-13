# 12. Test de charge : 5 000 courses simultanées et des centaines de SOS

Ce document décrit le banc de charge d'ORION, ce qu'il mesure, les résultats obtenus et
les faiblesses qu'il a révélées.

## Principe

Le test tourne contre un serveur qui fonctionne vraiment : il ne charge pas l'application
en mémoire. Les commandes passent par les routes publiques de l'application, comme un
téléphone : `POST /pricing/estimate`, puis `POST /rides`, puis `POST /rides/:id/sos`. Le
dispatch, le simulateur de trajets, le temps réel et le journal du tableau de bord
travaillent donc exactement comme en service.

Seules la flotte et la clientèle de test sont créées directement par le serveur
(`POST /admin/charge/preparer`). Les conducteurs sont répartis dans les communes
d'Abidjan selon leur poids (Yopougon, Cocody et Abobo d'abord), sur toutes les gammes
et les motos de livraison.

## Lancer le test

```bash
# Serveur de développement, test de charge autorisé, sans appel OSRM externe
cd backend
TEST_CHARGE=true OSRM_URL= SIM_TICK_MS=2000 npm run dev

# Dans un autre terminal
npx tsx scripts/test-charge.ts --courses 5000 --sos 300 --vagues 3
```

Options utiles :

| Option | Rôle |
|---|---|
| `--courses` | nombre de commandes de la rafale (5 000 par défaut) |
| `--conducteurs` | taille de la flotte de test (1,12 × courses par défaut) |
| `--sos`, `--vagues`, `--entre-vagues` | alertes SOS, en vagues |
| `--concurrence` | requêtes en vol en même temps (250 par défaut) |
| `--etat` | fichier JSON réécrit en continu, pour suivre le test en direct |
| `--rapport` | rapport final en JSON |
| `--signal` | pilotage pas à pas : la rafale attend `<chemin>.rafale`, la vague n attend `<chemin>.sos<n>` |

`OSRM_URL=` coupe le calcul d'itinéraire externe : 5 000 courses demandent environ
10 000 itinéraires, et le serveur OSRM public de démonstration n'est pas fait pour ça.
Les courses suivent alors un tracé de repli.

## Garde-fous

- `POST /admin/charge/preparer` est refusée par défaut (`TEST_CHARGE=false`).
- Elle est **toujours refusée en production**, quelle que soit la valeur de `TEST_CHARGE`.
- Elle est réservée au super administrateur technique, et chaque préparation est journalisée.

## Ce qui est mesuré

Côté générateur :
- le temps de réponse du devis, de la commande et du SOS (médiane, 95e et 99e centiles) ;
- les erreurs, les courses attribuées et les courses sans conducteur ;
- le délai d'arrivée de chaque SOS sur le poste de supervision (`/ws/emergency`) ;
- le délai d'affichage des commandes au tableau de bord (`/ws/dashboard`).

Côté serveur, en continu : `GET /admin/systeme/mesures`, réservé au service
informatique et à la direction (`sessions:read`). Il donne le débit, le temps de
traitement par route, les erreurs 5xx, les refus 429, le retard de la boucle
d'événements, les messages temps réel, la mémoire, l'état du calcul d'itinéraire et le
volume en cours.

## Résultats (novembre 2026)

Machine de test : 4 cœurs, sans carte graphique. Le serveur, le générateur et deux
navigateurs (console, tableau de bord) tournent sur la même machine.

| Mesure | Résultat |
|---|---|
| Rafale de 5 000 commandes | 8 à 12 s, soit 500 à 650 commandes par seconde |
| Erreurs | 0 sur plus de 10 000 requêtes |
| Commande, temps de traitement serveur (95e centile) | 3 à 6 ms |
| Courses attribuées | environ 75 % ; les autres n'avaient aucun conducteur de la bonne gamme assez proche |
| 300 SOS : délai jusqu'à la supervision | médiane 30 à 60 ms, 95e centile sous 100 ms |
| Commande affichée au tableau de bord (95e centile) | 30 à 140 ms |
| Console et tableau de bord, sans enregistrement vidéo | 50 à 60 images par seconde, dossier SOS ouvert compris |

## Faiblesses révélées, puis corrigées

1. **Équipages** : la liste reparcourait toutes les courses pour chaque chauffeur.
   Avec 5 600 chauffeurs, le serveur était bloqué 8,6 s à chaque rafraîchissement de la
   console. Elle fait désormais une passe par source et renvoie au plus 300 lignes ;
   la recherche trouve les autres.
2. **Flux du tableau de bord** : un message WebSocket par événement, et un état de
   plusieurs mégaoctets toutes les 4 s. Le journal part désormais par lots de 250 ms,
   avec le compte exact. Au-delà de 400 véhicules, la carte passe en mode masse : des
   points compacts et la densité des courses.
3. **Cartes** : un élément HTML ou SVG par véhicule. Les véhicules sont désormais dessinés
   en couches GPU sur le tableau de bord, et en tracés groupés sur la carte de supervision.
4. **Itinéraires en rafale** : chaque commande lançait ses appels OSRM sans limite. Les
   appels sont désormais bornés à 8 en parallèle, les demandes identiques sont partagées,
   et un tracé de repli part tout de suite quand la file déborde.
5. **Flou d'arrière-plan** derrière le dossier SOS : il était recalculé à chaque image,
   et les écrans tombaient de 55 à 13 images par seconde. Il est remplacé par un voile
   sans flou.

Le test a aussi révélé trois défauts d'affichage :
- un SOS apparaissait deux fois au journal ;
- la vitesse estimée du dossier SOS était fausse ;
- la position d'une longue course se figeait après 200 points GPS.

Les corrections côté serveur sont couvertes par `backend/tests/tenue-en-charge.test.ts`.
