# 🚀 Mettre ORION en ligne — guide pas à pas

Objectif : obtenir un **lien internet** que tu peux envoyer à des testeurs à Abidjan,
puis (plus tard) une **app installable** sur téléphone.

> Rappel : 2 morceaux à mettre en ligne — le **backend** (moteur) et le **frontend** (l'app).

---

## ⭐ Le plus simple : un lien démo à partager (sans backend)

L'app fonctionne en **mode démo** (données simulées) : il suffit de publier le **frontend**
pour obtenir un **lien cliquable** que tes connaissances peuvent ouvrir sur leur téléphone.

### Option 1 — GitHub Pages (gratuit, sur ton propre dépôt, automatique)
J'ai déjà ajouté le workflow `.github/workflows/deploy-pages.yml`. Une seule action de ta part :
1. Sur GitHub, va dans **Settings → Pages**.
2. **Build and deployment → Source** : choisis **« GitHub Actions »**.
3. (Si besoin) onglet **Actions** → ouvre « Deploy demo to GitHub Pages » → **Run workflow**.
4. Après ~2 min, ton lien est prêt :
   **`https://eliseeaguiei2018-pixel.github.io/orion-vtc-App/`** ← partage-le ! 🎉

> Le workflow se relance à chaque mise à jour. Si le déploiement est bloqué car la branche
> n'est pas `main`, fusionne la PR dans `main` (ou dis-le-moi, je t'explique).

### Option 2 — Vercel (gratuit, ~5 clics, lien le plus rapide)
1. Va sur **https://vercel.com** → **Continue with GitHub**.
2. **Add New → Project** → choisis `orion-vtc-App` → **Import**.
3. **Root Directory** : choisis **`frontend`**.
4. **Deploy**. Au bout d'une minute tu obtiens un lien `https://orion-xxx.vercel.app` à partager.

> Aucune des deux options ne nécessite le backend : la démo tourne toute seule.

---

## Niveau 2 — Lien web partageable

### Étape A · Mettre le backend en ligne (Render — gratuit pour tester)
1. Crée un compte sur **https://render.com** (connexion avec GitHub).
2. **New → Blueprint**, choisis ton dépôt `orion-vtc-App`.
3. Render détecte le fichier **`render.yaml`** à la racine et crée le service `orion-backend`.
4. Lance le déploiement. À la fin tu obtiens une URL, ex. `https://orion-backend.onrender.com`.
5. Vérifie : ouvre `https://orion-backend.onrender.com/health/ready` → tu dois voir `{"status":"ready"}`.

### Étape A bis · Relier l'application (APK) au serveur — sans la réinstaller
L'adresse du serveur n'est plus figée dans l'APK. Sur le téléphone :

1. ouvre **Paramètres → Serveur ORION** ;
2. saisis l'adresse obtenue à l'étape A (ex. `https://orion-backend.onrender.com`) ;
3. touche **Tester et relier** : l'app vérifie que c'est bien un serveur ORION, puis redémarre.

À partir de là, courses, alertes SOS, messages et compte passent par le serveur et
apparaissent dans la console. **Revenir au mode autonome** détache l'application.
L'adresse doit être en `https` (exigé par Android et iOS). Changer de serveur ferme la
session : le compte vit sur le serveur auquel l'app est reliée.

Pour livrer un APK déjà relié, construis-le avec `VITE_API_URL=https://…` : l'adresse
réglée dans l'app reste prioritaire.

### Étape B · Mettre le frontend en ligne (Vercel — gratuit)
1. Crée un compte sur **https://vercel.com** (connexion avec GitHub).
2. **Add New → Project**, choisis `orion-vtc-App`.
3. **Root Directory** : sélectionne le dossier **`frontend`**.
4. Variable d'environnement à ajouter :
   - `VITE_API_URL` = l'URL de ton backend (ex. `https://orion-backend.onrender.com`)
5. Déploie. Tu obtiens un lien, ex. `https://orion.vercel.app` → **c'est ton app en ligne** 🎉

### Étape C · Sécuriser (recommandé)
- Sur Render, change `CORS_ORIGIN` pour mettre **l'URL exacte de ton front** (au lieu de `*`).
  Si tu publies les apps mobiles, ajoute leurs origines : les apps Capacitor appellent le
  serveur depuis `capacitor://localhost` (iPhone) et `https://localhost` (Android). Exemple :
  `CORS_ORIGIN=https://orion.vercel.app,capacitor://localhost,https://localhost`.
- En production réelle, mets `SIMULATE_RIDES=false` (l'app chauffeur fournit désormais les vraies positions).
- **App chauffeur** : `DRIVER_JWT_SECRET` (généré automatiquement par le blueprint Render),
  puis, une fois l'opérateur SMS activé, `DRIVER_AUTH_STRICT=true`.
- **App cliente** : `CLIENT_JWT_SECRET` (généré automatiquement par le blueprint Render). Le
  compte client repose sur un numéro vérifié par code SMS, envoyé par l'opérateur SMS ; le
  code de test n'est renvoyé à l'app qu'en développement.
- **Opérateur SMS** (indispensable pour ouvrir l'app au public) : voir la section
  « Opérateur SMS » ci-dessous.
- **Revue Apple / Google** : `CLIENT_REVIEW_PHONE` et `CLIENT_REVIEW_CODE` réservent un numéro
  de démonstration qui reçoit toujours le même code (lui seul). Voir `store/README.md` §4.

### Opérateur SMS (codes de connexion)
Les clients et les chauffeurs se connectent avec un code reçu par SMS. Le serveur sait
l'envoyer par **Orange Côte d'Ivoire** (recommandé) ou par **Twilio** (secours).

1. Sur **https://developer.orange.com**, crée un compte, puis une application, et abonne-la
   à l'API **« SMS Côte d'Ivoire »** (achat d'un forfait de SMS).
2. Copie le **Client ID** et le **Client Secret** de l'application.
3. Demande à Orange la validation du nom d'expéditeur **ORION** (affiché à la place du
   numéro sur le téléphone du client).
4. Sur Render, renseigne : `SMS_PROVIDER=orange`, `ORANGE_SMS_CLIENT_ID`,
   `ORANGE_SMS_CLIENT_SECRET`. Redéploie.
5. Vérifie : `https://orion-backend.onrender.com/health/ready` doit afficher
   `"sms":{"fournisseur":"orange","actif":true}`. Puis inscris-toi avec ton propre numéro.

Protections intégrées : le code n'est jamais écrit dans les journaux ni renvoyé à l'app en
production ; 30 s minimum entre deux codes et 5 codes maximum par numéro et par heure ;
seuls les numéros `+225` reçoivent un SMS (`SMS_ALLOWED_PREFIXES`) ; si l'opérateur ne
répond pas, le client voit « Le SMS n'a pas pu être envoyé » et peut réessayer aussitôt.
Sans opérateur configuré, un serveur de production refuse poliment l'envoi du code au lieu
de laisser le client attendre.

Twilio : `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et
`TWILIO_FROM` (ou `TWILIO_MESSAGING_SERVICE_SID`).

---

## Niveau 3 — Vraie app mobile (Play Store / App Store)

Les applications natives **existent déjà** dans le dépôt (Capacitor 8) :
`frontend/android` (Android Studio) et `frontend/ios` (Xcode 26). Elles embarquent l'app web
compilée et appellent le même serveur.

```bash
cd frontend
VITE_API_URL=https://orion-backend.onrender.com npm run build
npx cap sync          # copie l'app web dans les projets Android et iOS
npx cap open android  # Android Studio : Build → Generate Signed App Bundle
npx cap open ios      # Xcode : Product → Archive (Mac obligatoire)
```

- Détails techniques, permissions et compilation : [`NATIVE.md`](NATIVE.md).
- Textes des fiches, visuels, confidentialité et compte de revue : [`store/README.md`](store/README.md).
- Compilation automatique et démonstration sur émulateurs : workflow GitHub
  **« Applications mobiles »** (`.github/workflows/mobile.yml`).

> La publication sur les stores nécessite un compte développeur (Google Play : 25 $ une fois ;
> Apple : 99 $/an) et l'opérateur SMS activé sur le serveur (section « Opérateur SMS »).

---

## Console Admin & supervision SAMU

Le dashboard d'administration est une **page séparée** de l'app cliente :

- En local : `http://localhost:5173/admin.html` (dev) ou `/admin.html` après build.
- Fonctionnalités : KPIs (courses actives, chauffeurs en ligne, revenu/commission, alertes),
  **carte de supervision de la flotte** (positions temps réel), **file SAMU** (SOS/accidents
  avec prise en charge / résolution), tables Courses et Chauffeurs (KYC, état, note).
- **Écran de connexion** : à l'ouverture, la console demande un **identifiant + mot de passe**.
  Le backend vérifie les identifiants et renvoie une **session JWT signée** (expiration
  12 h par défaut), mémorisée sur le poste ; bouton **Déconnexion** dans l'en-tête. Une
  session expirée renvoie automatiquement à l'écran de connexion.
  - **Compte par défaut (dev)** : `ADMIN_USERNAME` / `ADMIN_PASSWORD` (défaut `admin` /
    `orion-admin-dev`) = compte **super_admin**. À changer impérativement en production.
  - **Secret de signature** : définir `ADMIN_JWT_SECRET` (secret fort) et, au besoin,
    `ADMIN_JWT_TTL_SECONDS` (durée de session).
  - **Couches d'accès par rôle** : définir les comptes via `ADMIN_USERS` (JSON, mots de
    passe **hachés** — jamais en clair), généré avec `npm run hash-password -- <user> <mdp> <role>`.
    Ex. `[{"username":"awa","name":"Awa (Finance)","role":"finance","salt":"…","hash":"…"}]`.
    Rôles : **direction** `ceo`, `dg`, `daa`, `coo` (accès total + approbation des virements),
    `super_admin` (technique), `cfo` (finance complète, virements **sur aval de la direction**),
    puis `ops`, `finance`, `support`, `viewer`. Chaque rôle ne voit/agit que sur ses sections.
  - **Trésorerie (double validation)** : le CFO soumet une demande de virement ; seul un
    dirigeant peut l'approuver (exécution) ou la rejeter — jamais sa propre demande.
  - **Anti-brute-force** : 5 échecs de connexion → compte verrouillé 15 minutes.
  - **2FA direction (TOTP)** : générer un secret avec `npm run totp-secret -- <username>`,
    l'ajouter au champ `totp` du compte dans `ADMIN_USERS`, scanner l'URL `otpauth://` dans
    Google/Microsoft Authenticator. `ADMIN_REQUIRE_2FA=true` pour l'imposer à toute la direction.
  - **Sessions actives** : la direction voit qui est connecté (IP, appareil, activité) et
    peut **révoquer** une session — déconnexion immédiate de l'employé.
  - **Automatisation / intégrations** : l'en-tête `x-admin-token` (variable `ADMIN_TOKEN`)
    reste accepté pour les scripts serveur-à-serveur, en complément du login JWT humain.
  - Sections de la console : Vue d'ensemble, Supervision SAMU, Courses, Chauffeurs,
    **Tarification** (augmenter/réduire les prix, effet immédiat), Rôles & accès.
- Sans backend joignable, la console bascule en **mode démo** (données simulées) pour la présentation.

### Code de synchronisation ORION : appareils de confiance

La console et le tableau de bord s'ouvrent sur ordinateur (Windows, macOS), tablette,
téléphone et navigateur. Le **code de synchronisation** dit au serveur « cet appareil
appartient à ORION ». Il se saisit **une fois par appareil**, au premier lancement.
Ensuite, chaque employé se connecte avec ses identifiants personnels, comme avant.

**Mise en place, une seule fois :**

```bash
cd backend
npm run code-synchro        # taper le code : il ne s'affiche pas et n'est écrit nulle part
# → ORION_CODE_SYNCHRO_EMPREINTE=scrypt$32768$8$1$…$…
```

Copier cette ligne dans les variables d'environnement du serveur (Render, Docker…), puis
ajouter `APPAREILS_EXIGES=true` : la console et le tableau de bord ne s'ouvrent plus que
sur un appareil enrôlé.

**Ce que le serveur garde :** l'empreinte scrypt du code, jamais le code. Une fuite du
dépôt, d'une sauvegarde ou des variables ne le révèle pas. Le dépôt contient un test qui
échoue si le code y est écrit par erreur.

**Sécurité de l'enrôlement :**
- 5 essais manqués par adresse sur un quart d'heure, 50 pour tout le réseau, puis attente ;
- chaque essai, réussi ou non, figure au journal d'audit ;
- l'appareil reçoit une clé qui lui est propre (256 bits), posée dans un cookie HttpOnly :
  aucun script de la page ne peut la lire, et le serveur n'en garde que l'empreinte.

**Au quotidien, dans la console, section « Sessions actives » :** la liste des appareils
de confiance, avec la plateforme, l'application, la dernière activité et le dernier
compte utilisé. Le bouton **Révoquer** coupe l'accès d'un appareil perdu, volé, ou de
celui d'un employé parti, dès sa requête suivante. Les autres appareils ne sont pas
touchés, et il n'y a pas besoin de changer le code.

**Changer de code :** relancer `npm run code-synchro` et remplacer la variable. Les
appareils déjà enrôlés gardent leur accès ; seuls les nouveaux enrôlements demandent le
nouveau code.

> Le code de synchronisation ne remplace pas les mots de passe. Un code connu de tous les
> employés finit toujours par circuler : c'est pourquoi il ne donne accès à rien tout
> seul, et que chaque appareil reste révocable un par un. Pour la direction, gardez la
> double authentification (`ADMIN_REQUIRE_2FA=true`).

### Console et tableau de bord : partout, et un lien de secours

La console et le tableau de bord sont **une seule application web**, servie à une
adresse. Tout le reste en découle :

| Où | Comment |
|---|---|
| Navigateur (Chrome, Edge, Safari, Firefox) | ouvrir l'adresse : `console.orion.ci`, `tableau.orion.ci` |
| Windows, macOS | bouton **Installer** de l'écran de connexion (Edge, Chrome), ou les applications de bureau du dossier `bureau/` |
| Android, HarmonyOS | **Installer** : icône sur l'écran d'accueil, plein écran |
| iPhone, iPad | Safari : **Partager**, puis **Sur l'écran d'accueil** |

**Le lien de secours, c'est cette adresse.** Si une application installée pose problème
(mise à jour ratée, poste qui change), l'employé ouvre la même adresse dans n'importe
quel navigateur et retrouve les mêmes données, en direct. Il n'y a rien à maintenir en
double.

**Absentes des moteurs de recherche, volontairement.** Les trois outils internes
(console, tableau de bord, app chauffeur) portent `noindex` (balise et en-tête
`X-Robots-Tag`), et le serveur aussi. On y accède par leur adresse, pas par une
recherche Google : une console d'administration qui apparaît dans un moteur attire les
attaques. « Utilisable dans Chrome, Edge ou Safari » : oui. « Trouvable en cherchant
ORION dans Google » : non, et c'est une protection.

**Téléphone et tablette.** Sur un écran étroit, le menu de la console devient un tiroir
(bouton ☰), les tableaux larges défilent dans leur carte, et les boutons font au moins
40 px de haut.

**Hors connexion.** L'enveloppe de l'application (pages, scripts, styles) est gardée
par l'appareil : elle s'ouvre tout de suite, même sur un réseau lent. Les données, elles,
ne sont **jamais** gardées : courses, alertes et soldes viennent toujours du serveur.

**Serveur de secours (facultatif).** À la construction du site :

```bash
VITE_API_URL=https://api.orion.ci
VITE_API_URLS_SECOURS=https://api2.orion.ci
```

Au lancement, si le serveur principal ne répond pas en 2,5 s, la console et le tableau
de bord travaillent sur la première adresse de secours qui répond. La pastille de
l'en-tête affiche alors « EN DIRECT · SECOURS ». Sur un autre domaine, il faut se
reconnecter. Tant que les données ne sont pas dans une base commune (document 13), un
serveur de secours n'a de sens que s'il lit la même base que le principal.

**Domaines.** Dans `frontend/vercel.json`, remplacer `console.orion.ci`,
`tableau.orion.ci` et `chauffeur.orion.ci` par les vrais domaines, et les ajouter dans
Vercel → Domains.

### Mettre l'admin sur un sous-domaine dédié (recommandé)
1. Dans Vercel → **Domains**, ajoute `admin.tondomaine.ci` au projet frontend.
2. Dans `frontend/vercel.json`, remplace `admin.orion.ci` par ce domaine (règles `rewrites`
   déjà prêtes : sur ce sous-domaine, la racine sert `admin.html`).
3. Résultat : `tondomaine.ci` = app client ; `admin.tondomaine.ci` = console admin.
4. Sécurité en plus (optionnel) : mot de passe Vercel ou **liste d'IP** (bureau ORION).

> 🔒 En production : remplacer le jeton simple par une authentification forte (SSO/JWT + rôles)
> et un **audit log immuable** des actions admin.

## Carte réelle de Côte d'Ivoire et itinéraires routiers

La carte de l'app est une **vraie carte vectorielle** dessinée à partir d'OpenStreetMap :
routes, ponts (HKB, De Gaulle, Félix Houphouët-Boigny, Alassane Ouattara…), échangeurs,
**voies en construction** (en pointillés), quartiers et lagune. Les tuiles viennent
d'OpenFreeMap (gratuit, sans clé, données mises à jour chaque semaine) : un pont ou un
échangeur ajouté dans OpenStreetMap apparaît dans l'app la semaine suivante, sans mise à jour.

L'itinéraire suit les **vraies routes** : le serveur le calcule avec OSRM, le client voit le
tracé, le pont emprunté (« via Pont… »), et la voiture avance le long de la route.

| Variable | Où | Rôle |
|----------|----|------|
| `OSRM_URL` | Backend | Serveur d'itinéraires. Par défaut le serveur public OSRM ; en production, un serveur OSRM d'ORION chargé avec l'extrait OpenStreetMap de la Côte d'Ivoire (Geofabrik). |
| `VITE_MAP_TILES_URL` | Frontend | Serveur de tuiles vectorielles d'ORION (facultatif). |
| `VITE_MAP_GLYPHS_URL` | Frontend | Polices des libellés (facultatif). |
| `VITE_MAP_PROVIDER=stylise` | Frontend | Force la carte stylisée hors-ligne (démo sans réseau). |

> ℹ️ Sans réseau, ou si les tuiles ne répondent pas, l'app bascule seule sur la carte
> stylisée ; si OSRM ne répond pas, le trajet est tracé à vol d'oiseau. La course n'est
> jamais bloquée par la carte. Les crédits (© OpenStreetMap, OpenFreeMap, OSRM) sont
> affichés sur la carte et dans les mentions légales.

## ORION Assurance : dossiers de premiers secours

Les dossiers médicaux (identité, pièce, CMU, groupe sanguin, antécédents, allergies,
traitements, personne à prévenir) sont **chiffrés sur le serveur** (AES-256-GCM, une clé
dédiée, chaque dossier lié à son titulaire). Ils ne sont jamais stockés sur le téléphone.

1. Génère la clé **une seule fois** : `openssl rand -base64 32`.
2. Render → Environment → `MEDICAL_DATA_KEY` = cette valeur. Garde-la aussi dans le coffre
   de la direction : **perdue ou changée, tous les dossiers deviennent illisibles**.
3. Sans clé en production, l'inscription est simplement indisponible (le reste de l'app marche).

Accès console : permission `medical:read` (rôle opérations), **uniquement** pour l'agent qui a
pris en charge une alerte SOS en cours. Chaque ouverture est inscrite au journal d'audit et
signalée au client par un message ; toute tentative hors de ces conditions est refusée et journalisée.

## Tableau de bord ORION (écran de supervision)

Une interface à part, pensée pour l'écran de la salle de supervision : **`/dashboard.html`**
(lien « 📺 Tableau de bord » dans la console). Même identifiants et même session que la
console.

### Qui peut l'ouvrir

- **De droit** (permission `dashboard:read`) : PDG, Directeur Général, Directeur des Affaires
  Administratives, Directeur des Opérations, Directeur Financier, DAF, trésorier(ère)s,
  **service informatique** (rôle `informatique`) et **comptables** (rôle `comptable`), plus le
  compte technique `super_admin`.
- **Managers** (`manager`, `fleet_manager`) : uniquement sur **habilitation individuelle**,
  en trois temps :
  1. le manager la demande depuis l'écran « Accès réservé » du tableau de bord (motif
     obligatoire), ou le service informatique l'inscrit pour lui ;
  2. le service informatique la vérifie et la **transmet à la direction**, avec une date de fin
     facultative ;
  3. un membre de la direction (PDG, DG, DAA, directeur des opérations, directeur financier,
     DAF) l'**accorde** ou la **refuse** avec un motif. Celui qui a transmis ne peut jamais
     accorder, et personne ne traite sa propre habilitation.
  L'habilitation tombe à sa date de fin et se **révoque** à tout moment (motif obligatoire).
  Chaque étape est journalisée (`habilitation.*`) et chacun est prévenu par la messagerie
  interne ; l'écran du manager s'ouvre de lui-même dans les 10 secondes qui suivent l'accord.
- **Tous les autres** : refusés. Chaque tentative (HTTP comme WebSocket) est journalisée et
  signalée à la direction dans les alertes sécurité.

Console : section **Habilitations** (service informatique et direction). Routes :
`GET /admin/habilitations`, `POST /admin/habilitations` (inscription), `POST
/admin/habilitations/:id/transmettre`, `/decision`, `/revoquer` ; côté manager
`GET /admin/habilitations/moi` et `POST /admin/habilitations/demande`.

- **Synchronisé avec tout l'écosystème** : chaque événement du serveur (commande de l'app
  cliente, geste de l'app chauffeur, action de la console, paiement, alerte) arrive dans le
  journal d'activité à l'instant où il se produit (WebSocket `/ws/dashboard`), et les chiffres
  suivent (`GET /admin/dashboard`).
- **Contenu** : courses et livraisons en cours, conducteurs en ligne, chiffre d'affaires et
  courses terminées du jour, sécurité ; carte réelle de la flotte (voitures et motos, trajets
  en cours sur les vraies routes) ; commandes heure par heure ; encaissements par moyen de paiement.
- **Confidentialité** : aucune donnée de santé ; les clients n'y apparaissent que par leur
  prénom et l'initiale de leur nom.
- Sans serveur configuré, l'écran s'ouvre en mode démonstration.

### Onglet « Objectifs et tendances »

Deuxième vue du tableau de bord (`/dashboard.html#objectifs`, données : `GET /admin/dashboard/analyse`).
Le bouton **Défilement auto** alterne les deux vues toutes les 45 secondes (écran mural).

- **Objectifs financiers** du jour, de la semaine, du mois et de l'année : réalisé, part de
  l'objectif, rythme attendu à ce stade, projection en fin de période, comparaison à la période
  précédente au même moment, et un statut (en avance, dans les temps, en retard).
- **Courbe du chiffre d'affaires cumulé** de la période choisie, face à la période précédente et
  au rythme de l'objectif. Le rythme d'une journée ou d'une semaine suit le profil observé
  (heures sur 28 jours, jours sur 8 semaines) : à 9 h, une journée ordinaire n'a fait qu'une
  petite part de son chiffre.
- **Niveau des commandes** par heure (aujourd'hui, hier, moyenne des 4 mêmes jours), par jour
  (cette semaine, la précédente), sur 30 jours (moyenne glissante sur 7 jours) et par mois (cette
  année, la précédente), avec la **hausse ou la baisse** de chaque tranche. Une tranche entamée
  est comparée au même instant de la période de comparaison.
- **Ce qu'il faut retenir** : heure la plus chargée, plus forte hausse et plus forte baisse,
  tendance sur 7 jours, jour le plus chargé.
- Chaque courbe a sa vue « Voir les chiffres » (tableau) ; tout se recalcule toutes les 30 s et
  dès qu'une commande, une course terminée ou un paiement arrive.

Les **objectifs** se règlent dans la console, section Direction Générale, carte « Objectifs
financiers » (`GET`/`PUT /admin/objectifs`). Lecture : comptes qui ouvrent le tableau de bord ; modification :
`finance:write`, journalisée avec l'ancienne valeur (`objectifs.mise_a_jour`).

| Variable | Rôle |
| --- | --- |
| `DEMO_HISTORY_DAYS` | Jours d'historique **fictif** ajoutés aux courbes pour lire des tendances sur un serveur neuf. Non définie : 730 en développement avec simulation, 0 sinon. **Toujours ignorée en production.** L'écran affiche alors « Historique de démonstration ». |

## Livraison moto et paiements mobile money

- Les livraisons sont attribuées aux **coursiers à moto** (catégorie « moto », choisie à
  l'inscription dans l'app chauffeur). La taille du colis ne sert qu'au prix.
- Mobile money : l'app envoie le numéro vérifié du client. **Hors production**, le bac à sable
  confirme le paiement comme le ferait l'opérateur ; **en production**, le paiement reste « en
  attente » jusqu'à la confirmation de l'opérateur réel (Orange Money, Wave, MTN, Moov), à
  brancher avec leurs API.

## Messagerie ORION et contrôle de sécurité

La console (section **Messages clients**) écrit aux clients dans l'app : information,
consigne, ou contrôle de sécurité « votre course se passe-t-elle bien ? » avec réponses
rapides. L'app envoie aussi ce contrôle d'elle-même pendant chaque course, après
`SAFETY_CHECKIN_SECONDS` secondes (180 par défaut, 0 pour désactiver). La réponse
« Je ne me sens pas en sécurité » lève aussitôt une alerte dans la file SAMU.

## SOS : le centre de contrôle prévient les secours

Ce n'est pas au client d'appeler le SAMU, la police ou les pompiers. Dès l'alerte,
l'**agent ORION automatique** lui répond, comprend ce qui se passe (malaise, accident,
agression, incendie, chauffeur dangereux, harcèlement, panne) et **demande au centre** de
prévenir le service qu'il faut. Dans la console, le dossier SOS affiche sa synthèse et
ses demandes : l'opérateur appelle d'un geste (`Appeler`), ou coche une demande interne
(`Marquer fait` : chauffeur joint, course arrêtée, client rappelé). Le client voit
l'avancement réel — « le centre le prévient », « appel en cours », « joint ».

- Dès qu'un opérateur prend le dossier, l'agent automatique l'annonce et se tait.
- Sans réponse du client : relance à 30 s, puis rappel et police par précaution à 75 s.
- Avec un opérateur SMS configuré, le numéro `astreinte-ops` du **Répertoire d'urgence**
  reçoit un SMS à chaque demande : mets-y le vrai numéro d'astreinte.
- Les numéros 185 / 170 / 180 ne s'affichent côté client qu'en dernier recours : alerte
  non transmise, ou centre resté muet trois minutes.

## Activer Google Maps (optionnel)
1. Obtiens une clé sur Google Cloud (APIs : Directions, Places, Maps JavaScript).
2. Backend : variable `GOOGLE_MAPS_API_KEY` (Render → Environment) — itinéraires.
3. Frontend : variable `VITE_GOOGLE_MAPS_API_KEY` (Vercel → Environment, ou à la
   construction de l'APK) — fond de carte Google dans l'app cliente.

Sans clé, ORION fonctionne avec sa propre carte (OpenStreetMap, livrée avec l'application)
et son calcul d'itinéraire interne.

**Dans l'app cliente, sans reconstruire** : Menu (trois traits) → Carte → coller la clé →
« Enregistrer et afficher Google Maps ». La clé reste sur le téléphone. Un aperçu affiche
aussitôt la vraie carte Google ; si Google refuse la clé, l'écran en donne le motif
(clé inconnue, service « Maps JavaScript API » non activé, restriction de site, facturation
non activée) et l'application garde la carte ORION.

**Google Maps comme seule carte (APK cliente).** `scripts/construire-client-google.sh`
construit l'app cliente avec `VITE_MAP_GOOGLE_SEUL=1` : plus de choix du fond, plus de
saisie de clé, plus de carte ORION (ses tuiles ne sont pas livrées, l'APK passe de 27 à
11 Mo). Si Google ne répond pas, l'écran le dit et propose de réessayer ; la recherche et
la commande restent possibles. La clé vient de l'environnement de construction :

```bash
cd frontend
VITE_GOOGLE_MAPS_API_KEY=<clé> scripts/construire-client-google.sh dist
npx cap sync android && (cd android && ./gradlew assembleDebug)
```

Pour l'APK compilé par GitHub (workflow « APK client à installer »), ajouter la clé comme
secret du dépôt nommé `GOOGLE_MAPS_API_KEY` ; sans ce secret, l'APK garde la carte ORION.

Seul le service « Maps JavaScript API » est nécessaire pour afficher la carte. Trois
autres services, à activer sur le même projet Google Cloud, enrichissent l'app cliente ;
chacun est essayé au premier besoin et l'application retient la réponse :

| Service Google | Ce qu'il apporte | Sans lui |
|---|---|---|
| Places API (New) | Les lieux de Google Maps dans la recherche (suggestions, puis liste complète avec « Voir tous les lieux ») | Recherche dans les 48 924 lieux d'ORION |
| Routes API | Trajet tracé sur les routes de Google ; durée avec le trafic du moment et distance affichées sur la carte | Tracé du calcul ORION |
| Geocoding API | Nom de la rue de la position du téléphone et du point choisi sur la carte | Quartier seul |

Menu → Carte → « Services Google » indique, pour chacun, s'il répond pour la clé de
l'application, et « Vérifier maintenant » refait l'essai. Le prix des courses ne dépend
pas de ces services : il reste calculé par ORION. Google facture ces services à l'usage,
au-delà de son quota gratuit mensuel : plafonner les quotas du projet.

Restriction de la clé : l'application Android charge la carte depuis `https://localhost/`.
Une clé limitée par « sites web » doit donc autoriser `https://localhost/*` ; une clé
sans restriction d'application fonctionne aussi (à réserver aux essais). Ne jamais écrire
une clé dans le dépôt.

---

## Aide
Un blocage ? Copie le message d'erreur (Render/Vercel affichent des logs) et envoie-le moi,
je te débloque.
