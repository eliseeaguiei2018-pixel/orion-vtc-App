import { z } from 'zod';

/**
 * Configuration centralisée et validée.
 * 12-factor : toute la configuration provient de l'environnement.
 * Aucune valeur secrète n'est codée en dur.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Limitation de débit (back-pressure) — protège contre la surcharge.
  // Limiteur de débit (par minute) : par compte vérifié (client, chauffeur), par membre du
  // personnel ORION (la console interroge beaucoup), et par adresse pour l'anonyme — une
  // adresse d'opérateur mobile est partagée par de nombreux téléphones (voir core/limiteur.ts).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),
  RATE_LIMIT_MAX_STAFF: z.coerce.number().int().positive().default(2400),
  RATE_LIMIT_MAX_IP: z.coerce.number().int().positive().default(600),
  // Ouvertures de canaux temps réel anonymes par minute et par adresse (voir core/limiteur.ts).
  RATE_LIMIT_MAX_WS_IP: z.coerce.number().int().positive().default(6000),
  // Canaux temps réel ouverts en même temps depuis une même adresse (garde-fou mémoire).
  WS_MAX_PAR_ADRESSE: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // Verrouillage d'estimation de prix.
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  // Un chauffeur reste « en course » après `completed` le temps d'encaisser. Au-delà
  // de ce délai sans paiement enregistré, il est libéré — sinon un client parti sans
  // régler le bloquerait toute la journée.
  RIDE_UNPAID_RELEASE_MINUTES: z.coerce.number().int().positive().default(5),

  // Délai d'acceptation d'une offre par un chauffeur.
  OFFER_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(15),

  // Arrêt en douceur : délai max pour drainer les requêtes en cours.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Présence chauffeur : TTL de la position dans l'index géo.
  PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(30),

  // En prod : 'redis'. En local/test : 'memory' (aucune infra requise).
  GEO_BACKEND: z.enum(['memory', 'redis']).default('memory'),

  // Partenariat Google Maps (Directions / Distance Matrix / Places).
  // Optionnel : sans clé, on bascule sur un calcul interne (haversine) — l'app fonctionne.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Recherche d'adresses (OpenStreetMap, API Photon). Par défaut le service public
  // (usage modéré) ; à fort volume, une instance ORION. « off » : répertoire local seul.
  GEOCODEUR_URL: z.string().default('https://photon.komoot.io'),
  // Calcul d'itinéraire routier (OSRM, données OpenStreetMap). Par défaut : serveur public
  // de démonstration (usage modéré). En production : serveur ORION dédié, même API.
  // Vide = désactivé (tracé de repli en lignes droites).
  OSRM_URL: z.string().default('https://router.project-osrm.org'),

  // Simulation de course : en l'absence d'app chauffeur, le serveur simule le
  // déplacement du chauffeur et émet les événements temps réel (tracking live).
  // À désactiver en production quand l'app chauffeur fournit les vraies positions.
  // NB : z.coerce.boolean() transforme "false" en true — on parse explicitement.
  SIMULATE_RIDES: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  SIM_TICK_MS: z.coerce.number().int().positive().default(700),
  SIM_ENROUTE_MS: z.coerce.number().int().positive().default(8000),
  SIM_TRIP_MS: z.coerce.number().int().positive().default(12000),

  // Commission plateforme prélevée sur chaque course (0..1).
  PLATFORM_COMMISSION_RATE: z.coerce.number().min(0).max(1).default(0.18),

  // CORS : origine(s) autorisée(s) pour l'app cliente. '*' en dev ; liste en prod.
  CORS_ORIGIN: z.string().default('*'),
  /** SameSite des cookies de session console. « lax » si la console est servie depuis
   *  la même origine que l'API (recommandé) ; « none » si elle est sur une autre
   *  origine — SameSite=None impose Secure et un CORS avec origine explicite. */
  ADMIN_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  /** Cookies marqués Secure (HTTPS uniquement). À activer en production.
   *  Parsé explicitement : z.coerce.boolean() transformerait "false" en true. */
  ADMIN_COOKIE_SECURE: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),

  // Jeton d'accès au dashboard Admin / supervision SAMU (RBAC simple, en-tête x-admin-token).
  // Conservé pour la compatibilité / automatisation ; l'accès humain passe par le login JWT.
  ADMIN_TOKEN: z.string().default('orion-admin-dev'),
  // Comptes admin supplémentaires (couches d'accès), JSON : [{"token","name","role"}].
  // Rôles : super_admin | ops | finance | support | viewer.
  ADMIN_ACCOUNTS: z.string().optional(),

  // --- Authentification console (login + mot de passe → session JWT signée) ---
  // Secret de signature des jetons de session (HS256). À DÉFINIR en production.
  ADMIN_JWT_SECRET: z.string().default('orion-dev-jwt-secret-change-me'),
  // Durée de validité d'une session (secondes). 12 h par défaut.
  ADMIN_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(43_200),
  // Compte super_admin par défaut (dev). En prod : définir ADMIN_USERS (mots de passe hachés).
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('orion-admin-dev'),
  // Comptes avec mot de passe HACHÉ (scrypt), JSON :
  // [{"username","name","role","salt","hash","totp"?}]. Généré via `npm run hash-password`
  // (+ `npm run totp-secret` pour le secret 2FA). Si défini, remplace le compte par défaut.
  ADMIN_USERS: z.string().optional(),
  // Si "true" : la 2FA (TOTP) devient OBLIGATOIRE pour les comptes de direction
  // (ceo, dg, daa, coo, super_admin) — connexion refusée si le compte n'a pas de secret.
  ADMIN_REQUIRE_2FA: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  // CODE DE SYNCHRONISATION ORION : seule son EMPREINTE scrypt est connue du serveur
  // (npm run code-synchro). Le code lui-même n'est écrit nulle part. Vide : l'enrôlement
  // des appareils est indisponible.
  ORION_CODE_SYNCHRO_EMPREINTE: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/, 'empreinte scrypt attendue (npm run code-synchro)').optional()),
  // true : la console et le tableau de bord ne s'ouvrent que sur un appareil enrôlé avec
  // le code de synchronisation (recommandé en production).
  APPAREILS_EXIGES: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  // Verrouillage auto d'une session après N minutes d'inactivité (écran laissé allumé).
  ADMIN_INACTIVITY_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Authentification APP CHAUFFEUR (téléphone + code SMS → jeton signé) ---
  // Secret de signature des jetons chauffeur (HS256), DISTINCT de celui de la console.
  DRIVER_JWT_SECRET: z.string().default('orion-dev-driver-secret-change-me'),
  // Durée de validité d'une session chauffeur (secondes). 30 jours par défaut.
  DRIVER_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  // --- Compte CLIENT (téléphone vérifié par code SMS → jeton signé) ---
  // Secret DISTINCT : un jeton client n'ouvre ni l'app chauffeur ni la console.
  CLIENT_JWT_SECRET: z.string().default('orion-dev-client-secret-change-me'),
  // Session client : 90 jours (le client ne revalide pas son numéro à chaque course).
  CLIENT_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(7_776_000),
  // COMPTE DE VÉRIFICATION APP STORE / GOOGLE PLAY. Les vérificateurs d'Apple et de
  // Google doivent pouvoir se connecter, mais ne reçoivent pas nos SMS : un SEUL
  // numéro, désigné ici, accepte un code fixe. Vide = désactivé (par défaut).
  CLIENT_REVIEW_PHONE: z.string().optional(),
  CLIENT_REVIEW_CODE: z.string().regex(/^\d{6}$/, 'CLIENT_REVIEW_CODE : 6 chiffres').optional(),
  // --- Opérateur SMS (codes de connexion clients et chauffeurs) ---
  // 'orange' : API SMS Orange Côte d'Ivoire ; 'twilio' : secours international ;
  // 'console' : développement (aucun SMS ; refusé en production pour les vrais numéros).
  // (Un champ laissé vide dans l'hébergeur vaut « non défini ».)
  SMS_PROVIDER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['console', 'orange', 'twilio']).default('console')),
  // Nom d'expéditeur affiché sur le téléphone (11 caractères max, validé par l'opérateur).
  SMS_SENDER_NAME: z.string().max(11).default('ORION'),
  // Préfixes autorisés (séparés par des virgules) : bloque l'envoi de SMS facturés vers
  // l'étranger (fraude dite « SMS pumping »).
  SMS_ALLOWED_PREFIXES: z.string().default('+225'),
  ORANGE_SMS_CLIENT_ID: z.string().optional(),
  ORANGE_SMS_CLIENT_SECRET: z.string().optional(),
  // Adresse d'expédition attribuée par Orange (Côte d'Ivoire : tel:+2250000).
  ORANGE_SMS_SENDER: z.string().default('tel:+2250000'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  // CODES PAR WHATSAPP (Twilio, mêmes identifiants TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) :
  // numéro WhatsApp d'expédition (bac à sable Twilio +14155238886, ou le numéro WhatsApp
  // Business d'ORION). Vide : le bouton « Recevoir le code via WhatsApp » n'est pas proposé.
  TWILIO_WHATSAPP_FROM: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Modèle WhatsApp « authentification » approuvé par Meta (identifiant HX…, Content Template
  // Builder de Twilio) : obligatoire hors bac à sable. Vide : message libre (bac à sable).
  TWILIO_WHATSAPP_CONTENT_SID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Validité d'un code SMS de connexion (secondes).
  DRIVER_OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Mode STRICT : si "true", le jeton chauffeur devient OBLIGATOIRE sur toutes les routes
  // /drivers/:id/* (à activer en production). Désactivé par défaut (compatibilité).
  // Non renseigné : strict en production (l'app chauffeur se connecte toujours par code
  // SMS et présente son jeton), souple en développement et en test.
  DRIVER_AUTH_STRICT: z.enum(['true', 'false', 'TRUE', 'FALSE']).optional(),
  // BOÎTIERS TÉLÉMATIQUES (véhicules de location) : jeton partagé que chaque boîtier
  // présente (Authorization: Bearer …) pour remonter sa position. Sans lui en production,
  // les remontées sont refusées : une position falsifiée pourrait masquer un vol ou
  // déclencher une coupure moteur armée. Au moins 24 caractères.
  TELEMATIQUE_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(24, 'TELEMATIQUE_TOKEN : au moins 24 caractères').optional()),
  // TEST DE CHARGE : autorise la préparation d'une flotte de test (/admin/charge/preparer).
  // Toujours refusé en production, quelle que soit cette valeur.
  // File d'attente des connexions entrantes. Node la limite à 511 par défaut : une rafale
  // de connexions simultanées (des milliers de téléphones qui commandent en même temps)
  // peut la remplir, et le système d'exploitation fait alors réessayer les téléphones
  // 1, 3 puis 7 secondes plus tard. Précaution : elle reste bornée par somaxconn.
  LISTEN_BACKLOG: z.coerce.number().int().min(128).max(65_535).default(4096),
  TEST_CHARGE: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),

  // --- Trésorerie (macro-économie) ---
  // Solde du compte séquestre (Escrow) couvrant les portefeuilles virtuels.
  TREASURY_ESCROW_XOF: z.coerce.number().min(0).default(50_000_000),
  // OPEX mensuel (charges) pour le calcul du burn rate / runway.
  TREASURY_MONTHLY_OPEX_XOF: z.coerce.number().min(0).default(8_000_000),
  // Réserve de trésorerie disponible (cash on hand) pour le calcul du runway.
  TREASURY_CASH_XOF: z.coerce.number().min(0).default(120_000_000),

  // --- Messagerie ORION : contrôle de sécurité automatique pendant la course ---
  // Délai (secondes) après la prise en charge avant que l'app demande au client si
  // tout se passe bien. 0 = désactivé.
  SAFETY_CHECKIN_SECONDS: z.coerce.number().int().min(0).default(180),

  // --- Tableau de bord : historique de démonstration ---
  // Nombre de jours d'historique SYNTHÉTIQUE ajoutés aux courbes d'objectifs et de
  // commandes, pour qu'un serveur qui vient de démarrer montre des tendances lisibles.
  // Non défini : 730 jours en développement avec simulation, 0 sinon. Toujours ignoré en
  // production : la direction n'y voit que les vraies courses.
  DEMO_HISTORY_DAYS: z.coerce.number().int().min(0).max(800).optional(),

  // --- ORION Assurance : chiffrement du dossier médical (AES-256-GCM) ---
  // 32 octets aléatoires encodés en base64 (ex. : openssl rand -base64 32). À ne JAMAIS
  // régénérer une fois des dossiers enregistrés : ils deviendraient illisibles.
  // Absente en production : ORION Assurance est désactivé (aucune clé connue n'est utilisée).
  MEDICAL_DATA_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

  // Persistance : 'memory' (volatile, défaut/tests) ou 'sqlite' (durable, fichier local).
  // En production : 'postgres' via la même interface Repository (cf. docs).
  PERSISTENCE: z.enum(['memory', 'sqlite']).default('memory'),
  // Bus temps réel entre instances (plusieurs serveurs derrière un répartiteur) :
  // redis://hote:6379. Vide : une seule instance, le temps réel reste dans le processus.
  // ---- Sécurité Google Cloud (facultative ; rien n'est actif sans ces variables) ----
  // Projet Google Cloud. Inutile sur Cloud Run (lu auprès de l'instance), requis ailleurs.
  GCP_PROJECT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'GCP_PROJECT_ID : identifiant de projet Google Cloud').optional()),
  // reCAPTCHA Enterprise avant l'envoi d'un code SMS et la connexion à la console.
  // off : aucune vérification · observe : évalue et journalise sans bloquer · enforce : bloque.
  RECAPTCHA_MODE: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['off', 'observe', 'enforce']).default('off')),
  RECAPTCHA_SITE_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(20).max(80).optional()),
  // Score minimal accepté (0 = robot, 1 = humain).
  RECAPTCHA_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
  // Identity Platform : accepter les jetons d'identité de Google sur /clients/auth/identity.
  IDENTITY_PLATFORM: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  IDENTITY_PLATFORM_TENANT: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(80).optional()),
  // API Gateway : compte de service de la passerelle et destinataire de son jeton (adresse du serveur).
  GCP_GATEWAY_SERVICE_ACCOUNT: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  GCP_GATEWAY_AUDIENCE: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8).max(300).optional()),
  // true : toute requête qui n'arrive pas par la passerelle est refusée (hors santé et temps réel).
  GCP_GATEWAY_REQUIRED: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  // Débuts de chemins dispensés de passerelle : sonde de santé, canaux temps réel (connexions longues,
  // servies par l'équilibreur) et console (navigateurs du personnel, derrière Cloud Armor).
  GCP_GATEWAY_EXEMPT: z.string().default('/health,/ws,/admin,/appareils,/share'),
  // Nombre de relais de confiance devant le serveur (équilibreur, passerelle) : sans lui, le
  // limiteur de débit voit l'adresse du relais et compte tous les clients comme un seul.
  // 0 : aucun (serveur exposé directement). Cloud Run seul : 1. Équilibreur + Cloud Run : 2.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  REDIS_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  DB_PATH: z.string().default('./data/orion.db'),
}).superRefine((c, ctx) => {
  // PRODUCTION : jamais avec un secret public. Les valeurs par défaut sont écrites dans le
  // dépôt ; les garder en production permet à quiconque de fabriquer un jeton de
  // super-administrateur. Le serveur refuse de démarrer plutôt que de tourner exposé.
  if (c.NODE_ENV === 'production') {
    const secrets: Array<[keyof typeof c, string]> = [
      ['ADMIN_JWT_SECRET', 'orion-dev-jwt-secret-change-me'],
      ['DRIVER_JWT_SECRET', 'orion-dev-driver-secret-change-me'],
      ['CLIENT_JWT_SECRET', 'orion-dev-client-secret-change-me'],
    ];
    for (const [cle, defaut] of secrets) {
      const v = String(c[cle] ?? '');
      if (v === defaut || v.length < 32) {
        ctx.addIssue({ code: 'custom', path: [cle], message: `${cle} : secret propre à la production requis (32 caractères au moins, ex. openssl rand -base64 48)` });
      }
    }
    if (c.ADMIN_TOKEN === 'orion-admin-dev' || c.ADMIN_TOKEN.length < 24) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_TOKEN'], message: 'ADMIN_TOKEN : la valeur de développement ouvre un accès super-administrateur ; définir un jeton de 24 caractères au moins' });
    }
    if (!c.ADMIN_USERS && (c.ADMIN_PASSWORD === 'orion-admin-dev' || c.ADMIN_PASSWORD.length < 12)) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: 'ADMIN_PASSWORD : le mot de passe de développement est public ; en définir un de 12 caractères au moins (ou ADMIN_USERS)' });
    }
  }
  // Sécurité Google Cloud : une protection activée à moitié ne protège pas — on refuse de démarrer.
  if (c.RECAPTCHA_MODE !== 'off' && !c.RECAPTCHA_SITE_KEY) {
    ctx.addIssue({ code: 'custom', path: ['RECAPTCHA_SITE_KEY'], message: 'RECAPTCHA_MODE actif : RECAPTCHA_SITE_KEY (clé de site reCAPTCHA Enterprise) est requise' });
  }
  if (c.IDENTITY_PLATFORM && !c.GCP_PROJECT_ID) {
    ctx.addIssue({ code: 'custom', path: ['GCP_PROJECT_ID'], message: 'IDENTITY_PLATFORM=true : GCP_PROJECT_ID est requis (les jetons sont vérifiés pour ce projet)' });
  }
  if (Boolean(c.GCP_GATEWAY_SERVICE_ACCOUNT) !== Boolean(c.GCP_GATEWAY_AUDIENCE)) {
    ctx.addIssue({ code: 'custom', path: ['GCP_GATEWAY_AUDIENCE'], message: 'API Gateway : GCP_GATEWAY_SERVICE_ACCOUNT et GCP_GATEWAY_AUDIENCE vont ensemble' });
  }
  if (c.GCP_GATEWAY_REQUIRED && !c.GCP_GATEWAY_SERVICE_ACCOUNT) {
    ctx.addIssue({ code: 'custom', path: ['GCP_GATEWAY_REQUIRED'], message: 'GCP_GATEWAY_REQUIRED=true : GCP_GATEWAY_SERVICE_ACCOUNT et GCP_GATEWAY_AUDIENCE sont requis' });
  }
  // Un opérateur choisi sans ses identifiants : le serveur refuse de démarrer, plutôt que
  // de laisser les clients attendre un SMS qui ne partira jamais.
  if (c.MEDICAL_DATA_KEY && Buffer.from(c.MEDICAL_DATA_KEY, 'base64').length !== 32) {
    ctx.addIssue({ code: 'custom', path: ['MEDICAL_DATA_KEY'], message: 'MEDICAL_DATA_KEY : 32 octets encodés en base64 (openssl rand -base64 32)' });
  }
  if (c.SMS_PROVIDER === 'orange' && (!c.ORANGE_SMS_CLIENT_ID || !c.ORANGE_SMS_CLIENT_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['ORANGE_SMS_CLIENT_ID'], message: 'SMS_PROVIDER=orange : ORANGE_SMS_CLIENT_ID et ORANGE_SMS_CLIENT_SECRET sont requis' });
  }
  if (c.TWILIO_WHATSAPP_FROM && (!c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN)) {
    ctx.addIssue({ code: 'custom', path: ['TWILIO_WHATSAPP_FROM'], message: 'TWILIO_WHATSAPP_FROM : TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN sont requis pour envoyer les codes par WhatsApp' });
  }
  if (c.SMS_PROVIDER === 'twilio' && (!c.TWILIO_ACCOUNT_SID || !c.TWILIO_AUTH_TOKEN || (!c.TWILIO_FROM && !c.TWILIO_MESSAGING_SERVICE_SID))) {
    ctx.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: 'SMS_PROVIDER=twilio : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_FROM (ou TWILIO_MESSAGING_SERVICE_SID) sont requis' });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Configuration invalide:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  DRIVER_AUTH_STRICT: parsed.data.DRIVER_AUTH_STRICT === undefined
    ? parsed.data.NODE_ENV === 'production'
    : parsed.data.DRIVER_AUTH_STRICT.toLowerCase() === 'true',
};
export type Config = typeof config;
