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

  // Jeton d'accès au dashboard Admin / supervision SAMU (RBAC simple, en-tête x-admin-token).
  // En production : remplacer par un vrai secret + auth forte (SSO/JWT + rôles).
  ADMIN_TOKEN: z.string().default('orion-admin-dev'),

  // Persistance : 'memory' (volatile, défaut/tests) ou 'sqlite' (durable, fichier local).
  // En production : 'postgres' via la même interface Repository (cf. docs).
  PERSISTENCE: z.enum(['memory', 'sqlite']).default('memory'),
  DB_PATH: z.string().default('./data/orion.db'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Configuration invalide:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
