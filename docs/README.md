# Documentation ORION VTC

Documentation fonctionnelle et technique de la plateforme de mobilité verte ORION.

| # | Document | Sujet |
|---|----------|-------|
| 01 | [Vue d'ensemble](./01-vue-densemble.md) | Principes, 3 interfaces, architecture macro, cycle de vie d'une course |
| 02 | [Parcours utilisateurs (User Flows)](./02-user-flows.md) | Enchaînement des écrans : client, chauffeur, admin |
| 03 | [Critères de validation réglementaires](./03-criteres-validation-reglementaires.md) | Documents KYC chauffeur/véhicule + workflow de validation |
| 04 | [Stratégie d'extension des services](./04-strategie-extension-services.md) | Architecture multi-services (VTC, livraison, micro-mobilité) |
| 05 | [Architecture & scalabilité](./05-architecture-scalabilite.md) | Robustesse et passage à l'échelle |
| 06 | [Modèle de données](./06-modele-de-donnees.md) | Entités et choix structurants |
| 07 | [Côte d'Ivoire, sécurité & temps réel](./07-cote-divoire-securite-temps-reel.md) | Plan directeur CI, mobile money, détection d'accident + SAMU, WebSocket, Google Maps |
| 08 | [Persistance des données](./08-persistance.md) | Repository (mémoire / SQLite / PostgreSQL), write-through + réhydratation |
| 09 | [Dossier de reprise — App Chauffeur](./09-reprise-app-chauffeur.md) | Contexte, règles du projet, points d'accroche |
| 10 | [Application Chauffeur](./10-app-chauffeur.md) | Fonctionnalités, synchronisation console, endpoints, règles métier, sécurité |
| 11 | [Console : les sessions](./11-console-sessions.md) | Le poste de travail de chaque employé : accès et comptes, carte des sessions, interconnexion, rôles, règles du dispatch |
| 12 | [Test de charge](./12-test-de-charge.md) | 5 000 courses simultanées et des centaines de SOS : lancer le banc, mesures, résultats, faiblesses corrigées |
| 13 | [Volume](./13-volume-millions-de-donnees.md) | Un million de courses et 1,7 million d'écritures : index, cumuls financiers exacts, grand livre par pages, exports par tranches, compression, mesures et limites |
| 14 | [Intégration véhicules](./14-integration-vehicules.md) | App Chauffeur sur l'écran du véhicule (appairage par code), HarmonyOS/ArkWeb, kit constructeurs (OpenAPI), 120 Hz et plus |
| 15 | [Graphisme premium](./15-graphisme-premium.md) | Palier de finition des 4 interfaces : polices variables, chiffres alignés, fluidité 120/144 Hz, respect des préférences de mouvement, diagnostic ?fps=1 |

> Les diagrammes sont en **Mermaid** et se rendent automatiquement sur GitHub.

## Lien avec le code
- **Backend** [`../backend`](../backend) : moteur multi-service, tarification FCFA verrouillée,
  matching géolocalisé, conformité KYC, plan directeur CI, mobile money, sécurité/SAMU,
  temps réel WebSocket, Google Maps, et robustesse (idempotence, rate limiting, health
  checks, graceful shutdown).
- **App Client** [`../frontend`](../frontend) : application premium mobile-first (Abidjan),
  livrée en premier.
- **App Chauffeur** [`../frontend/driver.html`](../frontend/driver.html) : troisième page du même
  projet, synchronisée en temps réel avec le backend et la console (voir [doc 10](./10-app-chauffeur.md)).
- **Console Admin** [`../frontend/admin.html`](../frontend/admin.html) : 17 sessions métier.
