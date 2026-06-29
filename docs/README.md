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

> Les diagrammes sont en **Mermaid** et se rendent automatiquement sur GitHub.

## Lien avec le code
La fondation technique décrite ici est implémentée dans [`../backend`](../backend) :
moteur multi-service, tarification verrouillée, matching géolocalisé, conformité KYC,
et patterns de robustesse (idempotence, rate limiting, health checks, graceful shutdown).
