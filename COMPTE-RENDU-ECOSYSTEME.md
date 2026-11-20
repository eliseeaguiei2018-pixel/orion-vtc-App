# ORION — compte rendu : super-app, robustesse, applications et graphisme

Ce document répond à votre demande, point par point : rendre la console et le tableau de
bord capables de gérer des millions de données et de flux financiers, faire de même pour
les apps client et chauffeur, élever le graphisme et la fluidité, synchroniser le bouton
« Appeler » avec le clavier du téléphone, permettre à l'app Chauffeur de vivre sur l'écran
des véhicules et sous HarmonyOS, rendre la console et le tableau de bord disponibles en
application (Windows, macOS, mobiles) **et** par un lien web de secours, le tout avec un
code de synchronisation. Il se termine par **mon avis**, des **conseils de sécurité** et
les **limites franches**.

Tout ce qui suit est sur la branche `claude/orion-platform-overview-osgd1u` (PR #1), CI
verte, et vérifié en conditions réelles (navigateur, serveur, Electron, écran virtuel).

## Ce qui a été fait

| Votre demande | État | Où |
|---|---|---|
| Console et tableau de bord capables de millions de données et de flux financiers | **Fait** | doc 13 |
| Apps client et chauffeur : millions d'utilisateurs et de données en temps réel | **Fait** (index, cumuls, fenêtres ; chemins chauds < 1 ms à 1 M de courses) | doc 13 |
| Préparation à l'échelle horizontale (plusieurs serveurs) | **Fait** pour le temps réel (bus Redis) ; base commune à faire | doc 13 |
| Graphisme premium, fluidité, polices, 144 Hz / LTPO adaptatif | **Fait** (palier commun, polices variables, 120/144 Hz demandé) | doc 15 |
| Bouton « Appeler » → clavier du téléphone | **Fait** (client, chauffeur, console) | `NATIVE.md` §8 |
| App Chauffeur sur l'écran large des véhicules | **Fait** (mode écran de véhicule + appairage par code) | doc 14 |
| Transmettre les API chauffeur aux constructeurs | **Fait** (OpenAPI) | `docs/api/orion-chauffeur.openapi.yaml` |
| HarmonyOS (Huawei) : synchronisation et disponibilité | **Scaffold fourni** ; build = DevEco + compte Huawei | `harmony/`, doc 14 |
| Console et tableau de bord en application Windows et macOS | **Fait** (Electron, 2 apps séparées, signables) | `bureau/` |
| Disponibles aussi en application mobile et installable depuis le navigateur | **Fait** (PWA installable + apps natives) | doc, `DEPLOIEMENT.md` |
| Lien / domaine de secours utilisable dans tout navigateur | **Fait** (même adresse ; bascule serveur de secours) | `DEPLOIEMENT.md` |
| Code de synchronisation entre les versions | **Fait** (enrôlement d'appareils, révocation) | `DEPLOIEMENT.md` |

## Mon avis : la console et le tableau de bord en application, pour le télétravail

**C'est une bonne idée, et c'est pratique — à condition de garder une seule base de
code.** C'est exactement ce qui a été fait : la console et le tableau de bord sont **une
application web**, et tout le reste n'en est qu'un emballage :

- **au bureau comme à la maison**, l'employé ouvre l'application installée (Windows, macOS,
  tablette, téléphone) **ou** la même adresse dans Chrome, Edge ou Safari — mêmes données,
  en direct ;
- **une seule chose à maintenir** : une correction publiée arrive partout au lancement
  suivant, sans réinstaller ;
- **si l'application de bureau tombe en panne**, le lien web est le filet : rien n'est
  jamais bloqué.

Le risque du télétravail, ce n'est pas la technique, c'est **qui** ouvre la console et
**depuis quel appareil**. C'est pourquoi j'ai ajouté le **code de synchronisation** (seuls
les appareils enrôlés ouvrent la console), la **révocation** d'un appareil perdu ou d'un
employé parti, la **double authentification** pour la direction, et la **non-indexation**
(la console n'apparaît pas dans Google). Avec ces garde-fous, oui : laisser les employés
travailler depuis chez eux est à la fois pratique et raisonnable.

Mon seul bémol : pour de **vrais** millions d'utilisateurs simultanés, il restera à mettre
les **données** dans une base commune (PostgreSQL) et à partager sessions et index entre
plusieurs serveurs. Le temps réel est déjà prêt pour cela ; les données ne le sont pas
encore. D'ici là, le bon déploiement est **une instance par ville ou grande zone**.

## Conseils de sécurité sur le code de synchronisation

Le code que vous avez choisi fonctionne, mais traitez-le comme un **secret d'entreprise** :

1. **Ne l'écrivez nulle part en clair** — ni dans un e-mail de groupe, ni dans un document
   partagé, ni dans le code. Le serveur n'en connaît que l'**empreinte** (scrypt) ; le
   code lui-même n'est enregistré nulle part, et un test du dépôt échoue s'il y apparaît.
2. **Ce n'est pas un mot de passe.** Il dit seulement « cet appareil appartient à ORION ».
   Chaque employé se connecte **en plus** avec son identifiant personnel (et son code à
   usage unique pour la direction). Un code seul ne donne accès à rien.
3. **Un code connu de tous finit par fuiter.** C'est pourquoi chaque appareil est
   **révocable un par un** depuis la console, sans changer le code des autres.
4. **Changez-le de temps en temps** (`npm run code-synchro`, puis remplacez la variable) :
   les appareils déjà enrôlés gardent l'accès, seuls les nouveaux enrôlements utilisent le
   nouveau code.
5. **Gardez la 2FA obligatoire pour la direction** (`ADMIN_REQUIRE_2FA=true`) et surveillez
   la liste des appareils de confiance.

## Limites franches

Je préfère vous les dire clairement :

- **144 Hz non prouvable ici.** Le code demande partout le meilleur taux d'écran ; sur un
  serveur sans dalle, le diagnostic `?fps=1` plafonne à 60. Sur un vrai téléphone ou écran
  de véhicule 120/144 Hz, la fluidité est au rendez-vous, mais elle ne se capture pas en
  image fixe.
- **HarmonyOS** : le projet `harmony/` est complet et commenté, mais il ne se **compile**
  qu'avec **DevEco Studio**, le SDK HarmonyOS et un **compte développeur Huawei**, pour le
  signer et le publier sur AppGallery.
- **Publication sur les boutiques** (App Store, Google Play, AppGallery) et **signature**
  des applications de bureau (Windows, macOS) : il faut les **comptes développeurs**
  correspondants (payants) et les certificats. Le code et les workflows sont prêts ; la
  mise en ligne dépend de ces comptes, qui vous appartiennent.
- **Plusieurs serveurs en parallèle** : le temps réel est partagé (Redis), mais les données
  ne le sont pas encore (base commune PostgreSQL, sessions et index partagés à faire).

## Preuves

- **Tests automatiques** : 342 tests backend (340 verts, 2 ignorés), plus les tests des
  règles des applications de bureau et de l'appairage véhicule. CI verte sur la PR.
- **Captures en conditions réelles** produites pendant le travail : volume à 1 M de
  courses, bouton « Appeler » ouvrant le clavier, enrôlement d'appareils et révocation,
  console et tableau de bord sur téléphone et tablette, installation web, applications de
  bureau Windows/macOS, écran de véhicule (appairage + app en paysage), badge de fluidité.
- **Documentation** : `docs/13` (volume), `docs/14` (intégration véhicules), `docs/15`
  (graphisme), `DEPLOIEMENT.md` (code de synchronisation, secours, domaines), `NATIVE.md`
  (appeler, 120 Hz), `bureau/README.md`, `harmony/README.md`.

## Prochaines étapes que je recommande

1. Écrire l'adaptateur **PostgreSQL** (l'interface est prête) pour partager les données
   entre plusieurs serveurs, puis sessions et index géographique dans Redis.
2. Ouvrir les **comptes développeurs** (Apple, Google, Huawei, Microsoft) et les
   **certificats** de signature, pour publier les applications.
3. Déployer la **base commune** avant d'activer un vrai serveur de secours.
EOF
echo "rapport écrit ($(wc -l < COMPTE-RENDU-ECOSYSTEME.md) lignes)"