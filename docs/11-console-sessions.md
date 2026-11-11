# ORION — La console d'administration : les sessions

La console est le cerveau de l'écosystème ORION. Ce n'est pas un tableau de bord
qu'on regarde : c'est le **poste de travail** de chaque employé, du PDG au chauffeur.
Chaque personne s'y connecte avec **son identifiant et son mot de passe**, voit ce que
son service et ses accréditations lui ouvrent, et peut y faire tout ce que son métier
demande. Toutes les sessions lisent et écrivent les mêmes données : ce qu'une
trésorière arrête dans sa caisse apparaît dans le rapport financier, ce qu'un
chauffeur demande dans son espace arrive chez son manager et au DAF.

## 1. Accès et comptes

| Règle | Détail |
|-------|--------|
| Un compte par personne | Créé dans **Personnel & accès**. L'identifiant est dérivé du nom (`prenom.nom`), le mot de passe provisoire est généré sans caractères ambigus et doit être changé à la première connexion (10 caractères minimum). |
| Chauffeurs compris | Un chauffeur a un compte lié à son matricule ; il n'ouvre que **son** dossier (rôle `chauffeur`, droit `crew:self`). |
| Délégation aux managers | Un manager crée et réinitialise les comptes de **ses** agents et chauffeurs, pas les autres. |
| Comptes de configuration | Les comptes définis par `ADMIN_TOKEN` et `ADMIN_ACCOUNTS` restent valables et ne peuvent pas être modifiés depuis la console. |
| Refus d'accès | Ouvrir une session sans en avoir le droit affiche : « … **sans autorisation de la direction**. Cette tentative a été signalée à la direction (DG, CFO, DAA). » L'alerte part immédiatement et la tentative est journalisée. |

## 2. Carte des sessions

| Famille | Session | Droit d'entrée | Pour quoi faire |
|---------|---------|----------------|-----------------|
| Poste | Mon poste | aucun (tout compte) | Sa journée : à traiter, messages, rapports demandés, sa caisse, son équipe, sa flotte accréditée ; pour un chauffeur, son poste complet. |
| Poste | Mon équipe | `teams:read` | Le poste du manager : ce que font ses membres, appel, message, demande de rapport ou de bilan. |
| Pilotage | Vue d'ensemble | `overview:read` | Compteurs du jour. Les chauffeurs « sans position récente » sont comptés à part. |
| Pilotage | Direction Générale | `executive:read` | Consolidation PDG : finances, caisses, flotte, alertes, décisions à prendre. |
| Pilotage | Vigilance ORION | `vigilance:read` | Les constats que le système détecte seul (caisse non arrêtée, prêts en retard, courses non réglées, flotte muette…). |
| Pilotage | Intelligence | `rides:read` | L'assistant ORION répond sur les données réelles. |
| Exploitation | Supervision SAMU | `alerts:read` | SOS, accidents, moyens de contact immédiats. |
| Exploitation | Courses · Dispatch · Qualité · Mobilité verte | `rides:*`, `drivers:read` | Suivi des courses, attribution, notes, part électrique. |
| Exploitation | Chauffeurs · Clients · Support & chat · Litiges · Notifications | selon section | Validation KYC, comptes clients, conversations, litiges, campagnes. |
| Personnes | Équipes | `teams:read` | Les managers créent leurs équipes, chacune avec un rôle et une mission. |
| Personnes | Équipages | `crew:read` | Le dossier de chaque chauffeur, retrouvable par matricule, et ses requêtes. |
| Personnes | Personnel & accès · Rôles & accès | `accounts:read`, `roles:read` | Annuaire des comptes, matrice des droits. |
| Location Signature | Location · Tarifs location · Abonnements | `rental:read` | Contrats, grilles tarifaires, abonnements clients. |
| Location Signature | Suivi véhicules | `rental:read` | Position en temps réel, appel du locataire, coupure moteur, déclaration de vol. |
| Argent | Finances | `finance:read` | Demandes de dépense : dépôt et validation. |
| Argent | Trésorerie | `treasury:read` | Versements, demandes de virement, rapports. |
| Argent | Caisses espèces | `caisse:read` | La caisse nominative de chaque trésorier(ère) : comptage et arrêté. |
| Argent | Tarification · Zones & tarifs · Codes promo | `pricing:read`, `promos:read` | Grilles, zones, promotions. |
| Contrôle | Journal · Sessions actives · Alertes sécurité · Services & ville | `audit:read`, `sessions:read`, `security:read`, `services:read` | Traçabilité, qui est connecté, tentatives refusées, configuration de la ville. |

## 3. Ce que font les sessions ajoutées

### Mon poste
Chaque employé y trouve **tout ce que son service lui permet**, sans naviguer :
les éléments à traiter triés par urgence, les messages de son manager, les rapports
qu'on lui a demandés, sa caisse s'il en tient une, son équipe s'il en dirige une, la
flotte qu'on lui a accréditée, et son propre dossier.

### Mon poste d'un chauffeur
Le chauffeur se connecte avec son identifiant et ne voit que **son** poste : sa
gamme, sa note, ses courses et revenus sur 30 jours, son solde, les espèces qu'il
doit reverser face au plafond, ce qui lui reste à rembourser, ses dernières
courses, son véhicule et son assurance, son équipe avec un bouton pour appeler son
chef d'équipe. Il y dépose lui-même ses demandes (prêt, avance, réparation,
congé…) avec les plafonds affichés ; elles arrivent chez son chef d'équipe. Il ne
voit ni chiffre de l'entreprise, ni dossier d'un collègue.

### Mon équipe et Équipes
Les **managers créent leurs équipes** : un rôle, une mission, des membres. Chaque
membre a son espace dans Mon poste. Le manager voit ce que font ses membres, les
appelle, leur écrit dans l'application, leur demande un rapport ou un bilan avec une
échéance, et constate les retards. Chaque membre travaille sur la flotte et les
chauffeurs que son manager lui a accrédités, et sur rien d'autre.

### Équipages
Le **dossier de chaque chauffeur**, retrouvable par matricule : identité, véhicule,
courses, revenus, notes, dette espèces, requêtes traitées ou en attente. Le chauffeur
y dépose lui-même ses requêtes depuis son compte (prêt, avance, congé, réparation,
réclamation…). Une requête suit un circuit : triage par l'équipe, décision par le
DAF ou la direction, exécution par la trésorerie. Chaque étape est visible dans le
dossier.

### Caisses espèces
Chaque trésorier(ère) a **sa** caisse. Après comptage des espèces, elle fait sa
**mise au point** dans la console : le comptage par coupures, le montant attendu,
l'écart. Au-delà de 500 F d'écart, un motif est obligatoire. L'arrêté est validé par
une autre personne, puis consolidé dans le rapport financier et dans la session
Direction Générale. Une caisse non arrêtée le soir devient un constat de vigilance.

### Finances
Le **DAF** et les personnes accréditées (`finance:write`) déposent des demandes et
statuent sur celles des autres. Personne ne valide sa propre demande : la séparation
est imposée par le serveur, pas par la bonne volonté.

### Suivi véhicules (Location Signature)
Pour chaque véhicule loué : la **position en temps réel**, l'**appel du locataire**,
la **coupure moteur à distance** et la **déclaration de vol**.
La coupure obéit à une règle de sécurité : une première personne l'arme, une seconde
la confirme, et elle n'est exécutée qu'une fois le véhicule à l'arrêt (5 km/h au
plus). La déclaration de vol produit un **signalement PDF pour la police** avec la
position GPS, l'historique de positions et l'identité du locataire ; la transmission
et la clôture sont tracées.

### Supervision SAMU : le circuit d'une alerte SOS
1. **Le client appuie sur SOS.** La console de chaque agent habilité affiche un
   bandeau d'alarme et sonne (niveau rouge) ; la file de triage se met à jour.
   Le client voit « Alerte reçue par la supervision ORION » — et rien de plus
   tant que personne n'a agi.
2. **Un agent accepte l'alerte** (verrou nominatif). Le client lit « Prise en
   charge par *prénom*, agent ORION ».
3. **Le dossier s'ouvre** : véhicule à dicter à la police, chauffeur, passager,
   télémétrie, trajet réel.
4. **Chat discret** dans les deux sens : messages pré-enregistrés côté agent,
   réponses rapides côté client (« Je ne peux pas parler », « Envoyez de l'aide »).
5. **Secours** : l'appel au SAMU, à la police ou aux pompiers part du poste et
   est consigné avant la composition. Le client voit « ORION appelle le SAMU
   (185)… », puis « SAMU (185) prévenu par ORION » quand l'agent l'a joint. Un
   SMS ou un WhatsApp vers un secours part pré-rédigé avec la position GPS (lien
   carte), le passager, le véhicule et le chauffeur ; le client voit « Votre
   position a été transmise ».
6. **Clôture** avec note de synthèse : le dossier est scellé, le client est
   informé.

Un secours n'est jamais annoncé au client avant d'avoir été réellement sollicité.
Le flux d'urgence temps réel et la liste brute des alertes sont réservés au
personnel habilité ; le suivi d'une alerte, à la personne qui l'a déclenchée.

### Personnel & accès
L'annuaire des comptes : création, réinitialisation, désactivation, réactivation,
mot de passe provisoire à remettre en main propre. Les managers n'y voient que leur
périmètre.

## 4. Interconnexion : qui alimente qui

- **Requête d'un chauffeur** → Équipages (triage) → Finances (décision si c'est de
  l'argent) → Trésorerie (versement) → dossier chauffeur et Mon poste du chauffeur.
- **Arrêté de caisse** → Caisses espèces → Trésorerie → rapport financier →
  Direction Générale.
- **Déclaration de vol** → Suivi véhicules → Alertes sécurité et SAMU → Journal.
- **Demande de rapport du manager** → Mon poste du membre → rendu → Mon équipe.
- **Vigilance** lit toutes les sessions et pousse ses constats vers la section
  concernée ; **Direction Générale** consolide le tout ; **Journal** garde chaque
  action avec son auteur.

## 5. Rôles

| Rôle | Périmètre |
|------|-----------|
| `super_admin`, `ceo`, `dg`, `daa`, `coo` | Tout. |
| `cfo` | Pilotage financier complet, demande de virement, jamais l'approbation. |
| `daf` | Même périmètre financier ; dépose et statue sur les demandes des autres ; gère les caisses et les équipages. |
| `tresorier` | Sa caisse, ses versements, ses demandes ; aucune approbation. |
| `fleet_manager` | KYC, véhicules, dispatch, équipes, location. |
| `manager` | Ses équipes, ses membres, leurs comptes, la flotte accréditée. |
| `agent` | La flotte que son manager lui a accréditée. |
| `chauffeur` | Son dossier, ses courses, ses revenus, ses requêtes. |
| `ops`, `support`, `finance`, `financial_analyst`, `viewer` | Métiers transverses, en lecture ou en écriture selon la matrice de `roles.ts`. |

## 6. Trois règles du dispatch, apprises en conditions réelles

1. **« En ligne » ne suffit pas.** Un chauffeur sans position depuis
   `PRESENCE_TTL_SECONDS` (30 s) disparaît de l'index de dispatch. La console le
   compte « sans position récente » et la vigilance le nomme ; sans cela, 44
   chauffeurs en ligne et aucune course attribuée coexistaient sans explication.
2. **Un chauffeur ne reste pas bloqué « en course » quand personne ne paie.**
   Après `RIDE_UNPAID_RELEASE_MINUTES` (5 min) sans paiement d'une course terminée,
   il est libéré, prévenu, et la course reste terminée : l'impayé est un fait
   financier, il ne retient pas le véhicule.
3. **Le rayon est une promesse au client.** Au-delà du temps d'approche maximal
   réglé dans Dispatch, un chauffeur en ligne n'est pas proposé. Dimensionner la
   flotte **par gamme et par secteur** : une gamme avec un seul chauffeur dans un
   quartier n'a plus personne dès la première course.

## 7. Variables d'environnement liées

| Variable | Défaut | Rôle |
|----------|--------|------|
| `ADMIN_TOKEN` | — | Compte super administrateur de configuration. |
| `ADMIN_ACCOUNTS` | — | Comptes de configuration supplémentaires (JSON). |
| `PRESENCE_TTL_SECONDS` | `30` | Durée de validité d'une position chauffeur pour le dispatch. |
| `RIDE_UNPAID_RELEASE_MINUTES` | `5` | Délai d'encaissement avant libération d'un chauffeur. |
| `SIMULATE_RIDES` | `true` | Chauffeurs et courses simulés en développement, avec battement de position. |
