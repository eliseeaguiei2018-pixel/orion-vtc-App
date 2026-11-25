# ORION VTC — Modèle de données

Modèle conçu pour le multi-service (voir [`04-strategie-extension-services.md`](./04-strategie-extension-services.md))
et le passage à l'échelle (voir [`05-architecture-scalabilite.md`](./05-architecture-scalabilite.md)).

```mermaid
erDiagram
    USER ||--o{ RIDE : "réserve"
    USER ||--o{ PAYMENT_METHOD : possède
    USER ||--o{ FAVORITE_PLACE : enregistre
    DRIVER ||--|| USER : "est un"
    DRIVER ||--o{ VEHICLE : conduit
    DRIVER ||--o{ DOCUMENT : fournit
    VEHICLE ||--o{ DOCUMENT : possède
    DRIVER ||--o{ RIDE : réalise
    RIDE ||--|| QUOTE : "verrouille"
    RIDE ||--o| PAYMENT : génère
    RIDE ||--o{ RATING : reçoit
    RIDE ||--o{ RIDE_EVENT : journalise
    SERVICE_CATALOG ||--o{ RIDE : "type de service"
    ZONE ||--o{ PRICING_RULE : "tarif"
    ZONE ||--o{ SERVICE_CATALOG : "activé dans"

    USER {
        uuid id PK
        string phone UK
        string email
        string full_name
        string status
        timestamptz created_at
    }
    DRIVER {
        uuid id PK
        uuid user_id FK
        string kyc_status
        string availability
        float rating_avg
        int rating_count
        decimal wallet_balance
        string jurisdiction
    }
    VEHICLE {
        uuid id PK
        uuid driver_id FK
        string plate UK
        string category
        string green_type
        string status
    }
    DOCUMENT {
        uuid id PK
        uuid owner_id FK
        string owner_type
        string doc_type
        string status
        date expires_at
        timestamptz reviewed_at
    }
    QUOTE {
        uuid id PK
        string lock_id UK
        decimal amount
        string currency
        jsonb breakdown
        timestamptz expires_at
    }
    RIDE {
        uuid id PK
        uuid client_id FK
        uuid driver_id FK
        string service_type
        string status
        jsonb origin
        jsonb destination
        uuid quote_id FK
        string idempotency_key UK
        timestamptz created_at
    }
    PAYMENT {
        uuid id PK
        uuid ride_id FK
        string method
        decimal amount
        decimal commission
        string status
        string idempotency_key UK
    }
    RATING {
        uuid id PK
        uuid ride_id FK
        string from_role
        int stars
        text comment
    }
    RIDE_EVENT {
        uuid id PK
        uuid ride_id FK
        string type
        jsonb payload
        timestamptz at
    }
```

## Tables transverses
- `compliance_rules` — règles KYC par juridiction (cf. doc 03).
- `pricing_rules` — paramètres de tarification par zone & catégorie & service.
- `service_catalog` — services activés par zone (cf. doc 04).
- `idempotency_keys` — neutralise les doublons de requêtes.
- `audit_log` — trace immuable des actions admin.
- `driver_locations` — positions (volatile : Redis Geo en prod ; table partitionnée pour l'historique).

## Choix structurants
- **`service_type` sur `RIDE`** + table générique `jobs` à terme : socle multi-service.
- **`idempotency_key` unique** sur `RIDE` et `PAYMENT` : robustesse aux ré-essais.
- **`QUOTE.lock_id`** : prix verrouillé entre estimation et création (transparence).
- **`RIDE_EVENT`** : journal d'événements = source de vérité pour le temps réel et l'audit.
- **`jsonb`** pour `origin`/`destination`/`breakdown` : flexibilité sans migration lourde.
