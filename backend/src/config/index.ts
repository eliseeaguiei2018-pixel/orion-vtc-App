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
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
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
  // Validité d'un code SMS de connexion (secondes).
  DRIVER_OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Mode STRICT : si "true", le jeton chauffeur devient OBLIGATOIRE sur toutes les routes
  // /drivers/:id/* (à activer en production). Désactivé par défaut (compatibilité).
  DRIVER_AUTH_STRICT: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),

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

  // --- ORION Assurance : chiffrement du dossier médical (AES-256-GCM) ---
  // 32 octets aléatoires encodés en base64 (ex. : openssl rand -base64 32). À ne JAMAIS
  // régénérer une fois des dossiers enregistrés : ils deviendraient illisibles.
  // Absente en production : ORION Assurance est désactivé (aucune clé connue n'est utilisée).
  MEDICAL_DATA_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

  // Persistance : 'memory' (volatile, défaut/tests) ou 'sqlite' (durable, fichier local).
  // En production : 'postgres' via la même interface Repository (cf. docs).
  PERSISTENCE: z.enum(['memory', 'sqlite']).default('memory'),
  DB_PATH: z.string().default('./data/orion.db'),
}).superRefine((c, ctx) => {
  // Un opérateur choisi sans ses identifiants : le serveur refuse de démarrer, plutôt que
  // de laisser les clients attendre un SMS qui ne partira jamais.
  if (c.MEDICAL_DATA_KEY && Buffer.from(c.MEDICAL_DATA_KEY, 'base64').length !== 32) {
    ctx.addIssue({ code: 'custom', path: ['MEDICAL_DATA_KEY'], message: 'MEDICAL_DATA_KEY : 32 octets encodés en base64 (openssl rand -base64 32)' });
  }
  if (c.SMS_PROVIDER === 'orange' && (!c.ORANGE_SMS_CLIENT_ID || !c.ORANGE_SMS_CLIENT_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['ORANGE_SMS_CLIENT_ID'], message: 'SMS_PROVIDER=orange : ORANGE_SMS_CLIENT_ID et ORANGE_SMS_CLIENT_SECRET sont requis' });
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

export const config = parsed.data;
export type Config = typeof config;
