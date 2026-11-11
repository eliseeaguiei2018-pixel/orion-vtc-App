# ORION VTC — Parcours utilisateurs (User Flows)

Ce document modélise l'enchaînement des écrans pour les trois interfaces.
Les diagrammes utilisent la syntaxe Mermaid (rendue par GitHub).

---

## 1. Application Client — de l'ouverture à la notation

### 1.1 Flux nominal (vue d'ensemble)

```mermaid
flowchart TD
    A[Ouverture app] --> B{Compte existant ?}
    B -- Non --> C[Inscription : tel + OTP]
    C --> D[Profil minimal]
    B -- Oui --> E[Connexion]
    D --> F
    E --> F[Écran d'accueil + carte]
    F --> G[Géolocalisation auto du départ]
    G --> H[Saisie destination]
    H --> I[Choix catégorie véhicule]
    I --> J[Estimation prix AVANT validation]
    J --> K{Code promo ?}
    K -- Oui --> L[Application promo + recalcul]
    K -- Non --> M
    L --> M[Choix moyen de paiement]
    M --> N[Validation course - prix verrouillé]
    N --> O[Recherche chauffeur]
    O --> P{Chauffeur trouvé ?}
    P -- Non / timeout --> Q[Proposition : élargir / réessayer]
    Q --> O
    P -- Oui --> R[Chauffeur assigné + ETA]
    R --> S[Suivi temps réel : chauffeur en route]
    S --> T[Chauffeur arrivé - notification]
    T --> U[Course en cours - suivi trajet]
    U --> V[Arrivée destination]
    V --> W[Paiement capturé / confirmé]
    W --> X[Notation chauffeur + pourboire]
    X --> Y[Reçu + historique mis à jour]
    Y --> Z[Retour accueil]
```

### 1.2 Écrans détaillés

| # | Écran | Données affichées | Actions | Appel API |
|---|-------|-------------------|---------|-----------|
| 1 | Splash / Onboarding | Logo, valeur produit | Continuer | — |
| 2 | Inscription | Champ téléphone | Demander OTP | `POST /auth/otp/request` |
| 3 | Vérification OTP | 6 chiffres | Valider | `POST /auth/otp/verify` |
| 4 | Accueil | Carte, position, raccourcis (domicile/travail) | Saisir destination | `GET /me`, `GET /places/favorites` |
| 5 | Recherche destination | Autocomplétion adresses | Sélectionner | `GET /places/autocomplete` |
| 6 | Choix véhicule + estimation | Catégories, prix, ETA par catégorie | Sélectionner catégorie | `POST /pricing/estimate` |
| 7 | Confirmation | Prix **verrouillé**, paiement, promo | Confirmer | `POST /rides` |
| 8 | Recherche chauffeur | Animation, possibilité d'annuler | Annuler | WebSocket `ride.searching` |
| 9 | Suivi chauffeur | Position live, plaque, modèle, note, ETA, SOS | Appeler, partager, SOS | WebSocket `ride.driver_location` |
| 10 | En course | Itinéraire, ETA destination, partage | Partager trajet, SOS | WebSocket `ride.in_progress` |
| 11 | Fin / Paiement | Montant final, détail | Confirmer paiement | `POST /rides/:id/pay` |
| 12 | Notation | Étoiles, tags, pourboire, commentaire | Soumettre | `POST /rides/:id/rate` |

### 1.3 Flux d'erreur et cas limites

```mermaid
flowchart TD
    subgraph Cas limites
      E1[Pas de réseau] --> E1a[Mode dégradé + file d'attente locale]
      E2[GPS indisponible] --> E2a[Saisie manuelle du départ]
      E3[Paiement refusé] --> E3a[Proposer autre moyen / espèces]
      E4[Annulation chauffeur] --> E4a[Re-matching automatique, sans re-paiement]
      E5[Aucun chauffeur dispo] --> E5a[Notif quand dispo / programmer course]
      E6[Double tap validation] --> E6a[Idempotency-Key : pas de double course]
    end
```

### 1.4 Compte, photo, paramètres et annulation

- **Compte** : nom, numéro, e-mail facultatif ; le numéro est vérifié par un code SMS à
  6 chiffres. Un numéro vérifié = un compte : sur un nouveau téléphone, le client retrouve
  son compte et son historique. Sur un téléphone partagé, une nouvelle inscription reçoit
  son propre compte et n'écrase jamais celui de la personne précédente.
- **Photo** : prise avec la caméra frontale ou choisie dans la galerie, recadrée et
  compressée par l'app, vérifiée octet par octet par le serveur. Visible par la console
  (fiche client) et dans le dossier SOS ; modifiable ou supprimable à tout moment.
- **Paramètres** : profil (photo, nom, e-mail, numéro vérifié, compteurs), historique des
  courses (terminées et annulées : qui, pourquoi, combien ; reçu, chauffeur, paiement,
  note, alerte SOS), alertes SOS, portefeuille, abonnement, sécurité, préférences, aide,
  conditions et confidentialité, déconnexion, suppression du compte.
- **Annulation** : motif obligatoire, frais annoncés avant de confirmer. Gratuite sans
  chauffeur attribué, pendant le délai de grâce, pour un motif de sécurité (le bouton SOS
  est proposé) ou si le chauffeur a demandé l'annulation (signalé à la console).
- Pendant la course, la carte « Course suivie par ORION · intervention possible » est en orange.

> **Règle de transparence** : entre l'écran 6 (estimation) et l'écran 11 (paiement),
> le prix ne change pas, **sauf** modification d'itinéraire par le passager
> (arrêt ajouté, destination changée) — auquel cas un nouvel écran d'estimation est présenté.

---

## 2. Application Chauffeur

```mermaid
flowchart TD
    A[Connexion] --> B{Compte validé ?}
    B -- Non --> C[Écran : statut KYC + documents manquants]
    C --> D[Upload documents]
    D --> E[En attente de validation admin]
    B -- Oui --> F[Tableau de bord chauffeur]
    F --> G{Passer en ligne ?}
    G -- Oui --> H[En ligne : attente de demandes]
    H --> I[Demande reçue : trajet, prix, distance, note client]
    I --> J{Accepter en < 15 s ?}
    J -- Non --> K[Demande réattribuée + impact score]
    K --> H
    J -- Oui --> L[Navigation vers client]
    L --> M[Arrivé - signaler]
    M --> N[Client à bord - démarrer course]
    N --> O[Navigation vers destination]
    O --> P[Terminer la course]
    P --> Q[Encaissement / wallet crédité]
    Q --> R[Notation du client]
    R --> H
    F --> S[Revenus du jour / objectifs]
    F --> T[Wallet : solde + retrait]
    F --> U[Historique des courses]
```

### Statuts du chauffeur
`HORS_LIGNE` → `EN_LIGNE` → `EN_COURSE` → (`EN_PAUSE`) → `HORS_LIGNE`

---

## 3. Tableau de bord Administrateur

```mermaid
flowchart TD
    A[Connexion admin RBAC] --> B[Vue d'ensemble : KPI temps réel]
    B --> C[File de validation chauffeurs]
    C --> C1[Examen documents]
    C1 --> C2{Conforme ?}
    C2 -- Oui --> C3[Valider chauffeur]
    C2 -- Non --> C4[Rejeter + motif / demander complément]
    B --> D[Carte live : toutes les courses]
    B --> E[Gestion véhicules]
    B --> F[Commissions par catégorie/zone]
    B --> G[Promotions : créer / cibler / suivre]
    B --> H[Support : tickets & litiges]
    B --> I[Statistiques & exports]
    B --> J[Tarification dynamique par zone]
```

---

## 4. Légende des conventions

- **Prix verrouillé** : valeur figée par le backend (`pricing.lockId`) à l'estimation,
  ré-utilisée lors de la création de la course pour empêcher toute dérive.
- **Idempotency-Key** : en-tête HTTP fourni par le client sur les opérations sensibles
  (création de course, paiement) pour garantir l'absence de doublon malgré les ré-essais.
- **WebSocket** : canal temps réel pour la position du chauffeur et les transitions d'état.
