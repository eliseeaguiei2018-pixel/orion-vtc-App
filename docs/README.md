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

> Les diagrammes sont en **Mermaid** et se rendent automatiquement sur GitHub.

## Lien avec le code
- **Backend** [`../backend`](../backend) : moteur multi-service, tarification FCFA verrouillée,
  matching géolocalisé, conformité KYC, plan directeur CI, mobile money, sécurité/SAMU,
  temps réel WebSocket, Google Maps, et robustesse (idempotence, rate limiting, health
  checks, graceful shutdown).
- **App Client** [`../frontend`](../frontend) : application premium mobile-first (Abidjan),
  livrée en premier. L'app chauffeur est un projet séparé, à venir.
