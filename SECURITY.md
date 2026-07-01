# 🔒 ORION — Sécurité & protection des données

Niveau de sécurité élevé pour protéger les données personnelles des clients ivoiriens.

## 1. Authentification & accès
- **Verrouillage biométrique** (empreinte / Face ID) pour ouvrir l'app — WebAuthn (web) /
  Touch ID·Face ID·empreinte (natif via Capacitor). Réglage dans *Sécurité & confidentialité*.
- OTP par SMS **ou WhatsApp** ; JWT courts + refresh tokens (à brancher), RBAC pour l'admin.

## 2. Données personnelles
- **Chiffrement en transit** : TLS partout (HTTPS/WSS).
- **Chiffrement au repos** : documents KYC, RIB, données sensibles via KMS (prod).
- **Minimisation** : on ne stocke que le nécessaire ; numéros masqués lors des appels.
- **RGPD / loi ivoirienne (ARTCI)** : droit d'accès, rectification, effacement ; durées de
  conservation paramétrables (cf. `docs/03`).

## 3. Paiement
- Aucune donnée bancaire stockée par ORION : redirection vers l'app opérateur (Wave, Orange
  Money, MTN MoMo, Moov) ; ORION ne reçoit qu'une confirmation de transaction.
- **Idempotence** sur les paiements (pas de double débit).

## 4. Sécurité des courses
- **Partage de course** à un contact de confiance (lien de suivi en lecture seule, token).
- **Bouton SOS** + **détection d'accident** → SAMU (185) ; ORION peut joindre le contact de
  confiance et identifier le chauffeur par son **matricule ORION**.
- Trajet enregistré, **appel chauffeur ↔ client masqué** (WebRTC).

## 5. Infrastructure
- Rate limiting (anti-abus), validation stricte des entrées (Zod), CORS restreint en prod.
- Logs structurés sans données sensibles ; audit log immuable des actions admin.
- Secrets hors du code (variables d'environnement / coffre).

## 6. Limitations connues (à corriger avant mise en production)
Audit interne — points identifiés, à traiter avant lancement public :
- **Authentification client non appliquée côté API** : les endpoints acceptent un `clientId`/
  `userId` fourni par l'appelant (pas encore de JWT). ⇒ Brancher une vraie auth
  (OTP → JWT courts + refresh, `Authorization: Bearer`) et déduire l'identité du token,
  jamais du corps de requête.
- **Console admin** : authentification par **login + mot de passe** (haché scrypt + sel) →
  **session JWT signée HS256** (expiration configurable, `Authorization: Bearer`). RBAC par
  rôle + connexions (réussies/échouées) journalisées dans l'audit log. L'en-tête
  `x-admin-token` reste accepté pour l'automatisation serveur-à-serveur. Durcissements
  restants pour la production : rotation de `ADMIN_JWT_SECRET`, refresh tokens, audit log
  immuable, liste d'IP, éventuel SSO d'entreprise (OIDC).
- **Lien de partage** : token de 8 caractères (lecture seule, sans données perso). Pour un
  besoin élevé, allonger le token et ajouter une expiration.
- **Rate-limiting global** en place ; ajouter des quotas par utilisateur/route sensible
  (SOS, paiement) une fois l'auth branchée.

## 7. Signalement
Vulnérabilité ? Contact sécurité : `security@orion.ci` (à configurer). Ne pas divulguer
publiquement avant correction.
